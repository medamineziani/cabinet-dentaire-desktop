import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Archive, ArchiveRestore, ArrowLeft, FileText, Pencil, Plus, Trash2 } from "lucide-react";
import { APPOINTMENT_STATUS, DOCUMENT_TYPES, GENDERS, INVOICE_STATUS, TREATMENT_STATUS, type AppointmentStatus, type DocumentType } from "@shared/constants";
import { medicalSchema } from "@shared/schemas";
import { AssignTreatmentForm, ConsultationForm } from "@/components/clinical-forms";
import { InvoiceForm } from "@/components/invoice-form";
import { AreaField, Btn, Card, Confirm, DemoTag, LoadError, Modal, Select, Table, Tag, Td, useSubmit, useZodForm } from "@/components/kit";
import { Odontogram } from "@/components/odontogram";
import { generateDocument } from "@/components/documents";
import { useAuth, useLoad, useToast } from "@/hooks";
import { api } from "@/lib/api";
import { ageOf, fmt, fullName, money } from "@/lib/helpers";
import { cn } from "@/lib/utils";
import { PatientForm } from "./patients";

type P = { patientId: string; label: string };

function MedicalTab({ patientId }: P) {
  const { can } = useAuth();
  const { data, error } = useLoad(() => api.medical.get({ patientId }), [patientId]);
  if (!data) return <LoadError error={error} />;
  return <MedicalForm record={data} patientId={patientId} editable={can("medical.write")} />;
}

function MedicalForm({ record, patientId, editable }: { record: Record<string, unknown>; patientId: string; editable: boolean }) {
  const form = useZodForm(medicalSchema, record);
  const { busy, submit } = useSubmit((v: object) => api.medical.save({ ...v, patientId } as never), "Dossier médical enregistré");
  const ro = { disabled: !editable };
  return (
    <Card className="p-5">
      <form onSubmit={form.handleSubmit(submit as never)} className="grid grid-cols-2 gap-3">
        <AreaField form={form} name="history" label="Antécédents médicaux" rows={4} {...ro} />
        <AreaField form={form} name="allergies" label="Allergies" rows={4} {...ro} />
        <AreaField form={form} name="medications" label="Médicaments utilisés" rows={4} {...ro} />
        <AreaField form={form} name="chronicDiseases" label="Maladies chroniques" rows={4} {...ro} />
        <AreaField form={form} name="notes" label="Remarques médicales" className="col-span-2" rows={3} {...ro} />
        {editable && (
          <div className="col-span-2 flex justify-end">
            <Btn type="submit" busy={busy}>
              Enregistrer
            </Btn>
          </div>
        )}
      </form>
    </Card>
  );
}

