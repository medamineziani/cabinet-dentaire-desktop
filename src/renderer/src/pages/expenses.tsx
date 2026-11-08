import { useState } from "react";
import { endOfMonth, startOfMonth } from "date-fns";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { TrendingDown, TrendingUp, Scale } from "lucide-react";
import { EXPENSE_CATEGORIES } from "@shared/constants";
import { expenseSchema } from "@shared/schemas";
import { Btn, Card, Confirm, DemoTag, Field, FormActions, Input, LoadError, Modal, PageHeader, Pagination, Select, SelectField, Stat, Table, Td, useSubmit, useZodForm } from "@/components/kit";
import { useAuth, useLoad, useToast } from "@/hooks";
import { api } from "@/lib/api";
import { dateInput, fmt, money } from "@/lib/helpers";

type Row = Awaited<ReturnType<typeof api.expenses.list>>["rows"][number];

function ExpenseForm({ row, onDone, onCancel }: { row?: Row; onDone(): void; onCancel(): void }) {
  const form = useZodForm(expenseSchema, row ? { ...row, amount: row.amountCents / 100, date: dateInput(row.date) } : { date: dateInput(new Date()), category: "MATERIAL" });
  const { busy, submit } = useSubmit((v: object) => api.expenses.save({ ...v, id: row?.id } as never), "Dépense enregistrée", onDone);
  return (
    <form onSubmit={form.handleSubmit(submit as never)} className="grid grid-cols-2 gap-3">
      <Field form={form} name="label" label="Libellé" required className="col-span-2" autoFocus />
      <SelectField form={form} name="category" label="Catégorie" options={EXPENSE_CATEGORIES} />
      <Field form={form} name="date" label="Date" type="date" required />
      <Field form={form} name="amount" label="Montant (MAD)" type="number" step="0.01" min="0" required />
      <Field form={form} name="notes" label="Notes" />
      <div className="col-span-2">
        <FormActions onCancel={onCancel} busy={busy} />
      </div>
    </form>
  );
}

export function ExpensesPage() {
  const { can } = useAuth();
  const toast = useToast();
  const [from, setFrom] = useState(dateInput(startOfMonth(new Date())));
  const [to, setTo] = useState(dateInput(endOfMonth(new Date())));
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Row | "new" | null>(null);
  const [removing, setRemoving] = useState<Row | null>(null);
  const pageSize = 15;
  const range = { from: new Date(`${from}T00:00:00`), to: new Date(new Date(`${to}T00:00:00`).getTime() + 86_400_000) };
  const list = useLoad(() => api.expenses.list({ ...range, category: category || undefined, page, pageSize }), [from, to, category, page]);
  const summary = useLoad(() => api.expenses.summary(range), [from, to]);
  const refresh = () => {
    list.reload();
    summary.reload();
  };
  const writable = can("expenses.write");
  return (
    <div className="space-y-4">
      <PageHeader title="Dépenses" subtitle="Suivi des charges et résultat">
        {writable && (
          <Btn icon={Plus} onClick={() => setEditing("new")}>
            Nouvelle dépense
          </Btn>
        )}
      </PageHeader>
      <LoadError error={list.error} />
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Revenus encaissés" value={money(summary.data?.revenueCents ?? 0)} icon={TrendingUp} />
        <Stat label="Dépenses" value={money(summary.data?.expenseCents ?? 0)} icon={TrendingDown} />
        <Stat label="Résultat" value={money(summary.data?.resultCents ?? 0)} icon={Scale} />
      </div>
      <Card>
        <div className="flex flex-wrap items-center gap-2 p-3 text-sm">
          Du <Input type="date" className="w-40" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} /> au <Input type="date" className="w-40" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
          <Select value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} className="w-48">
            <option value="">Toutes les catégories</option>
            {Object.entries(EXPENSE_CATEGORIES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          <span className="ml-auto font-medium">Total : {money(list.data?.totalCents ?? 0)}</span>
        </div>
        <Table head={["Date", "Libellé", "Catégorie", "Montant", ""]} empty={list.data?.rows.length === 0}>
          {list.data?.rows.map((e) => (
            <tr key={e.id}>
              <Td>{fmt(e.date)}</Td>
              <Td className="font-medium">
                {e.label} <DemoTag show={e.isDemo} />
              </Td>
              <Td>{EXPENSE_CATEGORIES[e.category as keyof typeof EXPENSE_CATEGORIES]}</Td>
              <Td className="tabular-nums">{money(e.amountCents)}</Td>
              <Td className="text-right">
                {writable && <Btn variant="ghost" icon={Pencil} aria-label="Modifier" onClick={() => setEditing(e)} />}
                {can("expenses.delete") && <Btn variant="ghost" icon={Trash2} aria-label="Supprimer" onClick={() => setRemoving(e)} />}
              </Td>
            </tr>
          ))}
        </Table>
        <Pagination page={page} pageSize={pageSize} total={list.data?.total ?? 0} onChange={setPage} />
      </Card>
      <Modal open={editing !== null} onClose={() => setEditing(null)} title="Dépense">
        <ExpenseForm row={editing && editing !== "new" ? editing : undefined} onCancel={() => setEditing(null)} onDone={() => { setEditing(null); refresh(); }} />
      </Modal>
      <Confirm open={removing !== null} onClose={() => setRemoving(null)} danger title="Supprimer cette dépense ?" text={removing?.label ?? ""} confirmLabel="Supprimer" onConfirm={async () => { await api.expenses.remove({ id: removing!.id }); toast.success("Dépense supprimée"); refresh(); }} />
    </div>
  );
}
