import { PITCH_CONFIG } from "@/lib/constants";
import type { PitchType } from "@/types";

/**
 * Career arsenal strip (wave 8): one stacked bar per season, each segment a
 * pitch type in its site colour, width = usage share. The read a coach wants
 * from it is the CHANGE across seasons — which pitch grew, which one
 * disappeared — so the seasons sit side by side in order and each type keeps
 * its colour the whole way down. Server-rendered; the numbers come from the
 * career file's per-season mixes.
 */

const colorOf = (t: string) => PITCH_CONFIG[t as PitchType]?.color ?? "#8C9591";

export function CareerArsenal({ seasons }: { seasons: { s: number; usage: Record<string, number>; ip?: number }[] | null }) {
  const rows = (seasons ?? []).filter((s) => s.usage && Object.keys(s.usage).length);
  if (rows.length < 1) return null;
  const types = [...new Set(rows.flatMap((s) => Object.keys(s.usage)))]
    .sort((a, b) => Math.max(...rows.map((s) => s.usage[b] ?? 0)) - Math.max(...rows.map((s) => s.usage[a] ?? 0)));

  // The read: which type gained or lost the most between his first and last season here.
  let change: { t: string; d: number } | null = null;
  if (rows.length >= 2) {
    const first = rows[0], last = rows[rows.length - 1];
    for (const t of types) {
      const d = (last.usage[t] ?? 0) - (first.usage[t] ?? 0);
      if (!change || Math.abs(d) > Math.abs(change.d)) change = { t, d };
    }
  }

  return (
    <div className="glass-panel p-4">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">Arsenal by season</h2>
        <span className="text-[10px] text-text-dim">share of pitches · this level</span>
      </div>
      <div className="space-y-2">
        {rows.map((s) => (
          <div key={s.s} className="flex items-center gap-3">
            <span className="w-10 text-xs font-data text-text-secondary text-right">{s.s}</span>
            <div className="flex-1 h-[16px] rounded overflow-hidden flex" title={Object.entries(s.usage).map(([t, v]) => `${t} ${v}%`).join(" · ")}>
              {Object.entries(s.usage).sort((a, b) => b[1] - a[1]).map(([t, v]) => (
                <div key={t} style={{ width: `${v}%`, background: colorOf(t), opacity: 0.85 }}>
                  {v >= 12 ? (
                    <span className="text-[9px] font-data text-black/75 pl-1 leading-[16px] block">{t}</span>
                  ) : null}
                </div>
              ))}
            </div>
            <span className="w-16 text-[10px] font-data text-text-dim">{s.ip != null ? `${s.ip} IP` : ""}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3 mt-3">
        {types.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 text-[9px] text-text-dim font-data">
            <span className="w-2 h-2 rounded-sm" style={{ background: colorOf(t) }} />{t}
          </span>
        ))}
      </div>
      {change && Math.abs(change.d) >= 5 && (
        <p className="mt-2.5 text-xs leading-relaxed text-text-secondary">
          Biggest shift across these seasons: <span className="font-data">{change.t}</span>{" "}
          {change.d > 0 ? "up" : "down"} {Math.abs(change.d).toFixed(0)} points of usage, first season to last.
        </p>
      )}
    </div>
  );
}
