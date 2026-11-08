import { useState } from "react";
import { useSearchParams } from "react-router";
import { Ban, FileText, Plus } from "lucide-react";
import { INVOICE_STATUS, PAYMENT_METHODS } from "@shared/constants";
import { paymentSchema } from "@shared/schemas";
import { generateDocument } from "@/components/documents";
import { InvoiceForm } from "@/components/invoice-form";
import { Btn, Card, DemoTag, Field, Input, Label, LoadError, Modal, PageHeader, Pagination, SearchBox, Select, SelectField, Table, Tag, Td, useSubmit, useZodForm } from "@/components/kit";
import { useAuth, useDebounced, useLoad, useToast } from "@/hooks";
import { api } from "@/lib/api";
import { fmt, fullName, money } from "@/lib/helpers";

const tone = { PAID: "green", PARTIAL: "amber", UNPAID: "red", CANCELLED: "slate" } as const;
type Status = keyof typeof tone;

function PaymentForm({ invoiceId, remaining, onDone }: { invoiceId: string; remaining: number; onDone(): void }) {
  const form = useZodForm(paymentSchema.omit({ invoiceId: true }), { amount: remaining / 100, method: "CASH" });
  const { busy, submit } = useSubmit((v: object) => api.billing.addPayment({ ...v, invoiceId } as never), "Paiement enregistré", onDone);
  return (
    <form onSubmit={form.handleSubmit(submit as never)} className="grid grid-cols-3 items-end gap-2">
      <Field form={form} name="amount" label="Montant (MAD)" type="number" step="0.01" min="0" />
      <SelectField form={form} name="method" label="Mode" options={PAYMENT_METHODS} />
      <Field form={form} name="reference" label="Référence" />
      <div className="col-span-3 flex justify-end">
        <Btn type="submit" busy={busy}>
          Enregistrer le paiement
        </Btn>
      </div>
    </form>
  );
}

