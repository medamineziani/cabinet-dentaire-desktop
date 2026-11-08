import { useState } from "react";
import { Card, LoadError, PageHeader, Pagination, SearchBox, Table, Td } from "@/components/kit";
import { useDebounced, useLoad } from "@/hooks";
import { api } from "@/lib/api";
import { fmt } from "@/lib/helpers";

export function AuditPage() {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const term = useDebounced(q);
  const pageSize = 25;
  const { data, error } = useLoad(() => api.audit.list({ q: term, page, pageSize }), [term, page]);
  return (
    <div>
      <PageHeader title="Journal des actions" subtitle="Qui a fait quoi, et quand" />
      <LoadError error={error} />
      <Card>
        <div className="p-3">
          <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Action, utilisateur, détail" />
        </div>
        <Table head={["Date", "Utilisateur", "Action", "Détail"]} empty={data?.rows.length === 0}>
          {data?.rows.map((r) => (
            <tr key={r.id}>
              <Td className="tabular-nums whitespace-nowrap">{fmt(r.createdAt, "dd/MM/yyyy HH:mm:ss")}</Td>
              <Td>{r.userName ?? "Système"}</Td>
              <Td className="font-mono text-xs">{r.action}</Td>
              <Td className="max-w-md truncate text-muted-foreground">{r.details ?? "—"}</Td>
            </tr>
          ))}
        </Table>
        <Pagination page={page} pageSize={pageSize} total={data?.total ?? 0} onChange={setPage} />
      </Card>
    </div>
  );
}
