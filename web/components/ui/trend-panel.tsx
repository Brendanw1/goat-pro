"use client";
/**
 * Season trend (D-35): rolling wOBA vs xwOBA over the last N PA, against the league line, and his
 * cumulative run value game by game. Rows come baked per player-season (hitter_depth.trends):
 * [mm-dd, PA, wOBA numerator, xwOBA numerator, wOBA denominator, RV signed good-for-him].
 */
import { useMemo, useState } from "react";
import { GOOD, BAD, signedFixed } from "@/components/ui/shared-ui";

type Row = [string, number, number, number, number, number];
export type Trend = { cols: string[]; rows: Row[]; lg: { woba: number; xwoba: number } | null };

const W = 600, H = 150, PAD_L = 34, PAD_R = 8, PAD_T = 8, PAD_B = 18;
const WINDOWS = [50, 100, 200];
const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const C_WOBA = "#e87722", C_XWOBA = "#7aa5d8", C_LG = "#5b6472";
const dec3 = (v: number) => v.toFixed(3).replace(/^0/, "").replace(/^-0/, "-");

function rolling(rows: Row[], win: number) {
  const n = rows.length;
  const cum = (k: number) => { const c = [0]; rows.forEach((r) => c.push(c[c.length - 1] + (r[k] as number))); return c; };
  const pa = cum(1), wn = cum(2), xn = cum(3), den = cum(4), rv = cum(5);
  const eff = Math.min(win, pa[n]);
  const out: { i: number; d: string; woba: number | null; xwoba: number | null; rv: number; pa: number }[] = [];
  let j = 0;
  for (let i = 1; i <= n; i++) {
    while (j + 1 < i && pa[i] - pa[j + 1] >= eff) j++;
    const ok = pa[i] - pa[j] >= eff && den[i] - den[j] > 0;
    out.push({
      i: i - 1, d: rows[i - 1][0], pa: pa[i] - pa[j], rv: rv[i],
      woba: ok ? (wn[i] - wn[j]) / (den[i] - den[j]) : null,
      xwoba: ok ? (xn[i] - xn[j]) / (den[i] - den[j]) : null,
    });
  }
  return { pts: out, eff };
}

