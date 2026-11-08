import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDatabase, db, openDatabase } from "../src/main/db";
import { dispatch } from "../src/main/ipc/procedure";
import { router } from "../src/main/ipc/router";
import { setPlatform } from "../src/main/platform";
import { decryptBuffer, encryptBuffer, setMigrationsDir, runAutoBackupIfDue } from "../src/main/services/backup";
import { endSession } from "../src/main/security/session";

const dir = mkdtempSync(join(tmpdir(), "cabinet-test-"));
const migrations = resolve("prisma/migrations");
let nextSave: string | null = null;
let nextOpen: string | null = null;

async function call<T = any>(path: string, input?: unknown): Promise<T> {
  const r = await dispatch(router as never, path, input);
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r.data as T;
}
const fails = async (path: string, input?: unknown) => {
  const r = await dispatch(router as never, path, input);
  expect(r.ok).toBe(false);
  return r as { ok: false; code: string; message: string };
};

const ADMIN = { username: "admin", password: "MotDePasse2026" };
const login = async (username: string, password: string) => {
  endSession();
  await call("auth.login", { username, password });
};

let dentistId: string;
let patientId: string;

beforeAll(async () => {
  setPlatform({
    dataDir: dir,
    encryptSecret: (s) => `enc:${s}`,
    decryptSecret: (s) => s.slice(4),
    askSavePath: async () => nextSave,
    askOpenPath: async () => nextOpen,
    askDirectory: async () => dir,
    htmlToPdf: async (html) => Buffer.from(html),
    openPath: async () => {},
  });
  setMigrationsDir(migrations);
  await openDatabase(join(dir, "t.db"), migrations);
});

afterAll(async () => {
  await closeDatabase();
  // Windows garde un verrou sur la base jusqu'à la fin du processus
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {}
});

describe("authentification et rôles", () => {
  it("impose la création de l'administrateur au premier lancement", async () => {
    expect((await call("auth.status")).needsSetup).toBe(true);
    await fails("patients.list", {});
    await fails("auth.setup", { firstName: "A", lastName: "B", username: "admin", password: "court", clinicName: "C" });
    await call("auth.setup", { firstName: "Ali", lastName: "Admin", username: "admin", password: ADMIN.password, clinicName: "Cabinet Test" });
    expect((await call("auth.status")).needsSetup).toBe(false);
    await fails("auth.setup", { firstName: "X", lastName: "Y", username: "autre", password: ADMIN.password, clinicName: "C" });
  });

  it("ne stocke jamais le mot de passe en clair et bloque après 5 échecs", async () => {
    const u = await db().user.findFirstOrThrow();
    expect(u.passwordHash).not.toContain(ADMIN.password);
    await call("users.create", { firstName: "Dina", lastName: "Dentiste", username: "dentiste", role: "DENTIST", password: "Dentiste20261" });
    await call("users.create", { firstName: "Sara", lastName: "Sec", username: "secretaire", role: "SECRETARY", password: "Secretaire2026" });
    await call("users.create", { firstName: "Bob", lastName: "Bloc", username: "bob", role: "SECRETARY", password: "BobBloque20261" });
    endSession();
    for (let i = 0; i < 5; i++) expect((await fails("auth.login", { username: "bob", password: "mauvais" })).message).toContain("incorrect");
    expect((await fails("auth.login", { username: "bob", password: "BobBloque20261" })).message).toContain("bloqué");
  });

  it("force le changement du mot de passe provisoire", async () => {
    await login("dentiste", "Dentiste20261");
    expect((await fails("patients.list", {})).message).toContain("mot de passe");
    await call("auth.changePassword", { currentPassword: "Dentiste20261", newPassword: "Dentiste2026B" });
    await login("secretaire", "Secretaire2026");
    await call("auth.changePassword", { currentPassword: "Secretaire2026", newPassword: "Secretaire2026B" });
    await login("dentiste", "Dentiste2026B");
    dentistId = (await call("auth.status")).user.id;
    await call("patients.list", {});
  });

  it("interdit le dernier administrateur de disparaître", async () => {
    await login(ADMIN.username, ADMIN.password);
    const admin = (await call("users.list")).find((u: any) => u.role === "ADMIN");
    expect((await fails("users.update", { ...admin, phone: null, email: null, active: false })).message).toContain("administrateur");
  });
});

