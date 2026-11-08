import type { ReactNode } from "react";
import { ClipboardList } from "lucide-react";
import { changePasswordSchema, loginSchema, setupSchema } from "@shared/schemas";
import { Btn, Field, useSubmit, useZodForm } from "@/components/kit";
import { useAuth, type CurrentUser } from "@/hooks";
import { api } from "@/lib/api";

function Shell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#14315f] to-[#2a78d6] p-6">
      <div className="w-full max-w-md rounded-3xl bg-card p-8 shadow-2xl">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-accent text-primary">
          <ClipboardList className="size-6" />
        </span>
        <h1 className="mt-4 text-xl font-semibold">{title}</h1>
        <p className="mt-1 mb-5 text-sm text-muted-foreground">{subtitle}</p>
        {children}
      </div>
    </div>
  );
}

export function LoginScreen() {
  const { setUser } = useAuth();
  const form = useZodForm(loginSchema);
  const { busy, submit } = useSubmit(async (v: never) => setUser((await api.auth.login(v)) as CurrentUser), "Connexion réussie");
  return (
    <Shell title="Connexion" subtitle="Accédez au logiciel du cabinet.">
      <form onSubmit={form.handleSubmit(submit as never)} className="space-y-3">
        <Field form={form} name="username" label="Identifiant" autoFocus autoComplete="username" />
        <Field form={form} name="password" label="Mot de passe" type="password" autoComplete="current-password" />
        <Btn type="submit" busy={busy} className="h-11 w-full">
          Se connecter
        </Btn>
      </form>
    </Shell>
  );
}

export function SetupScreen() {
  const { setUser } = useAuth();
  const form = useZodForm(setupSchema);
  const { busy, submit } = useSubmit(async (v: never) => setUser((await api.auth.setup(v)) as CurrentUser), "Application configurée");
  return (
    <Shell title="Première configuration" subtitle="Créez le compte administrateur. Aucun compte par défaut n'existe : conservez ce mot de passe.">
      <form onSubmit={form.handleSubmit(submit as never)} className="space-y-3">
        <Field form={form} name="clinicName" label="Nom du cabinet" required autoFocus />
        <div className="grid grid-cols-2 gap-3">
          <Field form={form} name="firstName" label="Prénom" required />
          <Field form={form} name="lastName" label="Nom" required />
        </div>
        <Field form={form} name="username" label="Identifiant" required />
        <Field form={form} name="password" label="Mot de passe (10 caractères, lettres et chiffres)" type="password" required />
        <Btn type="submit" busy={busy} className="h-11 w-full">
          Créer le compte et commencer
        </Btn>
      </form>
    </Shell>
  );
}

export function ChangePasswordScreen() {
  const { setUser } = useAuth();
  const form = useZodForm(changePasswordSchema);
  const { busy, submit } = useSubmit(async (v: never) => setUser((await api.auth.changePassword(v)) as CurrentUser), "Mot de passe modifié");
  return (
    <Shell title="Nouveau mot de passe" subtitle="Votre mot de passe est provisoire : choisissez-en un personnel pour continuer.">
      <form onSubmit={form.handleSubmit(submit as never)} className="space-y-3">
        <Field form={form} name="currentPassword" label="Mot de passe provisoire" type="password" autoFocus />
        <Field form={form} name="newPassword" label="Nouveau mot de passe (10 caractères, lettres et chiffres)" type="password" />
        <Btn type="submit" busy={busy} className="h-11 w-full">
          Valider
        </Btn>
      </form>
    </Shell>
  );
}
