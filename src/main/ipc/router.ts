import type { z } from "zod";
import { auth, users } from "../services/auth";
import { backup } from "../services/backup";
import { appointments, consultations, odontogram, treatments } from "../services/clinical";
import { documents } from "../services/documents";
import { billing, expenses, stock, suppliers } from "../services/finance";
import { auditLog, dashboard, stats } from "../services/insights";
import { medical, patients } from "../services/patients";
import { demo, settings } from "../services/settings";
import type { Procedure } from "./procedure";

export const router = { auth, users, patients, medical, appointments, consultations, odontogram, treatments, billing, expenses, stock, suppliers, dashboard, stats, documents, settings, demo, backup, audit: auditLog };

type Router = typeof router;

/** Type de l'API vue par l'interface : déduit du routeur, aucune déclaration à maintenir */
export type Api = {
  [N in keyof Router]: {
    [P in keyof Router[N]]: Router[N][P] extends Procedure<infer S, infer R> ? (input: z.input<S extends z.ZodType ? S : never>) => Promise<R> : never;
  };
};
