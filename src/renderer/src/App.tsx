import { lazy, Suspense, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router";
import { Loader2 } from "lucide-react";
import type { Permission } from "@shared/permissions";
import { Layout } from "@/components/layout";
import { AuthContext, ToastProvider, useAuth, type CurrentUser } from "@/hooks";
import { api, SESSION_EXPIRED } from "@/lib/api";
import { ChangePasswordScreen, LoginScreen, SetupScreen } from "@/pages/auth";

const page = <T,>(load: () => Promise<T>, name: keyof T) => lazy(async () => ({ default: (await load())[name] as React.ComponentType }));

const Dashboard = page(() => import("@/pages/dashboard"), "DashboardPage");
const Patients = page(() => import("@/pages/patients"), "PatientsPage");
const PatientDetail = page(() => import("@/pages/patient-detail"), "PatientDetailPage");
const Agenda = page(() => import("@/pages/agenda"), "AgendaPage");
const Consultations = page(() => import("@/pages/consultations"), "ConsultationsPage");
const Treatments = page(() => import("@/pages/treatments"), "TreatmentsPage");
const Invoices = page(() => import("@/pages/invoices"), "InvoicesPage");
const Expenses = page(() => import("@/pages/expenses"), "ExpensesPage");
const Stock = page(() => import("@/pages/stock"), "StockPage");
const Staff = page(() => import("@/pages/staff"), "StaffPage");
const Documents = page(() => import("@/pages/documents"), "DocumentsPage");
const Stats = page(() => import("@/pages/stats"), "StatsPage");
const Settings = page(() => import("@/pages/settings"), "SettingsPage");
const Audit = page(() => import("@/pages/audit"), "AuditPage");

const Spinner = () => (
  <div className="flex h-64 items-center justify-center">
    <Loader2 className="size-6 animate-spin text-primary" />
  </div>
);

function Guard({ need, children }: { need: Permission | Permission[]; children: React.ReactNode }) {
  const { can } = useAuth();
  const list = Array.isArray(need) ? need : [need];
  return list.some(can) ? children : <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">Vous n&apos;avez pas accès à cette page.</p>;
}

export function App() {
  const [state, setState] = useState<{ ready: boolean; needsSetup: boolean; user: CurrentUser | null }>({ ready: false, needsSetup: false, user: null });
  const setUser = (user: CurrentUser | null) => setState((s) => ({ ...s, user, needsSetup: false }));

  useEffect(() => {
    api.auth.status().then((s) => setState({ ready: true, needsSetup: s.needsSetup, user: s.user as CurrentUser | null }));
    const expire = () => setState((s) => ({ ...s, user: null }));
    window.addEventListener(SESSION_EXPIRED, expire);
    return () => window.removeEventListener(SESSION_EXPIRED, expire);
  }, []);

  if (!state.ready) return <Spinner />;
  return (
    <AuthContext.Provider value={{ user: state.user, setUser }}>
      <ToastProvider>
        {state.needsSetup ? (
          <SetupScreen />
        ) : !state.user ? (
          <LoginScreen />
        ) : state.user.mustChangePassword ? (
          <ChangePasswordScreen />
        ) : (
          <Layout>
            <Suspense fallback={<Spinner />}>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/patients" element={<Guard need="patients.read"><Patients /></Guard>} />
                <Route path="/patients/:id" element={<Guard need="patients.read"><PatientDetail /></Guard>} />
                <Route path="/agenda" element={<Guard need="appointments.read"><Agenda /></Guard>} />
                <Route path="/consultations" element={<Guard need="consultations.read"><Consultations /></Guard>} />
                <Route path="/traitements" element={<Guard need="treatments.read"><Treatments /></Guard>} />
                <Route path="/factures" element={<Guard need="billing.read"><Invoices /></Guard>} />
                <Route path="/depenses" element={<Guard need="expenses.read"><Expenses /></Guard>} />
                <Route path="/stock" element={<Guard need="stock.read"><Stock /></Guard>} />
                <Route path="/personnel" element={<Guard need="users.manage"><Staff /></Guard>} />
                <Route path="/documents" element={<Guard need={["documents.admin", "documents.medical"]}><Documents /></Guard>} />
                <Route path="/statistiques" element={<Guard need="stats.read"><Stats /></Guard>} />
                <Route path="/parametres" element={<Guard need="settings.manage"><Settings /></Guard>} />
                <Route path="/journal" element={<Guard need="audit.read"><Audit /></Guard>} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </Layout>
        )}
      </ToastProvider>
    </AuthContext.Provider>
  );
}
