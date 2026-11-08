import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { treatmentSchema } from "@shared/schemas";
import { AreaField, Btn, Card, Field, FormActions, LoadError, Modal, PageHeader, Table, Tag, Td, useSubmit, useZodForm } from "@/components/kit";
import { useAuth, useLoad } from "@/hooks";
import { api } from "@/lib/api";
import { money } from "@/lib/helpers";

type Row = Awaited<ReturnType<typeof api.treatments.catalog>>[number];

function TreatmentForm({ row, onDone, onCancel }: { row?: Row; onDone(): void; onCancel(): void }) {
  const form = useZodForm(treatmentSchema, row ? { ...row, price: row.priceCents / 100 } : { active: true, durationMinutes: 30 });
  const { busy, submit } = useSubmit((v: object) => api.treatments.saveCatalog({ ...v, id: row?.id } as never), "Traitement enregistré", onDone);
  return (
    <form onSubmit={form.handleSubmit(submit as never)} className="grid grid-cols-2 gap-3">
      <Field form={form} name="name" label="Nom" required className="col-span-2" autoFocus />
      <AreaField form={form} name="description" label="Description" className="col-span-2" rows={2} />
      <Field form={form} name="price" label="Prix (MAD)" type="number" step="0.01" min="0" required />
      <Field form={form} name="durationMinutes" label="Durée estimée (min)" type="number" required />
      <label className="col-span-2 flex items-center gap-2 text-sm">
        <input type="checkbox" className="accent-primary" {...form.register("active")} /> Actif dans le catalogue
      </label>
      <div className="col-span-2">
        <FormActions onCancel={onCancel} busy={busy} />
      </div>
    </form>
  );
}

export function TreatmentsPage() {
  const { can } = useAuth();
  const { data, error, reload } = useLoad(() => api.treatments.catalog({ includeInactive: true }));
  const [editing, setEditing] = useState<Row | "new" | null>(null);
  const writable = can("catalog.write");
  return (
    <div>
      <PageHeader title="Catalogue des traitements" subtitle="Prix et durées configurables">
        {writable && (
          <Btn icon={Plus} onClick={() => setEditing("new")}>
            Nouveau traitement
          </Btn>
        )}
      </PageHeader>
      <LoadError error={error} />
      <Card>
        <Table head={["Nom", "Description", "Prix", "Durée", "État", ""]} empty={data?.length === 0}>
          {data?.map((t) => (
            <tr key={t.id}>
              <Td className="font-medium">{t.name}</Td>
              <Td className="text-muted-foreground">{t.description ?? "—"}</Td>
              <Td className="tabular-nums">{money(t.priceCents)}</Td>
              <Td>{t.durationMinutes} min</Td>
              <Td>{t.active ? <Tag tone="green">Actif</Tag> : <Tag>Inactif</Tag>}</Td>
              <Td className="text-right">{writable && <Btn variant="ghost" icon={Pencil} aria-label="Modifier" onClick={() => setEditing(t)} />}</Td>
            </tr>
          ))}
        </Table>
      </Card>
      <Modal open={editing !== null} onClose={() => setEditing(null)} title="Traitement">
        <TreatmentForm row={editing && editing !== "new" ? editing : undefined} onCancel={() => setEditing(null)} onDone={() => { setEditing(null); reload(); }} />
      </Modal>
    </div>
  );
}
