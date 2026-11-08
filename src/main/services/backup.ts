import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { createClient } from "@libsql/client";
import { z } from "zod";
import { databasePath, db, fileUrl, openDatabase, setActiveDatabase } from "../db";
import { AppError, audit, none, proc } from "../ipc/procedure";
import { platform } from "../platform";
import { endSession } from "../security/session";

// Format .cdbak : "CDBK1" + sel (16) + IV (12) + tag GCM (16) + base SQLite compressée puis chiffrée en AES-256-GCM.
const MAGIC = Buffer.from("CDBK1");
const EXTENSION = "cdbak";
const NAME_PREFIX = "sauvegarde-";
const secretRule = z.string().min(12, "12 caractères minimum").max(200);

let migrationsDir = "";
export const setMigrationsDir = (dir: string) => {
  migrationsDir = dir;
};

function deriveKey(passphrase: string, salt: Buffer) {
  return scryptSync(passphrase, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

export function encryptBuffer(plain: Buffer, passphrase: string) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(passphrase, salt), iv);
  const body = Buffer.concat([cipher.update(gzipSync(plain)), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), body]);
}

export function decryptBuffer(file: Buffer, passphrase: string) {
  if (!file.subarray(0, MAGIC.length).equals(MAGIC)) throw new AppError("Ce fichier n'est pas une sauvegarde valide.");
  let at = MAGIC.length;
  const take = (n: number) => file.subarray(at, (at += n));
  const salt = take(16);
  const iv = take(12);
  const tag = take(16);
  try {
    const decipher = createDecipheriv("aes-256-gcm", deriveKey(passphrase, salt), iv);
    decipher.setAuthTag(tag);
    return gunzipSync(Buffer.concat([decipher.update(file.subarray(at)), decipher.final()]));
  } catch {
    // GCM échoue aussi bien sur une mauvaise phrase que sur un fichier altéré
    throw new AppError("Phrase secrète incorrecte ou fichier endommagé.");
  }
}

const defaultDir = () => join(platform().dataDir, "sauvegardes");

async function snapshot(): Promise<Buffer> {
  const tmp = join(platform().dataDir, `snapshot-${Date.now()}.tmp`);
  try {
    // VACUUM INTO produit une copie cohérente même si la base est en cours d'utilisation
    await db().$executeRawUnsafe(`VACUUM INTO '${tmp.split("'").join("''")}'`);
    return await readFile(tmp);
  } finally {
    await rm(tmp, { force: true });
  }
}

const timestamp = () => new Date().toISOString().slice(0, 19).replace("T", "-").split(":").join("");

