import { useState } from "react";
import { Link } from "react-router";
import { Plus } from "lucide-react";
import { ConsultationForm, useDentistOptions } from "@/components/clinical-forms";
import { Btn, Card, DemoTag, LoadError, Modal, PageHeader, Pagination, SearchBox, Select, Table, Td } from "@/components/kit";
import { useAuth, useDebounced, useLoad } from "@/hooks";
import { api } from "@/lib/api";
import { fmt, fullName } from "@/lib/helpers";

export function ConsultationsPage() {
  const { can } = useAuth();
  const [q, setQ] = useState("");
  const [dentistId, setDentistId] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const term = useDebounced(q);
  const dentists = useDentistOptions();
  const pageSize = 15;
  const { data, error, reload } = useLoad(() => api.consultations.list({ q: term, dentistId: dentistId || undefined, page, pageSize }), [term, dentistId, page]);
  return (
    <div>
      <PageHeader title="Consultations" subtitle="Historique des consultations du cabinet">
        {can("consultations.write") && (
          <Btn icon={Plus} onClick={() => setCreating(true)}>
            Nouvelle consultation
          </Btn>
        )}
      </PageHeader>
      <LoadError error={error} />
      <Card>
        <div className="flex gap-2 p-3">
          <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Patient ou n° de dossier" />
          <Select value={dentistId} onChange={(e) => { setDentistId(e.target.value); setPage(1); }} className="w-52">
            <option value="">Tous les dentistes</option>
            {Object.entries(dentists).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </div>
        <Table head={["Date", "Patient", "Dentiste", "Motif", "Diagnostic"]} empty={data?.rows.length === 0}>
          {data?.rows.map((c) => (
            <tr key={c.id} className="hover:bg-muted/40">
              <Td className="tabular-nums">{fmt(c.date)}</Td>
              <Td>
                <Link to={`/patients/${c.patient.id}`} className="font-medium hover:text-primary">
                  {fullName(c.patient)}
                </Link>{" "}
                <DemoTag show={c.patient.isDemo} />
              </Td>
              <Td>Dr {fullName(c.dentist)}</Td>
              <Td className="max-w-64 truncate">{c.reason ?? "—"}</Td>
              <Td className="max-w-64 truncate">{c.diagnosis ?? "—"}</Td>
            </tr>
          ))}
        </Table>
        <Pagination page={page} pageSize={pageSize} total={data?.total ?? 0} onChange={setPage} />
      </Card>
      <Modal open={creating} onClose={() => setCreating(false)} title="Nouvelle consultation" wide>
        <ConsultationForm onCancel={() => setCreating(false)} onDone={() => { setCreating(false); reload(); }} />
      </Modal>
    </div>
  );
}
