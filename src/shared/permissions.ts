import type { Role } from "./constants";

// Matrice des droits : source unique, vérifiée dans le processus principal à chaque appel.
// L'interface s'en sert seulement pour masquer ce qui serait refusé.
export const PERMISSIONS = [
  "dashboard.read",
  "patients.read",
  "patients.write",
  "patients.archive",
  "patients.delete",
  "medical.read",
  "medical.write",
  "appointments.read",
  "appointments.write",
  "consultations.read",
  "consultations.write",
  "odontogram.read",
  "odontogram.write",
  "treatments.read",
  "treatments.assign",
  "catalog.write",
  "billing.read",
  "billing.write",
  "expenses.read",
  "expenses.write",
  "expenses.delete",
  "stock.read",
  "stock.write",
  "users.manage",
  "documents.admin",
  "documents.medical",
  "stats.read",
  "settings.manage",
  "backup.manage",
  "audit.read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const DENTIST: Permission[] = [
  "dashboard.read",
  "patients.read",
  "patients.write",
  "patients.archive",
  "medical.read",
  "medical.write",
  "appointments.read",
  "appointments.write",
  "consultations.read",
  "consultations.write",
  "odontogram.read",
  "odontogram.write",
  "treatments.read",
  "treatments.assign",
  "catalog.write",
  "billing.read",
  "billing.write",
  "expenses.read",
  "stock.read",
  "stock.write",
  "documents.admin",
  "documents.medical",
  "stats.read",
];

// La secrétaire n'a aucun droit médical : ni dossier médical, ni consultation, ni odontogramme.
const SECRETARY: Permission[] = [
  "dashboard.read",
  "patients.read",
  "patients.write",
  "patients.archive",
  "appointments.read",
  "appointments.write",
  "treatments.read",
  "billing.read",
  "billing.write",
  "expenses.read",
  "expenses.write",
  "stock.read",
  "stock.write",
  "documents.admin",
];

const MATRIX: Record<Role, ReadonlySet<Permission>> = {
  ADMIN: new Set(PERMISSIONS),
  DENTIST: new Set(DENTIST),
  SECRETARY: new Set(SECRETARY),
};

export const can = (role: Role, permission: Permission) => MATRIX[role].has(permission);
