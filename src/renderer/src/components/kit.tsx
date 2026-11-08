import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronLeft, ChevronRight, Loader2, Search, type LucideIcon } from "lucide-react";
import { useForm, type UseFormReturn } from "react-hook-form";
import type { z } from "zod";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useDebounced, useToast } from "@/hooks";
import { api } from "@/lib/api";
import { fullName } from "@/lib/helpers";
import { cn } from "@/lib/utils";

const inputClass = "h-10 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none transition-shadow focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:bg-muted/60";

export const Input = (p: ComponentProps<"input">) => <input {...p} className={cn(inputClass, p.className)} />;
export const Select = (p: ComponentProps<"select">) => <select {...p} className={cn(inputClass, p.className)} />;
export const TextArea = (p: ComponentProps<"textarea">) => <textarea rows={3} {...p} className={cn(inputClass, "h-auto py-2", p.className)} />;

type BtnProps = ComponentProps<"button"> & { variant?: "primary" | "outline" | "ghost" | "danger"; icon?: LucideIcon; busy?: boolean };
export function Btn({ variant = "primary", icon: Icon, busy, className, children, disabled, ...rest }: BtnProps) {
  const styles = {
    primary: "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm",
    outline: "border border-border bg-card hover:bg-muted",
    ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
    danger: "bg-red-600 text-white hover:bg-red-700",
  }[variant];
  return (
    <button type="button" {...rest} disabled={disabled || busy} className={cn("inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-3.5 text-sm font-medium whitespace-nowrap transition-colors disabled:opacity-50", styles, className)}>
      {busy ? <Loader2 className="size-4 animate-spin" /> : Icon && <Icon className="size-4" />}
      {children}
    </button>
  );
}

export const Card = ({ className, ...p }: ComponentProps<"section">) => <section {...p} className={cn("rounded-2xl border border-border/80 bg-card shadow-sm", className)} />;

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[#14315f]">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

const tones = {
  slate: "bg-slate-100 text-slate-700",
  blue: "bg-blue-50 text-blue-700",
  green: "bg-emerald-50 text-emerald-700",
  amber: "bg-amber-50 text-amber-800",
  red: "bg-red-50 text-red-700",
  violet: "bg-violet-50 text-violet-700",
};
export const Tag = ({ tone = "slate", children }: { tone?: keyof typeof tones; children: ReactNode }) => <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", tones[tone])}>{children}</span>;
export const DemoTag = ({ show }: { show?: boolean }) => (show ? <Tag tone="amber">DÉMO</Tag> : null);

export function Stat({ label, value, hint, icon: Icon, tone = "text-primary" }: { label: string; value: ReactNode; hint?: string; icon: LucideIcon; tone?: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{label}</p>
        <span className={cn("flex size-8 items-center justify-center rounded-lg bg-accent", tone)}>
          <Icon className="size-4" />
        </span>
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}

export function Modal({ open, onClose, title, description, wide, children }: { open: boolean; onClose(): void; title: string; description?: string; wide?: boolean; children: ReactNode }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn("max-h-[90vh] overflow-y-auto p-5", wide ? "sm:max-w-3xl" : "sm:max-w-lg")}>
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {open && children}
      </DialogContent>
    </Dialog>
  );
}

export function Confirm({ open, onClose, title, text, confirmLabel = "Confirmer", danger, onConfirm }: { open: boolean; onClose(): void; title: string; text: string; confirmLabel?: string; danger?: boolean; onConfirm(): Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p className="text-sm text-muted-foreground">{text}</p>
      <div className="flex justify-end gap-2">
        <Btn variant="outline" onClick={onClose}>
          Annuler
        </Btn>
        <Btn
          variant={danger ? "danger" : "primary"}
          busy={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
              onClose();
            } catch (e) {
              toast.error(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          {confirmLabel}
        </Btn>
      </div>
    </Modal>
  );
}

export function useZodForm(schema: z.ZodType, defaultValues: Record<string, unknown> = {}) {
  return useForm<any>({ resolver: zodResolver(schema as never) as never, defaultValues });
}
type Form = UseFormReturn<any>;

export function Label({ label, error, required, className, children }: { label: string; error?: string; required?: boolean; className?: string; children: ReactNode }) {
  return (
    <label className={cn("block space-y-1", className)}>
      <span className="text-sm font-medium">
        {label}
        {required && <span className="text-red-600"> *</span>}
      </span>
      {children}
      {error && <span className="block text-xs text-red-600">{error}</span>}
    </label>
  );
}

const errorOf = (form: Form, name: string) => form.formState.errors[name]?.message as string | undefined;

type FieldProps = { form: Form; name: string; label: string; required?: boolean; className?: string };
export const Field = ({ form, name, label, required, className, ...rest }: FieldProps & Omit<ComponentProps<"input">, "form">) => (
  <Label label={label} required={required} error={errorOf(form, name)} className={className}>
    <Input {...rest} {...form.register(name)} />
  </Label>
);
export const AreaField = ({ form, name, label, required, className, ...rest }: FieldProps & Omit<ComponentProps<"textarea">, "form">) => (
  <Label label={label} required={required} error={errorOf(form, name)} className={className}>
    <TextArea {...rest} {...form.register(name)} />
  </Label>
);
export const SelectField = ({ form, name, label, required, className, options, empty }: FieldProps & { options: Record<string, string> | string[]; empty?: string }) => (
  <Label label={label} required={required} error={errorOf(form, name)} className={className}>
    <Select {...form.register(name)}>
      {empty !== undefined && <option value="">{empty}</option>}
      {(Array.isArray(options) ? options.map((o) => [o, o]) : Object.entries(options)).map(([k, v]) => (
        <option key={k} value={k}>
          {v}
        </option>
      ))}
    </Select>
  </Label>
);

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange(v: string): void; placeholder: string }) {
  return (
    <div className="relative w-72">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="pl-9" />
    </div>
  );
}

