import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { addDays, addMonths, addWeeks, endOfMonth, endOfWeek, isSameDay, isSameMonth, startOfDay, startOfMonth, startOfWeek } from "date-fns";
import { ChevronLeft, ChevronRight, Plus, Stethoscope } from "lucide-react";
import { APPOINTMENT_COLORS, APPOINTMENT_STATUS, APPOINTMENT_TYPES, type AppointmentStatus } from "@shared/constants";
import { useDentistOptions, ConsultationForm } from "@/components/clinical-forms";
import { AreaField, Btn, Card, DemoTag, Field, FormActions, Label, LoadError, Modal, PageHeader, PatientPicker, Select, SelectField, useSubmit, useZodForm } from "@/components/kit";
import { useAuth, useLoad, useToast } from "@/hooks";
import { api } from "@/lib/api";
import { combine, dateInput, fmt, fullName, timeInput } from "@/lib/helpers";
import { cn } from "@/lib/utils";
import { z } from "zod";

type View = "day" | "week" | "month";
type Row = Awaited<ReturnType<typeof api.appointments.range>>[number];

const HOUR_START = 8;
const HOUR_END = 20;
const HOUR_PX = 64;
const GRID_MIN = 15;

const formSchema = z.object({ dentistId: z.string().min(1, "Dentiste requis"), day: z.string().min(1, "Date requise"), start: z.string().min(1, "Heure requise"), end: z.string().min(1, "Heure requise"), type: z.string().min(1), reason: z.string().optional(), notes: z.string().optional(), status: z.string() });

function AppointmentForm({ initial, onDone, onCancel, dentists }: { initial: Partial<Row> & { startsAt: Date; endsAt: Date }; onDone(): void; onCancel(): void; dentists: Record<string, string> }) {
  const [who, setWho] = useState(initial.patient ? { id: initial.patient.id, label: fullName(initial.patient) } : null);
  const form = useZodForm(formSchema, { dentistId: initial.dentistId ?? Object.keys(dentists)[0] ?? "", day: dateInput(initial.startsAt), start: timeInput(initial.startsAt), end: timeInput(initial.endsAt), type: initial.type ?? APPOINTMENT_TYPES[0], reason: initial.reason ?? "", notes: initial.notes ?? "", status: initial.status ?? "PENDING" });
  const { busy, submit } = useSubmit(
    async (v: z.output<typeof formSchema>) => {
      if (!who) throw new Error("Choisissez un patient.");
      const body = { patientId: who.id, dentistId: v.dentistId, startsAt: combine(v.day, v.start), endsAt: combine(v.day, v.end), type: v.type, reason: v.reason, notes: v.notes, status: v.status as AppointmentStatus };
      if (initial.id) await api.appointments.update({ ...body, id: initial.id });
      else await api.appointments.create(body);
    },
    "Rendez-vous enregistré",
    onDone,
  );
  return (
    <form onSubmit={form.handleSubmit(submit as never)} className="grid grid-cols-2 gap-3">
      <Label label="Patient" required className="col-span-2">
        <PatientPicker value={who} onChange={setWho} />
      </Label>
      <SelectField form={form} name="dentistId" label="Dentiste" required options={dentists} />
      <Field form={form} name="day" label="Date" type="date" required />
      <Field form={form} name="start" label="Début" type="time" required />
      <Field form={form} name="end" label="Fin" type="time" required />
      <SelectField form={form} name="type" label="Type de consultation" options={APPOINTMENT_TYPES} />
      <SelectField form={form} name="status" label="Statut" options={APPOINTMENT_STATUS} />
      <Field form={form} name="reason" label="Motif" className="col-span-2" />
      <AreaField form={form} name="notes" label="Notes" className="col-span-2" rows={2} />
      <div className="col-span-2">
        <FormActions onCancel={onCancel} busy={busy} />
      </div>
    </form>
  );
}

