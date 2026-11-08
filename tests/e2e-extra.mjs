// Parcours complémentaires dans la vraie application : déplacement de rendez-vous, restauration, vues secrétaire.
// Lancer après `npm run build` : node tests/e2e-extra.mjs (E2E_EXE pour tester la version empaquetée)
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron } from "playwright-core";

const userData = mkdtempSync(join(tmpdir(), "cabinet-e2e-extra-"));
const options = process.env.E2E_EXE ? { executablePath: process.env.E2E_EXE, args: [`--user-data-dir=${userData}`] } : { args: [".", `--user-data-dir=${userData}`] };
const ADMIN_PASSWORD = "MotDePasse2026";
const SECRET = "phrase secrete longue";

let app = await electron.launch({ ...options, timeout: 60000 });
let win = await app.firstWindow();
const fill = (name, value) => win.locator(`[name="${name}"]`).fill(value);
const nav = (label) => win.locator("aside").getByRole("link", { name: label, exact: true }).click();
const failures = [];
const section = async (name, fn) => {
  try {
    await fn();
    console.log(`OK    ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`ECHEC ${name} : ${e.message.split("\n").slice(0, 3).join(" | ")}`);
    await win.screenshot({ path: join(userData, `echec-${failures.length}.png`) }).catch(() => {});
    console.log(`      capture dans ${userData}`);
    await win.keyboard.press("Escape").catch(() => {});
  }
};
const addPatient = async (lastName) => {
  await nav("Patients");
  await win.getByRole("button", { name: "Nouveau patient" }).click();
  await fill("lastName", lastName);
  await fill("firstName", "Test");
  await win.getByRole("button", { name: "Enregistrer" }).click();
  await win.getByRole("heading", { name: new RegExp(lastName) }).waitFor({ timeout: 8000 });
};
const patientExists = async (lastName) => {
  await nav("Patients");
  await win.locator('input[placeholder^="Nom, téléphone"]').fill(lastName);
  await win.waitForTimeout(1200);
  return (await win.getByRole("link", { name: new RegExp(lastName) }).count()) > 0;
};
const login = async (username, password) => {
  await win.locator('[name="username"]').waitFor({ timeout: 30000 });
  await fill("username", username);
  await fill("password", password);
  await win.getByRole("button", { name: "Se connecter" }).click();
};

try {
  await win.getByText("Première configuration").waitFor({ timeout: 30000 });
  await fill("clinicName", "Cabinet Extra");
  await fill("firstName", "Amina");
  await fill("lastName", "Admin");
  await fill("username", "admin");
  await fill("password", ADMIN_PASSWORD);
  await win.getByRole("button", { name: "Créer le compte" }).click();
  await win.getByRole("heading", { name: "Tableau de bord" }).waitFor({ timeout: 15000 });
  await nav("Paramètres");
  await win.getByRole("button", { name: "Charger les données" }).click();
  await win.getByRole("button", { name: "Supprimer les données" }).waitFor({ timeout: 15000 });

  await section("déplacement d'un rendez-vous", async () => {
    await nav("Rendez-vous");
    await win.getByRole("heading", { name: "Rendez-vous" }).waitFor();
    await win.waitForTimeout(800);
    const blocks = win.locator('button[draggable="true"]');
    const count = await blocks.count();
    if (!count) throw new Error("aucun rendez-vous visible cette semaine");
    const block = blocks.first();
    const before = await block.getAttribute("style");
    const title = await block.getAttribute("title");
    const column = block.locator("xpath=ancestor::div[contains(@class,'border-l')][1]");
    const box = await column.boundingBox();
    const startY = (await block.boundingBox()).y - box.y;
    // Vise un créneau libre de la même colonne, 2 h plus bas ou plus haut
    const y = startY > 300 ? startY - 192 : startY + 192;
    await block.dragTo(column, { targetPosition: { x: box.width / 2, y }, force: true });
    await win.waitForTimeout(1200);
    const toasts = await win.locator("[data-sonner-toast], [role=status]").allInnerTexts();
    const moved = win.locator(`button[draggable="true"][title="${title}"]`).first();
    const after = await moved.getAttribute("style");
    if (before === after) throw new Error(`position inchangée. Messages : ${toasts.join(" / ")}`);
  });

  await section("restauration d'une sauvegarde par l'interface", async () => {
    await addPatient("Avantsauvegarde");
    await nav("Paramètres");
    await win.locator('input[autocomplete="new-password"]').fill(SECRET);
    await win.getByRole("button", { name: "Enregistrer", exact: true }).nth(1).click();
    await win.getByText("Configuration enregistrée").waitFor({ timeout: 8000 });
    await win.getByRole("button", { name: "Sauvegarder maintenant" }).click();
    await win.getByRole("cell", { name: /sauvegarde-.*cdbak/ }).first().waitFor({ timeout: 20000 });
    await addPatient("Apressauvegarde");
    await nav("Paramètres");
    await win.getByRole("cell", { name: /sauvegarde-.*cdbak/ }).first().waitFor({ timeout: 8000 });
    await win.getByRole("button", { name: "Restaurer", exact: true }).first().click();
    const secret = win.getByLabel("Phrase secrète de cette sauvegarde");
    await secret.click({ timeout: 5000 });
    await win.keyboard.type(SECRET);
    if ((await secret.inputValue()) !== SECRET) throw new Error("la phrase secrète ne peut pas être saisie");
    await win.getByRole("dialog").getByRole("button", { name: "Restaurer", exact: true }).click({ timeout: 5000 });
    await login("admin", ADMIN_PASSWORD);
    // Après reconnexion, l'application reste sur la page Paramètres
    await win.getByRole("heading", { name: "Paramètres" }).waitFor({ timeout: 15000 });
    if (!(await patientExists("Avantsauvegarde"))) throw new Error("patient sauvegardé absent après restauration");
    if (await patientExists("Apressauvegarde")) throw new Error("patient postérieur encore présent après restauration");
  });

  await section("vues de la secrétaire", async () => {
    await nav("Personnel");
    await win.getByRole("button", { name: /Nouvel|Ajouter/ }).first().click();
    await fill("lastName", "Sec");
    await fill("firstName", "Sara");
    await fill("username", "sara");
    await fill("password", "Provisoire2026");
    await win.getByRole("button", { name: "Enregistrer" }).click();
    await win.getByRole("cell", { name: /sara/ }).first().waitFor({ timeout: 8000 });
    await app.close();
    app = await electron.launch({ ...options, timeout: 60000 });
    win = await app.firstWindow();
    await login("sara", "Provisoire2026");
    await fill("currentPassword", "Provisoire2026");
    await fill("newPassword", "Secretaire2026");
    await win.locator('button[type="submit"]').click();
    await win.getByRole("heading", { name: "Tableau de bord" }).waitFor({ timeout: 15000 });
    const menu = await win.locator("aside").getByRole("link").allInnerTexts();
    console.log("      menu secrétaire :", menu.join(", "));
    for (const hidden of ["Consultations", "Statistiques", "Personnel", "Journal", "Paramètres"]) if (menu.includes(hidden)) throw new Error(`${hidden} visible par la secrétaire`);
    await nav("Patients");
    await win.locator('input[placeholder^="Nom, téléphone"]').fill("Avantsauvegarde");
    await win.getByRole("link", { name: /Avantsauvegarde/ }).click({ timeout: 8000 });
    await win.getByRole("heading", { name: /Avantsauvegarde/ }).waitFor({ timeout: 8000 });
    const tabs = await win.getByRole("main").getByRole("button").allInnerTexts();
    for (const hidden of ["Dossier médical", "Odontogramme"]) if (tabs.includes(hidden)) throw new Error(`onglet ${hidden} visible par la secrétaire`);
  });
} finally {
  await app.close().catch(() => {});
}
console.log(failures.length ? `${failures.length} échec(s)` : "Tout est OK");
process.exitCode = failures.length ? 1 : 0;
