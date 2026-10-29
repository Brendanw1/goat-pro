"use client";
/**
 * In-season trends by pitch type, from the explorer's per-pitch file (full season, no explorer filters):
 * rolling xwOBAcon and xSLG on contact over each type's last 50 balls in play, and usage over his last 100
 * pitches to each batter hand. Four small multiples share one date axis and one hover; each title states
 * the panel's biggest shift (the split of one type's line that most separates its before / after means).
 * Dashed lines on the contact panels are the league's mean for that type and season (`lgc` in the file).
 */
import { useMemo, useState } from "react";
import { PITCH_CONFIG } from "@/lib/constants";
import type { PitchType } from "@/types";

type Num = number | null;
export type TrendFile = {
  types: string[]; start: string; t: number[]; h: number[]; d: number[]; w: Num[]; sl?: Num[];
  lgc?: Record<string, [Num, Num]>;
};
type Series = { t: string; p: [number, number][]; n: number };
type PanelDef = { key: string; label: string; series: Series[]; thin: string[]; unit: string; win: number;
  fmt: (v: number) => string; minDelta: number; lg?: (t: string) => Num; usage?: boolean };

const BIP_WIN = 50, USE_WIN = 100, USE_MIN = 0.03;
const colorOf = (t: string) => PITCH_CONFIG[t as PitchType]?.color ?? "#8C9591";
const nameOf = (t: string) => PITCH_CONFIG[t as PitchType]?.label ?? t;
const x3 = (v: number) => v.toFixed(3).replace(/^0/, "");
const pct = (v: number) => `${Math.round(100 * v)}%`;

/** one point per day: the window's value after his last pitch that day */
function push(p: [number, number][], day: number, v: number) {
  if (p.length && p[p.length - 1][0] === day) p[p.length - 1][1] = v; else p.push([day, v]);
}

function contact(f: TrendFile, col: Num[] | undefined) {
  const series: Series[] = [], thin: string[] = [];
  if (!col) return { series, thin };
  f.types.forEach((t, ti) => {
    const q: number[] = [], p: [number, number][] = [];
    let sum = 0, n = 0;
    for (let i = 0; i < f.t.length; i++) {
      const v = col[i];
      if (f.t[i] !== ti || v == null) continue;
      n++; q.push(v / 1000); sum += v / 1000;
      if (q.length > BIP_WIN) sum -= q.shift()!;
      if (q.length === BIP_WIN) push(p, f.d[i], sum / BIP_WIN);
    }
    if (p.length >= 3) series.push({ t, p, n }); else if (n) thin.push(t);
  });
  return { series, thin };
}

function usage(f: TrendFile, side: number) {
  const K = f.types.length, cnt = new Array(K).fill(0), tot = new Array(K).fill(0);
  const q: number[] = [], ps: [number, number][][] = f.types.map(() => []);
  let all = 0;
  for (let i = 0; i < f.t.length; i++) {
    if (f.h[i] !== side) continue;
    const ti = f.t[i];
    q.push(ti); cnt[ti]++; tot[ti]++; all++;
    if (q.length > USE_WIN) cnt[q.shift()!]--;
    if (q.length === USE_WIN) for (let k = 0; k < K; k++) push(ps[k], f.d[i], cnt[k] / USE_WIN);
  }
  const series: Series[] = [], thin: string[] = [];
  f.types.forEach((t, k) => {
    if (!tot[k]) return;
    if (ps[k].length >= 3 && tot[k] >= 20 && tot[k] / all >= USE_MIN) series.push({ t, p: ps[k], n: tot[k] }); else thin.push(t);
  });
  return { series, thin };
}

function finding(pd: PanelDef, date: (d: number) => string) {
  let best: { s: Series; k: number; a: number; b: number } | null = null;
  for (const s of pd.series) {
    const v = s.p.map((x) => x[1]), L = v.length;
    if (L < 8) continue;
    let pre = 0;
    const total = v.reduce((a, x) => a + x, 0);
    for (let k = 1; k < L; k++) {
      pre += v[k - 1];
      if (k < Math.max(4, L / 6) || L - k < Math.max(4, L / 6)) continue;
      const a = pre / k, b = (total - pre) / (L - k);
      if (!best || Math.abs(b - a) > Math.abs(best.b - best.a)) best = { s, k, a, b };
    }
  }
  if (best && Math.abs(best.b - best.a) >= pd.minDelta) {
    return `${nameOf(best.s.t)} ${pd.label} ${best.b > best.a ? "rose" : "fell"} from ${pd.fmt(best.a)} to ${pd.fmt(best.b)} after ${date(best.s.p[best.k][0])}`;
  }
  const top = [...pd.series].sort((a, b) => b.n - a.n)[0]; // panels without a line are dropped upstream
  const last = top.p[top.p.length - 1][1], lg = pd.lg?.(top.t);
  return `${nameOf(top.t)} ${pd.label} held steady near ${pd.fmt(last)}${lg != null ? ` (league ${pd.fmt(lg)})` : ""}`;
}

const VW = 540, VH = 84;

