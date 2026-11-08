import { Link } from "react-router";
import { AlertTriangle, CalendarClock, CalendarDays, Clock, Stethoscope, TrendingUp, UserPlus, Users, Wallet, HandCoins } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { APPOINTMENT_STATUS, type AppointmentStatus } from "@shared/constants";
import { Card, DemoTag, LoadError, PageHeader, Stat, Tag } from "@/components/kit";
import { useLoad } from "@/hooks";
import { api } from "@/lib/api";
import { fmt, fullName, money } from "@/lib/helpers";

const label = (m: string) => `${m.slice(5)}/${m.slice(2, 4)}`;

export function DashboardPage() {
  const { data, error } = useLoad(() => api.dashboard.overview());
  if (!data) return <LoadError error={error} />;
  const c = data.cards;
  return (
    <div className="space-y-5">
      <PageHeader title="Tableau de bord" subtitle={fmt(new Date(), "EEEE d MMMM yyyy")} />
      {data.notices.length > 0 && (
        <div className="space-y-2">
          {data.notices.map((n) => (
            <Link key={n.text} to={n.to} className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm ${n.level === "danger" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"}`}>
              <AlertTriangle className="size-4" /> {n.text}
            </Link>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-5">
        <Stat label="Patients" value={c.patients} icon={Users} />
        <Stat label="Nouveaux ce mois" value={c.newPatients} icon={UserPlus} />
        <Stat label="RDV du jour" value={c.appointmentsToday} icon={CalendarDays} />
        <Stat label="RDV à venir" value={c.appointmentsUpcoming} icon={CalendarClock} />
        <Stat label="Consultations (mois)" value={c.consultationsMonth} icon={Stethoscope} />
        <Stat label="Revenus du jour" value={money(c.revenueDayCents)} icon={HandCoins} />
        <Stat label="Revenus du mois" value={money(c.revenueMonthCents)} icon={TrendingUp} />
        <Stat label="Paiements en attente" value={money(c.pendingCents)} hint={`${c.pendingCount} facture(s)`} icon={Clock} />
        <Stat label="Dépenses du mois" value={money(c.expensesMonthCents)} icon={Wallet} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-3 font-semibold">Revenus mensuels (MAD)</h2>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.charts}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e6e9ef" />
              <XAxis dataKey="month" tickFormatter={label} fontSize={11} />
              <YAxis fontSize={11} width={50} />
              <Tooltip labelFormatter={(m) => label(String(m))} formatter={(v) => [`${Number(v).toLocaleString("fr-FR")} MAD`, "Revenus"]} />
              <Bar dataKey="revenue" fill="#2a78d6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card className="p-5">
          <h2 className="mb-3 font-semibold">Consultations</h2>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={data.charts}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e6e9ef" />
              <XAxis dataKey="month" tickFormatter={label} fontSize={11} />
              <YAxis allowDecimals={false} fontSize={11} width={30} />
              <Tooltip labelFormatter={(m) => label(String(m))} formatter={(v) => [v as number, "Consultations"]} />
              <Line type="monotone" dataKey="consultations" stroke="#14315f" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
        <Card className="p-5">
          <h2 className="mb-2 font-semibold">Prochains rendez-vous</h2>
          {data.nextAppointments.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Aucun rendez-vous à venir.</p>}
          <ul className="divide-y divide-border/60">
            {data.nextAppointments.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <Link to={`/patients/${a.patient.id}`} className="font-medium hover:text-primary">
                  {fullName(a.patient)} <DemoTag show={a.patient.isDemo} />
                </Link>
                <span className="flex items-center gap-2 text-muted-foreground">
                  {fmt(a.startsAt, "dd/MM HH:mm")} <Tag tone="blue">{APPOINTMENT_STATUS[a.status as AppointmentStatus]}</Tag>
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-5">
          <h2 className="mb-2 font-semibold">Derniers patients enregistrés</h2>
          {data.latestPatients.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Aucun patient enregistré.</p>}
          <ul className="divide-y divide-border/60">
            {data.latestPatients.map((p) => (
              <li key={p.id} className="flex justify-between py-2 text-sm">
                <Link to={`/patients/${p.id}`} className="font-medium hover:text-primary">
                  {fullName(p)} <DemoTag show={p.isDemo} />
                </Link>
                <span className="text-muted-foreground">
                  {p.fileNumber} · {fmt(p.registeredAt)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
