import { settingsSchema } from "@shared/schemas";
import { db } from "../db";
import { AppError, audit, none, proc } from "../ipc/procedure";

const FIRST = ["Yassine", "Salma", "Omar", "Imane", "Karim", "Nadia", "Mehdi", "Sara", "Hamza", "Khadija", "Reda", "Zineb", "Anas", "Hajar", "Adil"];
const LAST = ["Démo-Alaoui", "Démo-Bennani", "Démo-Tazi", "Démo-Idrissi", "Démo-Berrada", "Démo-Chraibi", "Démo-Lahlou", "Démo-Kettani", "Démo-Naciri", "Démo-Ziani", "Démo-Haddad", "Démo-Fikri", "Démo-Sabri", "Démo-Tahiri", "Démo-Amzil"];

const atHour = (dayOffset: number, hour: number, minute = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d;
};

export const settings = {
  get: proc({ access: "authenticated", input: none, run: () => db().clinicSettings.findUniqueOrThrow({ where: { id: 1 }, omit: { backupSecret: true } }) }),

  save: proc({
    access: "settings.manage",
    input: settingsSchema,
    run: async ({ input, user }) => {
      const saved = await db().clinicSettings.update({ where: { id: 1 }, data: input, omit: { backupSecret: true } });
      await audit(user, "settings.update", "Settings");
      return saved;
    },
  }),
};

/**
 * Données de démonstration : insertion volontaire par un administrateur uniquement.
 * Chaque ligne porte isDemo = true, un badge DÉMO et un nom préfixé : suppression complète en un clic.
 */
export const demo = {
  status: proc({
    access: "settings.manage",
    input: none,
    run: async () => ({ patients: await db().patient.count({ where: { isDemo: true } }) }),
  }),

  load: proc({
    access: "settings.manage",
    input: none,
    run: async ({ user }) => {
      const d = db();
      if (await d.patient.count({ where: { isDemo: true } })) throw new AppError("Les données de démonstration sont déjà chargées.");
      const dentist = (await d.user.findFirst({ where: { role: "DENTIST", active: true } })) ?? (await d.user.findFirstOrThrow({ where: { role: "ADMIN", active: true } }));
      const catalog = await d.treatment.findMany({ where: { active: true }, orderBy: { name: "asc" } });

      await d.$transaction(
        async (tx) => {
          const patients = [];
          for (let i = 0; i < 15; i++) {
            patients.push(
              await tx.patient.create({
                data: {
                  fileNumber: `DEMO-${String(i + 1).padStart(3, "0")}`,
                  firstName: FIRST[i],
                  lastName: LAST[i],
                  gender: i % 2 ? "FEMALE" : "MALE",
                  birthDate: new Date(1960 + i * 3, i % 12, 5 + i),
                  phone: `06000000${String(i).padStart(2, "0")}`,
                  profession: "Donnée fictive",
                  registeredAt: atHour(-i * 12, 10),
                  isDemo: true,
                  medicalRecord: { create: { history: "Antécédents fictifs de démonstration", allergies: i % 4 === 0 ? "Pénicilline (fictif)" : null } },
                },
              }),
            );
          }
          for (let i = 0; i < 10; i++) {
            const startsAt = atHour(i - 2, 9 + (i % 7), i % 2 ? 30 : 0);
            await tx.appointment.create({
              data: { patientId: patients[i].id, dentistId: dentist.id, startsAt, endsAt: new Date(startsAt.getTime() + 30 * 60_000), type: "Consultation", reason: "Rendez-vous de démonstration", status: i < 2 ? "COMPLETED" : i % 3 ? "CONFIRMED" : "PENDING", isDemo: true },
            });
          }
          for (let i = 0; i < 5; i++) {
            const treatment = catalog[i % catalog.length];
            const consultation = await tx.consultation.create({
              data: { patientId: patients[i].id, dentistId: dentist.id, date: atHour(-i * 8 - 1, 11), reason: "Douleur dentaire (fictif)", observations: "Observation de démonstration", diagnosis: "Diagnostic fictif", prescriptions: "Prescription fictive de démonstration", isDemo: true },
            });
            await tx.patientTreatment.create({ data: { patientId: patients[i].id, treatmentId: treatment.id, consultationId: consultation.id, dentistId: dentist.id, status: "COMPLETED", completedAt: consultation.date, priceCents: treatment.priceCents, toothNumber: 16 + i, isDemo: true } });
            await tx.tooth.create({ data: { patientId: patients[i].id, number: 16 + i, condition: i % 2 ? "FILLING" : "CARIES" } });
            await tx.patientTreatment.create({ data: { patientId: patients[i].id, treatmentId: catalog[(i + 3) % catalog.length].id, dentistId: dentist.id, status: "PLANNED", priceCents: catalog[(i + 3) % catalog.length].priceCents, isDemo: true } });

            const total = treatment.priceCents;
            const paid = i === 0 ? 0 : i % 2 ? total : Math.round(total / 2);
            const invoice = await tx.invoice.create({
              data: { number: `DEMO-F-${String(i + 1).padStart(4, "0")}`, patientId: patients[i].id, date: consultation.date, subtotalCents: total, totalCents: total, paidCents: paid, status: paid === 0 ? "UNPAID" : paid >= total ? "PAID" : "PARTIAL", isDemo: true, items: { create: [{ label: treatment.name, quantity: 1, unitPriceCents: total, totalCents: total }] } },
            });
            if (paid) await tx.payment.create({ data: { invoiceId: invoice.id, amountCents: paid, method: i % 2 ? "CASH" : "CARD", paidAt: consultation.date } });
          }
          const items = [["Gants nitrile (boîte)", "Consommables", 3, 10], ["Anesthésique articaïne", "Anesthésie", 25, 10], ["Composite A2", "Composites", 8, 5], ["Masques chirurgicaux", "Hygiène", 40, 15], ["Fraises diamantées", "Instruments", 12, 5], ["Hypochlorite 3 %", "Hygiène", 6, 3]] as const;
          for (const [i, [name, category, quantity, minQuantity]] of items.entries()) {
            await tx.product.create({ data: { name: `${name} (démo)`, reference: `DEMO-${i + 1}`, category, quantity, minQuantity, purchasePriceCents: 5000 + i * 1000, expiryDate: i === 1 ? atHour(30, 12) : null, isDemo: true } });
          }
          await tx.expense.createMany({ data: [{ date: atHour(-3, 12), category: "MATERIAL", label: "Achat matériel (démo)", amountCents: 120000, isDemo: true }, { date: atHour(-10, 12), category: "RENT", label: "Loyer (démo)", amountCents: 500000, isDemo: true }] });
          await tx.clinicSettings.update({ where: { id: 1 }, data: { demoDataLoadedAt: new Date() } });
        },
        { timeout: 30_000 },
      );
      await audit(user, "demo.load", "Demo");
    },
  }),

  /** Ne retire que les lignes marquées isDemo : les vrais dossiers ne sont jamais concernés */
  remove: proc({
    access: "settings.manage",
    input: none,
    run: async ({ user }) => {
      await db().$transaction(async (tx) => {
        await tx.invoice.deleteMany({ where: { isDemo: true } });
        await tx.patient.deleteMany({ where: { isDemo: true } });
        await tx.product.deleteMany({ where: { isDemo: true } });
        await tx.expense.deleteMany({ where: { isDemo: true } });
        await tx.clinicSettings.update({ where: { id: 1 }, data: { demoDataLoadedAt: null } });
      });
      await audit(user, "demo.remove", "Demo");
    },
  }),
};
