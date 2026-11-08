// Montant en toutes lettres (français), pour les attestations de paiement : « trois cent cinquante dirhams »

const UNITS = [
  "zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf",
  "dix", "onze", "douze", "treize", "quatorze", "quinze", "seize", "dix-sept", "dix-huit", "dix-neuf",
];
const TENS = ["", "", "vingt", "trente", "quarante", "cinquante", "soixante", "soixante", "quatre-vingt", "quatre-vingt"];

function below100(n: number): string {
  if (n < 20) return UNITS[n];
  const t = Math.floor(n / 10);
  let u = n % 10;
  // 70-79 et 90-99 : soixante-dix, quatre-vingt-dix…
  if (t === 7 || t === 9) u += 10;
  if (u === 0) return t === 8 ? "quatre-vingts" : TENS[t];
  if ((u === 1 || u === 11) && t !== 8 && t !== 9) return `${TENS[t]} et ${UNITS[u]}`;
  return `${TENS[t]}-${UNITS[u]}`;
}

function below1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (h === 0) return below100(r);
  const head = h === 1 ? "cent" : `${UNITS[h]} cent${r === 0 ? "s" : ""}`;
  return r === 0 ? head : `${head} ${below100(r)}`;
}

/** Entier positif en lettres (jusqu'aux milliards) */
export function numberToWords(n: number): string {
  n = Math.floor(Math.abs(n));
  if (n < 1000) return below1000(n);
  const parts: string[] = [];
  const scales: [number, string][] = [
    [1_000_000_000, "milliard"],
    [1_000_000, "million"],
  ];
  for (const [value, name] of scales) {
    const q = Math.floor(n / value);
    if (q > 0) {
      parts.push(`${numberToWords(q)} ${name}${q > 1 ? "s" : ""}`);
      n %= value;
    }
  }
  const thousands = Math.floor(n / 1000);
  if (thousands > 0) {
    // « mille » est invariable, et on ne dit pas « un mille » ; « cents » et « vingts » perdent leur s devant mille
    parts.push(thousands === 1 ? "mille" : `${below1000(thousands).replace(/(cent|vingt)s$/, "$1")} mille`);
    n %= 1000;
  }
  if (n > 0) parts.push(below1000(n));
  return parts.join(" ");
}

/** 350.5 → « trois cent cinquante dirhams et cinquante centimes » */
export function amountInWords(amount: number): string {
  const cents = Math.round(amount * 100);
  const dh = Math.floor(cents / 100);
  const c = cents % 100;
  const main = `${numberToWords(dh)} ${dh > 0 && dh % 1_000_000 === 0 ? "de " : ""}dirham${dh > 1 ? "s" : ""}`;
  return c > 0 ? `${main} et ${numberToWords(c)} centime${c > 1 ? "s" : ""}` : main;
}