function InvoiceDetail({ id, onChanged }: { id: string; onChanged(): void }) {
  const { can, user } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useLoad(() => api.billing.get({ id }), [id]);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  if (!data) return <LoadError error={error} />;
  const remaining = data.totalCents - data.paidCents;
  const changed = () => {
    reload();
    onChanged();
  };
  const active = data.status !== "CANCELLED";
  return (
    <div className="space-y-4 text-sm">
      <div className="flex items-center justify-between">
        <p>
          <b>{fullName(data.patient)}</b> <DemoTag show={data.patient.isDemo} /> · {fmt(data.date)}
        </p>
        <Tag tone={tone[data.status as Status]}>{INVOICE_STATUS[data.status as Status]}</Tag>
      </div>
      <Table head={["Prestation", "Qté", "PU", "Total"]}>
        {data.items.map((i) => (
          <tr key={i.id}>
            <Td>{i.label}</Td>
            <Td>{i.quantity}</Td>
            <Td className="tabular-nums">{money(i.unitPriceCents)}</Td>
            <Td className="tabular-nums">{money(i.totalCents)}</Td>
          </tr>
        ))}
      </Table>
      <div className="ml-auto w-64 space-y-1">
        {data.discountCents > 0 && (
          <p className="flex justify-between">
            <span>Remise</span>
            <span className="tabular-nums">- {money(data.discountCents)}</span>
          </p>
        )}
        <p className="flex justify-between font-semibold">
          <span>Total</span>
          <span className="tabular-nums">{money(data.totalCents)}</span>
        </p>
        <p className="flex justify-between">
          <span>Payé</span>
          <span className="tabular-nums">{money(data.paidCents)}</span>
        </p>
        <p className="flex justify-between font-semibold text-red-700">
          <span>Reste à payer</span>
          <span className="tabular-nums">{money(Math.max(0, remaining))}</span>
        </p>
      </div>
      {data.cancelReason && <p className="rounded-lg bg-muted px-3 py-2">Annulée : {data.cancelReason}</p>}
      {data.payments.length > 0 && (
        <div>
          <h3 className="mb-1 font-semibold">Paiements</h3>
          <ul className="divide-y divide-border/60">
            {data.payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between py-1.5">
                <span className={p.cancelledAt ? "text-muted-foreground line-through" : ""}>
                  {fmt(p.paidAt, "dd/MM/yyyy HH:mm")} · {PAYMENT_METHODS[p.method as keyof typeof PAYMENT_METHODS]}
                  {p.reference && ` (${p.reference})`} · {money(p.amountCents)}
                </span>
                {!p.cancelledAt && user?.role !== "SECRETARY" && active && (
                  <Btn variant="ghost" className="h-7 text-xs" onClick={() => api.billing.cancelPayment({ paymentId: p.id }).then(changed).catch(toast.error)}>
                    Annuler
                  </Btn>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {can("billing.write") && active && remaining > 0 && (
        <div className="rounded-xl bg-muted/40 p-3">
          <PaymentForm key={remaining} invoiceId={id} remaining={remaining} onDone={changed} />
        </div>
      )}
      <div className="flex justify-end gap-2">
        {active && user?.role !== "SECRETARY" && (
          <Btn variant="outline" icon={Ban} onClick={() => setCancelling(true)}>
            Annuler la facture
          </Btn>
        )}
        <Btn variant="outline" icon={FileText} onClick={() => generateDocument({ type: "INVOICE", invoiceId: id })}>
          Télécharger le PDF
        </Btn>
      </div>
      {cancelling && (
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            api.billing.cancel({ id, reason }).then(() => { setCancelling(false); changed(); toast.success("Facture annulée"); }).catch(toast.error);
          }}
        >
          <Label label="Motif de l'annulation" className="flex-1">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          </Label>
          <Btn type="submit" variant="danger">
            Confirmer
          </Btn>
        </form>
      )}
    </div>
  );
}

export function InvoicesPage() {
  const { can } = useAuth();
  const [params] = useSearchParams();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(params.get("id"));
  const term = useDebounced(q);
  const pageSize = 15;
  const { data, error, reload } = useLoad(() => api.billing.list({ q: term, status: status || undefined, page, pageSize }), [term, status, page]);
  return (
    <div>
      <PageHeader title="Factures et paiements">
        {can("billing.write") && (
          <Btn icon={Plus} onClick={() => setCreating(true)}>
            Nouvelle facture
          </Btn>
        )}
      </PageHeader>
      <LoadError error={error} />
      <Card>
        <div className="flex gap-2 p-3">
          <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="N° de facture ou patient" />
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-52">
            <option value="">Tous les statuts</option>
            {Object.entries(INVOICE_STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </div>
        <Table head={["N°", "Date", "Patient", "Total", "Payé", "Reste", "Statut"]} empty={data?.rows.length === 0}>
          {data?.rows.map((i) => (
            <tr key={i.id} className="cursor-pointer hover:bg-muted/40" onClick={() => setOpen(i.id)}>
              <Td className="font-medium">{i.number}</Td>
              <Td>{fmt(i.date)}</Td>
              <Td>
                {fullName(i.patient)} <DemoTag show={i.patient.isDemo} />
              </Td>
              <Td className="tabular-nums">{money(i.totalCents)}</Td>
              <Td className="tabular-nums">{money(i.paidCents)}</Td>
              <Td className="tabular-nums">{i.status === "CANCELLED" ? "—" : money(i.totalCents - i.paidCents)}</Td>
              <Td>
                <Tag tone={tone[i.status as Status]}>{INVOICE_STATUS[i.status as Status]}</Tag>
              </Td>
            </tr>
          ))}
        </Table>
        <Pagination page={page} pageSize={pageSize} total={data?.total ?? 0} onChange={setPage} />
      </Card>
      <Modal open={creating} onClose={() => setCreating(false)} title="Nouvelle facture" wide>
        <InvoiceForm onCancel={() => setCreating(false)} onDone={() => { setCreating(false); reload(); }} />
      </Modal>
      <Modal open={open !== null} onClose={() => setOpen(null)} title="Facture" wide>
        {open && <InvoiceDetail id={open} onChanged={reload} />}
      </Modal>
    </div>
  );
}
