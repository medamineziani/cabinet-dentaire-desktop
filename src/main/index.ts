import { mkdirSync } from "node:fs";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { BrowserWindow, Menu, app, dialog, ipcMain, safeStorage, session, shell } from "electron";
import type { z } from "zod";
import { activeDatabasePath, openDatabase, removeReplacedDatabases } from "./db";
import { dispatch, type Procedure } from "./ipc/procedure";
import { router } from "./ipc/router";
import { setPlatform } from "./platform";
import { runAutoBackupIfDue, setMigrationsDir } from "./services/backup";

const DEV_URL = process.env.ELECTRON_RENDERER_URL;
const RENDERER_FILE = join(__dirname, "../renderer/index.html");
const AUTO_BACKUP_CHECK_MS = 15 * 60_000;

let mainWindow: BrowserWindow | null = null;

function isTrustedSender(url: string) {
  return DEV_URL ? url.startsWith(DEV_URL) : url.startsWith(pathToFileURL(RENDERER_FILE).href);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: "Cabinet Dentaire",
    webPreferences: { preload: join(__dirname, "../preload/index.js"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  mainWindow.on("ready-to-show", () => mainWindow?.show());
  // L'application ne navigue jamais hors de ses propres pages
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedSender(url)) event.preventDefault();
  });
  if (DEV_URL) mainWindow.loadURL(DEV_URL);
  else mainWindow.loadFile(RENDERER_FILE);
}

async function htmlToPdf(html: string) {
  const tmp = join(app.getPath("temp"), `cabinet-doc-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
  try {
    await writeFile(tmp, html, "utf8");
    await win.loadFile(tmp);
    return await win.webContents.printToPDF({ pageSize: "A4", printBackground: true, preferCSSPageSize: true });
  } finally {
    win.destroy();
    await rm(tmp, { force: true });
  }
}

const filterFor = (extension: string) => [{ name: extension.toUpperCase(), extensions: [extension] }];

async function bootstrap() {
  const dataDir = join(app.getPath("userData"), "donnees");
  mkdirSync(dataDir, { recursive: true });
  const migrationsDir = app.isPackaged ? join(process.resourcesPath, "migrations") : join(app.getAppPath(), "prisma/migrations");
  setMigrationsDir(migrationsDir);
  setPlatform({
    dataDir,
    encryptSecret: (plain) => safeStorage.encryptString(plain).toString("base64"),
    decryptSecret: (stored) => safeStorage.decryptString(Buffer.from(stored, "base64")),
    askSavePath: async (name, extension) => (await dialog.showSaveDialog(mainWindow!, { defaultPath: name, filters: filterFor(extension) })).filePath || null,
    askOpenPath: async (extension) => (await dialog.showOpenDialog(mainWindow!, { filters: filterFor(extension), properties: ["openFile"] })).filePaths[0] ?? null,
    askDirectory: async () => (await dialog.showOpenDialog(mainWindow!, { properties: ["openDirectory", "createDirectory"] })).filePaths[0] ?? null,
    htmlToPdf,
    openPath: async (path) => void (await shell.openPath(path)),
  });
  removeReplacedDatabases(dataDir);
  await openDatabase(activeDatabasePath(dataDir), migrationsDir);

  ipcMain.handle("rpc", (event, path: string, input: unknown) => {
    if (!event.senderFrame || !isTrustedSender(event.senderFrame.url)) return { ok: false, code: "FORBIDDEN", message: "Origine refusée." };
    return dispatch(router as unknown as Record<string, Record<string, Procedure<z.ZodType, unknown>>>, path, input);
  });

  // Aucune ressource externe : l'application fonctionne hors ligne et rien ne sort du poste
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const allowed = /^(file|devtools|data|blob):/.test(details.url) || (DEV_URL ? details.url.startsWith(DEV_URL) || details.url.startsWith(DEV_URL.replace("http", "ws")) : false);
    callback({ cancel: !allowed });
  });
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));

  const tick = () => runAutoBackupIfDue().catch((e) => console.error("Sauvegarde automatique impossible", e));
  tick();
  setInterval(tick, AUTO_BACKUP_CHECK_MS);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.focus();
  });
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    try {
      await bootstrap();
      createWindow();
    } catch (e) {
      console.error(e);
      dialog.showErrorBox("Démarrage impossible", String(e));
      app.quit();
    }
  });
  app.on("window-all-closed", () => app.quit());
}
