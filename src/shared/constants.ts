// Valeurs métier partagées entre le processus principal et l'interface.

const labels = <T extends Record<string, string>>(o: T) => o;
export const keysOf = <T extends object>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];

export const ROLES = labels({ ADMIN: "Administrateur", DENTIST: "Dentiste", SECRETARY: "Secrétaire" });
export type Role = keyof typeof ROLES;

export const GENDERS = labels({ MALE: "Homme", FEMALE: "Femme" });

export const APPOINTMENT_STATUS = labels({
  PENDING: "En attente",
  CONFIRMED: "Confirmé",
  ARRIVED: "Arrivé",
  IN_PROGRESS: "En consultation",
  COMPLETED: "Terminé",
  CANCELLED: "Annulé",
  NO_SHOW: "Absent",
});
export type AppointmentStatus = keyof typeof APPOINTMENT_STATUS;

/** Un rendez-vous annulé ou manqué libère son créneau */
export const NON_BLOCKING_STATUS: AppointmentStatus[] = ["CANCELLED", "NO_SHOW"];

export const APPOINTMENT_COLORS: Record<AppointmentStatus, { bg: string; border: string; text: string }> = {
  PENDING: { bg: "bg-amber-50", border: "border-amber-400", text: "text-amber-800" },
  CONFIRMED: { bg: "bg-blue-50", border: "border-blue-500", text: "text-blue-800" },
  ARRIVED: { bg: "bg-cyan-50", border: "border-cyan-500", text: "text-cyan-800" },
  IN_PROGRESS: { bg: "bg-violet-50", border: "border-violet-500", text: "text-violet-800" },
  COMPLETED: { bg: "bg-emerald-50", border: "border-emerald-500", text: "text-emerald-800" },
  CANCELLED: { bg: "bg-slate-100", border: "border-slate-400", text: "text-slate-500" },
  NO_SHOW: { bg: "bg-red-50", border: "border-red-500", text: "text-red-800" },
};

export const APPOINTMENT_TYPES = ["Consultation", "Contrôle", "Urgence", "Détartrage", "Soin", "Chirurgie", "Prothèse", "Orthodontie"];

export const TOOTH_CONDITIONS = labels({
  HEALTHY: "Dent saine",
  CARIES: "Carie",
  MISSING: "Dent absente",
  EXTRACTED: "Dent extraite",
  CROWN: "Couronne",
  IMPLANT: "Implant",
  FILLING: "Obturation",
  ROOT_CANAL: "Traitement de canal",
  FRACTURE: "Fracture",
  PROSTHESIS: "Prothèse",
});
export type ToothCondition = keyof typeof TOOTH_CONDITIONS;

export const TOOTH_COLORS: Record<ToothCondition, string> = {
  HEALTHY: "#ffffff",
  CARIES: "#ef4444",
  MISSING: "#cbd5e1",
  EXTRACTED: "#64748b",
  CROWN: "#f59e0b",
  IMPLANT: "#6366f1",
  FILLING: "#3b82f6",
  ROOT_CANAL: "#a855f7",
  FRACTURE: "#f97316",
  PROSTHESIS: "#14b8a6",
};

export const TOOTH_FACES = labels({ M: "Mésiale", D: "Distale", V: "Vestibulaire", L: "Linguale / palatine", O: "Occlusale" });
export type ToothFace = keyof typeof TOOTH_FACES;

/** Numérotation FDI, dans l'ordre d'affichage de gauche à droite (vue praticien) */
export const PERMANENT_ARCADES = {
  upper: [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28],
  lower: [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38],
};
export const PRIMARY_ARCADES = {
  upper: [55, 54, 53, 52, 51, 61, 62, 63, 64, 65],
  lower: [85, 84, 83, 82, 81, 71, 72, 73, 74, 75],
};
export const ALL_TEETH = [...Object.values(PERMANENT_ARCADES).flat(), ...Object.values(PRIMARY_ARCADES).flat()];

export const TREATMENT_STATUS = labels({ PLANNED: "Prévu", IN_PROGRESS: "En cours", COMPLETED: "Terminé", CANCELLED: "Annulé" });
export const INVOICE_STATUS = labels({ PAID: "Payée", PARTIAL: "Partiellement payée", UNPAID: "Non payée", CANCELLED: "Annulée" });
export const PAYMENT_METHODS = labels({ CASH: "Espèces", CARD: "Carte bancaire", TRANSFER: "Virement", CHEQUE: "Chèque", OTHER: "Autre" });
export const EXPENSE_CATEGORIES = labels({
  MATERIAL: "Matériel dentaire",
  MEDICINE: "Médicaments",
  RENT: "Loyer",
  ELECTRICITY: "Électricité",
  SALARIES: "Salaires",
  MAINTENANCE: "Maintenance",
  OTHER: "Autres",
});
export const PRODUCT_CATEGORIES = ["Consommables", "Anesthésie", "Composites", "Instruments", "Hygiène", "Équipement", "Autre"];

export const DOCUMENT_TYPES = labels({
  PATIENT_FILE: "Fiche patient",
  CONSULTATION_REPORT: "Compte rendu de consultation",
  INVOICE: "Facture",
  QUOTE: "Devis",
  PRESCRIPTION: "Ordonnance",
  TREATMENT_PLAN: "Plan de traitement",
});
export type DocumentType = keyof typeof DOCUMENT_TYPES;

/** Catalogue initial : les prix sont indicatifs et modifiables dans l'application */
export const STARTER_TREATMENTS = [
  { name: "Consultation", description: "Examen clinique et bilan", price: 200, duration: 20 },
  { name: "Détartrage", description: "Détartrage et polissage", price: 400, duration: 30 },
  { name: "Extraction", description: "Extraction dentaire simple", price: 400, duration: 30 },
  { name: "Traitement de carie", description: "Curetage de la lésion carieuse", price: 500, duration: 45 },
  { name: "Obturation", description: "Obturation composite", price: 500, duration: 40 },
  { name: "Dévitalisation", description: "Traitement endodontique", price: 1500, duration: 60 },
  { name: "Couronne", description: "Couronne céramo-métallique", price: 2500, duration: 60 },
  { name: "Implant", description: "Pose d'implant", price: 8000, duration: 90 },
  { name: "Blanchiment", description: "Éclaircissement au fauteuil", price: 2500, duration: 60 },
  { name: "Orthodontie", description: "Séance d'orthodontie", price: 600, duration: 30 },
  { name: "Prothèse dentaire", description: "Prothèse amovible", price: 4000, duration: 45 },
];