describe("patients", () => {
  it("crée, modifie, détecte un doublon", async () => {
    await login(ADMIN.username, ADMIN.password);
    const p = await call("patients.create", { firstName: "Imane", lastName: "Tazi", phone: "0612345678", birthDate: "1990-01-02", gender: "FEMALE", email: "" });
    patientId = p.id;
    expect(p.fileNumber).toBe("P-00001");
    await fails("patients.create", { firstName: "Imane", lastName: "Tazi", phone: "0612345678" });
    const u = await call("patients.update", { id: p.id, firstName: "Imane", lastName: "Tazi-B", phone: "0612345678" });
    expect(u.lastName).toBe("Tazi-B");
    expect((await call("patients.list", { q: "Tazi-B" })).total).toBe(1);
  });

  it("archive puis restaure", async () => {
    await call("patients.setArchived", { id: patientId, archived: true });
    expect((await call("patients.list", {})).total).toBe(0);
    expect((await call("patients.list", { status: "archived" })).total).toBe(1);
    await call("patients.setArchived", { id: patientId, archived: false });
  });

  it("protège le dossier médical de la secrétaire", async () => {
    await call("medical.save", { patientId, allergies: "Latex" });
    await login("secretaire", "Secretaire2026B");
    expect((await fails("medical.get", { patientId })).code).toBe("FORBIDDEN");
    expect((await fails("consultations.forPatient", { patientId })).code).toBe("FORBIDDEN");
    expect((await fails("odontogram.get", { patientId })).code).toBe("FORBIDDEN");
    expect((await fails("users.list")).code).toBe("FORBIDDEN");
    expect((await fails("backup.status")).code).toBe("FORBIDDEN");
    expect((await fails("documents.generate", { type: "PRESCRIPTION", consultationId: "x" })).message).toContain("accès");
    const p = await call("patients.get", { id: patientId });
    expect(JSON.stringify(p)).not.toContain("Latex");
    await call("patients.list", {});
  });
});

describe("rendez-vous", () => {
  const at = (h: number, m = 0) => new Date(2030, 0, 15, h, m).toISOString();
  it("détecte les conflits et autorise un créneau libéré", async () => {
    await login(ADMIN.username, ADMIN.password);
    const other = await call("patients.create", { firstName: "Omar", lastName: "Alami" });
    const a = await call("appointments.create", { patientId, dentistId, startsAt: at(10), endsAt: at(10, 30), type: "Consultation" });
    expect((await fails("appointments.create", { patientId: other.id, dentistId, startsAt: at(10, 15), endsAt: at(10, 45), type: "Soin" })).message).toContain("dentiste");
    expect((await fails("appointments.create", { patientId, dentistId, startsAt: at(9), endsAt: at(9), type: "Soin" })).message).toContain("fin");
    await call("appointments.setStatus", { id: a.id, status: "CANCELLED" });
    const b = await call("appointments.create", { patientId: other.id, dentistId, startsAt: at(10, 15), endsAt: at(10, 45), type: "Soin" });
    expect((await fails("appointments.setStatus", { id: a.id, status: "CONFIRMED" })).message).toContain("créneau");
    const moved = await call("appointments.update", { id: b.id, patientId: other.id, dentistId, startsAt: at(14), endsAt: at(14, 30), type: "Soin", status: "CONFIRMED" });
    expect(new Date(moved.startsAt).getHours()).toBe(14);
  });
});

