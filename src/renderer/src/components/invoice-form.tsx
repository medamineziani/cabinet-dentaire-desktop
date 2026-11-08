import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { Btn, FormActions, Input, Label, PatientPicker, useSubmit } from "@/components/kit";
import { api } from "@/lib/api";
import { dateInput, money } from "@/lib/helpers";

type Line = { label: string; quantity: number; unitPrice: number; patientTreatmentId?: string | null };
const empty: Line = { label: "", quantity: 1, unitPrice: 0 };

export function InvoiceForm({ patient, onDone, onCancel }: { patient?: { id: string; label: string }; onDone(): void; onCancel(): void }) {
  const [who, setWho] = useState(patient ?? null);
  const [date, setDate] = useState(dateInput(new Date()));
  const [lines, setLines] = useState<Line[]>([{ ...empty }]);
  const [discount, setDiscount] = useState(0);
  const [notes, setNotes] = useState("");
  const [unbilled, setUnbilled] = useState<Awaited<ReturnType<typeof api.billing.unbilled>>>([]);

  useEffect(() => {
    if (who) api.billing.unbilled({ patientId: who.id }).then(setUnbilled);
    else setUnbilled([]);
  }, [who]);

  const subtotal = lines.reduce((s, l) => s + Math.round(l.unitPrice * 100) * l.quantity, 0);
  const update = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const remaining = unbilled.filter((t) => !lines.some((l) => l.patientTreatmentId === t.id));

  const { busy, submit } = useSubmit(
    async () => {
      if (!who) throw new Error("Choisissez un patient.");
      await api.billing.create({ patientId: who.id, date, items: lines, discount, notes });
    },
    "Facture créée",
    onDone,
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit(undefined as never);
      }}
      className="space-y-3"
    >
      <div className="grid grid-cols-2 gap-3">
        <Label label="Patient" required>
          {patient ? <p className="pt-2 text-sm font-medium">{patient.label}</p> : <PatientPicker value={who} onChange={setWho} />}
        </Label>
        <Label label="Date" required>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Label>
      </div>
      {remaining.length > 0 && (
        <div className="rounded-xl bg-accent/50 p-3">
          <p className="mb-1.5 text-xs font-medium">Actes non facturés</p>
          <div className="flex flex-wrap gap-1.5">
            {remaining.map((t) => (
              <button key={t.id} type="button" className="rounded-full border border-primary/30 bg-card px-2.5 py-1 text-xs hover:bg-accent" onClick={() => setLines([...lines.filter((l) => l.label), { label: t.treatment.name, quantity: 1, unitPrice: t.priceCents / 100, patientTreatmentId: t.id }])}>
                + {t.treatment.name} ({money(t.priceCents)})
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input placeholder="Prestation" value={l.label} onChange={(e) => update(i, { label: e.target.value })} aria-label="Prestation" />
            <Input type="number" min={1} className="w-20" value={l.quantity} onChange={(e) => update(i, { quantity: Number(e.target.value) })} aria-label="Quantité" />
            <Input type="number" min={0} step="0.01" className="w-32" value={l.unitPrice} onChange={(e) => update(i, { unitPrice: Number(e.target.value) })} aria-label="Prix unitaire" />
            <span className="w-32 text-right text-sm tabular-nums">{money(Math.round(l.unitPrice * 100) * l.quantity)}</span>
            <Btn variant="ghost" icon={X} aria-label="Retirer" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))} />
          </div>
        ))}
        <Btn variant="outline" icon={Plus} onClick={() => setLines([...lines, { ...empty }])}>
          Ajouter une prestation
        </Btn>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Label label="Notes">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Label>
        <Label label="Remise (MAD)">
          <Input type="number" min={0} step="0.01" value={discount} onChange={(e) => setDiscount(Number(e.target.value))} />
        </Label>
      </div>
      <p className="text-right text-lg font-semibold tabular-nums">Total : {money(subtotal - Math.round(discount * 100))}</p>
      <FormActions onCancel={onCancel} busy={busy} label="Créer la facture" />
    </form>
  );
}
