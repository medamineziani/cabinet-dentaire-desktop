import { z } from "zod";
import { can, type Permission } from "@shared/permissions";
import { db } from "../db";
import { currentUser, displayName, touchSession, type SessionUser } from "../security/session";

export class AppError extends Error {}

export type Access = Permission | Permission[] | "public" | "authenticated";

export type Procedure<S extends z.ZodType = z.ZodType, R = unknown> = {
  access: Access;
  input: S;
  run: (ctx: { input: z.output<S>; user: SessionUser }) => Promise<R>;
};

export const none = z.void();

export function proc<S extends z.ZodType, R>(def: Procedure<S, R>): Procedure<S, R> {
  return def;
}

export type Response = { ok: true; data: unknown } | { ok: false; code: "AUTH" | "FORBIDDEN" | "ERROR"; message: string };

export function hasAccess(access: Access, user: SessionUser | null) {
  if (access === "public") return true;
  if (!user) return false;
  if (access === "authenticated") return true;
  const needed = Array.isArray(access) ? access : [access];
  return needed.some((p) => can(user.role, p));
}

function friendly(error: unknown): string {
  if (error instanceof AppError) return error.message;
  if (error instanceof z.ZodError) return error.issues[0]?.message ?? "Données invalides";
  const code = (error as { code?: string }).code;
  if (code === "P2002") return "Cette valeur existe déjà.";
  if (code === "P2003") return "Impossible : cet élément est lié à d'autres données.";
  if (code === "P2025") return "Élément introuvable.";
  console.error(error);
  return "Une erreur est survenue. Réessayez.";
}

/** Point d'entrée unique : routage sur liste blanche, session, permission, validation */
export async function dispatch(router: Record<string, Record<string, Procedure<z.ZodType, unknown>>>, path: string, raw: unknown): Promise<Response> {
  const [ns, name] = String(path).split(".");
  const target = Object.hasOwn(router, ns) && Object.hasOwn(router[ns], name) ? router[ns][name] : null;
  if (!target) return { ok: false, code: "ERROR", message: "Action inconnue." };

  const user = currentUser();
  if (target.access !== "public") {
    if (!user) return { ok: false, code: "AUTH", message: "Session expirée. Reconnectez-vous." };
    // Mot de passe temporaire : rien d'autre n'est possible avant de l'avoir changé
    if (user.mustChangePassword && target.access !== "authenticated") {
      return { ok: false, code: "FORBIDDEN", message: "Changez d'abord votre mot de passe." };
    }
    if (!hasAccess(target.access, user)) return { ok: false, code: "FORBIDDEN", message: "Vous n'avez pas accès à cette fonction." };
    touchSession();
  }

  try {
    const input = target.input.parse(raw);
    const data = await target.run({ input, user: user as SessionUser });
    return { ok: true, data };
  } catch (error) {
    return { ok: false, code: "ERROR", message: friendly(error) };
  }
}

/** Journal des actions importantes. Ne contient jamais de contenu médical, seulement qui a fait quoi. */
export async function audit(user: SessionUser | null, action: string, entity: string, entityId?: string | null, details?: string) {
  await db().auditLog.create({
    data: { userId: user?.id ?? null, userName: user ? displayName(user) : null, action, entity, entityId: entityId ?? null, details: details ?? null },
  });
}