describe("consultation, odontogramme", () => {
  it("enregistre une consultation avec ses actes dans l'historique", async () => {
    const [t] = await call("treatments.catalog", {});
    const c = await call("consultations.save", { patientId, dentistId, date: new Date().toISOString(), reason: "Douleur", diagnosis: "Carie 16", prescriptions: "Paracétamol", treatmentIds: [{ treatmentId: t.id, toothNumber: 16 }] });
    expect((await call("consultations.forPatient", { patientId }))[0].id).toBe(c.id);
    const list = await call("treatments.forPatient", { patientId });
    expect(list[0].status).toBe("COMPLETED");
  });

  it("modifie une dent et conserve l'historique", async () => {
    await call("odontogram.save", { patientId, number: 16, condition: "CARIES", faces: { O: "CARIES" } });
    await call("odontogram.save", { patientId, number: 16, condition: "FILLING", faces: { O: "FILLING" }, note: "Composite" });
    const teeth = await call("odontogram.get", { patientId });
    expect(teeth).toHaveLength(1);
    expect(teeth[0].condition).toBe("FILLING");
    const history = await call("odontogram.history", { patientId, number: 16 });
    expect(history).toHaveLength(2);
    expect(history[0].previousCondition).toBe("CARIES");
    await fails("odontogram.save", { patientId, number: 99, condition: "CARIES" });
  });
});

describe("facturation", () => {
  it("calcule remise, paiements partiels et reste à payer", async () => {
    const inv = await call("billing.create", { patientId, date: "2030-02-01", items: [{ label: "Soin", quantity: 2, unitPrice: 150.5 }, { label: "Radio", quantity: 1, unitPrice: 100 }], discount: 1 });
    expect(inv.number).toBe("F-2030-00001");
    expect(inv.totalCents).toBe(40000);
    let r = await call("billing.addPayment", { invoiceId: inv.id, amount: 100.1, method: "CASH" });
    expect(r.status).toBe("PARTIAL");
    expect(r.paidCents).toBe(10010);
    expect((await fails("billing.addPayment", { invoiceId: inv.id, amount: 300, method: "CASH" })).message).toContain("dépasse");
    r = await call("billing.addPayment", { invoiceId: inv.id, amount: 299.9, method: "CARD" });
    expect(r.status).toBe("PAID");
    await fails("billing.cancel", { id: inv.id, reason: "Erreur saisie" });
    const full = await call("billing.get", { id: inv.id });
    for (const p of full.payments) await call("billing.cancelPayment", { paymentId: p.id });
    expect((await call("billing.get", { id: inv.id })).status).toBe("UNPAID");
    expect((await call("billing.cancel", { id: inv.id, reason: "Erreur saisie" })).status).toBe("CANCELLED");
    await fails("billing.addPayment", { invoiceId: inv.id, amount: 10, method: "CASH" });
    await fails("billing.create", { patientId, date: "2030-02-01", items: [{ label: "x", quantity: 1, unitPrice: 10 }], discount: 20 });
    const second = await call("billing.create", { patientId, date: "2030-03-01", items: [{ label: "y", quantity: 1, unitPrice: 10 }] });
    expect(second.number).toBe("F-2030-00002");
  });

  it("refuse la suppression d'un patient facturé", async () => {
    expect((await fails("patients.remove", { id: patientId })).message).toContain("archivez");
  });

  it("refuse l'annulation de facture à la secrétaire", async () => {
    const inv = await call("billing.create", { patientId, date: "2030-04-01", items: [{ label: "z", quantity: 1, unitPrice: 5 }] });
    await login("secretaire", "Secretaire2026B");
    expect((await fails("billing.cancel", { id: inv.id, reason: "Test motif" })).message).toContain("autorisé");
    await login(ADMIN.username, ADMIN.password);
  });
});

describe("stock et dépenses", () => {
  it("met à jour le stock, refuse le négatif, alerte", async () => {
    const p = await call("stock.save", { name: "Gants", reference: "G1", category: "Hygiène", minQuantity: 5, purchasePrice: 10, initialQuantity: 10, expiryDate: new Date(Date.now() + 10 * 86_400_000).toISOString(), supplierId: "" });
    let u = await call("stock.move", { productId: p.id, type: "OUT", quantity: 6 });
    expect(u.quantity).toBe(4);
    await fails("stock.move", { productId: p.id, type: "OUT", quantity: 5 });
    u = await call("stock.move", { productId: p.id, type: "IN", quantity: 1 });
    expect(u.quantity).toBe(5);
    const alerts = await call("stock.alerts");
    expect(alerts.low).toHaveLength(1);
    expect(alerts.expiring).toHaveLength(1);
    expect((await call("stock.movements", { productId: p.id })).total).toBe(3);
  });

  it("calcule le résultat", async () => {
    await call("expenses.save", { date: "2031-01-10", category: "RENT", label: "Loyer", amount: 1000 });
    const s = await call("expenses.summary", { from: "2031-01-01", to: "2031-02-01" });
    expect(s).toEqual({ revenueCents: 0, expenseCents: 100000, resultCents: -100000 });
  });
});

