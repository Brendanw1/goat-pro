"use client";
/**
 * Rolling stat chart: pick any per-game-summable stat (or Whiff+ / Decision+) and see it over a rolling
 * window across the season, against the league line. Rows are the baked trend rows (hitter_depth.trends):
 * per game date, counts named by trend.cols; model stats are per-pitch sums on the season grade's scale.
 */
import { useMemo, useState } from "react";
import { GOOD, BAD } from "@/components/ui/shared-ui";

type Trend = { cols: string[]; rows: (string | number | number[])[][]; lg: Lg | null };
type Lg = { sums?: Record<string, number>; ev90?: number | null; dec?: { mu: number; sd: number } | null } | null;
type S = Record<string, number>;
type Metric = {
  key: string; label: string; den: string; unit: string; windows: number[]; good: 1 | -1;
  fmt: "pct" | "dec3" | "num1" | "int";
  v: (s: S, lg: Lg, evl: number[]) => number | null; need?: string;
};

const r = (a: number, b: number) => (b > 0 ? a / b : null);
const pct = (a: number, b: number) => (b > 0 ? (100 * a) / b : null);
const ev90 = (l?: number[]) => {
  if (!l || l.length < 5) return null;
  const s = [...l].sort((a, b) => a - b);
  const k = 0.9 * (s.length - 1), f = Math.floor(k);
  return s[f] + (s[Math.min(f + 1, s.length - 1)] - s[f]) * (k - f);
};

const PA_W = [50, 100, 200], BBE_W = [25, 50, 100], SW_W = [100, 200, 400], P_W = [250, 500, 1000];

const PITCHER: Metric[] = [
  { key: "whiffPlus", label: "Whiff+", den: "wzn", unit: "pitches", windows: P_W, good: 1, fmt: "int", need: "wzn",
    v: (s) => (s.wzn > 0 ? 100 + (10 * s.wz) / s.wzn : null) },
  { key: "whiff", label: "Whiff%", den: "sw", unit: "swings", windows: SW_W, good: 1, fmt: "pct", v: (s) => pct(s.wh, s.sw) },
  { key: "csw", label: "CSW%", den: "np", unit: "pitches", windows: P_W, good: 1, fmt: "pct", v: (s) => pct(s.cs + s.wh, s.np) },
  { key: "chase", label: "Chase%", den: "oz", unit: "out-of-zone pitches", windows: [100, 200, 400], good: 1, fmt: "pct", v: (s) => pct(s.ch, s.oz) },
  { key: "zone", label: "Zone%", den: "np", unit: "pitches", windows: P_W, good: 1, fmt: "pct", v: (s) => pct(s.iz, s.np) },
  { key: "k", label: "K%", den: "pa", unit: "BF", windows: PA_W, good: 1, fmt: "pct", v: (s) => pct(s.k, s.pa) },
  { key: "bb", label: "BB%", den: "pa", unit: "BF", windows: PA_W, good: -1, fmt: "pct", v: (s) => pct(s.bb, s.pa) },
  { key: "kbb", label: "K−BB%", den: "pa", unit: "BF", windows: PA_W, good: 1, fmt: "pct", v: (s) => pct(s.k - s.bb, s.pa) },
  { key: "xwoba", label: "xwOBA against", den: "den", unit: "PA", windows: PA_W, good: -1, fmt: "dec3", v: (s) => r(s.xn, s.den) },
  { key: "woba", label: "wOBA against", den: "den", unit: "PA", windows: PA_W, good: -1, fmt: "dec3", v: (s) => r(s.wn, s.den) },
  { key: "hh", label: "Hard-hit% against", den: "bbe", unit: "BBE", windows: BBE_W, good: -1, fmt: "pct", v: (s) => pct(s.hh, s.bbe) },
  { key: "brl", label: "Barrel% against", den: "bbe", unit: "BBE", windows: BBE_W, good: -1, fmt: "pct", v: (s) => pct(s.brl, s.bbe) },
  { key: "ev", label: "Avg EV against", den: "bbe", unit: "BBE", windows: BBE_W, good: -1, fmt: "num1", v: (s) => r(s.evs, s.bbe) },
  { key: "fbv", label: "Fastball velo", den: "fbn", unit: "fastballs", windows: [50, 100, 200], good: 1, fmt: "num1", v: (s) => r(s.fbv, s.fbn) },
];

