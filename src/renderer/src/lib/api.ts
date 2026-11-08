import type { Api } from "../../../main/ipc/router";

type Reply = { ok: true; data: unknown } | { ok: false; code: string; message: string };

declare global {
  interface Window {
    cabinet: { call(path: string, input: unknown): Promise<Reply> };
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
  }
}

export const SESSION_EXPIRED = "cabinet-session-expiree";

/** Appels typés vers le processus principal : api.patients.list({ ... }) */
export const api = new Proxy(
  {},
  {
    get: (_, ns: string) =>
      new Proxy(
        {},
        {
          get: (__, name: string) => async (input: unknown) => {
            const reply = await window.cabinet.call(`${ns}.${name}`, input);
            if (reply.ok) return reply.data;
            if (reply.code === "AUTH") window.dispatchEvent(new Event(SESSION_EXPIRED));
            throw new ApiError(reply.message, reply.code);
          },
        },
      ),
  },
) as Api;
