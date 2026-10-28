"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  decodeFilters, encodeFilters, filterMeta, isSet,
  type ActiveFilter, type FilterColumn, type FilterMeta,
} from "@/lib/column-filters";

/**
 * "+ Add filter": any column the board displays, grouped as the board groups
 * them. Number columns get min/max (both optional), text columns a pick-list.
 * Active filters sit as chips; click one to edit, ✕ to remove.
 */

/** Filters kept in the page URL (`?f=`), so a filtered board can be shared or reloaded. */
export function useUrlFilters(param = "f"): [ActiveFilter[], (next: ActiveFilter[]) => void] {
  const [active, setActive] = useState<ActiveFilter[]>([]);
  useEffect(() => {
    // Behind a timer, not in the effect body: the URL is browser-only.
    const t = setTimeout(() => setActive(decodeFilters(new URLSearchParams(window.location.search).get(param))), 0);
    return () => clearTimeout(t);
  }, [param]);
  const update = (next: ActiveFilter[]) => {
    setActive(next);
    const url = new URL(window.location.href);
    const enc = encodeFilters(next);
    if (enc) url.searchParams.set(param, enc); else url.searchParams.delete(param);
    window.history.replaceState(window.history.state, "", url.toString());
  };
  return [active, update];
}

/** One string in the URL query (`?key=value`), read on mount and written with replaceState, so Back restores it and the
 * view can be shared. The default value is kept out of the URL. Same timing rule as useUrlFilters. */
export function useUrlState(key: string, initial: string): [string, (next: string) => void] {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    const t = setTimeout(() => { const v = new URLSearchParams(window.location.search).get(key); if (v !== null) setValue(v); }, 0);
    return () => clearTimeout(t);
  }, [key]);
  const update = (next: string) => {
    setValue(next);
    const url = new URL(window.location.href);
    if (next === initial) url.searchParams.delete(key); else url.searchParams.set(key, next);
    window.history.replaceState(window.history.state, "", url.toString());
  };
  return [value, update];
}

function fmt(v: number) {
  return Math.abs(v) >= 100 || Number.isInteger(v) ? String(Math.round(v * 10) / 10) : v.toFixed(Math.abs(v) < 1 ? 3 : 1);
}

function summary(f: ActiveFilter, label: string): string {
  if (f.values?.length) return `${label}: ${f.values.length > 3 ? `${f.values.slice(0, 3).join(", ")} +${f.values.length - 3}` : f.values.join(", ")}`;
  if (f.min !== undefined && f.max !== undefined) return `${label} ${fmt(f.min)}–${fmt(f.max)}`;
  if (f.min !== undefined) return `${label} ≥ ${fmt(f.min)}`;
  if (f.max !== undefined) return `${label} ≤ ${fmt(f.max)}`;
  return `${label}: any`;
}

/**
 * Give it `meta` (lib/column-filters filterMeta, computed on the server) when the
 * board pages server-side and never holds its rows; `rows` still works for the
 * boards that do, and derives the same meta here.
 */