function ConsultationsTab({ patientId, label }: P) {
  const { can } = useAuth();
  const { data, error, reload } = useLoad(() => api.consultations.forPatient({ patientId }), [patientId]);
  const [editing, setEditing] = useState<null | "new" | NonNullable<typeof data>[number]>(null);
  return (
    <div className="space-y-3">
      <LoadError error={error} />
      {can("consultations.write") && (
        <div className="flex justify-end">
          <Btn icon={Plus} onClick={() => setEditing("new")}>
            Nouvelle consultation
          </Btn>
        </div>
      )}
      {data?.length === 0 && <Card className="py-12 text-center text-sm text-muted-foreground">Aucune consultation.</Card>}
      {data?.map((c) => (
        <Card key={c.id} className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">
              {fmt(c.date)} · Dr {fullName(c.dentist)}
            </p>
            <div className="flex gap-1">
              <Btn variant="outline" icon={FileText} onClick={() => generateDocument({ type: "CONSULTATION_REPORT", consultationId: c.id })}>
                Compte rendu
              </Btn>
              {c.prescriptions && (
                <Btn variant="outline" icon={FileText} onClick={() => generateDocument({ type: "PRESCRIPTION", consultationId: c.id })}>
                  Ordonnance
                </Btn>
              )}
              {can("consultations.write") && <Btn variant="ghost" icon={Pencil} aria-label="Modifier" onClick={() => setEditing(c)} />}
            </div>
          </div>
          <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm md:grid-cols-2">
            {([["Motif", c.reason], ["Diagnostic", c.diagnosis], ["Traitement réalisé", c.treatmentDone], ["Prescriptions", c.prescriptions]] as const).map(([k, v]) => v && (
              <div key={k}>
                <dt className="text-xs text-muted-foreground">{k}</dt>
                <dd className="whitespace-pre-line">{v}</dd>
              </div>
            ))}
          </dl>
          {c.treatments.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Actes : {c.treatments.map((t) => `${t.treatment.name}${t.toothNumber ? ` (${t.toothNumber})` : ""}`).join(", ")}</p>}
        </Card>
      ))}
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Nouvelle consultation" : "Modifier la consultation"} wide>
        <ConsultationForm patient={{ id: patientId, label }} existing={editing && editing !== "new" ? (editing as never) : undefined} onCancel={() => setEditing(null)} onDone={() => { setEditing(null); reload(); }} />
      </Modal>
    </div>
  );
}