function Block({ a, onOpen }: { a: Row; onOpen(): void }) {
  const c = APPOINTMENT_COLORS[a.status as AppointmentStatus];
  const start = new Date(a.startsAt);
  const minutes = (start.getHours() - HOUR_START) * 60 + start.getMinutes();
  const duration = (new Date(a.endsAt).getTime() - start.getTime()) / 60_000;
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/plain", a.id)}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      style={{ top: (minutes / 60) * HOUR_PX, height: Math.max((duration / 60) * HOUR_PX - 2, 20) }}
      title={`${fullName(a.patient)} · ${a.type} · ${APPOINTMENT_STATUS[a.status as AppointmentStatus]}`}
      className={cn("absolute inset-x-1 z-10 overflow-hidden rounded-md border-l-[3px] px-1.5 py-0.5 text-left text-xs shadow-sm", c.bg, c.border, c.text, a.status === "CANCELLED" && "line-through opacity-70")}
    >
      <span className="font-semibold">{fmt(a.startsAt, "HH:mm")}</span> {fullName(a.patient)}
    </button>
  );
}

function TimeGrid({ days, rows, onSlot, onOpen, onDrop }: { days: Date[]; rows: Row[]; onSlot(d: Date): void; onOpen(a: Row): void; onDrop(id: string, d: Date): void }) {
  const hours = Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i);
  const at = (day: Date, e: React.MouseEvent | React.DragEvent) => {
    const y = e.clientY - (e.currentTarget as HTMLElement).getBoundingClientRect().top;
    const minutes = Math.floor(((y / HOUR_PX) * 60) / GRID_MIN) * GRID_MIN;
    const d = new Date(day);
    d.setHours(HOUR_START, minutes, 0, 0);
    return d;
  };
  return (
    <div className="overflow-auto" style={{ maxHeight: "calc(100vh - 230px)" }}>
      <div className="sticky top-0 z-20 grid border-b border-border bg-card" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(120px,1fr))` }}>
        <div />
        {days.map((d) => (
          <div key={d.toISOString()} className={cn("py-2 text-center text-sm font-medium capitalize", isSameDay(d, new Date()) && "text-primary")}>
            {fmt(d, days.length === 1 ? "EEEE d MMMM" : "EEE d")}
          </div>
        ))}
      </div>
      <div className="grid" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(120px,1fr))` }}>
        <div>
          {hours.map((h) => (
            <div key={h} style={{ height: HOUR_PX }} className="pr-2 text-right text-xs text-muted-foreground tabular-nums">
              {h}:00
            </div>
          ))}
        </div>
        {days.map((day) => (
          <div key={day.toISOString()} className="relative border-l border-border/70" style={{ height: hours.length * HOUR_PX }} onClick={(e) => onSlot(at(day, e))} onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDrop(e.dataTransfer.getData("text/plain"), at(day, e))}>
            {hours.map((h) => (
              <div key={h} style={{ height: HOUR_PX }} className="border-b border-border/50" />
            ))}
            {rows.filter((a) => isSameDay(new Date(a.startsAt), day)).map((a) => (
              <Block key={a.id} a={a} onOpen={() => onOpen(a)} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function MonthGrid({ cursor, rows, onDay, onOpen }: { cursor: Date; rows: Row[]; onDay(d: Date): void; onOpen(a: Row): void }) {
  const first = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 });
  const last = endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 });
  const days: Date[] = [];
  for (let d = first; d <= last; d = addDays(d, 1)) days.push(d);
  return (
    <div className="grid grid-cols-7">
      {["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map((d) => (
        <div key={d} className="border-b border-border py-2 text-center text-xs font-medium text-muted-foreground">
          {d}
        </div>
      ))}
      {days.map((d) => {
        const list = rows.filter((a) => isSameDay(new Date(a.startsAt), d));
        return (
          <div key={d.toISOString()} className={cn("min-h-24 cursor-pointer border-r border-b border-border/60 p-1", !isSameMonth(d, cursor) && "bg-muted/30 text-muted-foreground")} onClick={() => onDay(d)}>
            <p className={cn("mb-0.5 text-right text-xs", isSameDay(d, new Date()) && "font-bold text-primary")}>{fmt(d, "d")}</p>
            {list.slice(0, 3).map((a) => {
              const c = APPOINTMENT_COLORS[a.status as AppointmentStatus];
              return (
                <button key={a.id} type="button" onClick={(e) => { e.stopPropagation(); onOpen(a); }} className={cn("mb-0.5 block w-full truncate rounded border-l-2 px-1 text-left text-[11px]", c.bg, c.border, c.text)}>
                  {fmt(a.startsAt, "HH:mm")} {a.patient.lastName}
                </button>
              );
            })}
            {list.length > 3 && <p className="text-[11px] text-muted-foreground">+ {list.length - 3}</p>}
          </div>
        );
      })}
    </div>
  );
}

