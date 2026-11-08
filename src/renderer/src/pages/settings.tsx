import { useState } from "react";
import { DatabaseBackup, FlaskConical, FolderOpen, RotateCcw, Save, Trash2 } from "lucide-react";
import { settingsSchema } from "@shared/schemas";
import { Btn, Card, Confirm, Field, Input, Label, LoadError, PageHeader, SelectField, Table, Td, useSubmit, useZodForm } from "@/components/kit";
import { useAuth, useLoad, useToast } from "@/hooks";
import { api } from "@/lib/api";
import { fmt } from "@/lib/helpers";

function ClinicCard() {
  const { data, error } = useLoad(() => api.settings.get());
  if (!data) return <LoadError error={error} />;
  return <ClinicForm values={data} />;
}

function ClinicForm({ values }: { values: Record<string, unknown> }) {
  const form = useZodForm(settingsSchema, values);
  const { busy, submit } = useSubmit((v: never) => api.settings.save(v), "Paramètres enregistrés");
  return (
    <Card className="p-5">
      <h2 className="mb-3 font-semibold">Cabinet</h2>
      <form onSubmit={form.handleSubmit(submit as never)} className="grid grid-cols-2 gap-3">
        <Field form={form} name="name" label="Nom du cabinet" required className="col-span-2" />
        <Field form={form} name="address" label="Adresse" />
        <Field form={form} name="city" label="Ville" />
        <Field form={form} name="phone" label="Téléphone" />
        <Field form={form} name="email" label="E-mail" />
        <Field form={form} name="ice" label="ICE" />
        <Field form={form} name="inpe" label="INPE" />
        <Field form={form} name="footerNote" label="Mention en bas des documents" className="col-span-2" />
        <SelectField form={form} name="invoiceCancelRole" label="Annulation de facture autorisée à" className="col-span-2" options={{ ADMIN: "Administrateur uniquement", ADMIN_DENTIST: "Administrateur et dentistes" }} />
        <div className="col-span-2 flex justify-end">
          <Btn type="submit" icon={Save} busy={busy}>
            Enregistrer
          </Btn>
        </div>
      </form>
    </Card>
  );
}

