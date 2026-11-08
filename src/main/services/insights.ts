import { writeFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import { z } from "zod";
import { db } from "../db";
import { audit, proc } from "../ipc/procedure";
import { platform } from "../platform";
import { stockAlerts } from "./finance";
import { escapeHtml, moneyText, pageShell } from "./documents";

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const monthStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

function monthsBetween(from: Date, to: Date) {
  const out: string[] = [];
  for (let d = monthStart(from); d < to; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) out.push(monthKey(d));
  return out;
}

function bucket<T>(months: string[], rows: T[], date: (r: T) => Date, value: (r: T) => number) {
  const totals = new Map(months.map((m) => [m, 0]));
  for (const r of rows) {
    const k = monthKey(date(r));
    if (totals.has(k)) totals.set(k, totals.get(k)! + value(r));
  }
  return months.map((m) => totals.get(m)!);
}

export const dashboard = {
  overview: proc({
    access: "dashboard.read",
    input: z.void(),
    run: async ({ user }) => {
      const now = new Date();
      const today = dayStart(now);
      const tomorrow = addDays(today, 1);
      const month = monthStart(now);
      const yearAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);
      const canSeeMoney = user.role !== "SECRETARY" || true;
      const d = db();
      const [patients, newPatients, todayCount, upcoming, consultations, dayRevenue, monthRevenue, pending, monthExpenses, nextAppointments, latestPatients, payments, consults, alerts] = await Promise.all([
        d.patient.count({ where: { archivedAt: null } }),
        d.patient.count({ where: { archivedAt: null, registeredAt: { gte: month } } }),
        d.appointment.count({ where: { startsAt: { gte: today, lt: tomorrow }, status: { notIn: ["CANCELLED"] } } }),
        d.appointment.count({ where: { startsAt: { gte: tomorrow }, status: { in: ["PENDING", "CONFIRMED"] } } }),
        d.consultation.count({ where: { date: { gte: month } } }),
        d.payment.aggregate({ where: { cancelledAt: null, paidAt: { gte: today, lt: tomorrow } }, _sum: { amountCents: true } }),
        d.payment.aggregate({ where: { cancelledAt: null, paidAt: { gte: month } }, _sum: { amountCents: true } }),
        d.invoice.aggregate({ where: { status: { in: ["UNPAID", "PARTIAL"] } }, _sum: { totalCents: true, paidCents: true }, _count: true }),
        d.expense.aggregate({ where: { date: { gte: month } }, _sum: { amountCents: true } }),
        d.appointment.findMany({
          where: { startsAt: { gte: now }, status: { in: ["PENDING", "CONFIRMED", "ARRIVED"] } },
          orderBy: { startsAt: "asc" },
          take: 6,
          include: { patient: { select: { id: true, firstName: true, lastName: true, isDemo: true } }, dentist: { select: { firstName: true, lastName: true } } },
        }),
        d.patient.findMany({ where: { archivedAt: null }, orderBy: { registeredAt: "desc" }, take: 6, select: { id: true, firstName: true, lastName: true, fileNumber: true, registeredAt: true, isDemo: true } }),
        d.payment.findMany({ where: { cancelledAt: null, paidAt: { gte: yearAgo } }, select: { paidAt: true, amountCents: true } }),
        d.consultation.findMany({ where: { date: { gte: yearAgo } }, select: { date: true } }),
        stockAlerts(),
      ]);
      void canSeeMoney;
      const months = monthsBetween(yearAgo, addDays(now, 1));
      const revenue = bucket(months, payments, (p) => p.paidAt, (p) => p.amountCents);
      const consultCounts = bucket(months, consults, (c) => c.date, () => 1);
      const unpaid = await d.invoice.count({ where: { status: { in: ["UNPAID", "PARTIAL"] }, date: { lt: addDays(today, -30) } } });
      const notices = [
        ...(alerts.low.length ? [{ level: "warning", text: `${alerts.low.length} produit(s) en stock faible`, to: "/stock" }] : []),
        ...(alerts.expiring.length ? [{ level: "warning", text: `${alerts.expiring.length} produit(s) proches de leur date d'expiration`, to: "/stock" }] : []),
        ...(unpaid ? [{ level: "danger", text: `${unpaid} facture(s) impayée(s) depuis plus de 30 jours`, to: "/factures" }] : []),
      ];
      return {
        cards: {
          patients,
          newPatients,
          appointmentsToday: todayCount,
          appointmentsUpcoming: upcoming,
          consultationsMonth: consultations,
          revenueDayCents: dayRevenue._sum.amountCents ?? 0,
          revenueMonthCents: monthRevenue._sum.amountCents ?? 0,
          pendingCents: (pending._sum.totalCents ?? 0) - (pending._sum.paidCents ?? 0),
          pendingCount: pending._count,
          expensesMonthCents: monthExpenses._sum.amountCents ?? 0,
        },
        charts: months.map((m, i) => ({ month: m, revenue: revenue[i] / 100, consultations: consultCounts[i] })),
        nextAppointments,
        latestPatients,
        notices,
      };
    },
  }),

  /** Recherche globale de la barre du haut : uniquement des éléments autorisés */
  notifications: proc({
    access: "dashboard.read",
    input: z.void(),
    run: async () => {
      const alerts = await stockAlerts();
      return { count: alerts.low.length + alerts.expiring.length, low: alerts.low.slice(0, 5), expiring: alerts.expiring.slice(0, 5) };
    },
  }),
};

