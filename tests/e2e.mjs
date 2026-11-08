// Parcours complet dans la vraie application Electron, sur un dossier de données temporaire.
// Lancer après `npm run build` : node tests/e2e.mjs
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron } from "playwright-core";

const shots = process.env.E2E_SHOTS ?? join(tmpdir(), "cabinet-e2e-shots");
const userData = mkdtempSync(join(tmpdir(), "cabinet-e2e-"));
// E2E_EXE : teste la version empaquetée au lieu du code compilé
const launchOptions = process.env.E2E_EXE ? { executablePath: process.env.E2E_EXE, args: [`--user-data-dir=${userData}`] } : { args: [".", `--user-data-dir=${userData}`] };
const app = await electron.launch({ ...launchOptions, timeout: 60000 });
const win = await app.firstWindow();
const problems = [];
win.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
win.on("pageerror", (e) => problems.push(`page: ${e.message}`));
let step = 0;
const shot = (name) => win.screenshot({ path: join(shots, `${String(++step).padStart(2, "0")}-${name}.png`) });
const nav = async (label, heading) => {
  await win.locator("aside").getByRole("link", { name: label, exact: true }).click();
  await win.getByRole("heading", { name: heading }).first().waitFor({ timeout: 10000 });
  await win.waitForTimeout(400);
  await shot(label.replace(/\W+/g, "_"));
};
const fill = (name, value) => win.locator(`[name="${name}"]`).fill(value);

try {
  await win.getByText("Première configuration").waitFor({ timeout: 30000 });
  await fill("clinicName", "Cabinet Test E2E");
  await fill("firstName", "Amina");
  await fill("lastName", "Admin");
  await fill("username", "admin");
  await fill("password", "MotDePasse2026");
  await shot("setup");
  await win.getByRole("button", { name: "Créer le compte" }).click();
  await win.getByRole("heading", { name: "Tableau de bord" }).waitFor({ timeout: 15000 });
  await win.waitForTimeout(600);
  await shot("dashboard-vide");

  await nav("Paramètres", "Paramètres");
  await win.getByRole("button", { name: "Charger les données" }).click();
  await win.getByRole("button", { name: "Supprimer les données" }).waitFor({ timeout: 15000 });

  await nav("Tableau de bord", "Tableau de bord");
  await nav("Patients", "Patients");
  await win.getByRole("button", { name: "Nouveau patient" }).click();
  await fill("lastName", "Vrai");
  await fill("firstName", "Patient");
  await win.getByRole("button", { name: "Enregistrer" }).click();
  await win.getByText("Patient créé").waitFor({ timeout: 8000 });
  await win.getByRole("heading", { name: /Vrai Patient/ }).waitFor();
  await win.getByRole("button", { name: "Odontogramme" }).click();
  await win.locator('[aria-label^="Dent 16"]').click();
  await win.getByRole("button", { name: "Carie" }).first().click();
  await win.getByRole("button", { name: "Enregistrer" }).click();
  await win.getByText("Dent 16 enregistrée").waitFor({ timeout: 8000 });
  await win.waitForTimeout(400);
  await win.getByRole("main").evaluate((m) => m.scrollTo(0, 0));
  await win.waitForTimeout(200);
  await shot("odontogramme");
  for (const t of ["Dossier médical", "Consultations", "Traitements", "Factures et paiements", "Documents"]) {
    await win.getByRole("main").getByRole("button", { name: t, exact: true }).click();
    await win.waitForTimeout(300);
    await shot(`onglet_${t.replace(/\W+/g, "_")}`);
  }
  // Vrai PDF et vrai coffre Windows : seul le dialogue d'enregistrement est remplacé
  const pdfPath = join(userData, "fiche-test.pdf");
  await app.evaluate(({ dialog, shell }, path) => {
    dialog.showSaveDialog = async () => ({ filePath: path });
    shell.openPath = async () => "";
  }, pdfPath);
  await win.getByRole("button", { name: "Fiche patient PDF" }).click();
  await win.getByRole("cell", { name: "Fiche Vrai Patient" }).waitFor({ timeout: 15000 });
  if (readFileSync(pdfPath).subarray(0, 4).toString() !== "%PDF") throw new Error("PDF invalide");

  await nav("Paramètres", "Paramètres");
  await win.locator('input[autocomplete="new-password"]').fill("phrase secrete longue");
  await win.getByRole("button", { name: "Enregistrer", exact: true }).nth(1).click();
  await win.getByText("Configuration enregistrée").waitFor({ timeout: 8000 });
  await win.getByRole("button", { name: "Sauvegarder maintenant" }).click();
  await win.getByText("Sauvegarde créée").waitFor({ timeout: 20000 });
  await win.getByRole("cell", { name: /sauvegarde-.*cdbak/ }).first().waitFor({ timeout: 8000 });
  await shot("sauvegarde");

  await nav("Rendez-vous", "Rendez-vous");
  await nav("Consultations", "Consultations");
  await nav("Traitements", "Catalogue des traitements");
  await nav("Factures", "Factures et paiements");
  await nav("Dépenses", "Dépenses");
  await nav("Stock", "Stock");
  await nav("Documents", "Documents");
  await nav("Statistiques", "Statistiques et rapports");
  await nav("Personnel", "Personnel");
  await nav("Journal", "Journal des actions");

  await app.evaluate(({ app: a }) => a.getPath("userData"));
  // Persistance : une seconde instance relit la même base
  await app.close();
  const again = await electron.launch({ ...launchOptions, timeout: 60000 });
  const w2 = await again.firstWindow();
  await w2.getByText("Connexion").first().waitFor({ timeout: 30000 });
  await w2.locator('[name="username"]').fill("admin");
  await w2.locator('[name="password"]').fill("MotDePasse2026");
  await w2.getByRole("button", { name: "Se connecter" }).click();
  await w2.getByRole("heading", { name: "Tableau de bord" }).waitFor({ timeout: 15000 });
  await w2.locator("aside").getByRole("link", { name: "Patients", exact: true }).click();
  await w2.locator('input[placeholder^="Nom, téléphone"]').fill("Vrai");
  await w2.getByRole("link", { name: "Vrai Patient" }).waitFor({ timeout: 8000 });
  await again.close();
  console.log(`OK. Problèmes console : ${problems.length}`);
  problems.slice(0, 20).forEach((p) => console.log(p));
} catch (e) {
  console.log("ECHEC", e.message.split("\n").slice(0, 6).join(" | "));
  problems.slice(0, 20).forEach((p) => console.log(p));
  await shot("echec").catch(() => {});
  await app.close().catch(() => {});
  process.exitCode = 1;
}
console.log("Captures :", shots);
