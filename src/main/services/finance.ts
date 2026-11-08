import { z } from "zod";
import { PRODUCT_CATEGORIES } from "@shared/constants";
import { can } from "@shared/permissions";
import { expenseSchema, invoiceSchema, pageInput, paymentSchema, productSchema, stockMovementSchema, supplierSchema, toCents } from "@shared/schemas";
import { db } from "../db";
import type { Prisma } from "../db/generated/client";
import { AppError, audit, proc } from "../ipc/procedure";
import { displayName } from "../security/session";

const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

export function invoiceStatus(totalCents: number, paidCents: number): "PAID" | "PARTIAL" | "UNPAID" {
  if (paidCents >= totalCents) return "PAID";
  return paidCents > 0 ? "PARTIAL" : "UNPAID";
}

async function nextInvoiceNumber(tx: Prisma.TransactionClient, date: Date) {
  const prefix = `F-${date.getFullYear()}-`;
  const last = await tx.invoice.findFirst({ where: { number: { startsWith: prefix } }, orderBy: { number: "desc" }, select: { number: true } });
  return `${prefix}${String((last ? Number(last.number.slice(prefix.length)) : 0) + 1).padStart(5, "0")}`;
}

/** Recalcule le payé depuis les paiements valides : le total ne peut pas dériver */
async function refreshInvoice(tx: Prisma.TransactionClient, invoiceId: string) {
  const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  const sum = await tx.payment.aggregate({ where: { invoiceId, cancelledAt: null }, _sum: { amountCents: true } });
  const paidCents = sum._sum.amountCents ?? 0;
  return tx.invoice.update({ where: { id: invoiceId }, data: { paidCents, status: invoice.status === "CANCELLED" ? "CANCELLED" : invoiceStatus(invoice.totalCents, paidCents) } });
}

const patientBrief = { select: { id: true, firstName: true, lastName: true, fileNumber: true, isDemo: true } } as const;

export const billing = {
  list: proc({
    access: "billing.read",
    input: pageInput.extend({ q: z.string().trim().max(100).optional(), status: z.string().optional(), patientId: z.string().optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional() }),
    run: async ({ input }) => {
      const where: Prisma.InvoiceWhereInput = {
        ...(input.status ? { status: input.status } : {}),
        ...(input.patientId ? { patientId: input.patientId } : {}),
        ...(input.from || input.to ? { date: { ...(input.from ? { gte: input.from } : {}), ...(input.to ? { lte: input.to } : {}) } } : {}),
        ...(input.q ? { OR: [{ number: { contains: input.q } }, { patient: { OR: [{ firstName: { contains: input.q } }, { lastName: { contains: input.q } }] } }] } : {}),
      };
      const [rows, total] = await Promise.all([
        db().invoice.findMany({ where, orderBy: [{ date: "desc" }, { number: "desc" }], skip: (input.page - 1) * input.pageSize, take: input.pageSize, include: { patient: patientBrief } }),
        db().invoice.count({ where }),
      ]);
      return { rows, total };
    },
  }),

  get: proc({
    access: "billing.read",
    input: z.object({ id: z.string() }),
    run: ({ input }) => db().invoice.findUniqueOrThrow({ where: { id: input.id }, include: { patient: patientBrief, items: true, payments: { orderBy: { paidAt: "desc" } } } }),
  }),

  /** Actes terminés ou en cours pas encore facturés : proposés à la création de facture */
  unbilled: proc({
    access: "billing.read",
    input: z.object({ patientId: z.string() }),
    run: ({ input }) =>
      db().patientTreatment.findMany({ where: { patientId: input.patientId, status: { in: ["COMPLETED", "IN_PROGRESS"] }, invoiceItems: { none: {} } }, include: { treatment: { select: { name: true } } }, orderBy: { createdAt: "desc" } }),
  }),

  create: proc({
    access: "billing.write",
    input: invoiceSchema,
    run: async ({ input, user }) => {
      const items = input.items.map((i) => ({ label: i.label, quantity: i.quantity, unitPriceCents: toCents(i.unitPrice), totalCents: toCents(i.unitPrice) * i.quantity, patientTreatmentId: i.patientTreatmentId ?? null }));
      const subtotalCents = items.reduce((s, i) => s + i.totalCents, 0);
      const discountCents = toCents(input.discount);
      if (discountCents > subtotalCents) throw new AppError("La remise dépasse le total.");
      const totalCents = subtotalCents - discountCents;
      const invoice = await db().$transaction(async (tx) =>
        tx.invoice.create({
          data: { number: await nextInvoiceNumber(tx, input.date), patientId: input.patientId, date: input.date, subtotalCents, discountCents, totalCents, status: invoiceStatus(totalCents, 0), notes: input.notes ?? null, createdById: user.id, items: { create: items } },
        }),
      );
      await audit(user, "invoice.create", "Invoice", invoice.id, invoice.number);
      return invoice;
    },
  }),

  addPayment: proc({
    access: "billing.write",
    input: paymentSchema,
    run: async ({ input, user }) => {
      const amountCents = toCents(input.amount);
      const invoice = await db().$transaction(async (tx) => {
        const current = await tx.invoice.findUniqueOrThrow({ where: { id: input.invoiceId } });
        if (current.status === "CANCELLED") throw new AppError("Cette facture est annulée.");
        const remaining = current.totalCents - current.paidCents;
        if (remaining <= 0) throw new AppError("Cette facture est déjà réglée.");
        if (amountCents > remaining) throw new AppError(`Le montant dépasse le reste à payer (${(remaining / 100).toFixed(2)} MAD).`);
        await tx.payment.create({ data: { invoiceId: input.invoiceId, amountCents, method: input.method, reference: input.reference ?? null, paidAt: input.paidAt ?? new Date(), receivedById: user.id } });
        return refreshInvoice(tx, input.invoiceId);
      });
      await audit(user, "payment.create", "Invoice", invoice.id, `${invoice.number} : ${amountCents / 100} MAD`);
      return invoice;
    },
  }),

  cancelPayment: proc({
    access: "billing.write",
    input: z.object({ paymentId: z.string() }),
    run: async ({ input, user }) => {
      if (!can(user.role, "users.manage") && user.role !== "DENTIST") throw new AppError("Annulation réservée à l'administrateur ou au dentiste.");
      const invoice = await db().$transaction(async (tx) => {
        const p = await tx.payment.update({ where: { id: input.paymentId }, data: { cancelledAt: new Date() } });
        return refreshInvoice(tx, p.invoiceId);
      });
      await audit(user, "payment.cancel", "Invoice", invoice.id, invoice.number);
      return invoice;
    },
  }),

  /** Annulation selon la règle des paramètres ; jamais de suppression, le numéro reste dans la séquence */
  cancel: proc({
    access: "billing.write",
    input: z.object({ id: z.string(), reason: z.string().trim().min(3, "Indiquez le motif") }),
    run: async ({ input, user }) => {
      const settings = await db().clinicSettings.findUnique({ where: { id: 1 } });
      const allowed = user.role === "ADMIN" || (settings?.invoiceCancelRole === "ADMIN_DENTIST" && user.role === "DENTIST");
      if (!allowed) throw new AppError("Vous n'êtes pas autorisé à annuler une facture.");
      const invoice = await db().$transaction(async (tx) => {
        const current = await tx.invoice.findUniqueOrThrow({ where: { id: input.id } });
        if (current.status === "CANCELLED") throw new AppError("Facture déjà annulée.");
        if (current.paidCents > 0) throw new AppError("Annulez d'abord les paiements de cette facture.");
        return tx.invoice.update({ where: { id: input.id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: input.reason } });
      });
      await audit(user, "invoice.cancel", "Invoice", invoice.id, invoice.number);
      return invoice;
    },
  }),

  payments: proc({
    access: "billing.read",
    input: pageInput,
    run: async ({ input }) => {
      const [rows, total] = await Promise.all([
        db().payment.findMany({ orderBy: { paidAt: "desc" }, skip: (input.page - 1) * input.pageSize, take: input.pageSize, include: { invoice: { select: { number: true, patient: patientBrief } } } }),
        db().payment.count(),
      ]);
      return { rows, total };
    },
  }),
};

