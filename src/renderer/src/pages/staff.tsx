import { useState } from "react";
import { KeyRound, Pencil, UserPlus } from "lucide-react";
import { z } from "zod";
import { ROLES, type Role } from "@shared/constants";
import { passwordRule, userCreateSchema, userUpdateSchema } from "@shared/schemas";
import { Btn, Card, Field, FormActions, LoadError, Modal, PageHeader, SelectField, Table, Tag, Td, useSubmit, useZodForm } from "@/components/kit";
import { useLoad } from "@/hooks";
import { api } from "@/lib/api";
import { fmt } from "@/lib/helpers";

type Row = Awaited<ReturnType<typeof api.users.list>>[number];

function UserForm({ row, onDone, onCancel }: { row?: Row; onDone(): void; onCancel(): void }) {
  const form = useZodForm(row ? userUpdateSchema : userCreateSchema, row ?? { role: "SECRETARY" });
  const { busy, submit } = useSubmit((v: never) => (row ? api.users.update(v) : api.users.create(v)), "Utilisateur enregistré", onDone);
  return (
    <form onSubmit={form.handleSubmit(submit as never)} className="grid grid-cols-2 gap-3">
      <Field form={form} name="lastName" label="Nom" required autoFocus />
      <Field form={form} name="firstName" label="Prénom" required />
      <Field form={form} name="username" label="Identifiant" required />
      <SelectField form={form} name="role" label="Rôle" options={ROLES} />
      <Field form={form} name="phone" label="Téléphone" />
      <Field form={form} name="email" label="E-mail" />
      {!row && <Field form={form} name="password" label="Mot de passe provisoire (à changer à la 1re connexion)" type="password" required className="col-span-2" />}
      {row && (
        <label className="col-span-2 flex items-center gap-2 text-sm">
          <input type="checkbox" className="accent-primary" {...form.register("active")} /> Compte actif
        </label>
      )}
      <div className="col-span-2">
        <FormActions onCancel={onCancel} busy={busy} />
      </div>
    </form>
  );
}

const resetSchema = z.object({ password: passwordRule });
function ResetForm({ row, onDone, onCancel }: { row: Row; onDone(): void; onCancel(): void }) {
  const form = useZodForm(resetSchema);
  const { busy, submit } = useSubmit((v: { password: string }) => api.users.resetPassword({ id: row.id, password: v.password }), "Mot de passe réinitialisé", onDone);
  return (
    <form onSubmit={form.handleSubmit(submit as never)} className="space-y-3">
      <Field form={form} name="password" label="Nouveau mot de passe provisoire" type="password" required autoFocus />
      <FormActions onCancel={onCancel} busy={busy} />
    </form>
  );
}

export function StaffPage() {
  const { data, error, reload } = useLoad(() => api.users.list());
  const [editing, setEditing] = useState<Row | "new" | null>(null);
  const [resetting, setResetting] = useState<Row | null>(null);
  return (
    <div>
      <PageHeader title="Personnel" subtitle="Comptes et rôles">
        <Btn icon={UserPlus} onClick={() => setEditing("new")}>
          Nouvel utilisateur
        </Btn>
      </PageHeader>
      <LoadError error={error} />
      <Card>
        <Table head={["Nom", "Identifiant", "Rôle", "Téléphone", "Dernière connexion", "État", ""]} empty={data?.length === 0}>
          {data?.map((u) => (
            <tr key={u.id}>
              <Td className="font-medium">
                {u.lastName} {u.firstName}
              </Td>
              <Td>{u.username}</Td>
              <Td>
                <Tag tone="blue">{ROLES[u.role as Role]}</Tag>
              </Td>
              <Td>{u.phone ?? "—"}</Td>
              <Td>{fmt(u.lastLoginAt, "dd/MM/yyyy HH:mm")}</Td>
              <Td>{u.active ? <Tag tone="green">Actif</Tag> : <Tag>Désactivé</Tag>}</Td>
              <Td className="text-right">
                <Btn variant="ghost" icon={KeyRound} aria-label="Réinitialiser le mot de passe" onClick={() => setResetting(u)} />
                <Btn variant="ghost" icon={Pencil} aria-label="Modifier" onClick={() => setEditing(u)} />
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
      <Modal open={editing !== null} onClose={() => setEditing(null)} title="Utilisateur" wide>
        <UserForm row={editing && editing !== "new" ? editing : undefined} onCancel={() => setEditing(null)} onDone={() => { setEditing(null); reload(); }} />
      </Modal>
      <Modal open={resetting !== null} onClose={() => setResetting(null)} title="Réinitialiser le mot de passe">
        {resetting && <ResetForm row={resetting} onCancel={() => setResetting(null)} onDone={() => setResetting(null)} />}
      </Modal>
    </div>
  );
}
