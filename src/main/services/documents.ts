import { writeFile } from "node:fs/promises";
import { z } from "zod";
import { DOCUMENT_TYPES, GENDERS, INVOICE_STATUS, PAYMENT_METHODS, TREATMENT_STATUS, keysOf, type DocumentType } from "@shared/constants";
import { can } from "@shared/permissions";
import { invoiceItemSchema, money, toCents } from "@shared/schemas";
import { db } from "../db";
import { AppError, audit, proc } from "../ipc/procedure";
import { platform } from "../platform";
import { displayName, type SessionUser } from "../security/session";

const REPLACEMENTS: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => REPLACEMENTS[c]);
export const moneyText = (cents: number) => `${(cents / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MAD`;
const dateText = (d: Date | null | undefined) => (d ? d.toLocaleDateString("fr-FR") : "—");
const multi = (s: string | null | undefined) => (s ? escapeHtml(s).split("\n").join("<br>") : "—");

type Clinic = { name: string; address: string | null; city: string | null; phone: string | null; email: string | null; ice: string | null; inpe: string | null; footerNote: string | null };

export function pageShell(c: Clinic, body: string) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>
  @page{size:A4;margin:16mm}*{box-sizing:border-box}body{font-family:"Segoe UI",Arial,sans-serif;color:#0f1729;font-size:12px;line-height:1.5}
  header{display:flex;justify-content:space-between;border-bottom:2px solid #1d4ed8;padding-bottom:10px;margin-bottom:18px}
  .clinic{font-size:17px;font-weight:700;color:#1e3a8a}.muted{color:#5b6578}h1{font-size:20px;margin:0 0 4px;color:#1e3a8a}h2{font-size:14px;margin:18px 0 6px;color:#1d4ed8}
  table{width:100%;border-collapse:collapse;margin-top:6px}th{background:#eff4ff;text-align:left;padding:6px 8px;font-size:11px}td{padding:6px 8px;border-bottom:1px solid #e3e8ef}
  .r{text-align:right}.totals{margin-left:auto;width:45%}.totals td{border:0;padding:3px 8px}.grand td{font-weight:700;font-size:14px;border-top:2px solid #1d4ed8}
  .box{border:1px solid #e3e8ef;border-radius:6px;padding:10px;margin-top:8px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 18px}
  .sign{margin-top:50px;text-align:right}footer{margin-top:28px;border-top:1px solid #e3e8ef;padding-top:6px;font-size:10px;color:#5b6578;text-align:center}
  </style></head><body><header><div><div class="clinic">${escapeHtml(c.name)}</div><div class="muted">${[c.address, c.city].filter(Boolean).map(escapeHtml).join(", ")}</div></div>
  <div class="muted" style="text-align:right">${c.phone ? `Tél. ${escapeHtml(c.phone)}<br>` : ""}${c.email ? `${escapeHtml(c.email)}<br>` : ""}${c.ice ? `ICE ${escapeHtml(c.ice)}<br>` : ""}${c.inpe ? `INPE ${escapeHtml(c.inpe)}` : ""}</div></header>
  ${body}${c.footerNote ? `<footer>${escapeHtml(c.footerNote)}</footer>` : ""}</body></html>`;
}

type PatientRow = { firstName: string; lastName: string; fileNumber: string; birthDate: Date | null; isDemo: boolean };
const patientLine = (p: PatientRow) =>
  `<div class="box"><b>${escapeHtml(p.lastName.toUpperCase())} ${escapeHtml(p.firstName)}</b> · Dossier ${escapeHtml(p.fileNumber)}${p.birthDate ? ` · Né(e) le ${dateText(p.birthDate)}` : ""}${p.isDemo ? " · <b>DONNÉE DE DÉMONSTRATION</b>" : ""}</div>`;

const signature = (name: string) => `<div class="sign">${escapeHtml(name)}<br><span class="muted">Signature et cachet</span></div>`;

const linesTable = (lines: { label: string; quantity: number; unitPriceCents: number; totalCents: number }[]) =>
  `<table><thead><tr><th>Prestation</th><th class="r">Qté</th><th class="r">Prix unitaire</th><th class="r">Total</th></tr></thead><tbody>${lines
    .map((i) => `<tr><td>${escapeHtml(i.label)}</td><td class="r">${i.quantity}</td><td class="r">${moneyText(i.unitPriceCents)}</td><td class="r">${moneyText(i.totalCents)}</td></tr>`)
    .join("")}</tbody></table>`;

const generateInput = z.object({
  type: z.enum(keysOf(DOCUMENT_TYPES)),
  patientId: z.string().optional(),
  consultationId: z.string().optional(),
  invoiceId: z.string().optional(),
  quote: z.object({ items: z.array(invoiceItemSchema).min(1, "Ajoutez au moins une prestation"), discount: money.default(0), validityDays: z.coerce.number().int().min(1).max(365).default(30) }).optional(),
});
type GenerateInput = z.output<typeof generateInput>;

const needsMedical = (type: DocumentType) => type === "CONSULTATION_REPORT" || type === "PRESCRIPTION" || type === "TREATMENT_PLAN";

function assertDocumentAccess(user: SessionUser, type: DocumentType) {
  if (!can(user.role, needsMedical(type) ? "documents.medical" : "documents.admin")) throw new AppError("Vous n'avez pas accès à ce document.");
}

async function build(input: GenerateInput, user: SessionUser): Promise<{ html: string; title: string; fileName: string; patientId: string | null }> {
  const d = db();
  const clinic = await d.clinicSettings.findUniqueOrThrow({ where: { id: 1 } });
  const patientOf = async (id?: string) => {
    if (!id) throw new AppError("Patient manquant.");
    return d.patient.findUniqueOrThrow({ where: { id }, include: { medicalRecord: true } });
  };
  const wrap = (title: string, fileName: string, patientId: string | null, body: string) => ({ html: pageShell(clinic, body), title, fileName: `${fileName}.pdf`, patientId });

  switch (input.type) {
    case "INVOICE": {
      if (!input.invoiceId) throw new AppError("Facture manquante.");
      const inv = await d.invoice.findUniqueOrThrow({ where: { id: input.invoiceId }, include: { patient: true, items: true, payments: { where: { cancelledAt: null }, orderBy: { paidAt: "asc" } } } });
      const body = `<h1>Facture ${escapeHtml(inv.number)}</h1><p class="muted">Date : ${dateText(inv.date)} · Statut : ${INVOICE_STATUS[inv.status as keyof typeof INVOICE_STATUS]}</p>
      ${patientLine(inv.patient)}${linesTable(inv.items)}
      <table class="totals"><tr><td>Sous-total</td><td class="r">${moneyText(inv.subtotalCents)}</td></tr>${inv.discountCents ? `<tr><td>Remise</td><td class="r">- ${moneyText(inv.discountCents)}</td></tr>` : ""}
      <tr class="grand"><td>Total</td><td class="r">${moneyText(inv.totalCents)}</td></tr><tr><td>Payé</td><td class="r">${moneyText(inv.paidCents)}</td></tr><tr><td><b>Reste à payer</b></td><td class="r"><b>${moneyText(inv.totalCents - inv.paidCents)}</b></td></tr></table>
      ${inv.payments.length ? `<h2>Paiements</h2><table><tbody>${inv.payments.map((p) => `<tr><td>${dateText(p.paidAt)}</td><td>${PAYMENT_METHODS[p.method as keyof typeof PAYMENT_METHODS]}${p.reference ? ` (${escapeHtml(p.reference)})` : ""}</td><td class="r">${moneyText(p.amountCents)}</td></tr>`).join("")}</tbody></table>` : ""}
      ${inv.status === "CANCELLED" ? `<p><b>FACTURE ANNULÉE</b> : ${escapeHtml(inv.cancelReason)}</p>` : ""}`;
      return wrap(`Facture ${inv.number}`, `facture_${inv.number}`, inv.patientId, body);
    }
    case "QUOTE": {
      if (!input.quote) throw new AppError("Prestations manquantes.");
      const p = await patientOf(input.patientId);
      const lines = input.quote.items.map((i) => ({ label: i.label, quantity: i.quantity, unitPriceCents: toCents(i.unitPrice), totalCents: toCents(i.unitPrice) * i.quantity }));
      const subtotal = lines.reduce((s, l) => s + l.totalCents, 0);
      const discount = toCents(input.quote.discount);
      if (discount > subtotal) throw new AppError("La remise dépasse le total.");
      const body = `<h1>Devis</h1><p class="muted">Date : ${dateText(new Date())} · Valable ${input.quote.validityDays} jours</p>${patientLine(p)}${linesTable(lines)}
      <table class="totals"><tr><td>Sous-total</td><td class="r">${moneyText(subtotal)}</td></tr>${discount ? `<tr><td>Remise</td><td class="r">- ${moneyText(discount)}</td></tr>` : ""}<tr class="grand"><td>Total</td><td class="r">${moneyText(subtotal - discount)}</td></tr></table>${signature(displayName(user))}`;
      return wrap(`Devis ${p.lastName}`, `devis_${p.fileNumber}`, p.id, body);
    }
    case "CONSULTATION_REPORT":
    case "PRESCRIPTION": {
      if (!input.consultationId) throw new AppError("Consultation manquante.");
      const c = await d.consultation.findUniqueOrThrow({ where: { id: input.consultationId }, include: { patient: true, dentist: true } });
      const dentist = `Dr ${displayName(c.dentist)}`;
      if (input.type === "PRESCRIPTION") {
        if (!c.prescriptions) throw new AppError("Cette consultation ne comporte pas de prescription.");
        const body = `<h1>Ordonnance</h1><p class="muted">${dateText(c.date)} · ${escapeHtml(dentist)}</p>${patientLine(c.patient)}<div style="margin-top:24px;font-size:14px">${multi(c.prescriptions)}</div>${c.recommendations ? `<h2>Recommandations</h2><p>${multi(c.recommendations)}</p>` : ""}${signature(dentist)}`;
        return wrap(`Ordonnance du ${dateText(c.date)}`, `ordonnance_${c.patient.fileNumber}`, c.patientId, body);
      }
      const section = (t: string, v: string | null) => (v ? `<h2>${t}</h2><p>${multi(v)}</p>` : "");
      const body = `<h1>Compte rendu de consultation</h1><p class="muted">${dateText(c.date)} · ${escapeHtml(dentist)}</p>${patientLine(c.patient)}${section("Motif", c.reason)}${section("Symptômes décrits", c.symptoms)}${section("Observations cliniques", c.observations)}${section("Diagnostic", c.diagnosis)}${section("Traitement réalisé", c.treatmentDone)}${section("Prescriptions", c.prescriptions)}${section("Recommandations", c.recommendations)}${section("Notes", c.notes)}${signature(dentist)}`;
      return wrap(`Compte rendu du ${dateText(c.date)}`, `compte-rendu_${c.patient.fileNumber}`, c.patientId, body);
    }
    case "TREATMENT_PLAN": {
      const p = await patientOf(input.patientId);
      const rows = await d.patientTreatment.findMany({ where: { patientId: p.id, status: { in: ["PLANNED", "IN_PROGRESS"] } }, include: { treatment: true }, orderBy: { createdAt: "asc" } });
      if (!rows.length) throw new AppError("Aucun traitement prévu pour ce patient.");
      const total = rows.reduce((s, r) => s + r.priceCents, 0);
      const body = `<h1>Plan de traitement</h1><p class="muted">${dateText(new Date())}</p>${patientLine(p)}<table><thead><tr><th>Traitement</th><th>Dent</th><th>Statut</th><th class="r">Prix</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${escapeHtml(r.treatment.name)}</td><td>${r.toothNumber ?? "—"}</td><td>${TREATMENT_STATUS[r.status as keyof typeof TREATMENT_STATUS]}</td><td class="r">${moneyText(r.priceCents)}</td></tr>`).join("")}</tbody></table><table class="totals"><tr class="grand"><td>Total estimé</td><td class="r">${moneyText(total)}</td></tr></table>${signature(displayName(user))}`;
      return wrap(`Plan de traitement ${p.lastName}`, `plan-traitement_${p.fileNumber}`, p.id, body);
    }
    case "PATIENT_FILE": {
      const p = await patientOf(input.patientId);
      const field = (k: string, v: unknown) => `<div><span class="muted">${k} :</span> ${escapeHtml(v || "—")}</div>`;
      // Le bloc médical n'apparaît que pour les profils qui ont le droit de le lire
      const m = can(user.role, "medical.read") ? p.medicalRecord : null;
      const medicalHtml = m
        ? `<h2>Dossier médical</h2><div class="box"><b>Antécédents</b><br>${multi(m.history)}<br><br><b>Allergies</b><br>${multi(m.allergies)}<br><br><b>Médicaments</b><br>${multi(m.medications)}<br><br><b>Maladies chroniques</b><br>${multi(m.chronicDiseases)}<br><br><b>Remarques</b><br>${multi(m.notes)}</div>`
        : "";
      const body = `<h1>Fiche patient</h1>${patientLine(p)}<h2>Informations</h2><div class="box grid">${field("Sexe", p.gender ? GENDERS[p.gender as keyof typeof GENDERS] : "")}${field("Téléphone", p.phone)}${field("E-mail", p.email)}${field("Adresse", p.address)}${field("Profession", p.profession)}${field("Inscrit le", dateText(p.registeredAt))}${field("Contact d'urgence", [p.emergencyName, p.emergencyPhone].filter(Boolean).join(" · "))}</div>${medicalHtml}`;
      return wrap(`Fiche ${p.lastName} ${p.firstName}`, `fiche_${p.fileNumber}`, p.id, body);
    }
  }
}

export const documents = {
  list: proc({
    access: ["documents.admin", "documents.medical"],
    input: z.object({ patientId: z.string().optional(), type: z.string().optional() }),
    run: async ({ input, user }) => {
      const rows = await db().document.findMany({
        where: { ...(input.patientId ? { patientId: input.patientId } : {}), ...(input.type ? { type: input.type } : {}) },
        orderBy: { createdAt: "desc" },
        take: 200,
        select: { id: true, type: true, title: true, createdBy: true, createdAt: true, patient: { select: { id: true, firstName: true, lastName: true, fileNumber: true } } },
      });
      return rows.filter((r) => can(user.role, needsMedical(r.type as DocumentType) ? "documents.medical" : "documents.admin"));
    },
  }),

  /** Génère le PDF, l'enregistre à l'endroit choisi et conserve une copie reproductible en base */
  generate: proc({
    access: ["documents.admin", "documents.medical"],
    input: generateInput,
    run: async ({ input, user }) => {
      assertDocumentAccess(user, input.type);
      const doc = await build(input, user);
      const path = await platform().askSavePath(doc.fileName, "pdf");
      if (!path) return null;
      await writeFile(path, await platform().htmlToPdf(doc.html));
      const row = await db().document.create({ data: { type: input.type, title: doc.title, patientId: doc.patientId, payload: JSON.stringify({ html: doc.html, fileName: doc.fileName }), createdBy: displayName(user) } });
      await audit(user, "document.generate", "Document", row.id, input.type);
      await platform().openPath(path);
      return path;
    },
  }),

  export: proc({
    access: ["documents.admin", "documents.medical"],
    input: z.object({ id: z.string() }),
    run: async ({ input, user }) => {
      const row = await db().document.findUniqueOrThrow({ where: { id: input.id } });
      assertDocumentAccess(user, row.type as DocumentType);
      const { html, fileName } = JSON.parse(row.payload) as { html: string; fileName: string };
      const path = await platform().askSavePath(fileName, "pdf");
      if (!path) return null;
      await writeFile(path, await platform().htmlToPdf(html));
      await audit(user, "document.export", "Document", row.id, row.type);
      await platform().openPath(path);
      return path;
    },
  }),
};

export const _internals = { build };