export const expenses = {
  list: proc({
    access: "expenses.read",
    input: pageInput.extend({ category: z.string().optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional() }),
    run: async ({ input }) => {
      const where: Prisma.ExpenseWhereInput = {
        ...(input.category ? { category: input.category } : {}),
        ...(input.from || input.to ? { date: { ...(input.from ? { gte: input.from } : {}), ...(input.to ? { lte: input.to } : {}) } } : {}),
      };
      const [rows, total, sum] = await Promise.all([
        db().expense.findMany({ where, orderBy: { date: "desc" }, skip: (input.page - 1) * input.pageSize, take: input.pageSize }),
        db().expense.count({ where }),
        db().expense.aggregate({ where, _sum: { amountCents: true } }),
      ]);
      return { rows, total, totalCents: sum._sum.amountCents ?? 0 };
    },
  }),

  /** Résultat de la période : encaissements moins dépenses */
  summary: proc({
    access: "expenses.read",
    input: z.object({ from: z.coerce.date(), to: z.coerce.date() }),
    run: async ({ input }) => {
      const [revenue, spent] = await Promise.all([
        db().payment.aggregate({ where: { cancelledAt: null, paidAt: { gte: input.from, lt: input.to } }, _sum: { amountCents: true } }),
        db().expense.aggregate({ where: { date: { gte: input.from, lt: input.to } }, _sum: { amountCents: true } }),
      ]);
      const revenueCents = revenue._sum.amountCents ?? 0;
      const expenseCents = spent._sum.amountCents ?? 0;
      return { revenueCents, expenseCents, resultCents: revenueCents - expenseCents };
    },
  }),

  save: proc({
    access: "expenses.write",
    input: expenseSchema.extend({ id: z.string().optional() }),
    run: async ({ input: { id, amount, ...rest }, user }) => {
      const data = { ...rest, notes: rest.notes ?? null, amountCents: toCents(amount) };
      const saved = id ? await db().expense.update({ where: { id }, data }) : await db().expense.create({ data: { ...data, createdById: user.id } });
      await audit(user, id ? "expense.update" : "expense.create", "Expense", saved.id, saved.label);
      return saved;
    },
  }),

  remove: proc({
    access: "expenses.delete",
    input: z.object({ id: z.string() }),
    run: async ({ input, user }) => {
      const row = await db().expense.delete({ where: { id: input.id } });
      await audit(user, "expense.delete", "Expense", input.id, `${row.label} : ${row.amountCents / 100} MAD`);
    },
  }),
};

