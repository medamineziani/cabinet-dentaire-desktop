const LOCALE = "fr-MA";

// fr-FR sépare les milliers par une espace fine (U+202F), peu visible avec Geist :
// on la remplace par une espace insécable classique.
const THIN_SPACE = / /g;
const NBSP = " ";

const madFormatter = new Intl.NumberFormat("fr-FR", {
  maximumFractionDigits: 0,
});

/** 12 450 MAD */
export function formatMAD(value: number | string | { toString(): string }) {
  return `${madFormatter.format(Number(value)).replace(THIN_SPACE, NBSP)}${NBSP}MAD`;
}

/** 12,4 k */
export function formatCompact(value: number) {
  return new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("fr-FR").format(value).replace(THIN_SPACE, NBSP);
}

export function formatPercent(value: number, digits = 1) {
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: digits }).format(value)}${NBSP}%`;
}

/** +212 6 12 34 56 78 */
export function formatPhone(e164?: string | null) {
  if (!e164) return "—";
  const m = e164.match(/^\+212(\d)(\d{2})(\d{2})(\d{2})(\d{2})$/);
  return m ? `+212 ${m[1]} ${m[2]} ${m[3]} ${m[4]} ${m[5]}` : e164;
}

export function formatTime(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat(LOCALE, { hour: "2-digit", minute: "2-digit", timeZone }).format(date);
}

export function initials(firstName: string, lastName: string) {
  return `${firstName[0] ?? ""}${lastName[0] ?? ""}`.toUpperCase();
}

/** « Dr. Yasmine Benali » → « YB » */
export function nameInitials(fullName: string) {
  return fullName
    .replace(/^Dr\.?\s*/, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}
