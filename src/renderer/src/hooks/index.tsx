import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { can, type Permission } from "@shared/permissions";
import type { Role } from "@shared/constants";
import { errorMessage } from "@/lib/helpers";

/** Charge des données ; `reload` relance après une écriture */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const ticket = useRef(0);
  const loader = useRef(load);
  loader.current = load;

  const reload = useCallback(async () => {
    const mine = ++ticket.current;
    setLoading(true);
    try {
      const result = await loader.current();
      if (mine === ticket.current) {
        setData(result);
        setError(null);
      }
    } catch (e) {
      if (mine === ticket.current) setError(errorMessage(e));
    } finally {
      if (mine === ticket.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading, reload };
}

export function useDebounced<T>(value: T, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

type Toast = { id: number; ok: boolean; text: string };
const ToastContext = createContext<{ success(text: string): void; error(e: unknown): void }>({ success() {}, error() {} });
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const counter = useRef(0);
  const push = useCallback((ok: boolean, text: string) => {
    const id = ++counter.current;
    setItems((l) => [...l, { id, ok, text }]);
    setTimeout(() => setItems((l) => l.filter((t) => t.id !== id)), ok ? 3000 : 6000);
  }, []);
  const value = useRef({ success: (text: string) => push(true, text), error: (e: unknown) => push(false, errorMessage(e)) }).current;
  // Erreurs levées hors d'un composant (génération de PDF)
  useEffect(() => {
    const onError = (e: Event) => push(false, (e as CustomEvent<string>).detail);
    window.addEventListener("cabinet-erreur", onError);
    return () => window.removeEventListener("cabinet-erreur", onError);
  }, [push]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed right-4 bottom-4 z-[100] flex w-96 flex-col gap-2" role="status">
        {items.map((t) => (
          <div key={t.id} className={`flex items-start gap-2 rounded-xl border bg-card px-4 py-3 text-sm shadow-lg ${t.ok ? "border-emerald-200" : "border-red-200"}`}>
            {t.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-red-600" />}
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export type CurrentUser = { id: string; username: string; firstName: string; lastName: string; role: Role; mustChangePassword: boolean };
export const AuthContext = createContext<{ user: CurrentUser | null; setUser(u: CurrentUser | null): void }>({ user: null, setUser() {} });

export function useAuth() {
  const ctx = useContext(AuthContext);
  return { ...ctx, can: (p: Permission) => (ctx.user ? can(ctx.user.role, p) : false) };
}