export function AgendaPage() {
  const { can } = useAuth();
  const toast = useToast();
  const [params] = useSearchParams();
  const [view, setView] = useState<View>("week");
  const [cursor, setCursor] = useState(new Date());
  const [dentistId, setDentistId] = useState(params.get("dentist") ?? "");
  const [draft, setDraft] = useState<(Partial<Row> & { startsAt: Date; endsAt: Date }) | null>(null);
  const [selected, setSelected] = useState<Row | null>(null);
  const [consulting, setConsulting] = useState<Row | null>(null);
  const dentists = useDentistOptions();
  const writable = can("appointments.write");

  const { days, from, to } = useMemo(() => {
    if (view === "day") return { days: [startOfDay(cursor)], from: startOfDay(cursor), to: addDays(startOfDay(cursor), 1) };
    if (view === "week") {
      const s = startOfWeek(cursor, { weekStartsOn: 1 });
      return { days: Array.from({ length: 7 }, (_, i) => addDays(s, i)), from: s, to: addDays(s, 7) };
    }
    return { days: [], from: startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 }), to: addDays(endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 }), 1) };
  }, [view, cursor]);

  const { data, error, reload } = useLoad(() => api.appointments.range({ from, to, dentistId: dentistId || undefined }), [from.getTime(), to.getTime(), dentistId]);
  const move = (n: number) => setCursor(view === "day" ? addDays(cursor, n) : view === "week" ? addWeeks(cursor, n) : addMonths(cursor, n));

  const drop = async (id: string, startsAt: Date) => {
    const a = data?.find((x) => x.id === id);
    if (!a || !writable) return;
    const ms = new Date(a.endsAt).getTime() - new Date(a.startsAt).getTime();
    try {
      await api.appointments.update({ id, patientId: a.patientId, dentistId: a.dentistId, startsAt, endsAt: new Date(startsAt.getTime() + ms), type: a.type, reason: a.reason, notes: a.notes, status: a.status as AppointmentStatus });
      toast.success("Rendez-vous déplacé");
      reload();
    } catch (e) {
      toast.error(e);
    }
  };

  const newAt = (d: Date) => writable && setDraft({ startsAt: d, endsAt: new Date(d.getTime() + 30 * 60_000), dentistId: dentistId || undefined });
  const setStatus = async (status: AppointmentStatus) => {
    try {
      await api.appointments.setStatus({ id: selected!.id, status });
      setSelected(null);
      reload();
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <div>
      <PageHeader title="Rendez-vous" subtitle={view === "month" ? fmt(cursor, "MMMM yyyy") : view === "day" ? fmt(cursor, "EEEE d MMMM yyyy") : `Semaine du ${fmt(days[0], "d MMMM yyyy")}`}>
        <Select value={dentistId} onChange={(e) => setDentistId(e.target.value)} className="w-52" aria-label="Filtrer par dentiste">
          <option value="">Tous les dentistes</option>
          {Object.entries(dentists).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        <div className="inline-flex rounded-lg bg-muted p-0.5 text-sm">
          {(["day", "week", "month"] as View[]).map((v) => (
            <button key={v} type="button" onClick={() => setView(v)} className={cn("rounded-md px-3 py-1", view === v && "bg-card font-medium shadow-sm")}>
              {{ day: "Jour", week: "Semaine", month: "Mois" }[v]}
            </button>
          ))}
        </div>
        <Btn variant="outline" icon={ChevronLeft} aria-label="Précédent" onClick={() => move(-1)} />
        <Btn variant="outline" onClick={() => setCursor(new Date())}>
          Aujourd&apos;hui
        </Btn>
        <Btn variant="outline" icon={ChevronRight} aria-label="Suivant" onClick={() => move(1)} />
        {writable && (
          <Btn icon={Plus} onClick={() => { const d = new Date(); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1); newAt(d); }}>
            Nouveau
          </Btn>
        )}
      </PageHeader>
      <LoadError error={error} />
      <div className="mb-2 flex flex-wrap gap-3 text-xs">
        {(Object.entries(APPOINTMENT_STATUS) as [AppointmentStatus, string][]).map(([k, v]) => (
          <span key={k} className="flex items-center gap-1">
            <span className={cn("size-2.5 rounded-sm border-l-2", APPOINTMENT_COLORS[k].bg, APPOINTMENT_COLORS[k].border)} /> {v}
          </span>
        ))}
      </div>
      <Card className="overflow-hidden">
        {view === "month" ? (
          <MonthGrid cursor={cursor} rows={data ?? []} onDay={(d) => { setCursor(d); setView("day"); }} onOpen={setSelected} />
        ) : (
          <TimeGrid days={days} rows={data ?? []} onSlot={newAt} onOpen={setSelected} onDrop={drop} />
        )}
      </Card>

      <Modal open={draft !== null} onClose={() => setDraft(null)} title={draft?.id ? "Modifier le rendez-vous" : "Nouveau rendez-vous"} wide>
        {draft && <AppointmentForm initial={draft} dentists={dentists} onCancel={() => setDraft(null)} onDone={() => { setDraft(null); reload(); }} />}
      </Modal>

      <Modal open={selected !== null} onClose={() => setSelected(null)} title="Rendez-vous">
        {selected && (
          <div className="space-y-3 text-sm">
            <p>
              <Link to={`/patients/${selected.patient.id}`} className="font-semibold hover:text-primary">
                {fullName(selected.patient)}
              </Link>{" "}
              <DemoTag show={selected.patient.isDemo} />
            </p>
            <p className="text-muted-foreground">
              {fmt(selected.startsAt, "EEEE d MMMM · HH:mm")} – {fmt(selected.endsAt, "HH:mm")} · Dr {fullName(selected.dentist)}
            </p>
            <p>
              {selected.type}
              {selected.reason && ` · ${selected.reason}`}
            </p>
            {selected.notes && <p className="text-muted-foreground">{selected.notes}</p>}
            {writable && (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.entries(APPOINTMENT_STATUS) as [AppointmentStatus, string][]).map(([k, v]) => (
                    <Btn key={k} variant={selected.status === k ? "primary" : "outline"} className="h-8 text-xs" onClick={() => setStatus(k)}>
                      {v}
                    </Btn>
                  ))}
                </div>
                <div className="flex justify-end gap-2">
                  {can("consultations.write") && !selected.consultation && (
                    <Btn variant="outline" icon={Stethoscope} onClick={() => { setConsulting(selected); setSelected(null); }}>
                      Saisir la consultation
                    </Btn>
                  )}
                  <Btn onClick={() => { setDraft({ ...selected, startsAt: new Date(selected.startsAt), endsAt: new Date(selected.endsAt) }); setSelected(null); }}>Modifier</Btn>
                </div>
              </>
            )}
          </div>
        )}
      </Modal>

      <Modal open={consulting !== null} onClose={() => setConsulting(null)} title="Consultation" wide>
        {consulting && <ConsultationForm patient={{ id: consulting.patient.id, label: fullName(consulting.patient) }} appointmentId={consulting.id} onCancel={() => setConsulting(null)} onDone={() => { setConsulting(null); reload(); }} />}
      </Modal>
    </div>
  );
}
