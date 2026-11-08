import bcrypt from "bcryptjs";
import { z } from "zod";
import { STARTER_TREATMENTS, type Role } from "@shared/constants";
import { changePasswordSchema, loginSchema, setupSchema, toCents, userCreateSchema, userUpdateSchema, passwordRule } from "@shared/schemas";
import { db } from "../db";
import { AppError, audit, none, proc } from "../ipc/procedure";
import { currentUser, endSession, startSession, type SessionUser } from "../security/session";

const BCRYPT_ROUNDS = 12;
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60_000;
// Même coût de calcul si l'identifiant n'existe pas : on ne révèle pas quels comptes existent
const DUMMY_HASH = bcrypt.hashSync("compte-inexistant", BCRYPT_ROUNDS);

export const hashPassword = (p: string) => bcrypt.hash(p, BCRYPT_ROUNDS);

const toSession = (u: { id: string; username: string; firstName: string; lastName: string; role: string; mustChangePassword: boolean }): SessionUser => ({
  id: u.id,
  username: u.username,
  firstName: u.firstName,
  lastName: u.lastName,
  role: u.role as Role,
  mustChangePassword: u.mustChangePassword,
});

const publicUser = { id: true, username: true, firstName: true, lastName: true, role: true, phone: true, email: true, active: true, lastLoginAt: true, createdAt: true } as const;

async function assertAnotherAdmin(excludeId: string) {
  const others = await db().user.count({ where: { role: "ADMIN", active: true, id: { not: excludeId } } });
  if (!others) throw new AppError("Il doit rester au moins un administrateur actif.");
}

export const auth = {
  status: proc({
    access: "public",
    input: none,
    run: async () => ({ needsSetup: (await db().user.count()) === 0, user: currentUser() }),
  }),

  /** Premier lancement uniquement : le compte administrateur est créé avec un mot de passe choisi (aucun compte par défaut) */
  setup: proc({
    access: "public",
    input: setupSchema,
    run: async ({ input }) => {
      if ((await db().user.count()) > 0) throw new AppError("L'application est déjà configurée.");
      const { password, clinicName, ...fields } = input;
      const created = await db().$transaction(async (tx) => {
        const user = await tx.user.create({ data: { ...fields, passwordHash: await hashPassword(password), role: "ADMIN" } });
        await tx.clinicSettings.create({ data: { id: 1, name: clinicName } });
        await tx.treatment.createMany({
          data: STARTER_TREATMENTS.map((t) => ({ name: t.name, description: t.description, priceCents: toCents(t.price), durationMinutes: t.duration })),
        });
        return user;
      });
      const session = toSession(created);
      startSession(session);
      await audit(session, "setup", "User", created.id, "Création du compte administrateur initial");
      return session;
    },
  }),

  login: proc({
    access: "public",
    input: loginSchema,
    run: async ({ input }) => {
      const failure = new AppError("Identifiant ou mot de passe incorrect.");
      const user = await db().user.findUnique({ where: { username: input.username.toLowerCase() } });
      if (user?.lockedUntil && user.lockedUntil > new Date()) {
        throw new AppError("Compte bloqué après plusieurs essais. Réessayez dans 15 minutes.");
      }
      const valid = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);
      if (!user || !user.active || !valid) {
        if (user) {
          const failedAttempts = user.failedAttempts + 1;
          const locked = failedAttempts >= MAX_FAILURES;
          await db().user.update({
            where: { id: user.id },
            data: { failedAttempts: locked ? 0 : failedAttempts, lockedUntil: locked ? new Date(Date.now() + LOCK_MS) : null },
          });
          await audit(null, locked ? "login.locked" : "login.failed", "User", user.id, user.username);
        }
        throw failure;
      }
      await db().user.update({ where: { id: user.id }, data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() } });
      const session = toSession(user);
      startSession(session);
      await audit(session, "login", "User", user.id);
      return session;
    },
  }),

  logout: proc({
    access: "authenticated",
    input: none,
    run: async ({ user }) => {
      await audit(user, "logout", "User", user.id);
      endSession();
    },
  }),

  changePassword: proc({
    access: "authenticated",
    input: changePasswordSchema,
    run: async ({ input, user }) => {
      const row = await db().user.findUniqueOrThrow({ where: { id: user.id } });
      if (!(await bcrypt.compare(input.currentPassword, row.passwordHash))) throw new AppError("Mot de passe actuel incorrect.");
      await db().user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(input.newPassword), mustChangePassword: false } });
      const session = { ...user, mustChangePassword: false };
      startSession(session);
      await audit(user, "password.change", "User", user.id);
      return session;
    },
  }),
};

export const users = {
  /** Liste réduite pour les sélecteurs (agenda, consultations) */
  dentists: proc({
    access: "authenticated",
    input: none,
    run: () =>
      db().user.findMany({
        where: { active: true, role: { in: ["DENTIST", "ADMIN"] } },
        orderBy: [{ role: "desc" }, { lastName: "asc" }],
        select: { id: true, firstName: true, lastName: true, role: true },
      }),
  }),

  list: proc({ access: "users.manage", input: none, run: () => db().user.findMany({ orderBy: { createdAt: "asc" }, select: publicUser }) }),

  create: proc({
    access: "users.manage",
    input: userCreateSchema,
    run: async ({ input, user }) => {
      const { password, ...fields } = input;
      // Mot de passe donné par l'administrateur : temporaire, à changer à la première connexion
      const created = await db().user.create({ data: { ...fields, passwordHash: await hashPassword(password), mustChangePassword: true }, select: publicUser });
      await audit(user, "user.create", "User", created.id, `${created.username} (${created.role})`);
      return created;
    },
  }),

  update: proc({
    access: "users.manage",
    input: userUpdateSchema,
    run: async ({ input, user }) => {
      const { id, ...data } = input;
      const before = await db().user.findUniqueOrThrow({ where: { id } });
      if (before.role === "ADMIN" && before.active && (data.role !== "ADMIN" || !data.active)) await assertAnotherAdmin(id);
      const updated = await db().user.update({ where: { id }, data, select: publicUser });
      await audit(user, "user.update", "User", id, `${updated.username} (${updated.role}, ${updated.active ? "actif" : "désactivé"})`);
      return updated;
    },
  }),

  resetPassword: proc({
    access: "users.manage",
    input: z.object({ id: z.string(), password: passwordRule }),
    run: async ({ input, user }) => {
      await db().user.update({
        where: { id: input.id },
        data: { passwordHash: await hashPassword(input.password), mustChangePassword: true, failedAttempts: 0, lockedUntil: null },
      });
      await audit(user, "password.reset", "User", input.id);
    },
  }),
};
