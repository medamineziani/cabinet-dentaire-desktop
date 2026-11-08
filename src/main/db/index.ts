import { existsSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "./generated/client";

let client: PrismaClient | null = null;
let currentPath: string | null = null;

export const fileUrl = (path: string) => pathToFileURL(path).href;

/** Applique dans l'ordre les fichiers .sql pas encore exécutés (le CLI Prisma n'est pas livré avec l'application) */
export async function applyMigrations(dbPath: string, migrationsDir: string) {
  const sql = createClient({ url: fileUrl(dbPath) });
  try {
    await sql.execute(`CREATE TABLE IF NOT EXISTS "_app_migrations" ("name" TEXT PRIMARY KEY, "appliedAt" TEXT NOT NULL)`);
    const done = new Set((await sql.execute(`SELECT name FROM "_app_migrations"`)).rows.map((r) => String(r.name)));
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const body = readFileSync(join(migrationsDir, file), "utf8");
      // Tout ou rien : une migration interrompue ne laisse pas de base à moitié modifiée
      await sql.executeMultiple(`BEGIN;\n${body}\nINSERT INTO "_app_migrations" VALUES ('${file}', datetime('now'));\nCOMMIT;`);
    }
  } finally {
    sql.close();
  }
}

export async function openDatabase(dbPath: string, migrationsDir: string) {
  await closeDatabase();
  await applyMigrations(dbPath, migrationsDir);
  client = new PrismaClient({ adapter: new PrismaLibSql({ url: fileUrl(dbPath) }) });
  await client.$executeRawUnsafe("PRAGMA foreign_keys = ON");
  await client.$queryRawUnsafe("PRAGMA journal_mode = WAL");
  await client.$queryRawUnsafe("PRAGMA busy_timeout = 5000");
  currentPath = dbPath;
  return client;
}

export async function closeDatabase() {
  if (client) await client.$disconnect();
  client = null;
}

export function db(): PrismaClient {
  if (!client) throw new Error("Base de données non ouverte");
  return client;
}

export function databasePath() {
  if (!currentPath) throw new Error("Base de données non ouverte");
  return currentPath;
}

const POINTER = "base-active.txt";
const DB_FILE = /^cabinet(-[0-9]+)?\.db(-wal|-shm)?$/;

/** Fichier de base en service : le pointeur est écrit de façon atomique après une restauration */
export function activeDatabasePath(dataDir: string) {
  const pointer = join(dataDir, POINTER);
  const name = existsSync(pointer) ? readFileSync(pointer, "utf8").trim() : "";
  return DB_FILE.test(name) && existsSync(join(dataDir, name)) ? join(dataDir, name) : join(dataDir, "cabinet.db");
}

export function setActiveDatabase(dataDir: string, path: string) {
  const tmp = join(dataDir, `${POINTER}.tmp`);
  writeFileSync(tmp, basename(path), "utf8");
  renameSync(tmp, join(dataDir, POINTER));
}

/** Au démarrage, plus aucun verrou : retire les bases remplacées (une copie chiffrée est dans avant-restauration) */
export function removeReplacedDatabases(dataDir: string) {
  const active = basename(activeDatabasePath(dataDir));
  for (const f of readdirSync(dataDir)) {
    if (DB_FILE.test(f) && !f.startsWith(active)) rmSync(join(dataDir, f), { force: true });
  }
}
export type Db = PrismaClient;