export function Pagination({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange(p: number): void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between border-t border-border/70 px-4 py-2.5 text-sm text-muted-foreground">
      <span>
        {total} résultat{total > 1 ? "s" : ""}
      </span>
      <div className="flex items-center gap-2">
        <Btn variant="ghost" icon={ChevronLeft} disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="Page précédente" />
        <span className="tabular-nums">
          {page} / {pages}
        </span>
        <Btn variant="ghost" icon={ChevronRight} disabled={page >= pages} onClick={() => onChange(page + 1)} aria-label="Page suivante" />
      </div>
    </div>
  );
}

export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/70 text-left text-xs text-muted-foreground">
            {head.map((h, i) => (
              <th key={i} className="px-4 py-2.5 font-medium whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">{children}</tbody>
      </table>
      {empty && <p className="px-4 py-12 text-center text-sm text-muted-foreground">Aucun résultat.</p>}
    </div>
  );
}
export const Td = ({ className, ...p }: ComponentProps<"td">) => <td {...p} className={cn("px-4 py-2.5", className)} />;

export const LoadError = ({ error }: { error: string | null }) => (error ? <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null);

/** Choix d'un patient par recherche */
export function PatientPicker({ value, onChange, error }: { value: { id: string; label: string } | null; onChange(v: { id: string; label: string } | null): void; error?: string }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Awaited<ReturnType<typeof api.patients.search>>>([]);
  const term = useDebounced(q);
  const ref = useRef(0);
  useEffect(() => {
    const mine = ++ref.current;
    api.patients.search({ q: term }).then((r) => mine === ref.current && setResults(r));
  }, [term]);

  if (value) {
    return (
      <div className="flex h-10 items-center justify-between rounded-lg border border-input bg-muted/40 px-3 text-sm">
        <span className="font-medium">{value.label}</span>
        <button type="button" className="text-xs text-primary hover:underline" onClick={() => onChange(null)}>
          Changer
        </button>
      </div>
    );
  }
  return (
    <div>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom, téléphone ou n° de dossier" autoFocus />
      {q && results.length > 0 && (
        <ul className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-border bg-card p-1 shadow-md">
          {results.map((p) => (
            <li key={p.id}>
              <button type="button" className="flex w-full justify-between rounded-md px-3 py-1.5 text-left text-sm hover:bg-muted" onClick={() => onChange({ id: p.id, label: fullName(p) })}>
                <span>
                  {fullName(p)} {p.isDemo && <Tag tone="amber">DÉMO</Tag>}
                </span>
                <span className="text-xs text-muted-foreground">{p.fileNumber}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <span className="block text-xs text-red-600">{error}</span>}
    </div>
  );
}

export function FormActions({ onCancel, busy, label = "Enregistrer" }: { onCancel(): void; busy?: boolean; label?: string }) {
  return (
    <div className="flex justify-end gap-2 pt-1">
      <Btn variant="outline" onClick={onCancel}>
        Annuler
      </Btn>
      <Btn type="submit" busy={busy}>
        {label}
      </Btn>
    </div>
  );
}

export function useSubmit<T>(run: (values: T) => Promise<unknown>, message: string, done?: () => void) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return {
    busy,
    submit: async (values: T) => {
      setBusy(true);
      try {
        await run(values);
        toast.success(message);
        done?.();
      } catch (e) {
        toast.error(e);
      } finally {
        setBusy(false);
      }
    },
  };
}
