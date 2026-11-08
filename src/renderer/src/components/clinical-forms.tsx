import { useState } from "react";
import { Plus, X } from "lucide-react";
import { TREATMENT_STATUS } from "@shared/constants";
import { consultationSchema, patientTreatmentSchema } from "@shared/schemas";
import { AreaField, Btn, Field, FormActions, Label, PatientPicker, Select, SelectField, useSubmit, useZodForm } from "@/components/kit";
import { useAuth, useLoad } from "@/hooks";
import { api } from "@/lib/api";
import { dateInput, fullName, money } from "@/lib/helpers";

type Existing = { id?: string; patientId: string; dentistId: string; date: Date; reason: string | null; symptoms: string | null; observations: string | null; diagnosis: string | null; treatmentDone: string | null; prescriptions: string | null; recommendations: string | null; notes: string | null; appointmentId: string | null };

export function useDentistOptions() {
  const { data } = useLoad(() => api.users.dentists());
  return Object.fromEntries((data ?? []).map((d) => [d.id, `Dr ${fullName(d)}`]));
}

export function ConsultationForm({ patient, existing, appointmentId, onDone, onCancel }: { patient?: { id: string; label: string }; existing?: Existing; appointmentId?: string; onDone(): void; onCancel(): void }) {
  const { user } = useAuth();
  const dentists = useDentistOptions();
  const { data: catalog } = useLoad(() => api.treatments.catalog({ includeInactive: false }));
  const [who, setWho] = useState(patient ?? null);
  const [acts, setActs] = useState<{ treatmentId: string; toothNumber: number | null }[]>([]);
  const form = useZodForm(consultationSchema.omit({ patientId: true }), { dentistId: existing?.dentistId ?? (user?.role === "DENTIST" ? user.id : ""), ...existing, date: dateInput(existing?.date ?? new Date()) });
  const { busy, submit } = useSubmit(
    async (v: Record<string, unknown>) => {
      if (!who) throw new Error("Choisissez un patient.");
      await api.consultations.save({ ...v, id: existing?.id, patientId: who.id, appointmentId: appointmentId ?? existing?.appointmentId ?? null, treatmentIds: acts } as never);
    },
    "Consultation enregistrée",
    onDone,
  );
  return (
    <form onSubmit={form.handleSubmit(submit as never)} className="grid grid-cols-2 gap-3">
      <Label label="Patient" required className="col-span-2">
        {patient ? <p className="text-sm font-medium">{patient.label}</p> : <PatientPicker value={who} onChange={setWho} />}
      </Label>
      <SelectField form={form} name="dentistId" label="Dentiste" required options={dentists} empty="Choisir" />
      <Field form={form} name="date" label="Date" type="date" required />
      <AreaField form={form} name="reason" label="Motif" className="col-span-2" rows={2} />
      <AreaField form={form} name="symptoms" label="Symptômes décrits" />
      <AreaField form={form} name="observations" label="Observations cliniques" />
      <AreaField form={form} name="diagnosis" label="Diagnostic saisi par le praticien" />
      <AreaField form={form} name="treatmentDone" label="Traitement réalisé" />
      <AreaField form={form} name="prescriptions" label="Prescriptions" />
      <AreaField form={form} name="recommendations" label="Recommandations" />
      <AreaField form={form} name="notes" label="Notes complémentaires" className="col-span-2" rows={2} />
      <div className="col-span-2 space-y-2 rounded-xl bg-muted/40 p-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Actes réalisés</p>
          <Btn variant="outline" icon={Plus} onClick={() => catalog?.[0] && setActs([...acts, { treatmentId: catalog[0].id, toothNumber: null }])}>
            Ajouter
          </Btn>
        </div>
        {acts.map((a, i) => (
          <div key={i} className="flex items-center gap-2">
            <Select value={a.treatmentId} onChange={(e) => setActs(acts.map((x, j) => (j === i ? { ...x, treatmentId: e.target.value } : x)))}>
              {catalog?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({money(t.priceCents)})
                </option>
              ))}
            </Select>
            <input type="number" placeholder="Dent" className="h-10 w-24 rounded-lg border border-input bg-card px-2 text-sm" value={a.toothNumber ?? ""} onChange={(e) => setActs(acts.map((x, j) => (j === i ? { ...x, toothNumber: e.target.value ? Number(e.target.value) : null } : x)))} />
            <Btn variant="ghost" icon={X} aria-label="Retirer" onClick={() => setActs(acts.filter((_, j) => j !== i))} />
          </div>
        ))}
      </div>
      <div className="col-span-2">
        <FormActions onCancel={onCancel} busy={busy} />
      </div>
    </form>
  );
}

export function AssignTreatmentForm({ patientId, onDone, onCancel }: { patientId: string; onDone(): void; onCancel(): void }) {
  const dentists = useDentistOptions();
  const { data: catalog } = useLoad(() => api.treatments.catalog({ includeInactive: false }));
  const form = useZodForm(patientTreatmentSchema.omit({ patientId: true, toothNumber: true, price: true }), { status: "PLANNED" });
  const [tooth, setTooth] = useState("");
  const [price, setPrice] = useState("");
  const { busy, submit } = useSubmit(
    (v: Record<string, unknown>) => api.treatments.assign({ ...v, patientId, toothNumber: tooth ? Number(tooth) : null, dentistId: v.dentistId || null, price: price === "" ? undefined : Number(price) } as never),
    "Traitement ajouté",
    onDone,
  );
  return (
    <form onSubmit={form.handleSubmit(submit as never)} className="grid grid-cols-2 gap-3">
      <SelectField form={form} name="treatmentId" label="Traitement" required className="col-span-2" options={Object.fromEntries((catalog ?? []).map((t) => [t.id, `${t.name} (${money(t.priceCents)})`]))} empty="Choisir" />
      <SelectField form={form} name="dentistId" label="Dentiste" options={dentists} empty="—" />
      <SelectField form={form} name="status" label="Statut" options={TREATMENT_STATUS} />
      <Label label="Dent (FDI)">
        <input type="number" className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm" value={tooth} onChange={(e) => setTooth(e.target.value)} />
      </Label>
      <Label label="Prix (MAD, vide = catalogue)">
        <input type="number" step="0.01" min="0" className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm" value={price} onChange={(e) => setPrice(e.target.value)} />
      </Label>
      <AreaField form={form} name="notes" label="Notes" className="col-span-2" rows={2} />
      <div className="col-span-2">
        <FormActions onCancel={onCancel} busy={busy} />
      </div>
    </form>
  );
}
