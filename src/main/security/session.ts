import type { Role } from "@shared/constants";

export type SessionUser = { id: string; username: string; firstName: string; lastName: string; role: Role; mustChangePassword: boolean };

/** Verrouillage automatique après inactivité : le poste du cabinet peut rester sans surveillance */
export const SESSION_IDLE_MS = 30 * 60_000;

let user: SessionUser | null = null;
let lastActivity = 0;

export function startSession(u: SessionUser) {
  user = u;
  lastActivity = Date.now();
}

export function endSession() {
  user = null;
}

export function currentUser(): SessionUser | null {
  if (user && Date.now() - lastActivity > SESSION_IDLE_MS) user = null;
  return user;
}

export function touchSession() {
  lastActivity = Date.now();
}

export const displayName = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`;