const statsInput = z.object({ from: z.coerce.date(), to: z.coerce.date(), dentistId: z.string().optional() });

async function computeStats(input: z.output<typeof statsInput>) {
  const d = db();
  const range = { gte: input.from, lt: input.to };
  const dentist = input.dentistId ? { dentistId: input.dentistId } : {};
  const paymentWhere = {
    cancelledAt: null,
    paidAt: range,
    // Filtre dentiste : factures qui comportent au moins un acte de ce dentiste
    ...(input.dentistId ? { invoice: { items: { some: { patientTreatment: { dentistId: input.dentistId } } } } } : {}),
  };
  const [patients, consultations, payments, expenses, appointments, treatments, debtors] = await Promise.all([
    d.patient.findMany({ where: { registeredAt: range }, select: { registeredAt: true } }),
    d.consultation.findMany({ where: { date: range, ...dentist }, select: { date: true } }),
    d.payment.findMany({ where: paymentWhere, select: { paidAt: true, amountCents: true } }),
    d.expense.findMany({ where: { date: range }, select: { date: true, amountCents: true } }),
    d.appointment.findMany({ where: { startsAt: range, ...dentist }, select: { status: true } }),
    d.patientTreatment.groupBy({ by: ["treatmentId"], where: { createdAt: range, status: { not: "CANCELLED" }, ...dentist }, _count: { _all: true }, orderBy: { _count: { treatmentId: "desc" } }, take: 10 }),
    d.invoice.findMany({ where: { status: { in: ["UNPAID", "PARTIAL"] } }, select: { totalCents: true, paidCents: true, patient: { select: { id: true, firstName: true, lastName: true, fileNumber: true } } } }),
  ]);
  const names = await d.treatment.findMany({ where: { id: { in: treatments.map((t) => t.treatmentId) } }, select: { id: true, name: true } });
  const months = monthsBetween(input.from, input.to);
  const monthly = months.map((month, i) => ({
    month,
    patients: bucket(months, patients, (p) => p.registeredAt, () => 1)[i],
    consultations: bucket(months, consultations, (c) => c.date, () => 1)[i],
    revenue: bucket(months, payments, (p) => p.paidAt, (p) => p.amountCents)[i] / 100,
    expenses: bucket(months, expenses, (e) => e.date, (e) => e.amountCents)[i] / 100,
  }));
  const debts = new Map<string, { id: string; name: string; fileNumber: string; dueCents: number }>();
  for (const inv of debtors) {
    const e = debts.get(inv.patient.id) ?? { id: inv.patient.id, name: `${inv.patient.lastName} ${inv.patient.firstName}`, fileNumber: inv.patient.fileNumber, dueCents: 0 };
    e.dueCents += inv.totalCents - inv.paidCents;
    debts.set(inv.patient.id, e);
  }
  const cancelled = appointments.filter((a) => a.status === "CANCELLED").length;
  const noShow = appointments.filter((a) => a.status === "NO_SHOW").length;
  const held = appointments.filter((a) => a.status === "COMPLETED").length;
  return {
    monthly,
    topTreatments: treatments.map((t) => ({ name: names.find((n) => n.id === t.treatmentId)?.name ?? "—", count: t._count._all })),
    debtors: [...debts.values()].sort((a, b) => b.dueCents - a.dueCents),
    appointments: { total: appointments.length, cancelled, noShow, noShowRate: noShow + held ? Math.round((noShow / (noShow + held)) * 1000) / 10 : 0 },
    totals: {
      consultations: consultations.length,
      patients: patients.length,
      revenueCents: payments.reduce((s, p) => s + p.amountCents, 0),
      expenseCents: expenses.reduce((s, e) => s + e.amountCents, 0),
    },
  };
}

