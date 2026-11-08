import { useState } from "react";
import { Link } from "react-router";
import { UserPlus } from "lucide-react";
import { GENDERS } from "@shared/constants";
import { patientSchema } from "@shared/schemas";
import { AreaField, Btn, Card, DemoTag, Field, FormActions, LoadError, Modal, PageHeader, Pagination, SearchBox, Select, SelectField, Table, Tag, Td, useSubmit, useZodForm } from "@/components/kit";
import { useAuth, useDebounced, useLoad } from "@/hooks";
import { api } from "@/lib/api";
import { ageOf, dateInput, fmt, fullName } from "@/lib/helpers";

type PatientValues = Partial<Awaited<ReturnType<typeof api.patients.get>>["patient"]>;

export function PatientForm({ patient, onDone, onCancel }: { patient?: PatientValues; onDone(id: string): void; onCancel(): void }) {
  const form = useZodForm(patientSchema, { ...patient, birthDate: dateInput(patient?.birthDate), gender: patient?.gender ?? "" });
  const { busy, submit } = useSubmit(
    async (v: never) => {
      const saved = patient?.id ? await api.patients.update({ ...(v as object), id: patient.id } as never) : await api.patients.create(v);
      onDone(saved.id);
    },
    patient?.id ? "Patient modifié" : "Patient créé",
  );
  return (
    <form onSubmit={form.handleSubmit(submit as never)} className="grid grid-cols-2 gap-3">
      <Field form={form} name="lastName" label="Nom" required autoFocus />
      <Field form={form} name="firstName" label="Prénom" required />
      <Field form={form} name="birthDate" label="Date de naissance" type="date" />
      <SelectField form={form} name="gender" label="Sexe" options={GENDERS} empty="—" />
      <Field form={form} name="phone" label="Téléphone" />
      <Field form={form} name="email" label="E-mail" type="email" />
      <AreaField form={form} name="address" label="Adresse" className="col-span-2" rows={2} />
      <Field form={form} name="profession" label="Profession" className="col-span-2" />
      <Field form={form} name="emergencyName" label="Personne à contacter en urgence" />
      <Field form={form} name="emergencyPhone" label="Téléphone d'urgence" />
      <div className="col-span-2">
        <FormActions onCancel={onCancel} busy={busy} />
      </div>
    </form>
  );
}

export function PatientsPage() {
  const { can } = useAuth();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"active" | "archived" | "all">("active");
  const [gender, setGender] = useState("");
  const [withBalance, setWithBalance] = useState(false);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const term = useDebounced(q);
  const pageSize = 15;
  const { data, error, reload } = useLoad(() => api.patients.list({ q: term, status, gender: (gender || undefined) as never, withBalance: withBalance || undefined, page, pageSize }), [term, status, gender, withBalance, page]);
  const reset = (fn: () => void) => {
    fn();
    setPage(1);
  };
  return (
    <div>
      <PageHeader title="Patients" subtitle="Dossiers du cabinet">
        {can("patients.write") && (
          <Btn icon={UserPlus} onClick={() => setCreating(true)}>
            Nouveau patient
          </Btn>
        )}
      </PageHeader>
      <LoadError error={error} />
      <Card>
        <div className="flex flex-wrap items-center gap-2 p-3">
          <SearchBox value={q} onChange={(v) => reset(() => setQ(v))} placeholder="Nom, téléphone, n° de dossier" />
          <Select value={status} onChange={(e) => reset(() => setStatus(e.target.value as never))} className="w-36">
            <option value="active">Actifs</option>
            <option value="archived">Archivés</option>
            <option value="all">Tous</option>
          </Select>
          <Select value={gender} onChange={(e) => reset(() => setGender(e.target.value))} className="w-32">
            <option value="">Sexe</option>
            <option value="MALE">Homme</option>
            <option value="FEMALE">Femme</option>
          </Select>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="accent-primary" checked={withBalance} onChange={(e) => reset(() => setWithBalance(e.target.checked))} /> Paiement en attente
          </label>
        </div>
        <Table head={["Dossier", "Patient", "Âge", "Téléphone", "Inscrit le", ""]} empty={data?.rows.length === 0}>
          {data?.rows.map((p) => (
            <tr key={p.id} className="hover:bg-muted/40">
              <Td className="text-muted-foreground tabular-nums">{p.fileNumber}</Td>
              <Td>
                <Link to={`/patients/${p.id}`} className="font-medium hover:text-primary">
                  {fullName(p)}
                </Link>{" "}
                <DemoTag show={p.isDemo} /> {p.archivedAt && <Tag>Archivé</Tag>}
              </Td>
              <Td>{ageOf(p.birthDate) ?? "—"}</Td>
              <Td>{p.phone ?? "—"}</Td>
              <Td>{fmt(p.registeredAt)}</Td>
              <Td className="text-right">
                <Link to={`/patients/${p.id}`} className="text-sm text-primary hover:underline">
                  Ouvrir
                </Link>
              </Td>
            </tr>
          ))}
        </Table>
        <Pagination page={page} pageSize={pageSize} total={data?.total ?? 0} onChange={setPage} />
      </Card>
      <Modal open={creating} onClose={() => setCreating(false)} title="Nouveau patient" wide>
        <PatientForm onCancel={() => setCreating(false)} onDone={() => { setCreating(false); reload(); }} />
      </Modal>
    </div>
  );
}
