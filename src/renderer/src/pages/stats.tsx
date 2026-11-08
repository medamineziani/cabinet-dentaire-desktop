import { useState } from "react";
import { Link } from "react-router";
import { startOfYear } from "date-fns";
import { FileSpreadsheet, FileText, Percent, Stethoscope, TrendingDown, TrendingUp, UserX, XCircle } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useDentistOptions } from "@/components/clinical-forms";
import { Btn, Card, Input, LoadError, PageHeader, Select, Stat, Table, Td } from "@/components/kit";
import { useLoad, useToast } from "@/hooks";
import { api } from "@/lib/api";
import { dateInput, money } from "@/lib/helpers";

const axis = (m: string) => `${m.slice(5)}/${m.slice(2, 4)}`;

export function StatsPage() {
  const toast = useToast();
  const [from, setFrom] = useState(dateInput(startOfYear(new Date())));
  const [to, setTo] = useState(dateInput(new Date()));
  const [dentistId, setDentistId] = useState("");
  const dentists = useDentistOptions();
  const input = { from: new Date(`${from}T00:00:00`), to: new Date(new Date(`${to}T00:00:00`).getTime() + 86_400_000), dentistId: dentistId || undefined };
  const { data, error } = useLoad(() => api.stats.report(input), [from, to, dentistId]);
  const exporter = (fn: typeof api.stats.exportPdf) => () => fn(input).then((p) => p && toast.success(`Exporté : ${p}`)).catch(toast.error);
  return (
    <div className="space-y-4">
      <PageHeader title="Statistiques et rapports">
        <Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Du" />
        <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Au" />
        <Select value={dentistId} onChange={(e) => setDentistId(e.target.value)} className="w-52">
          <option value="">Tous les dentistes</option>
          {Object.entries(dentists).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        <Btn variant="outline" icon={FileText} onClick={exporter(api.stats.exportPdf)}>
          PDF
        </Btn>
        <Btn variant="outline" icon={FileSpreadsheet} onClick={exporter(api.stats.exportExcel)}>
          Excel
        </Btn>
      </PageHeader>
      <LoadError error={error} />
      {data && (
        <>
          {dentistId && <p className="text-xs text-muted-foreground">Avec un dentiste choisi, les revenus sont ceux des factures comportant un de ses actes. Les dépenses restent celles du cabinet.</p>}
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
            <Stat label="Consultations" value={data.totals.consultations} icon={Stethoscope} />
            <Stat label="Revenus" value={money(data.totals.revenueCents)} icon={TrendingUp} />
            <Stat label="Dépenses" value={money(data.totals.expenseCents)} icon={TrendingDown} />
            <Stat label="Rendez-vous annulés" value={data.appointments.cancelled} hint={`sur ${data.appointments.total}`} icon={XCircle} />
            <Stat label="Absences" value={data.appointments.noShow} icon={UserX} />
            <Stat label="Taux d'absence" value={`${data.appointments.noShowRate} %`} icon={Percent} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-5">
              <h2 className="mb-3 font-semibold">Revenus et dépenses (MAD)</h2>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={data.monthly}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e6e9ef" />
                  <XAxis dataKey="month" tickFormatter={axis} fontSize={11} />
                  <YAxis fontSize={11} width={55} />
                  <Tooltip labelFormatter={(m) => axis(String(m))} />
                  <Legend />
                  <Bar dataKey="revenue" name="Revenus" fill="#2a78d6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="expenses" name="Dépenses" fill="#eb6834" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
            <Card className="p-5">
              <h2 className="mb-3 font-semibold">Patients et consultations par mois</h2>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={data.monthly}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e6e9ef" />
                  <XAxis dataKey="month" tickFormatter={axis} fontSize={11} />
                  <YAxis allowDecimals={false} fontSize={11} width={30} />
                  <Tooltip labelFormatter={(m) => axis(String(m))} />
                  <Legend />
                  <Bar dataKey="patients" name="Nouveaux patients" fill="#1baf7a" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="consultations" name="Consultations" fill="#14315f" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
            <Card>
              <h2 className="p-4 pb-0 font-semibold">Traitements les plus fréquents</h2>
              <Table head={["Traitement", "Nombre"]} empty={data.topTreatments.length === 0}>
                {data.topTreatments.map((t) => (
                  <tr key={t.name}>
                    <Td>{t.name}</Td>
                    <Td className="tabular-nums">{t.count}</Td>
                  </tr>
                ))}
              </Table>
            </Card>
            <Card>
              <h2 className="p-4 pb-0 font-semibold">Patients avec paiements en attente</h2>
              <Table head={["Dossier", "Patient", "Reste à payer"]} empty={data.debtors.length === 0}>
                {data.debtors.slice(0, 15).map((d) => (
                  <tr key={d.id}>
                    <Td className="text-muted-foreground">{d.fileNumber}</Td>
                    <Td>
                      <Link to={`/patients/${d.id}`} className="hover:text-primary">
                        {d.name}
                      </Link>
                    </Td>
                    <Td className="tabular-nums">{money(d.dueCents)}</Td>
                  </tr>
                ))}
              </Table>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