describe("documents, tableau de bord, statistiques", () => {
  it("échappe le contenu saisi dans les PDF", async () => {
    const p = await call("patients.create", { firstName: "<script>x</script>", lastName: "Html" });
    nextSave = join(dir, "fiche.pdf");
    await call("documents.generate", { type: "PATIENT_FILE", patientId: p.id });
    const row = await db().document.findFirstOrThrow({ where: { patientId: p.id } });
    expect(row.payload).not.toContain("<script>x");
    nextSave = null;
    expect(await call("documents.generate", { type: "PATIENT_FILE", patientId: p.id })).toBeNull();
  });

  it("calcule le tableau de bord et les statistiques depuis la base", async () => {
    const o = await call("dashboard.overview");
    expect(o.cards.patients).toBeGreaterThan(0);
    expect(o.charts).toHaveLength(12);
    const s = await call("stats.report", { from: new Date(2030, 0, 1), to: new Date(2031, 0, 1) });
    expect(s.monthly).toHaveLength(12);
    expect(s.appointments.cancelled).toBe(1);
  });
});

describe("données de démonstration", () => {
  it("charge puis retire seulement les lignes de démonstration", async () => {
    const before = await db().patient.count();
    await call("demo.load");
    expect(await db().patient.count({ where: { isDemo: true } })).toBe(15);
    expect(await db().appointment.count({ where: { isDemo: true } })).toBe(10);
    expect(await db().consultation.count({ where: { isDemo: true } })).toBe(5);
    await fails("demo.load");
    await call("demo.remove");
    expect(await db().patient.count()).toBe(before);
    expect(await db().invoice.count({ where: { isDemo: true } })).toBe(0);
  });
});

describe("sauvegarde et restauration", () => {
  const secret = "phrase secrete de test";
  it("chiffre : la mauvaise phrase et un fichier altéré sont refusés", () => {
    const enc = encryptBuffer(Buffer.from("données patient"), secret);
    expect(enc.includes(Buffer.from("données patient"))).toBe(false);
    expect(decryptBuffer(enc, secret).toString()).toBe("données patient");
    expect(() => decryptBuffer(enc, "mauvaise phrase secrete")).toThrow();
    enc[enc.length - 1] ^= 1;
    expect(() => decryptBuffer(enc, secret)).toThrow();
  });

  it("restaure l'état exact après une perte de données", async () => {
    const path = await call("backup.createNow", { secret });
    const count = await db().patient.count();
    await call("patients.create", { firstName: "Après", lastName: "Sauvegarde" });
    expect(await db().patient.count()).toBe(count + 1);
    expect((await fails("backup.restore", { path, secret: "mauvaise phrase secrete" })).message).toContain("Phrase");
    expect(await db().patient.count()).toBe(count + 1);
    await call("backup.restore", { path, secret });
    expect(await db().patient.count()).toBe(count);
    await fails("patients.list", {});
    await login(ADMIN.username, ADMIN.password);
  });

  it("sauvegarde automatique selon la configuration", async () => {
    expect(await runAutoBackupIfDue()).toBeNull();
    await call("backup.configure", { enabled: true, hours: 24, retention: 1, secret });
    expect(await runAutoBackupIfDue()).toBeTruthy();
    expect(await runAutoBackupIfDue()).toBeNull();
    const later = new Date(Date.now() + 25 * 3_600_000);
    expect(await runAutoBackupIfDue(later)).toBeTruthy();
    expect((await call("backup.status")).files).toHaveLength(1);
  });

  it("journalise les actions importantes", async () => {
    const { rows } = await call("audit.list", { q: "patient.create" });
    expect(rows.length).toBeGreaterThan(0);
  });
});