const HITTER: Metric[] = [
  { key: "decisionPlus", label: "Decision+", den: "dvn", unit: "decisions", windows: P_W, good: 1, fmt: "int", need: "dvn",
    v: (s, lg) => (s.dvn > 0 && lg?.dec ? 100 + (10 * ((100 * s.dv) / s.dvn - lg.dec.mu)) / lg.dec.sd : null) },
  { key: "xwoba", label: "xwOBA", den: "den", unit: "PA", windows: PA_W, good: 1, fmt: "dec3", v: (s) => r(s.xn, s.den) },
  { key: "woba", label: "wOBA", den: "den", unit: "PA", windows: PA_W, good: 1, fmt: "dec3", v: (s) => r(s.wn, s.den) },
  { key: "brl", label: "Barrel%", den: "bbe", unit: "BBE", windows: BBE_W, good: 1, fmt: "pct", v: (s) => pct(s.brl, s.bbe) },
  { key: "hh", label: "Hard-hit%", den: "bbe", unit: "BBE", windows: BBE_W, good: 1, fmt: "pct", v: (s) => pct(s.hh, s.bbe) },
  { key: "ev90", label: "EV90", den: "bbe", unit: "BBE", windows: BBE_W, good: 1, fmt: "num1", v: (_s, _lg, evl) => ev90(evl) },
  { key: "ev", label: "Avg EV", den: "bbe", unit: "BBE", windows: BBE_W, good: 1, fmt: "num1", v: (s) => r(s.evs, s.bbe) },
  { key: "ss", label: "Sweet-spot%", den: "bbe", unit: "BBE", windows: BBE_W, good: 1, fmt: "pct", v: (s) => pct(s.ss, s.bbe) },
  { key: "whiff", label: "Whiff%", den: "sw", unit: "swings", windows: SW_W, good: -1, fmt: "pct", v: (s) => pct(s.wh, s.sw) },
  { key: "chase", label: "Chase%", den: "oz", unit: "out-of-zone pitches", windows: [100, 200, 400], good: -1, fmt: "pct", v: (s) => pct(s.ch, s.oz) },
  { key: "zswing", label: "Zone swing%", den: "iz", unit: "zone pitches", windows: [100, 200, 400], good: 1, fmt: "pct", v: (s) => pct(s.izs, s.iz) },
  { key: "zcon", label: "Zone contact%", den: "izs", unit: "zone swings", windows: SW_W, good: 1, fmt: "pct", v: (s) => pct(s.izc, s.izs) },
  { key: "k", label: "K%", den: "pa", unit: "PA", windows: PA_W, good: -1, fmt: "pct", v: (s) => pct(s.k, s.pa) },
  { key: "bb", label: "BB%", den: "pa", unit: "PA", windows: PA_W, good: 1, fmt: "pct", v: (s) => pct(s.bb, s.pa) },
  { key: "bat", label: "Bat speed (tracked swings)", den: "bsn", unit: "swings", windows: SW_W, good: 1, fmt: "num1", need: "bsn",
    v: (s) => r(s.bs, s.bsn) },
];

const W = 600, H = 170, PAD_L = 38, PAD_R = 8, PAD_T = 8, PAD_B = 18;
const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LINE = "#e87722", LG = "#5b6472";

function show(v: number | null, f: Metric["fmt"]) {
  if (v == null || !Number.isFinite(v)) return "—";
  if (f === "pct") return v.toFixed(1) + "%";
  if (f === "dec3") return v.toFixed(3).replace(/^0/, "").replace(/^-0/, "-");
  if (f === "int") return v.toFixed(0);
  return v.toFixed(1);
}