export function FilterBuilder<T extends object>({ rows, meta, columns, active, onChange }: {
  rows?: T[]; meta?: FilterMeta; columns: FilterColumn[]; active: ActiveFilter[]; onChange: (next: ActiveFilter[]) => void;
}) {
  const m = useMemo(() => meta ?? filterMeta(rows ?? [], columns), [meta, rows, columns]);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  // Only columns the data can actually filter (numbers, or a short list of text values).
  const usable = useMemo(() => columns
    .filter((c) => m[c.key])
    .map((c) => ({ c })), [columns, m]);
  const groups = useMemo(() => {
    const m = new Map<string, typeof usable>();
    for (const u of usable) (m.get(u.c.group) ?? m.set(u.c.group, []).get(u.c.group)!).push(u);
    return [...m.entries()];
  }, [usable]);

  useEffect(() => {
    if (!adding && !editing) return;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) { setAdding(false); setEditing(null); } };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [adding, editing]);

  const set = (key: string, patch: Partial<ActiveFilter> | null) => {
    if (patch === null) { onChange(active.filter((f) => f.key !== key)); return; }
    const exists = active.some((f) => f.key === key);
    onChange(exists ? active.map((f) => (f.key === key ? { ...f, ...patch, key } : f)) : [...active, { key, ...patch }]);
  };
  const colOf = (key: string) => usable.find((u) => u.c.key === key);

  return (
    <div ref={box} className="relative flex flex-wrap items-center gap-1.5">
      {active.map((f) => {
        const u = colOf(f.key);
        if (!u) return null;
        return (
          <span key={f.key} className="relative">
            <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] ${isSet(f) ? "filter-chip-active" : "border-border-subtle text-text-dim"}`}>
              <button type="button" onClick={() => { setEditing(editing === f.key ? null : f.key); setAdding(false); }} className="hover:underline">
                {summary(f, u.c.label)}
              </button>
              <button type="button" aria-label={`Remove ${u.c.label} filter`} onClick={() => set(f.key, null)} className="text-text-dim hover:text-text-primary">✕</button>
            </span>
            {editing === f.key && (
              <Editor meta={m[u.c.key]} col={u.c} f={f} onPatch={(p) => set(f.key, p)} onDone={() => setEditing(null)} />
            )}
          </span>
        );
      })}

      <button type="button" onClick={() => { setAdding(!adding); setEditing(null); }}
              className="rounded-full border border-dashed border-border-subtle px-3 py-1 text-[11px] text-text-secondary hover:text-text-primary press-scale nav-glow">
        + Add filter
      </button>
      {active.length > 0 && (
        <button type="button" onClick={() => onChange([])} className="text-[10px] text-text-dim underline">clear filters</button>
      )}

      {adding && (
        <div className="absolute left-0 top-full z-50 mt-2 max-h-[60vh] w-[min(560px,90vw)] overflow-y-auto glass-panel p-3 shadow-[0_8px_40px_rgba(0,0,0,0.5)]">
          {groups.map(([g, cols]) => (
            <div key={g} className="mb-2">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-text-dim">{g}</div>
              <div className="flex flex-wrap gap-1">
                {cols.map(({ c }) => {
                  const on = active.some((f) => f.key === c.key);
                  return (
                    <button key={c.key} type="button" disabled={on}
                            onClick={() => { set(c.key, {}); setAdding(false); setEditing(c.key); }}
                            className="rounded border border-border-subtle px-2 py-0.5 text-[11px] text-text-secondary hover:bg-white/[0.06] hover:text-text-primary disabled:opacity-40">
                      {c.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Editor({ meta, col, f, onPatch, onDone }: {
  meta: FilterMeta[string]; col: FilterColumn; f: ActiveFilter;
  onPatch: (p: Partial<ActiveFilter>) => void; onDone: () => void;
}) {
  const [q, setQ] = useState("");
  const panel = "absolute left-0 top-full z-50 mt-2 w-[260px] glass-panel p-3 shadow-[0_8px_40px_rgba(0,0,0,0.5)] space-y-2";
  if (meta.kind === "number") {
    const r = meta.range;
    const num = (s: string) => (s.trim() === "" || !Number.isFinite(Number(s)) ? undefined : Number(s));
    const input = "w-full rounded bg-white/[0.05] border border-border-subtle px-2 py-1 text-xs font-data";
    return (
      <div className={panel}>
        <div className="text-[10px] uppercase tracking-wider text-text-dim">{col.label}</div>
        <div className="flex items-center gap-2">
          <input aria-label={`${col.label} minimum`} type="number" inputMode="decimal" defaultValue={f.min ?? ""} placeholder={r ? `min ${fmt(r.min)}` : "min"}
                 onChange={(e) => onPatch({ min: num(e.target.value) })} className={input} autoFocus />
          <span className="text-text-dim">–</span>
          <input aria-label={`${col.label} maximum`} type="number" inputMode="decimal" defaultValue={f.max ?? ""} placeholder={r ? `max ${fmt(r.max)}` : "max"}
                 onChange={(e) => onPatch({ max: num(e.target.value) })} className={input} />
        </div>
        {r && <div className="text-[10px] text-text-dim">On this board: {fmt(r.min)} to {fmt(r.max)}. Leave a side empty for no limit.</div>}
        <button type="button" onClick={onDone} className="text-[11px] text-usf-gold">Done</button>
      </div>
    );
  }
  const all = meta.categories.filter((v) => v.toLowerCase().includes(q.toLowerCase()));
  const chosen = new Set(f.values ?? []);
  return (
    <div className={panel}>
      <div className="text-[10px] uppercase tracking-wider text-text-dim">{col.label}</div>
      {meta.categories.length > 10 && (
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="search…" autoFocus
               className="w-full rounded bg-white/[0.05] border border-border-subtle px-2 py-1 text-xs" />
      )}
      <div className="max-h-56 overflow-y-auto space-y-0.5">
        {all.map((v) => (
          <label key={v} className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
            <input type="checkbox" checked={chosen.has(v)} className="accent-[var(--color-usf-gold)]"
                   onChange={(e) => {
                     const next = new Set(chosen);
                     if (e.target.checked) next.add(v); else next.delete(v);
                     onPatch({ values: [...next] });
                   }} />
            {v}
          </label>
        ))}
      </div>
      <button type="button" onClick={onDone} className="text-[11px] text-usf-gold">Done</button>
    </div>
  );
}
