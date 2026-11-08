import { useMemo, useState } from "react";
import { PERMANENT_ARCADES, PRIMARY_ARCADES, TOOTH_COLORS, TOOTH_CONDITIONS, TOOTH_FACES, type ToothCondition, type ToothFace } from "@shared/constants";
import { Btn, Card, LoadError, TextArea, useSubmit } from "@/components/kit";
import { useAuth, useLoad } from "@/hooks";
import { api } from "@/lib/api";
import { fmt } from "@/lib/helpers";
import { cn } from "@/lib/utils";

type Faces = Partial<Record<ToothFace, ToothCondition>>;
type Row = { number: number; condition: string; faces: string; note: string | null };

const WIDTH = 640;
const CENTER = WIDTH / 2;

/** Taille selon le type de dent : le dernier chiffre FDI donne sa position dans l'arcade */
const sizeOf = (n: number) => {
  const pos = n % 10;
  if (n > 50) return pos >= 4 ? 30 : 25;
  return pos >= 6 ? 36 : pos >= 4 ? 31 : 27;
};

/** Répartit les dents sur une demi-ellipse : c'est la forme réelle d'une arcade */
function layout(numbers: number[], arch: "upper" | "lower", rx: number, ry: number, cy: number) {
  return numbers.map((number, i) => {
    const t = Math.PI - (Math.PI * (i + 0.5)) / numbers.length;
    const x = CENTER + rx * Math.cos(t);
    const y = arch === "upper" ? cy - ry * Math.sin(t) : cy + ry * Math.sin(t);
    const angle = arch === "upper" ? 90 - (t * 180) / Math.PI : (t * 180) / Math.PI - 90;
    return { number, x, y, angle };
  });
}

function Tooth({ x, y, angle, number, condition, faces, selected, activeFace, onSelect, onFace }: { x: number; y: number; angle: number; number: number; condition: ToothCondition; faces: Faces; selected: boolean; activeFace: ToothFace | null; onSelect(): void; onFace(f: ToothFace): void }) {
  const s = sizeOf(number);
  const h = s / 2;
  const inner = s / 5;
  const absent = condition === "MISSING" || condition === "EXTRACTED";
  const base = TOOTH_COLORS[condition];
  const fill = (f: ToothFace) => (faces[f] ? TOOTH_COLORS[faces[f]!] : base);
  const parts: [ToothFace, string][] = [
    ["V", `${-h},${-h} ${h},${-h} ${inner},${-inner} ${-inner},${-inner}`],
    ["D", `${h},${-h} ${h},${h} ${inner},${inner} ${inner},${-inner}`],
    ["L", `${h},${h} ${-h},${h} ${-inner},${inner} ${inner},${inner}`],
    ["M", `${-h},${h} ${-h},${-h} ${-inner},${-inner} ${-inner},${inner}`],
  ];
  return (
    <g transform={`translate(${x} ${y}) rotate(${angle})`} role="button" aria-label={`Dent ${number} : ${TOOTH_CONDITIONS[condition]}`} className="cursor-pointer" onClick={onSelect}>
      <rect x={-h - 3} y={-h - 3} width={s + 6} height={s + 6} rx={7} fill="transparent" stroke={selected ? "#2a78d6" : "transparent"} strokeWidth={2} />
      <g opacity={absent ? 0.55 : 1}>
        {parts.map(([f, points]) => (
          <polygon key={f} points={points} fill={fill(f)} stroke={selected && activeFace === f ? "#14315f" : "#94a3b8"} strokeWidth={selected && activeFace === f ? 2 : 1} onClick={(e) => { if (selected) { e.stopPropagation(); onFace(f); } }} />
        ))}
        <rect x={-inner} y={-inner} width={inner * 2} height={inner * 2} fill={fill("O")} stroke={selected && activeFace === "O" ? "#14315f" : "#94a3b8"} strokeWidth={selected && activeFace === "O" ? 2 : 1} onClick={(e) => { if (selected) { e.stopPropagation(); onFace("O"); } }} />
      </g>
      {absent && (
        <g stroke="#475569" strokeWidth={2} pointerEvents="none">
          <line x1={-h} y1={-h} x2={h} y2={h} />
          <line x1={h} y1={-h} x2={-h} y2={h} />
        </g>
      )}
    </g>
  );
}