export function PitchTrends({ file }: { file: TrendFile }) {
  const [hov, setHov] = useState<number | null>(null);
  const lastDay = Math.max(1, ...file.d);
  const t0 = Date.parse(`${file.start}T00:00:00Z`);
  const date = (d: number) => new Date(t0 + d * 864e5).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

  const panels = useMemo<PanelDef[]>(() => {
    const lg = (k: 0 | 1) => (t: string) => file.lgc?.[t]?.[k] ?? null;
    return ([
      { key: "xw", label: "xwOBAcon", ...contact(file, file.w), unit: "BIP", win: BIP_WIN, fmt: x3, minDelta: 0.04, lg: lg(0) },
      { key: "xs", label: "xSLG on contact", ...contact(file, file.sl), unit: "BIP", win: BIP_WIN, fmt: x3, minDelta: 0.08, lg: lg(1) },
      { key: "ur", label: "usage vs RHH", ...usage(file, 1), unit: "pitches", win: USE_WIN, fmt: pct, minDelta: 0.06, usage: true },
      { key: "ul", label: "usage vs LHH", ...usage(file, 0), unit: "pitches", win: USE_WIN, fmt: pct, minDelta: 0.06, usage: true },
    ] as PanelDef[]).filter((p) => p.series.length); // a panel with no line yet is left off
  }, [file]);
  if (!panels.length) return null;

  const sx = (d: number) => (d / lastDay) * VW;
  const months: [number, string][] = [];
  for (let d = 0; d <= lastDay; d++) {
    const dt = new Date(t0 + d * 864e5);
    if (dt.getUTCDate() === 1) months.push([d, dt.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })]);
  }
  const at = (s: Series, day: number) => {
    let v: number | null = null;
    for (const [d, x] of s.p) { if (d > day) break; v = x; }
    return v;
  };
  const move = (ev: React.MouseEvent) => {
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    setHov(Math.max(0, Math.min(lastDay, Math.round(((ev.clientX - r.left) / r.width) * lastDay))));
  };

  return (
    <div className="space-y-3 min-w-0">
      <p className="text-[10px] uppercase tracking-wider text-text-dim">Through the season, by pitch type</p>
      {panels.map((pd, pi) => {
        const vals = pd.series.flatMap((s) => s.p.map((q) => q[1]));
        const refs = pd.lg ? pd.series.map((s) => pd.lg!(s.t)).filter((v): v is number => v != null) : [];
        let lo = pd.usage ? 0 : Math.min(...vals, ...refs), hi = Math.max(...vals, ...refs, pd.usage ? 0.1 : 0);
        const pad = (hi - lo || 0.1) * 0.08;
        if (!pd.usage) lo -= pad;
        hi += pad;
        const sy = (v: number) => VH - ((v - lo) / (hi - lo || 1)) * VH;
        return (
          <div key={pd.key}>
            <p className="text-xs font-medium text-text-primary leading-snug">{finding(pd, date)}</p>
            <p className="text-[10px] text-text-dim font-data mb-0.5">
              {pd.label} · rolling last {pd.win} {pd.unit}{pd.lg ? " · dashed = league for the type" : ""}{pd.thin.length ? ` · too thin: ${pd.thin.join(", ")}` : ""}
            </p>
            {vals.length > 0 && (
              <div className="relative" onMouseMove={move} onMouseLeave={() => setHov(null)}>
                <svg viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="none" className="w-full block" style={{ height: VH }}
                  role="img" aria-label={`${pd.label} by pitch type through the season`}>
                  {months.map(([d]) => <line key={d} x1={sx(d)} x2={sx(d)} y1={0} y2={VH} stroke="#fff" strokeOpacity={0.07} vectorEffect="non-scaling-stroke" />)}
                  {pd.lg && pd.series.map((s) => {
                    const v = pd.lg!(s.t);
                    return v == null ? null : <line key={`lg${s.t}`} x1={0} x2={VW} y1={sy(v)} y2={sy(v)} stroke={colorOf(s.t)} strokeOpacity={0.45}
                      strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />;
                  })}
                  {pd.series.map((s) => (
                    <polyline key={s.t} fill="none" stroke={colorOf(s.t)} strokeWidth={1.6} vectorEffect="non-scaling-stroke"
                      points={s.p.map(([d, v]) => `${sx(d).toFixed(1)},${sy(v).toFixed(1)}`).join(" ")} />
                  ))}
                  {hov !== null && <line x1={sx(hov)} x2={sx(hov)} y1={0} y2={VH} stroke="#fff" strokeOpacity={0.5} vectorEffect="non-scaling-stroke" />}
                </svg>
                <span className="absolute left-0 top-0 text-[9px] font-data text-text-dim">{pd.fmt(hi)}</span>
                <span className="absolute left-0 bottom-0 text-[9px] font-data text-text-dim">{pd.fmt(Math.max(0, lo))}</span>
              </div>
            )}
            {pi === panels.length - 1 && (
              <div className="relative h-3 text-[9px] font-data text-text-dim">
                {months.map(([d, m]) => <span key={d} className="absolute" style={{ left: `${(d / lastDay) * 100}%` }}>{m}</span>)}
              </div>
            )}
            <p className="text-[10px] font-data text-text-secondary mt-0.5">
              {hov !== null ? <span className="text-text-dim">{date(hov)} · </span> : <span className="text-text-dim">latest · </span>}
              {pd.series.map((s, k) => {
                const v = hov !== null ? at(s, hov) : s.p[s.p.length - 1][1], lg = pd.lg?.(s.t);
                return (
                  <span key={s.t}>{k ? " · " : ""}<span style={{ color: colorOf(s.t) }}>{s.t}</span> {v === null ? "—" : pd.fmt(v)}
                    {hov === null && <span className="text-text-dim"> ({lg != null ? `lg ${pd.fmt(lg)}, ` : ""}{s.n} {pd.unit})</span>}
                  </span>
                );
              })}
            </p>
          </div>
        );
      })}
      <p className="text-[10px] text-text-dim leading-[1.5]">
        Full season, explorer filters not applied. Lower xwOBAcon and xSLG are better for the pitcher. A line starts once the
        type has {BIP_WIN} balls in play ({USE_WIN} pitches to that hand for usage); types under 3% usage to a hand are left off.
        Titles name the largest before/after shift in any one line; rolling windows overlap, so a shift is descriptive, not a test.
      </p>
    </div>
  );
}
