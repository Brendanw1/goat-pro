"use client";

/**
 * Hitter scouting card (H10) + skill grades (H9), wave 3. The zone grid is
 * where he swings and what happens there, from his point of view; the count
 * rows are his approach by situation. The 20-80 estimates are computed in
 * the bake from this season's percentiles (rank -> normal z -> 50+10z,
 * rounded to 5) — labelled estimates, never a model output, and nothing
 * here predicts next season.
 */
import { Fragment, useMemo } from "react";

const ROWS = ["above", "high", "mid", "low", "below"] as const;
const COLS = ["inside", "center", "away"] as const;
const ROW_LABEL: Record<string, string> = {
  above: "Above zone", high: "Upper third", mid: "Middle", low: "Lower third", below: "Below zone",
};
const COL_LABEL: Record<string, string> = { inside: "Inside", center: "Middle", away: "Away" };

const gradeColor = (g: number): string => {
  // the site's descriptive ramp compressed to the 30-80 grade range
  const pct = Math.max(1, Math.min(99, Math.round(((g - 50) / 10) * 34 + 50)));
  return `var(--grade-${pct})` in (typeof document !== "undefined" ? {} : {}) ? "" : gradeRamp(pct);
};

function gradeRamp(pct: number): string {
  // mirrors lib/percentiles percentileColor anchors, simplified for grades
  const stops: [number, string][] = [
    [1, "#e2574c"], [25, "#d8905a"], [50, "#8b93a3"], [75, "#5ba88f"], [99, "#3fae6e"],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (pct <= stops[i][0]) {
      const [p0, c0] = stops[i - 1], [p1, c1] = stops[i];
      const t = (pct - p0) / (p1 - p0);
      const hx = (c: string) => [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16));
      const a = hx(c0), b = hx(c1);
      const mix = a.map((v, k) => Math.round(v + (b[k] - v) * t));
      return `#${mix.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
    }
  }
  return "#3fae6e";
}

export function ScoutingCard({ data }: { data: any | null }) {
  const skill = data?.skill;
  return (
    <div className="glass-panel p-4">
      <div className="flex items-center justify-between gap-3 mb-2">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">Skill card</h2>
        <span className="text-[10px] text-text-dim">descriptive 20-80 estimates</span>
      </div>
      {skill ? (
        <>
          <div className="grid grid-cols-3 gap-3 mb-2">
            {[["Power", skill.power], ["Contact", skill.contact], ["Eye", skill.eye]].map(([label, g]) => (
              <div key={label as string} className="text-center">
                <div className="font-data text-xl font-bold" style={{ color: typeof g === "number" ? gradeColor(g) : undefined }}>
                  {typeof g === "number" ? g : "—"}
                </div>
                <div className="text-[10px] text-text-dim">{label}</div>
              </div>
            ))}
          </div>
          {skill.type && <p className="text-xs leading-relaxed text-text-secondary">{skill.type}.</p>}
          <p className="mt-2 text-[10px] leading-relaxed text-text-dim">
            50 = league average, 5-point steps ≈ percentile bands this season. An estimate from one season&apos;s
            percentiles — pair it with the class levels a scout would attach to age and competition, and treat a first
            season as provisional.
          </p>
        </>
      ) : (
        <p className="text-[11px] text-text-dim">No card for this season.</p>
      )}
    </div>
  );
}

const f1 = (v: number) => Math.round(v * 10) / 10;

export function ZoneGridPanel({ data, league }: { data: any | null; league?: any | null }) {
  const cellMap = useMemo(() => {
    const m = new Map<string, any>();
    for (const c of data?.cells ?? []) m.set(`${c.zz}|${c.zx}`, c);
    return m;
  }, [data]);
  // League rates for the same season x batter hand, per cell (bake totals ->
  // rates here). A cell shows a delta when both sides have enough sample.
  const lgMap = useMemo(() => {
    const m = new Map<string, { swing: number | null; whiff: number | null }>();
    for (const [k, c] of Object.entries<any>(league ?? {})) {
      m.set(k, {
        swing: c.n ? (100 * c.sw) / c.n : null,
        whiff: c.sw ? (100 * c.wh) / c.sw : null,
      });
    }
    return m;
  }, [league]);
  const maxSwing = useMemo(() => {
    let m = 0;
    for (const c of data?.cells ?? []) if ((c.n ?? 0) >= 5 && c.swingPct != null) m = Math.max(m, c.swingPct);
    return m || 100;
  }, [data]);

  if (!data?.cells?.length) {
    return (
      <div className="glass-panel p-4">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim mb-2">Zone grid</h2>
        <p className="text-[11px] text-text-dim">No zone data for this season.</p>
      </div>
    );
  }

  return (
    <div className="glass-panel p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">Where he swings</h2>
          <p className="text-[10px] text-text-dim">fill = swing rate · hover for whiff and damage</p>
        </div>
        <span className="text-[10px] text-text-dim">{data.season} · from his point of view</span>
      </div>
      <div className="grid grid-cols-[64px_repeat(3,1fr)] gap-1">
        <div />
        {COLS.map((c) => (
          <div key={c} className="text-center text-[10px] uppercase tracking-wider text-text-dim">{COL_LABEL[c]}</div>
        ))}
        {ROWS.map((zz) => (
          <Fragment key={zz}>
            <div key={`${zz}-label`} className="flex items-center justify-end pr-1 text-[10px] text-text-dim">{ROW_LABEL[zz]}</div>
            {COLS.map((zx) => {
              const cell = cellMap.get(`${zz}|${zx}`);
              const n = cell?.n ?? 0;
              const thin = n < 5;
              const swing = cell?.swingPct;
              const lg = lgMap.get(`${zz}-${zx}`);
              const lgTip = lg?.swing != null ? ` · league ${f1(lg.swing!)}% swung · ${lg?.whiff != null ? f1(lg.whiff!) : "—"}% whiff` : "";
              const whiffDelta = typeof cell?.whiffPct === "number" && lg?.whiff != null && n >= 20 && (league?.[`${zz}-${zx}`]?.sw ?? 0) >= 200
                ? cell.whiffPct - lg.whiff!
                : null;
              return (
                <div key={`${zz}-${zx}`}
                  className="relative h-[52px] rounded-md border border-white/[0.06] flex flex-col items-center justify-center"
                  title={cell && n > 0
                    ? `${n} pitches · ${cell.swingPct ?? "—"}% swung · ${cell.whiffPct ?? "—"}% whiff on swings${cell.avgEv ? ` · ${cell.avgEv} mph avg EV` : ""}${lgTip}${thin ? " — thin" : ""}`
                    : lg?.swing != null ? `No pitches here · league ${f1(lg.swing)}% swung` : "No pitches here"}
                  style={{ background: !thin && typeof swing === "number" ? `rgba(232,119,34,${0.08 + 0.5 * (swing / maxSwing)})` : "rgba(255,255,255,0.02)" }}>
                  <span className={`font-data text-xs ${thin ? "text-text-dim" : "text-text-primary"}`}>{typeof swing === "number" ? `${swing}%` : "—"}</span>
                  <span className="text-[9px] text-text-dim">
                    {n ? `n=${n}${thin ? " ·" : ""}` : ""}
                    {whiffDelta !== null && Math.abs(whiffDelta) >= 5 ? (
                      <span className={whiffDelta > 0 ? "text-[#e0654f]" : "text-usf-green"}> {whiffDelta > 0 ? "+" : "−"}{f1(Math.abs(whiffDelta))}</span>
                    ) : null}
                  </span>
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>
      <p className="mt-3 text-[10px] leading-relaxed text-text-dim">
        Inside/away mirror his own hand. Cells under 5 pitches print dim — a rate on four pitches is an anecdote.
        The zone outline sits between high/mid/low. A coloured +/− marks cells where his whiff rate sits 5+ points
        from the league&apos;s same cell (red = more whiffs than league, green = fewer).
      </p>
    </div>
  );
}

export function CountsPanel({ data, league }: { data: any | null; league?: any | null }) {
  const rows = [...(data?.counts ?? [])].sort((a, b) => a.count.localeCompare(b.count));
  const lg = (c: string) => {
    const l = league?.[c];
    return l ? {
      swing: l.n ? (100 * l.sw) / l.n : null,
      whiff: l.sw ? (100 * l.wh) / l.sw : null,
    } : null;
  };
  if (!rows.length) return null;
  return (
    <div className="glass-panel overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border-subtle flex items-center justify-between gap-3">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">By count</h2>
        <span className="text-[10px] text-text-dim">approach by situation</span>
      </div>
      <div className="overflow-x-auto"><div className="min-w-max">
        <div className="flex items-center px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-text-dim border-b border-border-subtle">
          <div className="w-[52px]">Count</div>
          <div className="w-[56px] text-right">Pitches</div>
          <div className="w-[56px] text-right">Swing%</div>
          <div className="w-[56px] text-right">Whiff%</div>
          <div className="w-[56px] text-right">Chase%</div>
          <div className="w-[64px] text-right">HH%</div>
          <div className="w-[64px] text-right">Lg Whiff%</div>
        </div>
        {rows.map((r) => {
          const l = lg(r.count);
          return (
            <div key={r.count} className={`flex items-center px-4 border-b border-white/[0.025] ${(r.n ?? 0) < 20 ? "opacity-60" : ""}`} style={{ height: "30px" }}
              title={l ? `league ${l.swing != null ? f1(l.swing) : "—"}% swung · ${l.whiff != null ? f1(l.whiff) : "—"}% whiff in this count` : undefined}>
              <div className="w-[52px] text-xs font-data font-medium text-text-primary">{r.count}</div>
              <div className="w-[56px] text-right text-xs font-data text-text-dim">{r.n}</div>
              <div className="w-[56px] text-right text-xs font-data text-text-secondary">{r.swingPct ?? "—"}</div>
              <div className="w-[56px] text-right text-xs font-data text-text-secondary">{r.whiffPct ?? "—"}</div>
              <div className="w-[56px] text-right text-xs font-data text-text-secondary">{r.chasePct ?? "—"}</div>
              <div className="w-[64px] text-right text-xs font-data text-text-secondary">{r.hardHitPct ?? "—"}</div>
              <div className="w-[64px] text-right text-xs font-data text-text-dim">{l?.whiff != null ? f1(l.whiff) : "—"}</div>
            </div>
          );
        })}
      </div></div>
      <p className="px-4 py-2 text-[10px] text-text-dim">Counts under 20 pitches are dimmed — the rates are leans.</p>
    </div>
  );
}
