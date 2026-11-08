import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router";
import { Bell, CalendarDays, ChartColumn, ClipboardList, FileText, History, KeyRound, LayoutDashboard, LogOut, Package, Receipt, Settings, Stethoscope, Syringe, UserCog, Users, Wallet, type LucideIcon } from "lucide-react";
import { ROLES } from "@shared/constants";
import { changePasswordSchema } from "@shared/schemas";
import type { Permission } from "@shared/permissions";
import { Field, FormActions, Input, Modal, useSubmit, useZodForm } from "@/components/kit";
import { useAuth, useDebounced, useLoad } from "@/hooks";
import { api } from "@/lib/api";
import { fmt, fullName } from "@/lib/helpers";
import { cn } from "@/lib/utils";

const NAV: { to: string; label: string; icon: LucideIcon; need?: Permission | Permission[] }[] = [
  { to: "/", label: "Tableau de bord", icon: LayoutDashboard },
  { to: "/patients", label: "Patients", icon: Users, need: "patients.read" },
  { to: "/agenda", label: "Rendez-vous", icon: CalendarDays, need: "appointments.read" },
  { to: "/consultations", label: "Consultations", icon: Stethoscope, need: "consultations.read" },
  { to: "/traitements", label: "Traitements", icon: Syringe, need: "treatments.read" },
  { to: "/factures", label: "Factures", icon: Receipt, need: "billing.read" },
  { to: "/depenses", label: "Dépenses", icon: Wallet, need: "expenses.read" },
  { to: "/stock", label: "Stock", icon: Package, need: "stock.read" },
  { to: "/documents", label: "Documents", icon: FileText, need: ["documents.admin", "documents.medical"] },
  { to: "/statistiques", label: "Statistiques", icon: ChartColumn, need: "stats.read" },
  { to: "/personnel", label: "Personnel", icon: UserCog, need: "users.manage" },
  { to: "/journal", label: "Journal", icon: History, need: "audit.read" },
  { to: "/parametres", label: "Paramètres", icon: Settings, need: "settings.manage" },
];

function useOutside(close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  });
  return ref;
}

function GlobalSearch() {
  const [q, setQ] = useState("");
  const term = useDebounced(q);
  const { can } = useAuth();
  const { data } = useLoad(() => (can("patients.read") && term ? api.patients.search({ q: term }) : Promise.resolve([])), [term]);
  const ref = useOutside(() => setQ(""));
  const go = useNavigate();
  return (
    <div className="relative w-96" ref={ref}>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un patient…" aria-label="Rechercher un patient" />
      {q && data && (
        <ul className="absolute z-40 mt-1 w-full rounded-xl border border-border bg-card p-1 shadow-lg">
          {data.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">Aucun patient trouvé.</li>}
          {data.map((p) => (
            <li key={p.id}>
              <button type="button" className="flex w-full justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => { setQ(""); go(`/patients/${p.id}`); }}>
                <span className="font-medium">{fullName(p)}</span>
                <span className="text-xs text-muted-foreground">{p.fileNumber}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const { can } = useAuth();
  const { data, reload } = useLoad(() => (can("stock.read") ? api.stock.alerts() : Promise.resolve({ low: [], expiring: [] })));
  const ref = useOutside(() => setOpen(false));
  const count = (data?.low.length ?? 0) + (data?.expiring.length ?? 0);
  return (
    <div className="relative" ref={ref}>
      <button type="button" aria-label="Notifications" className="relative rounded-lg p-2 text-muted-foreground hover:bg-muted" onClick={() => { setOpen(!open); reload(); }}>
        <Bell className="size-5" />
        {count > 0 && <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-red-600 text-[10px] font-semibold text-white">{count}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-1 w-80 rounded-xl border border-border bg-card p-3 text-sm shadow-lg">
          {count === 0 && <p className="text-muted-foreground">Aucune alerte.</p>}
          {data?.low.map((p) => (
            <Link key={p.id} to="/stock" onClick={() => setOpen(false)} className="block rounded-md px-2 py-1.5 hover:bg-muted">
              Stock faible : <b>{p.name}</b> ({p.quantity})
            </Link>
          ))}
          {data?.expiring.map((p) => (
            <Link key={`e${p.id}`} to="/stock" onClick={() => setOpen(false)} className="block rounded-md px-2 py-1.5 hover:bg-muted">
              Expire le {fmt(p.expiryDate)} : <b>{p.name}</b>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function PasswordModal({ onClose }: { onClose(): void }) {
  const form = useZodForm(changePasswordSchema);
  const { busy, submit } = useSubmit((v: never) => api.auth.changePassword(v), "Mot de passe modifié", onClose);
  return (
    <form onSubmit={form.handleSubmit(submit as never)} className="space-y-3">
      <Field form={form} name="currentPassword" label="Mot de passe actuel" type="password" />
      <Field form={form} name="newPassword" label="Nouveau mot de passe (10 caractères, lettres et chiffres)" type="password" />
      <FormActions onCancel={onClose} busy={busy} />
    </form>
  );
}

function ProfileMenu() {
  const { user, setUser } = useAuth();
  const [open, setOpen] = useState(false);
  const [pwd, setPwd] = useState(false);
  const ref = useOutside(() => setOpen(false));
  if (!user) return null;
  return (
    <div className="relative" ref={ref}>
      <button type="button" className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-muted" onClick={() => setOpen(!open)}>
        <span className="flex size-8 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">{`${user.firstName[0]}${user.lastName[0]}`.toUpperCase()}</span>
        <span className="text-left text-sm leading-tight">
          <span className="block font-medium">
            {user.firstName} {user.lastName}
          </span>
          <span className="block text-xs text-muted-foreground">{ROLES[user.role]}</span>
        </span>
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-1 w-56 rounded-xl border border-border bg-card p-1 text-sm shadow-lg">
          <button type="button" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-muted" onClick={() => { setOpen(false); setPwd(true); }}>
            <KeyRound className="size-4" /> Changer le mot de passe
          </button>
          <button type="button" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-muted" onClick={async () => { await api.auth.logout(); setUser(null); }}>
            <LogOut className="size-4" /> Se déconnecter
          </button>
        </div>
      )}
      <Modal open={pwd} onClose={() => setPwd(false)} title="Changer le mot de passe">
        <PasswordModal onClose={() => setPwd(false)} />
      </Modal>
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { can } = useAuth();
  const { data: clinic } = useLoad(() => api.settings.get());
  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="flex w-60 shrink-0 flex-col bg-[#14315f] text-blue-100">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <span className="flex size-9 items-center justify-center rounded-xl bg-white/15">
            <ClipboardList className="size-5 text-white" />
          </span>
          <span className="truncate text-sm font-semibold text-white" title={clinic?.name}>
            {clinic?.name ?? "Cabinet dentaire"}
          </span>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
          {NAV.filter((n) => !n.need || (Array.isArray(n.need) ? n.need : [n.need]).some(can)).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === "/"} className={({ isActive }) => cn("flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors", isActive ? "bg-white/15 font-medium text-white" : "hover:bg-white/10")}>
              <n.icon className="size-4" />
              {n.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-border/70 bg-card px-6">
          <GlobalSearch />
          <div className="flex items-center gap-2">
            <Notifications />
            <ProfileMenu />
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