const stamp = (from: Date, to: Date) => `${from.toISOString().slice(0, 10)}_${to.toISOString().slice(0, 10)}`;

export const stats = {
  report: proc({ access: "stats.read", input: statsInput, run: ({ input }) => computeStats(input) }),

  exportExcel: proc({
    access: "stats.read",
    input: statsInput,
    run: async ({ input, user }) => {
      const path = await platform().askSavePath(`statistiques_${stamp(input.from, input.to)}.xlsx`, "xlsx");
      if (!path) return null;
      const s = await computeStats(input);
      const book = new ExcelJS.Workbook();
      const add = (name: string, columns: { header: string; key: string; width: number }[], rows: object[]) => {
        const sheet = book.addWorksheet(name);
        sheet.columns = columns;
        sheet.getRow(1).font = { bold: true };
        sheet.addRows(rows);
      };
      add("Par mois", [{ header: "Mois", key: "month", width: 12 }, { header: "Nouveaux patients", key: "patients", width: 18 }, { header: "Consultations", key: "consultations", width: 15 }, { header: "Revenus (MAD)", key: "revenue", width: 15 }, { header: "Dépenses (MAD)", key: "expenses", width: 15 }], s.monthly);
      add("Traitements", [{ header: "Traitement", key: "name", width: 30 }, { header: "Nombre", key: "count", width: 10 }], s.topTreatments);
      add("Impayés", [{ header: "Dossier", key: "fileNumber", width: 12 }, { header: "Patient", key: "name", width: 30 }, { header: "Reste à payer (MAD)", key: "due", width: 20 }], s.debtors.map((x) => ({ ...x, due: x.dueCents / 100 })));
      add("Rendez-vous", [{ header: "Indicateur", key: "k", width: 25 }, { header: "Valeur", key: "v", width: 12 }], [{ k: "Total", v: s.appointments.total }, { k: "Annulés", v: s.appointments.cancelled }, { k: "Absents", v: s.appointments.noShow }, { k: "Taux d'absence (%)", v: s.appointments.noShowRate }]);
      await book.xlsx.writeFile(path);
      await audit(user, "stats.export", "Stats", null, "Excel");
      return path;
    },
  }),

  exportPdf: proc({
    access: "stats.read",
    input: statsInput,
    run: async ({ input, user }) => {
      const path = await platform().askSavePath(`statistiques_${stamp(input.from, input.to)}.pdf`, "pdf");
      if (!path) return null;
      const s = await computeStats(input);
      const settings = await db().clinicSettings.findUniqueOrThrow({ where: { id: 1 } });
      const table = (head: string[], rows: (string | number)[][]) =>
        `<table><thead><tr>${head.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(String(c))}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
      const body = `<h1>Statistiques</h1><p class="muted">Du ${input.from.toLocaleDateString("fr-FR")} au ${input.to.toLocaleDateString("fr-FR")}</p>
        <h2>Par mois</h2>${table(["Mois", "Patients", "Consultations", "Revenus", "Dépenses"], s.monthly.map((m) => [m.month, m.patients, m.consultations, moneyText(m.revenue * 100), moneyText(m.expenses * 100)]))}
        <h2>Traitements les plus fréquents</h2>${table(["Traitement", "Nombre"], s.topTreatments.map((t) => [t.name, t.count]))}
        <h2>Rendez-vous</h2>${table(["Total", "Annulés", "Absents", "Taux d'absence"], [[s.appointments.total, s.appointments.cancelled, s.appointments.noShow, `${s.appointments.noShowRate} %`]])}
        <h2>Patients avec paiements en attente</h2>${table(["Dossier", "Patient", "Reste à payer"], s.debtors.map((x) => [x.fileNumber, x.name, moneyText(x.dueCents)]))}`;
      await writeFile(path, await platform().htmlToPdf(pageShell(settings, body)));
      await audit(user, "stats.export", "Stats", null, "PDF");
      return path;
    },
  }),
};

export const auditLog = {
  list: proc({
    access: "audit.read",
    input: z.object({ page: z.number().int().min(1).default(1), pageSize: z.number().int().max(100).default(25), q: z.string().trim().max(60).optional() }),
    run: async ({ input }) => {
      const where = input.q ? { OR: [{ action: { contains: input.q } }, { userName: { contains: input.q } }, { details: { contains: input.q } }] } : {};
      const [rows, total] = await Promise.all([
        db().auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (input.page - 1) * input.pageSize, take: input.pageSize }),
        db().auditLog.count({ where }),
      ]);
      return { rows, total };
    },
  }),
};