function Arcades({ arcades, rows, selected, activeFace, onSelect, onFace }: { arcades: { upper: number[]; lower: number[] }; rows: Map<number, Row>; selected: number | null; activeFace: ToothFace | null; onSelect(n: number): void; onFace(f: ToothFace): void }) {
  const primary = arcades.upper.length === 10;
  const rx = primary ? 195 : 265;
  const ry = primary ? 150 : 215;
  const upperY = 255;
  const lowerY = 295;
  const items = [...layout(arcades.upper, "upper", rx, ry, upperY), ...layout(arcades.lower, "lower", rx, ry, lowerY)];
  const labelDistance = 32;
  return (
    <svg viewBox={`0 0 ${WIDTH} 550`} className="mx-auto h-[520px] w-full max-w-[640px] select-none">
      <text x={CENTER} y={upperY - 40} textAnchor="middle" fontSize={13} fill="#64748b">
        Maxillaire
      </text>
      <text x={CENTER} y={lowerY + 50} textAnchor="middle" fontSize={13} fill="#64748b">
        Mandibule
      </text>
      <text x={24} y={275} fontSize={12} fill="#94a3b8">
        Droite
      </text>
      <text x={WIDTH - 24} y={275} textAnchor="end" fontSize={12} fill="#94a3b8">
        Gauche
      </text>
      {items.map((t) => {
        const row = rows.get(t.number);
        const dy = t.y - (t.number < 30 || (t.number > 50 && t.number < 70) ? upperY : lowerY);
        const dx = t.x - CENTER;
        const len = Math.hypot(dx, dy) || 1;
        return (
          <g key={t.number}>
            <Tooth {...t} condition={(row?.condition as ToothCondition) ?? "HEALTHY"} faces={row ? (JSON.parse(row.faces) as Faces) : {}} selected={selected === t.number} activeFace={activeFace} onSelect={() => onSelect(t.number)} onFace={onFace} />
            <text x={t.x + (dx / len) * labelDistance} y={t.y + (dy / len) * labelDistance + 4} textAnchor="middle" fontSize={12} fontWeight={selected === t.number ? 700 : 500} fill={selected === t.number ? "#2a78d6" : "#334155"}>
              {t.number}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function Odontogram({ patientId }: { patientId: string }) {
  const { can } = useAuth();
  const editable = can("odontogram.write");
  const [dentition, setDentition] = useState<"permanent" | "primary">("permanent");
  const { data, error, reload } = useLoad(() => api.odontogram.get({ patientId }), [patientId]);
  const [selected, setSelected] = useState<number | null>(null);
  const history = useLoad(() => api.odontogram.history({ patientId, number: selected ?? undefined }), [patientId, selected]);
  const rows = useMemo(() => new Map((data ?? []).map((t) => [t.number, t as Row])), [data]);

  const [condition, setCondition] = useState<ToothCondition>("HEALTHY");
  const [faces, setFaces] = useState<Faces>({});
  const [face, setFace] = useState<ToothFace | null>(null);
  const [note, setNote] = useState("");

  const select = (n: number) => {
    const row = rows.get(n);
    setSelected(n);
    setCondition((row?.condition as ToothCondition) ?? "HEALTHY");
    setFaces(row ? JSON.parse(row.faces) : {});
    setNote(row?.note ?? "");
    setFace(null);
  };

  const { busy, submit } = useSubmit(
    async () => {
      await api.odontogram.save({ patientId, number: selected!, condition, faces, note });
      await reload();
      await history.reload();
    },
    `Dent ${selected} enregistrée`,
  );

  /** Aperçu immédiat du choix en cours, avant enregistrement */
  const preview = useMemo(() => {
    if (selected === null) return rows;
    const copy = new Map(rows);
    copy.set(selected, { number: selected, condition, faces: JSON.stringify(faces), note });
    return copy;
  }, [rows, selected, condition, faces, note]);

  const apply = (c: ToothCondition) => {
    if (face) setFaces({ ...faces, [face]: c });
    else {
      setCondition(c);
      setFaces({});
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card className="p-4">
        <LoadError error={error} />
        <div className="mb-2 flex items-center justify-between">
          <div className="inline-flex rounded-lg bg-muted p-0.5 text-sm">
            {(["permanent", "primary"] as const).map((d) => (
              <button key={d} type="button" onClick={() => { setDentition(d); setSelected(null); }} className={cn("rounded-md px-3 py-1", dentition === d && "bg-card font-medium shadow-sm")}>
                {d === "permanent" ? "Permanentes (11-48)" : "Temporaires (51-85)"}
              </button>
            ))}
          </div>
          <span className="text-xs text-muted-foreground">Vue praticien : cliquez sur une dent, puis sur une face</span>
        </div>
        <Arcades arcades={dentition === "permanent" ? PERMANENT_ARCADES : PRIMARY_ARCADES} rows={preview} selected={selected} activeFace={face} onSelect={select} onFace={setFace} />
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-border/70 pt-3 text-xs">
          {Object.entries(TOOTH_CONDITIONS).map(([k, v]) => (
            <span key={k} className="flex items-center gap-1.5">
              <span className="size-3 rounded-sm border border-slate-400" style={{ background: TOOTH_COLORS[k as ToothCondition] }} /> {v}
            </span>
          ))}
        </div>
      </Card>
      <div className="space-y-4">
        <Card className="p-4">
          {selected === null ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Sélectionnez une dent sur le schéma.</p>
          ) : (
            <div className="space-y-3">
              <h3 className="font-semibold">Dent {selected}</h3>
              <div>
                <p className="mb-1 text-xs text-muted-foreground">Partie à modifier</p>
                <div className="flex flex-wrap gap-1">
                  <button type="button" onClick={() => setFace(null)} className={cn("rounded-md border px-2 py-1 text-xs", face === null ? "border-primary bg-accent" : "border-border")}>
                    Dent entière
                  </button>
                  {(Object.entries(TOOTH_FACES) as [ToothFace, string][]).map(([k, v]) => (
                    <button key={k} type="button" onClick={() => setFace(k)} className={cn("rounded-md border px-2 py-1 text-xs", face === k ? "border-primary bg-accent" : "border-border")}>
                      {v}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {(Object.entries(TOOTH_CONDITIONS) as [ToothCondition, string][]).map(([k, v]) => {
                  const active = face ? faces[face] === k : condition === k;
                  return (
                    <button key={k} type="button" disabled={!editable} onClick={() => apply(k)} className={cn("flex items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-xs disabled:opacity-60", active ? "border-primary bg-accent font-medium" : "border-border hover:bg-muted")}>
                      <span className="size-3 shrink-0 rounded-sm border border-slate-400" style={{ background: TOOTH_COLORS[k] }} /> {v}
                    </button>
                  );
                })}
              </div>
              <TextArea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note sur cette dent" rows={2} disabled={!editable} />
              {editable && (
                <Btn className="w-full" busy={busy} onClick={() => submit(undefined as never)}>
                  Enregistrer
                </Btn>
              )}
            </div>
          )}
        </Card>
        <Card className="p-4">
          <h3 className="mb-2 text-sm font-semibold">{selected ? `Historique de la dent ${selected}` : "Historique récent"}</h3>
          {history.data?.length === 0 && <p className="text-sm text-muted-foreground">Aucune modification.</p>}
          <ul className="max-h-64 space-y-2 overflow-y-auto text-xs">
            {history.data?.map((h) => (
              <li key={h.id} className="border-l-2 border-border pl-2">
                <p>
                  <b>Dent {h.tooth.number}</b> : {h.previousCondition ? `${TOOTH_CONDITIONS[h.previousCondition as ToothCondition]} → ` : ""}
                  {TOOTH_CONDITIONS[h.condition as ToothCondition]}
                </p>
                <p className="text-muted-foreground">
                  {fmt(h.createdAt, "dd/MM/yyyy HH:mm")} · {h.userName}
                  {h.note && ` · ${h.note}`}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
