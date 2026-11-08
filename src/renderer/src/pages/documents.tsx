import { useState } from "react";
import { Link } from "react-router";
import { FilePlus2, FileText, Plus, X } from "lucide-react";
import { DOCUMENT_TYPES, type DocumentType } from "@shared/constants";
import { generateDocument } from "@/components/documents";
import { Btn, Card, FormActions, Input, Label, LoadError, Modal, PageHeader, PatientPicker, Select, Table, Td } from "@/components/kit";
import { useLoad } from "@/hooks";
import { api } from "@/lib/api";
import { fmt, fullName } from "@/lib/helpers";

function QuoteForm({ onDone, onCancel }: { onDone(): void; onCancel(): void }) {
  const [who, setWho] = useState<{ id: string; label: string } | null>(null);
  const [lines, setLines] = useState([{ label: "", quantity: 1, unitPrice: 0 }]);
  const [discount, setDiscount] = useState(0);
  const [validityDays, setValidity] = useState(30);
  const update = (i: number, patch: object) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!who) return;
        await generateDocument({ type: "QUOTE", patientId: who.id, quote: { items: lines, discount, validityDays } }, onDone);
      }}
    >
      <Label label="Patient" required>
        <PatientPicker value={who} onChange={setWho} />
      </Label>
      {lines.map((l, i) => (
        <div key={i} className="flex gap-2">
          <Input placeholder="Prestation" value={l.label} onChange={(e) => update(i, { label: e.target.value })} required />
          <Input type="number" min={1} className="w-20" value={l.quantity} onChange={(e) => update(i, { quantity: Number(e.target.value) })} aria-label="Quantité" />
          <Input type="number" min={0} step="0.01" className="w-32" value={l.unitPrice} onChange={(e) => update(i, { unitPrice: Number(e.target.value) })} aria-label="Prix" />
          <Btn variant="ghost" icon={X} disabled={lines.length === 1} aria-label="Retirer" onClick={() => setLines(lines.filter((_, j) => j !== i))} />
        </div>
      ))}
      <Btn variant="outline" icon={Plus} onClick={() => setLines([...lines, { label: "", quantity: 1, unitPrice: 0 }])}>
        Ajouter
      </Btn>
      <div className="grid grid-cols-2 gap-3">
        <Label label="Remise (MAD)">
          <Input type="number" min={0} step="0.01" value={discount} onChange={(e) => setDiscount(Number(e.target.value))} />
        </Label>
        <Label label="Validité (jours)">
          <Input type="number" min={1} value={validityDays} onChange={(e) => setValidity(Number(e.target.value))} />
        </Label>
      </div>
      <FormActions onCancel={onCancel} label="Générer le devis" />
    </form>
  );
}

export function DocumentsPage() {
  const [type, setType] = useState("");
  const [quote, setQuote] = useState(false);
  const { data, error, reload } = useLoad(() => api.documents.list({ type: type || undefined }), [type]);
  return (
    <div>
      <PageHeader title="Documents" subtitle="Fiches, ordonnances, comptes rendus, factures et devis générés">
        <Select value={type} onChange={(e) => setType(e.target.value)} className="w-60">
          <option value="">Tous les types</option>
          {Object.entries(DOCUMENT_TYPES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        <Btn icon={FilePlus2} onClick={() => setQuote(true)}>
          Nouveau devis
        </Btn>
      </PageHeader>
      <p className="mb-3 text-sm text-muted-foreground">Les autres documents se génèrent depuis la fiche du patient, une consultation ou une facture.</p>
      <LoadError error={error} />
      <Card>
        <Table head={["Document", "Type", "Patient", "Créé par", "Date", ""]} empty={data?.length === 0}>
          {data?.map((d) => (
            <tr key={d.id}>
              <Td className="font-medium">{d.title}</Td>
              <Td>{DOCUMENT_TYPES[d.type as DocumentType]}</Td>
              <Td>
                {d.patient ? (
                  <Link to={`/patients/${d.patient.id}`} className="hover:text-primary">
                    {fullName(d.patient)}
                  </Link>
                ) : (
                  "—"
                )}
              </Td>
              <Td>{d.createdBy}</Td>
              <Td>{fmt(d.createdAt, "dd/MM/yyyy HH:mm")}</Td>
              <Td className="text-right">
                <Btn variant="ghost" icon={FileText} aria-label="Exporter" onClick={() => api.documents.export({ id: d.id })} />
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
      <Modal open={quote} onClose={() => setQuote(false)} title="Nouveau devis" wide>
        <QuoteForm onCancel={() => setQuote(false)} onDone={() => { setQuote(false); reload(); }} />
      </Modal>
    </div>
  );
}