function TreatmentsTab({ patientId }: P) {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useLoad(() => api.treatments.forPatient({ patientId }), [patientId]);
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-3">
      <LoadError error={error} />
      <div className="flex justify-end gap-2">
        {can("documents.medical") && (
          <Btn variant="outline" icon={FileText} onClick={() => generateDocument({ type: "TREATMENT_PLAN", patientId })}>
            Plan de traitement
          </Btn>
        )}
        {can("treatments.assign") && (
          <Btn icon={Plus} onClick={() => setAdding(true)}>
            Ajouter un traitement
          </Btn>
        )}
      </div>
      <Card>
        <Table head={["Traitement", "Dent", "Dentiste", "Prix", "Statut"]} empty={data?.length === 0}>
          {data?.map((t) => (
            <tr key={t.id}>
              <Td className="font-medium">{t.treatment.name}</Td>
              <Td>{t.toothNumber ?? "—"}</Td>
              <Td>{t.dentist ? `Dr ${fullName(t.dentist)}` : "—"}</Td>
              <Td className="tabular-nums">{money(t.priceCents)}</Td>
              <Td>
                {can("treatments.assign") ? (
                  <Select className="h-8 w-36" value={t.status} onChange={(e) => api.treatments.setStatus({ id: t.id, status: e.target.value as never }).then(reload).catch(toast.error)}>
                    {Object.entries(TREATMENT_STATUS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Tag>{TREATMENT_STATUS[t.status as keyof typeof TREATMENT_STATUS]}</Tag>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
      <Modal open={adding} onClose={() => setAdding(false)} title="Ajouter un traitement">
        <AssignTreatmentForm patientId={patientId} onCancel={() => setAdding(false)} onDone={() => { setAdding(false); reload(); }} />
      </Modal>
    </div>
  );
}

function BillingTab({ patientId, label }: P) {
  const { can } = useAuth();
  const { data, error, reload } = useLoad(() => api.billing.list({ patientId, page: 1, pageSize: 100 }), [patientId]);
  const [creating, setCreating] = useState(false);
  const tone = { PAID: "green", PARTIAL: "amber", UNPAID: "red", CANCELLED: "slate" } as const;
  return (
    <div className="space-y-3">
      <LoadError error={error} />
      {can("billing.write") && (
        <div className="flex justify-end">
          <Btn icon={Plus} onClick={() => setCreating(true)}>
            Nouvelle facture
          </Btn>
        </div>
      )}
      <Card>
        <Table head={["N°", "Date", "Total", "Payé", "Reste", "Statut", ""]} empty={data?.rows.length === 0}>
          {data?.rows.map((i) => (
            <tr key={i.id}>
              <Td className="font-medium">
                <Link to={`/factures?id=${i.id}`} className="hover:text-primary">
                  {i.number}
                </Link>
              </Td>
              <Td>{fmt(i.date)}</Td>
              <Td className="tabular-nums">{money(i.totalCents)}</Td>
              <Td className="tabular-nums">{money(i.paidCents)}</Td>
              <Td className="tabular-nums">{i.status === "CANCELLED" ? "—" : money(i.totalCents - i.paidCents)}</Td>
              <Td>
                <Tag tone={tone[i.status as keyof typeof tone]}>{INVOICE_STATUS[i.status as keyof typeof INVOICE_STATUS]}</Tag>
              </Td>
              <Td className="text-right">
                <Btn variant="ghost" icon={FileText} aria-label="PDF" onClick={() => generateDocument({ type: "INVOICE", invoiceId: i.id })} />
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
      <Modal open={creating} onClose={() => setCreating(false)} title="Nouvelle facture" wide>
        <InvoiceForm patient={{ id: patientId, label }} onCancel={() => setCreating(false)} onDone={() => { setCreating(false); reload(); }} />
      </Modal>
    </div>
  );
}

function DocumentsTab({ patientId }: P) {
  const { can } = useAuth();
  const { data, reload } = useLoad(() => api.documents.list({ patientId }), [patientId]);
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Btn icon={FileText} onClick={() => generateDocument({ type: "PATIENT_FILE", patientId }, reload)}>
          Fiche patient PDF
        </Btn>
      </div>
      <Card>
        <Table head={["Document", "Type", "Créé par", "Date", ""]} empty={data?.length === 0}>
          {data?.map((d) => (
            <tr key={d.id}>
              <Td className="font-medium">{d.title}</Td>
              <Td>{DOCUMENT_TYPES[d.type as DocumentType]}</Td>
              <Td>{d.createdBy}</Td>
              <Td>{fmt(d.createdAt, "dd/MM/yyyy HH:mm")}</Td>
              <Td className="text-right">{(can("documents.admin") || can("documents.medical")) && <Btn variant="ghost" icon={FileText} aria-label="Exporter" onClick={() => api.documents.export({ id: d.id })} />}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}

function AppointmentsList({ patientId }: { patientId: string }) {
  const { data } = useLoad(() => api.appointments.forPatient({ patientId }), [patientId]);
  return (
    <Card>
      <Table head={["Date", "Heure", "Type", "Dentiste", "Statut"]} empty={data?.length === 0}>
        {data?.map((a) => (
          <tr key={a.id}>
            <Td>{fmt(a.startsAt)}</Td>
            <Td className="tabular-nums">{fmt(a.startsAt, "HH:mm")}</Td>
            <Td>{a.type}</Td>
            <Td>Dr {fullName(a.dentist)}</Td>
            <Td>
              <Tag tone="blue">{APPOINTMENT_STATUS[a.status as AppointmentStatus]}</Tag>
            </Td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}

export function PatientDetailPage() {
  const { id = "" } = useParams();
  const { can } = useAuth();
  const go = useNavigate();
  const toast = useToast();
  const { data, error, reload } = useLoad(() => api.patients.get({ id }), [id]);
  const [tab, setTab] = useState("info");
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  if (!data) return <LoadError error={error} />;
  const p = data.patient;
  const label = fullName(p);

  const tabs = [
    ["info", "Informations personnelles", true],
    ["medical", "Dossier médical", can("medical.read")],
    ["consultations", "Consultations", can("consultations.read")],
    ["odontogram", "Odontogramme", can("odontogram.read")],
    ["treatments", "Traitements", can("treatments.read")],
    ["billing", "Factures et paiements", can("billing.read")],
    ["documents", "Documents", can("documents.admin") || can("documents.medical")],
  ] as const;
  const facts: [string, string | null | number][] = [
    ["Date de naissance", p.birthDate ? `${fmt(p.birthDate)} (${ageOf(p.birthDate)} ans)` : null],
    ["Sexe", p.gender ? GENDERS[p.gender as keyof typeof GENDERS] : null],
    ["Téléphone", p.phone],
    ["E-mail", p.email],
    ["Adresse", p.address],
    ["Profession", p.profession],
    ["Inscrit le", fmt(p.registeredAt)],
    ["Contact d'urgence", [p.emergencyName, p.emergencyPhone].filter(Boolean).join(" · ") || null],
  ];

  return (
    <div className="space-y-4">
      <Link to="/patients" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Patients
      </Link>
      <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <h1 className="text-xl font-semibold">
            {label} <DemoTag show={p.isDemo} /> {p.archivedAt && <Tag>Archivé</Tag>}
          </h1>
          <p className="text-sm text-muted-foreground">
            Dossier {p.fileNumber}
            {data.balanceCents > 0 && can("billing.read") && <span className="text-red-600"> · Reste à payer : {money(data.balanceCents)}</span>}
          </p>
        </div>
        <div className="flex gap-2">
          {can("patients.write") && (
            <Btn variant="outline" icon={Pencil} onClick={() => setEditing(true)}>
              Modifier
            </Btn>
          )}
          {can("patients.archive") && (
            <Btn variant="outline" icon={p.archivedAt ? ArchiveRestore : Archive} onClick={() => api.patients.setArchived({ id, archived: !p.archivedAt }).then(() => { toast.success(p.archivedAt ? "Patient restauré" : "Patient archivé"); reload(); }).catch(toast.error)}>
              {p.archivedAt ? "Restaurer" : "Archiver"}
            </Btn>
          )}
          {can("patients.delete") && <Btn variant="ghost" icon={Trash2} aria-label="Supprimer" onClick={() => setRemoving(true)} />}
        </div>
      </Card>
      <div className="flex gap-1 overflow-x-auto border-b border-border">
        {tabs.filter((t) => t[2]).map(([k, v]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={cn("-mb-px border-b-2 px-3 pb-2.5 text-sm font-medium whitespace-nowrap", tab === k ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {v}
          </button>
        ))}
      </div>
      {tab === "info" && (
        <div className="space-y-4">
          <Card className="grid gap-x-8 gap-y-3 p-5 md:grid-cols-2">
            {facts.map(([k, v]) => (
              <div key={k}>
                <p className="text-xs text-muted-foreground">{k}</p>
                <p className="text-sm">{v || "—"}</p>
              </div>
            ))}
          </Card>
          {can("appointments.read") && (
            <div>
              <h2 className="mb-2 font-semibold">Rendez-vous</h2>
              <AppointmentsList patientId={id} />
            </div>
          )}
        </div>
      )}
      {tab === "medical" && <MedicalTab patientId={id} label={label} />}
      {tab === "consultations" && <ConsultationsTab patientId={id} label={label} />}
      {tab === "odontogram" && <Odontogram patientId={id} />}
      {tab === "treatments" && <TreatmentsTab patientId={id} label={label} />}
      {tab === "billing" && <BillingTab patientId={id} label={label} />}
      {tab === "documents" && <DocumentsTab patientId={id} label={label} />}
      <Modal open={editing} onClose={() => setEditing(false)} title="Modifier le patient" wide>
        <PatientForm patient={p} onCancel={() => setEditing(false)} onDone={() => { setEditing(false); reload(); }} />
      </Modal>
      <Confirm open={removing} onClose={() => setRemoving(false)} danger title="Supprimer définitivement ?" text="Le dossier, les rendez-vous, consultations et l'odontogramme de ce patient seront effacés. Cette action est irréversible." confirmLabel="Supprimer" onConfirm={async () => { await api.patients.remove({ id }); toast.success("Patient supprimé"); go("/patients"); }} />
    </div>
  );
}