function BackupCard() {
  const toast = useToast();
  const { setUser } = useAuth();
  const { data, error, reload } = useLoad(() => api.backup.status());
  const [draft, setDraft] = useState<{ enabled: boolean; hours: number; retention: number } | null>(null);
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [restore, setRestore] = useState<{ path: string } | null>(null);
  const [restoreSecret, setRestoreSecret] = useState("");
  if (!data) return <LoadError error={error} />;
  const v = draft ?? { enabled: data.enabled, hours: data.hours, retention: data.retention };
  const run = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(message);
      setSecret("");
      reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="p-5">
      <h2 className="font-semibold">Sauvegardes chiffrées</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        Chiffrement AES-256 avec votre phrase secrète. <b>Sans cette phrase, une sauvegarde est irrécupérable</b> : conservez-la hors de ce poste. Copiez aussi régulièrement les sauvegardes sur un support externe.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <label className="col-span-2 flex items-center gap-2 text-sm">
          <input type="checkbox" className="accent-primary" checked={v.enabled} onChange={(e) => setDraft({ ...v, enabled: e.target.checked })} /> Sauvegarde automatique
        </label>
        <Label label="Fréquence (heures)">
          <Input type="number" min={1} value={v.hours} onChange={(e) => setDraft({ ...v, hours: Number(e.target.value) })} />
        </Label>
        <Label label="Nombre de sauvegardes conservées">
          <Input type="number" min={1} value={v.retention} onChange={(e) => setDraft({ ...v, retention: Number(e.target.value) })} />
        </Label>
        <Label label={data.hasSecret ? "Phrase secrète (laisser vide pour la conserver)" : "Phrase secrète (12 caractères minimum)"} className="col-span-2">
          <Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="new-password" />
        </Label>
        <div className="col-span-2 flex items-center gap-2 text-sm">
          <span className="min-w-0 flex-1 truncate text-muted-foreground" title={data.directory}>
            Dossier : {data.directory}
          </span>
          <Btn variant="outline" icon={FolderOpen} onClick={async () => { const d = await api.backup.chooseDirectory(); if (d) run(() => api.backup.configure({ ...v, directory: d }), "Dossier modifié"); }}>
            Changer
          </Btn>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Btn variant="outline" icon={RotateCcw} onClick={async () => { const path = await api.backup.chooseFile(); if (path) { setRestoreSecret(""); setRestore({ path }); } }}>
          Restaurer un fichier
        </Btn>
        <Btn variant="outline" busy={busy} onClick={() => run(() => api.backup.configure({ ...v, secret: secret || undefined }), "Configuration enregistrée")}>
          Enregistrer
        </Btn>
        <Btn icon={DatabaseBackup} busy={busy} onClick={() => run(() => api.backup.createNow({ secret: secret || undefined }), "Sauvegarde créée")}>
          Sauvegarder maintenant
        </Btn>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">Dernière sauvegarde automatique : {fmt(data.lastAutoBackupAt, "dd/MM/yyyy HH:mm")}</p>
      {data.files.length > 0 && (
        <div className="mt-3">
          <Table head={["Fichier", "Date", "Taille", ""]}>
            {data.files.slice(0, 10).map((f) => (
              <tr key={f.path}>
                <Td>{f.name}</Td>
                <Td>{fmt(f.createdAt, "dd/MM/yyyy HH:mm")}</Td>
                <Td>{Math.round(f.size / 1024)} Ko</Td>
                <Td className="text-right">
                  <Btn variant="ghost" onClick={() => { setRestoreSecret(""); setRestore({ path: f.path }); }}>
                    Restaurer
                  </Btn>
                </Td>
              </tr>
            ))}
          </Table>
        </div>
      )}
      <Confirm
        open={restore !== null}
        onClose={() => setRestore(null)}
        danger
        title="Restaurer cette sauvegarde ?"
        text="Toutes les données actuelles seront remplacées par celles de la sauvegarde (une copie chiffrée de l'état actuel est conservée). Vous serez déconnecté."
        confirmLabel="Restaurer"
        onConfirm={async () => {
          await api.backup.restore({ path: restore!.path, secret: restoreSecret });
          setUser(null);
        }}
      />
      {restore && (
        <div className="fixed inset-x-0 bottom-6 z-[60] mx-auto w-full max-w-md rounded-xl border border-border bg-card p-3 shadow-xl">
          <Label label="Phrase secrète de cette sauvegarde">
            <Input type="password" value={restoreSecret} onChange={(e) => setRestoreSecret(e.target.value)} autoFocus />
          </Label>
        </div>
      )}
    </Card>
  );
}

function DemoCard() {
  const toast = useToast();
  const { data, reload } = useLoad(() => api.demo.status());
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(message);
      reload();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="p-5">
      <h2 className="font-semibold">Données de démonstration</h2>
      <p className="mb-3 text-sm text-muted-foreground">15 patients, rendez-vous, consultations, factures et stock fictifs. Chaque ligne porte un badge DÉMO. La suppression ne touche pas les vrais dossiers.</p>
      {data && data.patients > 0 ? (
        <Btn variant="outline" icon={Trash2} busy={busy} onClick={() => run(() => api.demo.remove(), "Données de démonstration supprimées")}>
          Supprimer les données de démonstration
        </Btn>
      ) : (
        <Btn variant="outline" icon={FlaskConical} busy={busy} onClick={() => run(() => api.demo.load(), "Données de démonstration chargées")}>
          Charger les données de démonstration
        </Btn>
      )}
    </Card>
  );
}

export function SettingsPage() {
  return (
    <div className="space-y-4">
      <PageHeader title="Paramètres" />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <ClinicCard />
        <div className="space-y-4">
          <BackupCard />
          <DemoCard />
        </div>
      </div>
    </div>
  );
}