export function TrendPanel({ trend, role }: { trend: Trend | null | undefined; role: "hitter" | "pitcher" }) {
  const [win, setWin] = useState(100);
  const [hover, setHover] = useState<number | null>(null);
  const rows = trend?.rows ?? [];
  const { pts, eff } = useMemo(() => rolling(rows, win), [rows, win]);
  if (rows.length < 5) return null;

  const n = rows.length;
  const x = (i: number) => PAD_L + (n === 1 ? 0 : (i / (n - 1)) * (W - PAD_L - PAD_R));
  const vals = pts.flatMap((p) => [p.woba, p.xwoba]).filter((v): v is number => v != null);
  if (trend?.lg) vals.push(trend.lg.woba, trend.lg.xwoba);
  const lo = Math.max(0, Math.min(...vals) - 0.02), hi = Math.max(...vals) + 0.02;
  const y1 = (v: number) => PAD_T + (1 - (v - lo) / (hi - lo || 1)) * (H - PAD_T - PAD_B);
  const path = (k: "woba" | "xwoba") => pts.reduce((s, p) => {
    const v = p[k];
    if (v == null) return s;
    return s + (s ? " L" : "M") + x(p.i).toFixed(1) + "," + y1(v).toFixed(1);
  }, "");

  const rvs = pts.map((p) => p.rv);
  const rlo = Math.min(0, ...rvs), rhi = Math.max(0, ...rvs);
  const y2 = (v: number) => PAD_T + (1 - (v - rlo) / (rhi - rlo || 1)) * (H - PAD_T - PAD_B);
  const area = (sign: 1 | -1) => {
    const top = pts.map((p) => `${x(p.i).toFixed(1)},${y2(sign > 0 ? Math.max(0, p.rv) : Math.min(0, p.rv)).toFixed(1)}`);
    return `M${x(0).toFixed(1)},${y2(0).toFixed(1)} L${top.join(" L")} L${x(n - 1).toFixed(1)},${y2(0).toFixed(1)}Z`;
  };

  const ticks = rows.map((r, i) => ({ i, m: Number(r[0].slice(0, 2)) }))
    .filter((t, k, a) => k === 0 || t.m !== a[k - 1].m);
  const yTicks = [lo, (lo + hi) / 2, hi];
  const hp = hover != null ? pts[hover] : pts[pts.length - 1];
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    setHover(Math.max(0, Math.min(n - 1, Math.round(((px - PAD_L) / (W - PAD_L - PAD_R)) * (n - 1)))));
  };
  const unit = role === "hitter" ? "PA" : "BF";
  const against = role === "pitcher" ? " against" : "";
  const axisX = (
    <>
      {ticks.map((t) => (
        <text key={t.i} x={x(t.i)} y={H - 4} fontSize="9" fill="var(--text-dim, #8a93a3)">{MONTHS[t.m]}</text>
      ))}
      {hover != null && <line x1={x(hover)} x2={x(hover)} y1={PAD_T} y2={H - PAD_B} stroke="#ffffff33" />}
    </>
  );

  return (
    <div className="glass-panel p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">Season trend</h2>
        <div className="flex items-center gap-1 text-[10px]">
          <span className="text-text-dim mr-1">Rolling</span>
          {WINDOWS.map((w) => (
            <button key={w} onClick={() => setWin(w)}
              className={`rounded px-1.5 py-0.5 ${w === win ? "bg-white/10 text-text-primary" : "text-text-dim hover:text-text-secondary"}`}>
              {w} {unit}
            </button>
          ))}
        </div>
      </div>
      <div className="mb-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-text-secondary">
        <span>{hp.d.replace("-", "/")}</span>
        <span><span style={{ color: C_WOBA }}>wOBA{against}</span> {hp.woba != null ? dec3(hp.woba) : "—"}</span>
        <span><span style={{ color: C_XWOBA }}>xwOBA{against}</span> {hp.xwoba != null ? dec3(hp.xwoba) : "—"}</span>
        <span>Run value <span style={{ color: hp.rv > 0 ? GOOD : hp.rv < 0 ? BAD : undefined }}>{signedFixed(hp.rv, 1)}</span></span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" onMouseMove={onMove} onMouseLeave={() => setHover(null)}
        role="img" aria-label={`Rolling ${eff}-${unit} wOBA and xwOBA${against} across the season`}>
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y1(v)} y2={y1(v)} stroke="#ffffff10" />
            <text x={PAD_L - 4} y={y1(v) + 3} fontSize="9" textAnchor="end" fill="var(--text-dim, #8a93a3)">{dec3(v)}</text>
          </g>
        ))}
        {trend?.lg && <line x1={PAD_L} x2={W - PAD_R} y1={y1(trend.lg.woba)} y2={y1(trend.lg.woba)} stroke={C_LG} strokeDasharray="4 3" />}
        <path d={path("xwoba")} fill="none" stroke={C_XWOBA} strokeWidth="1.6" />
        <path d={path("woba")} fill="none" stroke={C_WOBA} strokeWidth="1.8" />
        {axisX}
      </svg>
      <p className="mt-1 mb-3 text-[10px] text-text-dim">
        Last {eff} {unit} at each game{trend?.lg ? `; dashed = league wOBA (${dec3(trend.lg.woba)})` : ""}.
        {role === "pitcher" ? " Lower is better for him." : ""} Expected stats are Statcast&apos;s, on Savant&apos;s wOBA scale.
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" onMouseMove={onMove} onMouseLeave={() => setHover(null)}
        role="img" aria-label="Cumulative run value across the season">
        <line x1={PAD_L} x2={W - PAD_R} y1={y2(0)} y2={y2(0)} stroke="#ffffff30" />
        {[rlo, rhi].filter((v) => v !== 0).map((v) => (
          <text key={v} x={PAD_L - 4} y={y2(v) + 3} fontSize="9" textAnchor="end" fill="var(--text-dim, #8a93a3)">{signedFixed(v, 0)}</text>
        ))}
        <path d={area(1)} fill={GOOD} fillOpacity="0.35" />
        <path d={area(-1)} fill={BAD} fillOpacity="0.35" />
        <path d={pts.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)},${y2(p.rv).toFixed(1)}`).join(" ")} fill="none" stroke="#d6dae1" strokeWidth="1.2" />
        {axisX}
      </svg>
      <p className="mt-1 text-[10px] text-text-dim">
        Cumulative run value (Statcast delta run expectancy), {role === "hitter" ? "batting runs" : "runs saved"}; above zero is good for him.
      </p>
    </div>
  );
}
