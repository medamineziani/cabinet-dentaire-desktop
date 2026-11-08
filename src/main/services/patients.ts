import { z } from "zod";
import { medicalSchema, pageInput, patientSchema } from "@shared/schemas";
import { db } from "../db";
import type { Prisma } from "../db/generated/client";
import { AppError, audit, proc } from "../ipc/procedure";

const id = z.object({ id: z.string().min(1) });

async function nextFileNumber(tx: Prisma.TransactionClient) {
  const rows = await tx.patient.findMany({ where: { fileNumber: { startsWith: "P-" } }, orderBy: { fileNumber: "desc" }, take: 1, select: { fileNumber: true } });
  const last = rows[0] ? Number(rows[0].fileNumber.slice(2)) : 0;
  return `P-${String(last + 1).padStart(5, "0")}`;
}

export const patients = {
  list: proc({
    access: "patients.read",
    input: pageInput.extend({
      q: z.string().trim().max(100).optional(),
      status: z.enum(["active", "archived", "all"]).default("active"),
      gender: z.enum(["MALE", "FEMALE"]).optional(),
      withBalance: z.boolean().optional(),
    }),
    run: async ({ input }) => {
      const words = (input.q ?? "").split(/\s+/).filter(Boolean);
      const where: Prisma.PatientWhereInput = {
        ...(input.status === "active" ? { archivedAt: null } : input.status === "archived" ? { archivedAt: { not: null } } : {}),
        ...(input.gender ? { gender: input.gender } : {}),
        ...(input.withBalance ? { invoices: { some: { status: { in: ["UNPAID", "PARTIAL"] } } } } : {}),
        AND: words.map((w) => ({
          OR: [{ firstName: { contains: w } }, { lastName: { contains: w } }, { phone: { contains: w } }, { fileNumber: { contains: w } }],
        })),
      };
      const [rows, total] = await Promise.all([
        db().patient.findMany({ where, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], skip: (input.page - 1) * input.pageSize, take: input.pageSize }),
        db().patient.count({ where }),
      ]);
      return { rows, total };
    },
  }),

  /** Recherche rapide : barre du haut et sélecteurs */
  search: proc({
    access: "patients.read",
    input: z.object({ q: z.string().trim().max(100) }),
    run: ({ input }) =>
      input.q.length < 1
        ? Promise.resolve([])
        : db().patient.findMany({
            where: { archivedAt: null, OR: [{ firstName: { contains: input.q } }, { lastName: { contains: input.q } }, { phone: { contains: input.q } }, { fileNumber: { contains: input.q } }] },
            orderBy: { lastName: "asc" },
            take: 8,
            select: { id: true, firstName: true, lastName: true, fileNumber: true, phone: true, isDemo: true },
          }),
  }),

  get: proc({
    access: "patients.read",
    input: id,
    run: async ({ input }) => {
      const patient = await db().patient.findUnique({ where: { id: input.id } });
      if (!patient) throw new AppError("Patient introuvable.");
      const invoices = await db().invoice.aggregate({ where: { patientId: input.id, status: { in: ["UNPAID", "PARTIAL"] } }, _sum: { totalCents: true, paidCents: true } });
      return { patient, balanceCents: (invoices._sum.totalCents ?? 0) - (invoices._sum.paidCents ?? 0) };
    },
  }),

  create: proc({
    access: "patients.write",
    input: patientSchema,
    run: async ({ input, user }) => {
      if (input.phone) {
        const twin = await db().patient.findFirst({ where: { phone: input.phone, lastName: input.lastName, firstName: input.firstName } });
        if (twin) throw new AppError(`Ce patient existe déjà (dossier ${twin.fileNumber}).`);
      }
      const patient = await db().$transaction(async (tx) => tx.patient.create({ data: { ...input, fileNumber: await nextFileNumber(tx), medicalRecord: { create: {} } } }));
      await audit(user, "patient.create", "Patient", patient.id, patient.fileNumber);
      return patient;
    },
  }),

  update: proc({
    access: "patients.write",
    input: patientSchema.extend({ id: z.string() }),
    run: async ({ input: { id: patientId, ...data }, user }) => {
      const patient = await db().patient.update({ where: { id: patientId }, data });
      await audit(user, "patient.update", "Patient", patientId, patient.fileNumber);
      return patient;
    },
  }),

  setArchived: proc({
    access: "patients.archive",
    input: id.extend({ archived: z.boolean() }),
    run: async ({ input, user }) => {
      const patient = await db().patient.update({ where: { id: input.id }, data: { archivedAt: input.archived ? new Date() : null } });
      await audit(user, input.archived ? "patient.archive" : "patient.restore", "Patient", input.id, patient.fileNumber);
      return patient;
    },
  }),

  /** Suppression définitive : administrateur seulement, et jamais s'il existe des factures (obligation comptable) */
  remove: proc({
    access: "patients.delete",
    input: id,
    run: async ({ input, user }) => {
      const patient = await db().patient.findUnique({ where: { id: input.id }, include: { _count: { select: { invoices: true } } } });
      if (!patient) throw new AppError("Patient introuvable.");
      if (patient._count.invoices > 0) throw new AppError("Ce patient a des factures : archivez-le au lieu de le supprimer.");
      await db().patient.delete({ where: { id: input.id } });
      await audit(user, "patient.delete", "Patient", input.id, patient.fileNumber);
    },
  }),
};

export const medical = {
  get: proc({
    access: "medical.read",
    input: z.object({ patientId: z.string() }),
    run: async ({ input, user }) => {
      const record = await db().medicalRecord.upsert({ where: { patientId: input.patientId }, create: { patientId: input.patientId }, update: {} });
      await audit(user, "medical.view", "Patient", input.patientId);
      return record;
    },
  }),

  save: proc({
    access: "medical.write",
    input: medicalSchema.extend({ patientId: z.string() }),
    run: async ({ input: { patientId, ...data }, user }) => {
      const record = await db().medicalRecord.upsert({ where: { patientId }, create: { patientId, ...data }, update: data });
      await audit(user, "medical.update", "Patient", patientId);
      return record;
    },
  }),
};
