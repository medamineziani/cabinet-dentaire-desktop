import { z } from "zod";
import { APPOINTMENT_STATUS, EXPENSE_CATEGORIES, GENDERS, PAYMENT_METHODS, ROLES, TOOTH_CONDITIONS, TREATMENT_STATUS, keysOf } from "./constants";

// Schémas partagés : validés dans les formulaires, puis de nouveau dans le processus principal.

const text = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullable()
    .optional();

const required = (label: string, max = 120) => z.string().trim().min(1, `${label} requis`).max(max);

export const optionalDate = z.preprocess((v) => (v === "" || v === undefined ? null : v), z.coerce.date().nullable());
/** Montant saisi en dirhams, stocké en centimes */
export const money = z.coerce.number({ message: "Montant invalide" }).min(0, "Montant négatif").max(10_000_000, "Montant trop élevé");
export const toCents = (amount: number) => Math.round(amount * 100);

export const passwordRule = z
  .string()
  .min(10, "10 caractères minimum")
  .max(128)
  .regex(/[a-zA-Z]/, "Au moins une lettre")
  .regex(/[0-9]/, "Au moins un chiffre");

export const loginSchema = z.object({ username: z.string().trim().min(1, "Identifiant requis"), password: z.string().min(1, "Mot de passe requis") });

const userFields = {
  firstName: required("Prénom"),
  lastName: required("Nom"),
  username: z.string().trim().toLowerCase().min(3, "3 caractères minimum").max(40).regex(/^[a-z0-9._-]+$/, "Lettres, chiffres, point, tiret uniquement"),
  phone: text(30),
  email: text(120),
};

export const setupSchema = z.object({ ...userFields, password: passwordRule, clinicName: required("Nom du cabinet") });
export const userCreateSchema = z.object({ ...userFields, role: z.enum(keysOf(ROLES)), password: passwordRule });
export const userUpdateSchema = z.object({ ...userFields, id: z.string(), role: z.enum(keysOf(ROLES)), active: z.boolean() });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1, "Mot de passe actuel requis"), newPassword: passwordRule });

export const patientSchema = z.object({
  firstName: required("Prénom"),
  lastName: required("Nom"),
  birthDate: optionalDate,
  gender: z.preprocess((v) => v || null, z.enum(keysOf(GENDERS)).nullable()),
  phone: text(30),
  email: z.preprocess((v) => v || null, z.email("E-mail invalide").nullable()),
  address: text(),
  profession: text(120),
  emergencyName: text(120),
  emergencyPhone: text(30),
});

export const medicalSchema = z.object({
  history: text(5000),
  allergies: text(2000),
  medications: text(2000),
  chronicDiseases: text(2000),
  notes: text(5000),
});

export const appointmentSchema = z
  .object({
    patientId: required("Patient"),
    dentistId: required("Dentiste"),
    startsAt: z.coerce.date({ message: "Date invalide" }),
    endsAt: z.coerce.date({ message: "Date invalide" }),
    type: required("Type"),
    reason: text(300),
    notes: text(1000),
    status: z.enum(keysOf(APPOINTMENT_STATUS)).default("PENDING"),
  })
  .refine((a) => a.endsAt > a.startsAt, { message: "L'heure de fin doit être après le début", path: ["endsAt"] });

export const consultationSchema = z.object({
  patientId: required("Patient"),
  dentistId: required("Dentiste"),
  appointmentId: z.string().nullable().optional(),
  date: z.coerce.date({ message: "Date invalide" }),
  reason: text(500),
  symptoms: text(3000),
  observations: text(5000),
  diagnosis: text(3000),
  treatmentDone: text(3000),
  prescriptions: text(3000),
  recommendations: text(3000),
  notes: text(3000),
});

export const toothSchema = z.object({
  patientId: z.string().min(1),
  number: z.number().int(),
  condition: z.enum(keysOf(TOOTH_CONDITIONS)),
  faces: z.record(z.string(), z.enum(keysOf(TOOTH_CONDITIONS))).default({}),
  note: text(500),
});

export const treatmentSchema = z.object({
  name: required("Nom"),
  description: text(500),
  price: money,
  durationMinutes: z.coerce.number().int().min(5, "5 minutes minimum").max(600),
  active: z.boolean().default(true),
});

export const patientTreatmentSchema = z.object({
  patientId: required("Patient"),
  treatmentId: required("Traitement"),
  consultationId: z.string().nullable().optional(),
  dentistId: z.string().nullable().optional(),
  toothNumber: z.coerce.number().int().nullable().optional(),
  status: z.enum(keysOf(TREATMENT_STATUS)).default("PLANNED"),
  price: money.optional(),
  notes: text(500),
});

export const invoiceItemSchema = z.object({
  label: required("Prestation", 200),
  quantity: z.coerce.number().int().min(1, "Quantité minimale : 1").max(999),
  unitPrice: money,
  patientTreatmentId: z.string().nullable().optional(),
});

export const invoiceSchema = z.object({
  patientId: required("Patient"),
  date: z.coerce.date({ message: "Date invalide" }),
  items: z.array(invoiceItemSchema).min(1, "Ajoutez au moins une prestation"),
  discount: money.default(0),
  notes: text(500),
});

export const paymentSchema = z.object({
  invoiceId: z.string().min(1),
  amount: z.coerce.number({ message: "Montant invalide" }).positive("Le montant doit être positif"),
  method: z.enum(keysOf(PAYMENT_METHODS)),
  reference: text(80),
  paidAt: z.coerce.date().optional(),
});

export const expenseSchema = z.object({
  date: z.coerce.date({ message: "Date invalide" }),
  category: z.enum(keysOf(EXPENSE_CATEGORIES)),
  label: required("Libellé", 200),
  amount: money,
  notes: text(500),
});

export const supplierSchema = z.object({ name: required("Nom"), phone: text(30), email: text(120), address: text(300) });

export const productSchema = z.object({
  name: required("Nom"),
  reference: required("Référence", 60),
  category: required("Catégorie", 60),
  minQuantity: z.coerce.number().int().min(0),
  purchasePrice: money,
  supplierId: z.preprocess((v) => v || null, z.string().nullable()),
  expiryDate: optionalDate,
});

export const stockMovementSchema = z.object({
  productId: z.string().min(1),
  type: z.enum(["IN", "OUT"]),
  quantity: z.coerce.number().int().positive("Quantité invalide"),
  reason: text(200),
});

export const settingsSchema = z.object({
  name: required("Nom du cabinet"),
  address: text(300),
  city: text(100),
  phone: text(30),
  email: text(120),
  ice: text(30),
  inpe: text(30),
  footerNote: text(300),
  invoiceCancelRole: z.enum(["ADMIN", "ADMIN_DENTIST"]),
});

export const pageInput = z.object({ page: z.number().int().min(1).default(1), pageSize: z.number().int().min(1).max(100).default(15) });
