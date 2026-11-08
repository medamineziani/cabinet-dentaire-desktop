import { format } from "date-fns";
import { fr } from "date-fns/locale";

export const money = (cents: number) => `${(cents / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MAD`;
export const toAmount = (cents: number) => cents / 100;
export const fmt = (d: Date | string | null | undefined, pattern = "dd/MM/yyyy") => (d ? format(new Date(d), pattern, { locale: fr }) : "—");
export const dateInput = (d: Date | string | null | undefined) => (d ? format(new Date(d), "yyyy-MM-dd") : "");
export const timeInput = (d: Date | string) => format(new Date(d), "HH:mm");
export const fullName = (p: { firstName: string; lastName: string }) => `${p.lastName} ${p.firstName}`;
export const combine = (day: string, time: string) => new Date(`${day}T${time}:00`);
export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : "Une erreur est survenue.");
export const ageOf = (d: Date | string | null) => {
  if (!d) return null;
  const b = new Date(d);
  const now = new Date();
  return now.getFullYear() - b.getFullYear() - (now < new Date(now.getFullYear(), b.getMonth(), b.getDate()) ? 1 : 0);
};
