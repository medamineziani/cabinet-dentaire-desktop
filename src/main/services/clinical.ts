import { z } from "zod";
import { ALL_TEETH, APPOINTMENT_STATUS, NON_BLOCKING_STATUS, keysOf } from "@shared/constants";
import { appointmentSchema, consultationSchema, pageInput, patientTreatmentSchema, toCents, toothSchema, treatmentSchema } from "@shared/schemas";
import { db } from "../db";
import type { Prisma } from "../db/generated/client";
import { AppError, audit, proc } from "../ipc/procedure";
import { displayName } from "../security/session";

const personName = { select: { id: true, firstName: true, lastName: true } } as const;

/** Conflit : même dentiste ou même patient sur un créneau qui chevauche */
async function findConflict(tx: Prisma.TransactionClient, a: { patientId: string; dentistId: string; startsAt: Date; endsAt: Date }, excludeId?: string) {
  const overlap = { startsAt: { lt: a.endsAt }, endsAt: { gt: a.startsAt }, status: { notIn: NON_BLOCKING_STATUS }, ...(excludeId ? { id: { not: excludeId } } : {}) };
  const dentist = await tx.appointment.findFirst({ where: { ...overlap, dentistId: a.dentistId }, include: { patient: personName } });
  if (dentist) return `Ce dentiste a déjà un rendez-vous sur ce créneau (${dentist.patient.firstName} ${dentist.patient.lastName}).`;
  const patient = await tx.appointment.findFirst({ where: { ...overlap, patientId: a.patientId } });
  return patient ? "Ce patient a déjà un rendez-vous sur ce créneau." : null;
}

const appointmentInclude = { patient: { select: { id: true, firstName: true, lastName: true, fileNumber: true, phone: true, isDemo: true } }, dentist: personName, consultation: { select: { id: true } } } as const;

export const appointments = {
  range: proc({
    access: "appointments.read",
    input: z.object({ from: z.coerce.date(), to: z.coerce.date(), dentistId: z.string().optional() }),
    run: ({ input }) =>
      db().appointment.findMany({
        where: { startsAt: { gte: input.from, lt: input.to }, ...(input.dentistId ? { dentistId: input.dentistId } : {}) },
        orderBy: { startsAt: "asc" },
        include: appointmentInclude,
      }),
  }),

  forPatient: proc({
    access: "appointments.read",
    input: z.object({ patientId: z.string() }),
    run: ({ input }) => db().appointment.findMany({ where: { patientId: input.patientId }, orderBy: { startsAt: "desc" }, include: appointmentInclude }),
  }),

  create: proc({
    access: "appointments.write",
    input: appointmentSchema,
    run: async ({ input, user }) => {
      const created = await db().$transaction(async (tx) => {
        const conflict = await findConflict(tx, input);
        if (conflict) throw new AppError(conflict);
        return tx.appointment.create({ data: input, include: appointmentInclude });
      });
      await audit(user, "appointment.create", "Appointment", created.id);
      return created;
    },
  }),

  /** Modification et déplacement : même contrôle de conflit */
  update: proc({
    access: "appointments.write",
    input: appointmentSchema.safeExtend({ id: z.string() }),
    run: async ({ input: { id, ...data }, user }) => {
      const updated = await db().$transaction(async (tx) => {
        if (!NON_BLOCKING_STATUS.includes(data.status)) {
          const conflict = await findConflict(tx, data, id);
          if (conflict) throw new AppError(conflict);
        }
        return tx.appointment.update({ where: { id }, data, include: appointmentInclude });
      });
      await audit(user, "appointment.update", "Appointment", id);
      return updated;
    },
  }),

  setStatus: proc({
    access: "appointments.write",
    input: z.object({ id: z.string(), status: z.enum(keysOf(APPOINTMENT_STATUS)) }),
    run: async ({ input, user }) => {
      const updated = await db().$transaction(async (tx) => {
        const current = await tx.appointment.findUniqueOrThrow({ where: { id: input.id } });
        // Réactiver un rendez-vous annulé : le créneau a pu être redonné
        if (NON_BLOCKING_STATUS.includes(current.status as never) && !NON_BLOCKING_STATUS.includes(input.status)) {
          const conflict = await findConflict(tx, current, current.id);
          if (conflict) throw new AppError(conflict);
        }
        return tx.appointment.update({ where: { id: input.id }, data: { status: input.status }, include: appointmentInclude });
      });
      await audit(user, "appointment.status", "Appointment", input.id, input.status);
      return updated;
    },
  }),
};

