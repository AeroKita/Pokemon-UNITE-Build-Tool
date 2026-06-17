import { useMemo, useState, type ReactNode } from "react";
import { asset } from "../ui/asset";
import { EMBLEM_COLOR_HEX, EMBLEM_GRADE_HEX, readableTextColor } from "../ui/colors";
import { useModalDismiss } from "../ui/useModalDismiss";
import type { EmblemColor, EmblemGrade } from "../types";

export interface PickItem {
  id: string;
  name: string;
  icon: string;
  subtitle?: string;
  title?: string; // hover tooltip (e.g. item description)
  colors?: EmblemColor[];
}

const GRADES: EmblemGrade[] = ["bronze", "silver", "gold"];

interface Props {
  title: string;
  items: PickItem[];
  onPick: (id: string, grade?: EmblemGrade) => void;
  onClose: () => void;
  filters?: { label: string; predicate: (id: string) => boolean; activeColor?: string }[];
  grades?: boolean; // show a Bronze/Silver/Gold toggle (emblems)
  owned?: Set<string>; // keys are `${id}:${grade}`; enables ownership stars + "Owned only"
  onToggleOwn?: (id: string, grade: EmblemGrade) => void;
  iconForGrade?: (id: string, grade: EmblemGrade) => string; // grade-correct image (emblems)
  goldOnlyIds?: Set<string>; // hide from silver/bronze pickers (UNITE-DB gold-only emblems)
  footer?: ReactNode;
}

export function PickerModal({ title, items, onPick, onClose, filters, grades, owned, onToggleOwn, iconForGrade, goldOnlyIds }: Props) {
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [ownedOnly, setOwnedOnly] = useState(false);
  const [grade, setGrade] = useState<EmblemGrade>("gold");

  useModalDismiss(onClose);

  const isOwned = (id: string) => owned?.has(grades ? `${id}:${grade}` : id);

  const shown = useMemo(() => {
    const f = filters?.find((x) => x.label === activeFilter);
    return items.filter(
      (it) =>
        it.name.toLowerCase().includes(query.toLowerCase()) &&
        (!f || f.predicate(it.id)) &&
        (!ownedOnly || isOwned(it.id)) &&
        (!grades || grade === "gold" || !goldOnlyIds?.has(it.id)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, query, activeFilter, filters, ownedOnly, owned, grade, goldOnlyIds]);

  const ownedCount = owned ? (grades ? [...owned].filter((k) => k.endsWith(`:${grade}`)).length : owned.size) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-2xl bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-ink">{title}</h2>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-faint hover:bg-raise">✕</button>
        </div>
        <input
          autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          className="mb-3 rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-accent"
        />
        {grades && (
          <div className="mb-3 flex items-center gap-2">
            <span className="text-xs font-medium text-muted">Grade</span>
            <div className="flex gap-1 rounded-lg bg-raise p-0.5">
              {GRADES.map((g) => (
                <button
                  key={g}
                  onClick={() => setGrade(g)}
                  style={grade === g ? { background: EMBLEM_GRADE_HEX[g], color: readableTextColor(EMBLEM_GRADE_HEX[g]) } : undefined}
                  className={`rounded-md px-3 py-1 text-xs font-semibold capitalize transition ${
                    grade === g ? "shadow-sm" : "text-muted hover:text-ink"
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>
        )}
        {(filters || owned) && (
          <div className="mb-3 flex flex-wrap gap-1">
            <FilterChip label="All" active={activeFilter === null && !ownedOnly} onClick={() => { setActiveFilter(null); setOwnedOnly(false); }} />
            {owned && <FilterChip label={`★ Owned (${ownedCount})`} active={ownedOnly} onClick={() => setOwnedOnly((v) => !v)} />}
            {filters?.map((f) => (
              <FilterChip key={f.label} label={f.label} active={activeFilter === f.label} activeColor={f.activeColor} onClick={() => setActiveFilter(f.label)} />
            ))}
          </div>
        )}
        <div className="grid grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
          {shown.map((it) => {
            const ownedHere = isOwned(it.id);
            return (
              <button
                key={it.id}
                onClick={() => { onPick(it.id, grades ? grade : undefined); onClose(); }}
                title={it.title ?? it.name}
                className={`relative flex flex-col items-center gap-1 rounded-xl border p-2 text-center hover:border-accent hover:bg-accent-weak ${
                  ownedHere ? "border-as-border bg-as-bg" : "border-line"
                }`}
              >
                {it.colors && it.colors.length > 0 && (
                  <span className="absolute -left-1 -top-1 flex gap-0.5">
                    {it.colors.map((c) => (
                      <span key={c} className="h-2 w-2 rounded-full ring-1 ring-white"
                        style={{ background: EMBLEM_COLOR_HEX[c] }} />
                    ))}
                  </span>
                )}
                {onToggleOwn && (
                  <span
                    role="button"
                    title={ownedHere ? `Owned (${grade}) — click to unmark` : `Mark ${grade} as owned`}
                    onClick={(e) => { e.stopPropagation(); onToggleOwn(it.id, grade); }}
                    className={`absolute right-1 top-1 text-sm leading-none ${ownedHere ? "text-as-ink" : "text-faint hover:text-as-ink"}`}
                  >
                    ★
                  </span>
                )}
                <img src={asset(grades && iconForGrade ? iconForGrade(it.id, grade) : it.icon)} alt={it.name} loading="lazy" className="h-12 w-12 object-contain" />
                <span className="text-xs font-medium leading-tight text-ink">{it.name}</span>
                {it.subtitle && <span className="text-[10px] text-faint">{it.subtitle}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function FilterChip({ label, active, onClick, activeColor }:
  { label: string; active: boolean; onClick: () => void; activeColor?: string }) {
  const style = active && activeColor
    ? { background: activeColor, color: readableTextColor(activeColor) } : undefined;
  return (
    <button onClick={onClick} style={style}
      className={`rounded-full border px-3 py-1 text-xs font-medium capitalize ${
        active
          ? activeColor ? "border-line" : "border-transparent bg-accent text-white"
          : "border-transparent bg-raise text-muted hover:bg-raise"
      }`}>
      {label}
    </button>
  );
}