const EXPIRY_ALERT_DAYS = 60;

export async function stockAlerts() {
  const products = await db().product.findMany({ where: { active: true }, select: { id: true, name: true, reference: true, quantity: true, minQuantity: true, expiryDate: true } });
  const limit = addDays(new Date(), EXPIRY_ALERT_DAYS);
  return {
    low: products.filter((p) => p.quantity <= p.minQuantity),
    expiring: products.filter((p) => p.expiryDate && p.expiryDate <= limit).sort((a, b) => a.expiryDate!.getTime() - b.expiryDate!.getTime()),
  };
}

export const stock = {
  categories: proc({ access: "stock.read", input: z.void(), run: async () => PRODUCT_CATEGORIES }),

  list: proc({
    access: "stock.read",
    input: pageInput.extend({ q: z.string().trim().max(100).optional(), category: z.string().optional(), alert: z.enum(["low", "expiring"]).optional() }),
    run: async ({ input }) => {
      const where: Prisma.ProductWhereInput = {
        active: true,
        ...(input.category ? { category: input.category } : {}),
        ...(input.q ? { OR: [{ name: { contains: input.q } }, { reference: { contains: input.q } }] } : {}),
      };
      if (input.alert) {
        const alerts = await stockAlerts();
        where.id = { in: alerts[input.alert].map((p) => p.id) };
      }
      const [rows, total] = await Promise.all([
        db().product.findMany({ where, orderBy: { name: "asc" }, skip: (input.page - 1) * input.pageSize, take: input.pageSize, include: { supplier: { select: { id: true, name: true } } } }),
        db().product.count({ where }),
      ]);
      return { rows, total };
    },
  }),

  alerts: proc({ access: "stock.read", input: z.void(), run: () => stockAlerts() }),

  save: proc({
    access: "stock.write",
    input: productSchema.extend({ id: z.string().optional(), initialQuantity: z.coerce.number().int().min(0).default(0) }),
    run: async ({ input: { id, purchasePrice, initialQuantity, ...rest }, user }) => {
      const data = { ...rest, purchasePriceCents: toCents(purchasePrice) };
      const saved = await db().$transaction(async (tx) => {
        if (id) return tx.product.update({ where: { id }, data });
        const product = await tx.product.create({ data: { ...data, quantity: initialQuantity } });
        if (initialQuantity > 0) await tx.stockMovement.create({ data: { productId: product.id, type: "IN", quantity: initialQuantity, reason: "Stock initial", userName: displayName(user) } });
        return product;
      });
      await audit(user, id ? "product.update" : "product.create", "Product", saved.id, saved.name);
      return saved;
    },
  }),

  deactivate: proc({
    access: "stock.write",
    input: z.object({ id: z.string() }),
    run: async ({ input, user }) => {
      await db().product.update({ where: { id: input.id }, data: { active: false } });
      await audit(user, "product.deactivate", "Product", input.id);
    },
  }),

  move: proc({
    access: "stock.write",
    input: stockMovementSchema,
    run: async ({ input, user }) => {
      const product = await db().$transaction(async (tx) => {
        const current = await tx.product.findUniqueOrThrow({ where: { id: input.productId } });
        if (input.type === "OUT" && input.quantity > current.quantity) throw new AppError(`Stock insuffisant (${current.quantity} disponible).`);
        await tx.stockMovement.create({ data: { ...input, reason: input.reason ?? null, userName: displayName(user) } });
        return tx.product.update({ where: { id: input.productId }, data: { quantity: input.type === "IN" ? { increment: input.quantity } : { decrement: input.quantity } } });
      });
      await audit(user, "stock.move", "Product", input.productId, `${input.type} ${input.quantity}`);
      return product;
    },
  }),

  movements: proc({
    access: "stock.read",
    input: pageInput.extend({ productId: z.string().optional() }),
    run: async ({ input }) => {
      const where = input.productId ? { productId: input.productId } : {};
      const [rows, total] = await Promise.all([
        db().stockMovement.findMany({ where, orderBy: { createdAt: "desc" }, skip: (input.page - 1) * input.pageSize, take: input.pageSize, include: { product: { select: { name: true, reference: true } } } }),
        db().stockMovement.count({ where }),
      ]);
      return { rows, total };
    },
  }),
};

export const suppliers = {
  list: proc({ access: "stock.read", input: z.void(), run: () => db().supplier.findMany({ orderBy: { name: "asc" } }) }),
  save: proc({
    access: "stock.write",
    input: supplierSchema.extend({ id: z.string().optional() }),
    run: async ({ input: { id, ...data } }) => (id ? db().supplier.update({ where: { id }, data }) : db().supplier.create({ data })),
  }),
};