async function writeBackup(dir: string, passphrase: string) {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${NAME_PREFIX}${timestamp()}.${EXTENSION}`);
  await writeFile(path, encryptBuffer(await snapshot(), passphrase));
  return path;
}

function prune(dir: string, keep: number) {
  const files = readdirSync(dir)
    .filter((f) => f.startsWith(NAME_PREFIX) && f.endsWith(`.${EXTENSION}`))
    .sort()
    .reverse();
  for (const f of files.slice(keep)) rmSync(join(dir, f), { force: true });
}

/** Vérifie qu'un fichier est une base lisible et intègre avant de remplacer quoi que ce soit */
async function assertValidDatabase(path: string) {
  const sql = createClient({ url: fileUrl(path) });
  try {
    const check = await sql.execute("PRAGMA integrity_check");
    if (String(check.rows[0]?.[0]) !== "ok") throw new AppError("La sauvegarde est endommagée.");
    const t = await sql.execute(`SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('User', 'Patient', 'Invoice')`);
    if (Number(t.rows[0]?.n) !== 3) throw new AppError("Ce fichier ne provient pas de cette application.");
  } finally {
    sql.close();
  }
}

const storedSecret = async () => {
  const s = await db().clinicSettings.findUnique({ where: { id: 1 } });
  return s?.backupSecret ? platform().decryptSecret(s.backupSecret) : null;
};

/** Sauvegarde automatique si elle est due : appelée régulièrement par le processus principal */
export async function runAutoBackupIfDue(now = new Date()) {
  const s = await db().clinicSettings.findUnique({ where: { id: 1 } });
  if (!s?.autoBackupEnabled || !s.backupSecret) return null;
  if (s.lastAutoBackupAt && now.getTime() - s.lastAutoBackupAt.getTime() < s.autoBackupHours * 3_600_000) return null;
  const dir = s.backupDirectory || defaultDir();
  const path = await writeBackup(dir, platform().decryptSecret(s.backupSecret));
  prune(dir, s.backupRetention);
  await db().clinicSettings.update({ where: { id: 1 }, data: { lastAutoBackupAt: now } });
  await audit(null, "backup.auto", "Backup", null, path);
  return path;
}

export const backup = {
  status: proc({
    access: "backup.manage",
    input: none,
    run: async () => {
      const s = await db().clinicSettings.findUniqueOrThrow({ where: { id: 1 } });
      const dir = s.backupDirectory || defaultDir();
      const files = existsSync(dir)
        ? readdirSync(dir)
            .filter((f) => f.startsWith(NAME_PREFIX) && f.endsWith(`.${EXTENSION}`))
            .sort()
            .reverse()
            .map((f) => ({ name: f, path: join(dir, f), size: statSync(join(dir, f)).size, createdAt: statSync(join(dir, f)).mtime }))
        : [];
      return { enabled: s.autoBackupEnabled, hours: s.autoBackupHours, retention: s.backupRetention, directory: dir, hasSecret: Boolean(s.backupSecret), lastAutoBackupAt: s.lastAutoBackupAt, files };
    },
  }),

  configure: proc({
    access: "backup.manage",
    input: z.object({ enabled: z.boolean(), hours: z.coerce.number().int().min(1).max(720), retention: z.coerce.number().int().min(1).max(365), directory: z.string().nullable().optional(), secret: secretRule.optional() }),
    run: async ({ input, user }) => {
      const data = {
        autoBackupEnabled: input.enabled,
        autoBackupHours: input.hours,
        backupRetention: input.retention,
        ...(input.directory !== undefined ? { backupDirectory: input.directory } : {}),
        ...(input.secret ? { backupSecret: platform().encryptSecret(input.secret) } : {}),
      };
      const saved = await db().clinicSettings.update({ where: { id: 1 }, data });
      if (saved.autoBackupEnabled && !saved.backupSecret) throw new AppError("Définissez une phrase secrète pour activer la sauvegarde automatique.");
      await audit(user, "backup.configure", "Backup");
    },
  }),

  chooseDirectory: proc({ access: "backup.manage", input: none, run: () => platform().askDirectory() }),

  /** Sauvegarde immédiate, avec la phrase saisie ou celle enregistrée */
  createNow: proc({
    access: "backup.manage",
    input: z.object({ secret: secretRule.optional() }),
    run: async ({ input, user }) => {
      const secret = input.secret ?? (await storedSecret());
      if (!secret) throw new AppError("Définissez d'abord une phrase secrète.");
      const s = await db().clinicSettings.findUniqueOrThrow({ where: { id: 1 } });
      const path = await writeBackup(s.backupDirectory || defaultDir(), secret);
      await audit(user, "backup.create", "Backup", null, path);
      return path;
    },
  }),

  chooseFile: proc({ access: "backup.manage", input: none, run: () => platform().askOpenPath(EXTENSION) }),

  /** Restauration : déchiffre, contrôle, met de côté la base actuelle, remplace. Déconnecte tout le monde. */
  restore: proc({
    access: "backup.manage",
    input: z.object({ path: z.string().min(1), secret: z.string().min(1, "Phrase secrète requise") }),
    run: async ({ input, user }) => {
      const data = decryptBuffer(await readFile(input.path), input.secret);
      const current = databasePath();
      // Nouveau fichier plutôt qu'un écrasement : sous Windows, la base ouverte reste verrouillée
      const candidate = join(platform().dataDir, `cabinet-${Date.now()}.db`);
      await writeFile(candidate, data);
      try {
        await assertValidDatabase(candidate);
      } catch (e) {
        await rm(candidate, { force: true });
        throw e;
      }
      await audit(user, "backup.restore", "Backup", null, input.path);
      // Filet de sécurité chiffré : la base remplacée reste récupérable
      const safetyDir = join(platform().dataDir, "avant-restauration");
      mkdirSync(safetyDir, { recursive: true });
      await writeFile(join(safetyDir, `${NAME_PREFIX}${timestamp()}.${EXTENSION}`), encryptBuffer(await snapshot(), input.secret));
      try {
        await openDatabase(candidate, migrationsDir);
      } catch (e) {
        // La base d'origine n'a pas été touchée : on y revient
        await openDatabase(current, migrationsDir);
        throw e;
      }
      setActiveDatabase(platform().dataDir, candidate);
      endSession();
      return true;
    },
  }),
};
