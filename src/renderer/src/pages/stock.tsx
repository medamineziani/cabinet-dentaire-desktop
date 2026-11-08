import { useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, History, Pencil, Plus, Truck } from "lucide-react";
import { PRODUCT_CATEGORIES } from "@shared/constants";
import { productSchema, stockMovementSchema, supplierSchema } from "@shared/schemas";
import { Btn, Card, DemoTag, Field, FormActions, LoadError, Modal, PageHeader, Pagination, SearchBox, Select, SelectField, Table, Tag, Td, useSubmit, useZodForm } from "@/components/kit";
import { useAuth, useDebounced, useLoad } from "@/hooks";
import { api } from "@/lib/api";
import { dateInput, fmt, money } from "@/lib/helpers";

type Row = Awaited<ReturnType<typeof api.stock.list>>["rows"][number];

function ProductForm({ row, onDone, onCancel }: { row?: Row; onDone(): void; onCancel(): void }) {
  const { data: suppliers } = useLoad(() => api.suppliers.list());
  const form = useZodForm(productSchema.extend({ initialQuantity: stockMovementSchema.shape.quantity.optional() }), row ? { ...row, purchasePrice: row.purchasePriceCents / 100, expiryDate: dateInput(row.expiryDate), supplierId: row.supplierId ?? "" } : { category: PRODUCT_CATEGORIES[0], minQuantity: 0, purchasePrice: 0, supplierId: "" });
  const { busy, submit } = useSubmit((v: object) => api.stock.save({ ...v, id: row?.id } as never), "Produit enregistré", onDone);
  return (
    <form onSubmit={form.handleSubmit(submit as never)} className="grid grid-cols-2 gap-3">
      <Field form={form} name="name" label="Nom" required className="col-span-2" autoFocus />
      <Field form={form} name="reference" label="Référence" required />
      <SelectField form={form} name="category" label="Catégorie" options={PRODUCT_CATEGORIES} />
      {!row && <Field form={form} name="initialQuantity" label="Quantité initiale" type="number" min="0" />}
      <Field form={form} name="minQuantity" label="Quantité minimale" type="number" min="0" required />
      <Field form={form} name="purchasePrice" label="Prix d'achat (MAD)" type="number" step="0.01" min="0" />
      <SelectField form={form} name="supplierId" label="Fournisseur" options={Object.fromEntries((suppliers ?? []).map((s) => [s.id, s.name]))} empty="—" />
      <Field form={form} name="expiryDate" label="Date d'expiration" type="date" />
      <div className="col-span-2">
        <FormActions onCancel={onCancel} busy={busy} />
      </div>
    </form>
  );
}

function MoveForm({ product, type, onDone, onCancel }: { product: Row; type: "IN" | "OUT"; onDone(): void; onCancel(): void }) {
  const form = useZodForm(stockMovementSchema.omit({ productId: true, type: true }), { quantity: 1 });
  const { busy, submit } = useSubmit((v: object) => api.stock.move({ ...v, productId: product.id, type } as never), "Stock mis à jour", onDone);
  return (
    <form onSubmit={form.handleSubmit(submit as never)} className="space-y-3">
      <p className="text-sm">
        {product.name} · disponible : <b>{product.quantity}</b>
      </p>
      <Field form={form} name="quantity" label="Quantité" type="number" min="1" required autoFocus />
      <Field form={form} name="reason" label="Motif" />
      <FormActions onCancel={onCancel} busy={busy} />
    </form>
  );
}

function SupplierForm({ onDone, onCancel }: { onDone(): void; onCancel(): void }) {
  const form = useZodForm(supplierSchema);
  const { busy, submit } = useSubmit((v: never) => api.suppliers.save(v), "Fournisseur ajouté", onDone);
  return (
    <form onSubmit={form.handleSubmit(submit as never)} className="space-y-3">
      <Field form={form} name="name" label="Nom" required autoFocus />
      <Field form={form} name="phone" label="Téléphone" />
      <Field form={form} name="email" label="E-mail" />
      <Field form={form} name="address" label="Adresse" />
      <FormActions onCancel={onCancel} busy={busy} />
    </form>
  );
}

function Movements({ productId }: { productId: string }) {
  const [page, setPage] = useState(1);
  const { data } = useLoad(() => api.stock.movements({ productId, page, pageSize: 10 }), [productId, page]);
  return (
    <div>
      <Table head={["Date", "Type", "Quantité", "Motif", "Par"]} empty={data?.rows.length === 0}>
        {data?.rows.map((m) => (
          <tr key={m.id}>
            <Td>{fmt(m.createdAt, "dd/MM/yyyy HH:mm")}</Td>
            <Td>{m.type === "IN" ? <Tag tone="green">Entrée</Tag> : <Tag tone="red">Sortie</Tag>}</Td>
            <Td className="tabular-nums">{m.quantity}</Td>
            <Td>{m.reason ?? "—"}</Td>
            <Td>{m.userName}</Td>
          </tr>
        ))}
      </Table>
      <Pagination page={page} pageSize={10} total={data?.total ?? 0} onChange={setPage} />
    </div>
  );
}