export const consultations = {
  list: proc({
    access: "consultations.read",
    input: pageInput.extend({ q: z.string().trim().max(100).optional(), dentistId: z.string().optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional() }),
    run: async ({ input }) => {
      const where: Prisma.ConsultationWhereInput = {
        ...(input.dentistId ? { dentistId: input.dentistId } : {}),
        ...(input.from || input.to ? { date: { ...(input.from ? { gte: input.from } : {}), ...(input.to ? { lte: input.to } : {}) } } : {}),
        ...(input.q ? { patient: { OR: [{ firstName: { contains: input.q } }, { lastName: { contains: input.q } }, { fileNumber: { contains: input.q } }] } } : {}),
      };
      const [rows, total] = await Promise.all([
        db().consultation.findMany({ where, orderBy: { date: "desc" }, skip: (input.page - 1) * input.pageSize, take: input.pageSize, include: { patient: { select: { id: true, firstName: true, lastName: true, fileNumber: true, isDemo: true } }, dentist: personName } }),
        db().consultation.count({ where }),
      ]);
      return { rows, total };
    },
  }),

  forPatient: proc({
    access: "consultations.read",
    input: z.object({ patientId: z.string() }),
    run: ({ input }) =>
      db().consultation.findMany({ where: { patientId: input.patientId }, orderBy: { date: "desc" }, include: { dentist: personName, treatments: { include: { treatment: { select: { name: true } } } } } }),
  }),

  save: proc({
    access: "consultations.write",
    input: consultationSchema.extend({ id: z.string().optional(), treatmentIds: z.array(z.object({ treatmentId: z.string(), toothNumber: z.number().int().nullable().optional() })).default([]) }),
    run: async ({ input: { id, treatmentIds, ...data }, user }) => {
      const saved = await db().$transaction(async (tx) => {
        const row = id ? await tx.consultation.update({ where: { id }, data }) : await tx.consultation.create({ data });
        // Actes réalisés pendant la consultation : ajoutés au parcours de soins du patient
        for (const t of treatmentIds) {
          const treatment = await tx.treatment.findUniqueOrThrow({ where: { id: t.treatmentId } });
          await tx.patientTreatment.create({
            data: { patientId: data.patientId, treatmentId: t.treatmentId, consultationId: row.id, dentistId: data.dentistId, toothNumber: t.toothNumber ?? null, status: "COMPLETED", completedAt: data.date, priceCents: treatment.priceCents },
          });
        }
        if (data.appointmentId) await tx.appointment.update({ where: { id: data.appointmentId }, data: { status: "COMPLETED" } });
        return row;
      });
      await audit(user, id ? "consultation.update" : "consultation.create", "Consultation", saved.id);
      return saved;
    },
  }),
};

export const odontogram = {
  get: proc({
    access: "odontogram.read",
    input: z.object({ patientId: z.string() }),
    run: ({ input }) => db().tooth.findMany({ where: { patientId: input.patientId } }),
  }),

  history: proc({
    access: "odontogram.read",
    input: z.object({ patientId: z.string(), number: z.number().int().optional() }),
    run: ({ input }) =>
      db().toothConditionHistory.findMany({
        where: { tooth: { patientId: input.patientId, ...(input.number ? { number: input.number } : {}) } },
        orderBy: { createdAt: "desc" },
        take: 100,
        include: { tooth: { select: { number: true } } },
      }),
  }),

  /** Chaque modification crée une ligne d'historique : l'état passé d'une dent n'est jamais perdu */
  save: proc({
    access: "odontogram.write",
    input: toothSchema,
    run: async ({ input, user }) => {
      if (!ALL_TEETH.includes(input.number)) throw new AppError("Numéro de dent invalide.");
      const faces = JSON.stringify(input.faces);
      const tooth = await db().$transaction(async (tx) => {
        const before = await tx.tooth.findUnique({ where: { patientId_number: { patientId: input.patientId, number: input.number } } });
        const row = await tx.tooth.upsert({
          where: { patientId_number: { patientId: input.patientId, number: input.number } },
          create: { patientId: input.patientId, number: input.number, condition: input.condition, faces, note: input.note ?? null },
          update: { condition: input.condition, faces, note: input.note ?? null },
        });
        await tx.toothConditionHistory.create({
          data: { toothId: row.id, previousCondition: before?.condition ?? null, condition: input.condition, faces, note: input.note ?? null, userId: user.id, userName: displayName(user) },
        });
        return row;
      });
      await audit(user, "tooth.update", "Patient", input.patientId, `Dent ${input.number}`);
      return tooth;
    },
  }),
};

export const treatments = {
  catalog: proc({
    access: "treatments.read",
    input: z.object({ includeInactive: z.boolean().default(false) }),
    run: ({ input }) => db().treatment.findMany({ where: input.includeInactive ? {} : { active: true }, orderBy: { name: "asc" } }),
  }),

  saveCatalog: proc({
    access: "catalog.write",
    input: treatmentSchema.extend({ id: z.string().optional() }),
    run: async ({ input: { id, price, ...rest }, user }) => {
      const data = { ...rest, priceCents: toCents(price) };
      const saved = id ? await db().treatment.update({ where: { id }, data }) : await db().treatment.create({ data });
      await audit(user, "treatment.save", "Treatment", saved.id, saved.name);
      return saved;
    },
  }),

  forPatient: proc({
    access: "treatments.read",
    input: z.object({ patientId: z.string() }),
    run: ({ input }) =>
      db().patientTreatment.findMany({ where: { patientId: input.patientId }, orderBy: { createdAt: "desc" }, include: { treatment: { select: { name: true } }, dentist: personName, invoiceItems: { select: { id: true } } } }),
  }),

  assign: proc({
    access: "treatments.assign",
    input: patientTreatmentSchema,
    run: async ({ input: { price, ...rest }, user }) => {
      const treatment = await db().treatment.findUniqueOrThrow({ where: { id: rest.treatmentId } });
      const created = await db().patientTreatment.create({
        data: { ...rest, priceCents: price === undefined ? treatment.priceCents : toCents(price), completedAt: rest.status === "COMPLETED" ? new Date() : null },
      });
      await audit(user, "patientTreatment.create", "Patient", rest.patientId, treatment.name);
      return created;
    },
  }),

  setStatus: proc({
    access: "treatments.assign",
    input: z.object({ id: z.string(), status: patientTreatmentSchema.shape.status }),
    run: async ({ input, user }) => {
      const updated = await db().patientTreatment.update({ where: { id: input.id }, data: { status: input.status, completedAt: input.status === "COMPLETED" ? new Date() : null } });
      await audit(user, "patientTreatment.status", "Patient", updated.patientId, input.status);
      return updated;
    },
  }),
};