export function RollingPanel({ trend, role }: { trend: Trend | null | undefined; role: "hitter" | "pitcher" }) {
  const cols = useMemo(() => trend?.cols ?? [], [trend]);
  const lg = trend?.lg ?? null;
  const metrics = useMemo(() => (role === "pitcher" ? PITCHER : HITTER).filter((m) =>
    cols.includes(m.den) && (!m.need || (lg?.sums?.[m.need] ?? 0) > 0)), [role, cols, lg]);
  const [key, setKey] = useState(role === "pitcher" ? "whiffPlus" : "decisionPlus");
  const m = metrics.find((x) => x.key === key) ?? metrics[0];
  const [winIdx, setWinIdx] = useState(1);
  const [hover, setHover] = useState<number | null>(null);

  // one object of counts per game row (evl kept as a list)
  const rows = useMemo(() => (trend?.rows ?? []).map((row) => {
    const o: S = {};
    let evl: number[] = [];
    cols.forEach((c, i) => { if (c === "evl") evl = (row[i] as number[]) ?? []; else if (c !== "d") o[c] = row[i] as number; });
    return { o, evl };
  }), [trend, cols]);
  const dates = (trend?.rows ?? []).map((row) => String(row[0]));

  const { pts, eff } = useMemo(() => {
    if (!m) return { pts: [] as (number | null)[], eff: 0 };
    const total = rows.reduce((a, x) => a + (x.o[m.den] || 0), 0);
    const eff = Math.min(m.windows[winIdx] ?? m.windows[0], total);
    const pts = rows.map((_, i) => {
      const s: S = {}, evl: number[] = [];
      let n = 0;
      for (let j = i; j >= 0 && n < eff; j--) {
        for (const c of cols) if (c !== "d" && c !== "evl") s[c] = (s[c] || 0) + (rows[j].o[c] || 0);
        evl.push(...rows[j].evl);
        n += rows[j].o[m.den] || 0;
      }
      return n >= eff && eff > 0 ? m.v(s, lg, evl) : null;
    });
    return { pts, eff };
  }, [rows, cols, m, winIdx, lg]);

  if (!m || rows.length < 5) return null;
  const lgv = m.key === "whiffPlus" || m.key === "decisionPlus" ? 100 : m.key === "ev90" ? lg?.ev90 ?? null
    : lg?.sums ? m.v(lg.sums, lg, []) : null;

  const n = rows.length;
  const x = (i: number) => PAD_L + (n === 1 ? 0 : (i / (n - 1)) * (W - PAD_L - PAD_R));
  const vals = pts.filter((v): v is number => v != null);
  if (lgv != null) vals.push(lgv);
  if (!vals.length) return null;
  const span = Math.max(...vals) - Math.min(...vals) || 1;
  const lo = Math.min(...vals) - span * 0.08, hi = Math.max(...vals) + span * 0.08;
  const y = (v: number) => PAD_T + (1 - (v - lo) / (hi - lo)) * (H - PAD_T - PAD_B);
  const path = pts.reduce((s, v, i) => (v == null ? s : s + (s ? " L" : "M") + x(i).toFixed(1) + "," + y(v).toFixed(1)), "");
  const ticks = dates.map((d, i) => ({ i, m: Number(d.slice(0, 2)) })).filter((t, k, a) => k === 0 || t.m !== a[k - 1].m);
  const hi_ = hover ?? n - 1;
  const cur = pts[hi_];
  const better = cur != null && lgv != null ? (cur - lgv) * m.good > 0 : null;
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const b = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - b.left) / b.width) * W;
    setHover(Math.max(0, Math.min(n - 1, Math.round(((px - PAD_L) / (W - PAD_L - PAD_R)) * (n - 1)))));
  };

  return (
    <div className="glass-panel p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">Rolling</h2>
          <select value={m.key} onChange={(e) => setKey(e.target.value)} aria-label="Stat"
            className="rounded bg-white/5 px-1.5 py-0.5 text-[11px] text-text-primary">
            {metrics.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-1 text-[10px]">
          {m.windows.map((w, i) => (
            <button key={w} onClick={() => setWinIdx(i)}
              className={`rounded px-1.5 py-0.5 ${i === winIdx ? "bg-white/10 text-text-primary" : "text-text-dim hover:text-text-secondary"}`}>
              {w} {m.unit}
            </button>
          ))}
        </div>
      </div>
      <div className="mb-1 flex flex-wrap gap-x-4 text-[11px] text-text-secondary">
        <span>{dates[hi_]?.replace("-", "/")}</span>
        <span>{m.label}{" "}
          <span style={{ color: better == null ? undefined : better ? GOOD : BAD }}>{show(cur, m.fmt)}</span>
        </span>
        {lgv != null && <span className="text-text-dim">League {show(lgv, m.fmt)}</span>}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" onMouseMove={onMove} onMouseLeave={() => setHover(null)}
        role="img" aria-label={`Rolling ${eff} ${m.unit} ${m.label} across the season`}>
        {[lo + (hi - lo) * 0.1, (lo + hi) / 2, hi - (hi - lo) * 0.1].map((v) => (
          <g key={v}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y(v)} y2={y(v)} stroke="#ffffff10" />
            <text x={PAD_L - 4} y={y(v) + 3} fontSize="9" textAnchor="end" fill="var(--text-dim, #8a93a3)">{show(v, m.fmt)}</text>
          </g>
        ))}
        {lgv != null && <line x1={PAD_L} x2={W - PAD_R} y1={y(lgv)} y2={y(lgv)} stroke={LG} strokeDasharray="4 3" />}
        <path d={path} fill="none" stroke={LINE} strokeWidth="1.8" />
        {ticks.map((t) => <text key={t.i} x={x(t.i)} y={H - 4} fontSize="9" fill="var(--text-dim, #8a93a3)">{MONTHS[t.m]}</text>)}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={PAD_T} y2={H - PAD_B} stroke="#ffffff33" />}
      </svg>
      <p className="mt-1 text-[10px] text-text-dim">
        Last {eff} {m.unit} at each game date; dashed = league ({m.good > 0 ? "higher" : "lower"} is better for him).
        {m.key === "whiffPlus" && " Whiff+ scale (per-pitch predicted whiff/swing vs league by pitch class and batter hand, 100 = average). Each pitch is scored against its own batter hand, so it can differ by a few points from the season card until that grade gets the same fix."}
        {m.key === "decisionPlus" && " Same scale as his season Decision+ (swing/take run value per pitch vs that season's 100+ PA hitters)."}
        {m.key === "ev90" && " 90th percentile of exit velocity on balls in play in the window."}
        {m.key === "bat" && " Mean of every tracked swing (Savant's average uses competitive swings, so his card can read higher)."}
      </p>
    </div>
  );
}