export function StockPage() {
  const { can } = useAuth();
  const [q, setQ] = useState("");
  const [alert, setAlert] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Row | "new" | null>(null);
  const [moving, setMoving] = useState<{ product: Row; type: "IN" | "OUT" } | null>(null);
  const [history, setHistory] = useState<Row | null>(null);
  const [supplier, setSupplier] = useState(false);
  const term = useDebounced(q);
  const pageSize = 15;
  const { data, error, reload } = useLoad(() => api.stock.list({ q: term, alert: (alert || undefined) as never, page, pageSize }), [term, alert, page]);
  const alerts = useLoad(() => api.stock.alerts(), [data]);
  const soon = Date.now() + 60 * 86_400_000;
  const writable = can("stock.write");
  return (
    <div className="space-y-4">
      <PageHeader title="Stock" subtitle="Consommables et équipements">
        {writable && (
          <>
            <Btn variant="outline" icon={Truck} onClick={() => setSupplier(true)}>
              Fournisseur
            </Btn>
            <Btn icon={Plus} onClick={() => setEditing("new")}>
              Nouveau produit
            </Btn>
          </>
        )}
      </PageHeader>
      <LoadError error={error} />
      {alerts.data && (alerts.data.low.length > 0 || alerts.data.expiring.length > 0) && (
        <p className="rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          {alerts.data.low.length} produit(s) en stock faible · {alerts.data.expiring.length} proche(s) de l&apos;expiration
        </p>
      )}
      <Card>
        <div className="flex gap-2 p-3">
          <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Nom ou référence" />
          <Select value={alert} onChange={(e) => { setAlert(e.target.value); setPage(1); }} className="w-48">
            <option value="">Tous les produits</option>
            <option value="low">Stock faible</option>
            <option value="expiring">Expiration proche</option>
          </Select>
        </div>
        <Table head={["Produit", "Réf.", "Catégorie", "Quantité", "Prix d'achat", "Fournisseur", "Expiration", ""]} empty={data?.rows.length === 0}>
          {data?.rows.map((p) => (
            <tr key={p.id}>
              <Td className="font-medium">
                {p.name} <DemoTag show={p.isDemo} />
              </Td>
              <Td className="text-muted-foreground">{p.reference}</Td>
              <Td>{p.category}</Td>
              <Td className="tabular-nums">
                {p.quantity} {p.quantity <= p.minQuantity && <Tag tone="red">Faible</Tag>}
              </Td>
              <Td className="tabular-nums">{money(p.purchasePriceCents)}</Td>
              <Td>{p.supplier?.name ?? "—"}</Td>
              <Td>
                {fmt(p.expiryDate)} {p.expiryDate && new Date(p.expiryDate).getTime() <= soon && <Tag tone="amber">Proche</Tag>}
              </Td>
              <Td className="text-right whitespace-nowrap">
                {writable && <Btn variant="ghost" icon={ArrowDownToLine} aria-label="Entrée" title="Entrée" onClick={() => setMoving({ product: p, type: "IN" })} />}
                {writable && <Btn variant="ghost" icon={ArrowUpFromLine} aria-label="Sortie" title="Sortie" onClick={() => setMoving({ product: p, type: "OUT" })} />}
                <Btn variant="ghost" icon={History} aria-label="Mouvements" title="Mouvements" onClick={() => setHistory(p)} />
                {writable && <Btn variant="ghost" icon={Pencil} aria-label="Modifier" onClick={() => setEditing(p)} />}
              </Td>
            </tr>
          ))}
        </Table>
        <Pagination page={page} pageSize={pageSize} total={data?.total ?? 0} onChange={setPage} />
      </Card>
      <Modal open={editing !== null} onClose={() => setEditing(null)} title="Produit" wide>
        <ProductForm row={editing && editing !== "new" ? editing : undefined} onCancel={() => setEditing(null)} onDone={() => { setEditing(null); reload(); }} />
      </Modal>
      <Modal open={moving !== null} onClose={() => setMoving(null)} title={moving?.type === "IN" ? "Entrée de stock" : "Sortie de stock"}>
        {moving && <MoveForm {...moving} onCancel={() => setMoving(null)} onDone={() => { setMoving(null); reload(); }} />}
      </Modal>
      <Modal open={history !== null} onClose={() => setHistory(null)} title={`Mouvements : ${history?.name ?? ""}`} wide>
        {history && <Movements productId={history.id} />}
      </Modal>
      <Modal open={supplier} onClose={() => setSupplier(false)} title="Nouveau fournisseur">
        <SupplierForm onCancel={() => setSupplier(false)} onDone={() => setSupplier(false)} />
      </Modal>
    </div>
  );
}
