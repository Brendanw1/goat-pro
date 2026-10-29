"use client";
/**
 * Pitch explorer: every pitch of a player-season (bake family `pitches`), filtered by pitch type, opponent
 * hand, count and outcome. Surfaces follow the college pitch-surface plot: an all-pitches panel plus one per
 * pitch type, a Gaussian kernel whose width adapts to the panel's sample (0.5 ft under 150 pitches, 0.18 ft
 * over 600, linear between), a cell drawn only with enough pitches within a bandwidth, the LOCATION ramp for
 * where / rates and a red-to-teal ramp for value (RV/100, xwOBAcon, Whiff+, Pitching+) read for the player
 * on the page, a dashed zone, a hero number per panel and a cursor shared across panels.
 * Whiff+ / Pitching+ per pitch sit on their season scales, so a slice's grade is the plain mean.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { PITCH_CONFIG } from "@/lib/constants";
import type { PitchType } from "@/types";
import { PitchSplits, type SplitFile } from "@/components/ui/pitch-splits";
import { PitchTrends, type TrendFile } from "@/components/ui/pitch-trends";

type Num = number | null;
type File = {
  side: "P" | "H"; season: number; types: string[]; outcomes: string[]; zone: [number, number]; start: string;
  t: number[]; x: number[]; z: number[]; h: number[]; c: number[]; o: number[]; r: number[];
  e: Num[]; w: Num[]; d: number[]; q?: number[]; lgc?: Record<string, [Num, Num]>; ba?: Num[]; sl?: Num[]; wp?: Num[]; pp?: Num[];
};

const colorOf = (t: string) => PITCH_CONFIG[t as PitchType]?.color ?? "#8C9591";
const X0 = -1.9, X1 = 1.9, Z0 = 0.4, Z1 = 4.6, CELL = 0.1;
const NX = Math.round((X1 - X0) / CELL), NZ = Math.round((Z1 - Z0) / CELL);
const SWING = new Set([2, 3, 4, 5, 6, 7, 8]);
const BIP = new Set([4, 5, 6, 7, 8]);
const MIN_EFF = 5; // kernel weight (≈ pitches within a bandwidth) a cell needs before it is drawn

const COUNTS = [["all", "All counts"], ["first", "0-0"], ["pAhead", "Pitcher ahead"], ["even", "Even"],
  ["hAhead", "Hitter ahead"], ["two", "Two strikes"]] as const;
const OUTCOMES = [["all", "All pitches"], ["swing", "Swings"], ["whiff", "Whiffs"], ["called", "Called strikes"],
  ["bip", "In play"], ["hard", "Hard-hit (95+)"]] as const;

type Metric = {
  key: string; label: string; kind: "density" | "rate" | "value";
  /** per pitch: [value, 1]; null = not in this metric's denominator */
  of?: (f: File, i: number) => [number, number] | null;
  lo: number; hi: number; mid?: number; fmt: (v: number) => string;
  /** +1 when higher is better for a pitcher (flipped on hitter pages), 0 = no good/bad */
  dir: number; pitcherOnly?: boolean;
};

const pct = (v: number) => `${(100 * v).toFixed(0)}%`;
const x3 = (v: number) => v.toFixed(3).replace(/^0/, "");
const METRICS: Metric[] = [
  { key: "density", label: "Where", kind: "density", lo: 0, hi: 1, fmt: pct, dir: 0 },
  { key: "whiff", label: "Whiff%", kind: "rate", of: (f, i) => (SWING.has(f.o[i]) ? [f.o[i] === 2 ? 1 : 0, 1] : null), lo: 0, hi: 0.6, fmt: pct, dir: 0 },
  { key: "csw", label: "CSW%", kind: "rate", of: (f, i) => [f.o[i] === 1 || f.o[i] === 2 ? 1 : 0, 1], lo: 0, hi: 0.5, fmt: pct, dir: 0 },
  { key: "swing", label: "Swing%", kind: "rate", of: (f, i) => [SWING.has(f.o[i]) ? 1 : 0, 1], lo: 0, hi: 1, fmt: pct, dir: 0 },
  { key: "rv", label: "RV/100", kind: "value", of: (f, i) => [f.r[i] / 10, 1], lo: -6, hi: 6, mid: 0, fmt: (v) => v.toFixed(1), dir: 1 },
  { key: "xwobacon", label: "xwOBAcon", kind: "value", of: (f, i) => (f.w[i] === null ? null : [f.w[i]! / 1000, 1]), lo: 0.12, hi: 0.62, mid: 0.37, fmt: x3, dir: -1 },
  { key: "whiffPlus", label: "Whiff+", kind: "value", of: (f, i) => (f.wp?.[i] == null ? null : [f.wp[i]! / 10, 1]), lo: 70, hi: 130, mid: 100, fmt: (v) => v.toFixed(0), dir: 1, pitcherOnly: true },
  { key: "pitchingPlus", label: "Pitching+", kind: "value", of: (f, i) => (f.pp?.[i] == null ? null : [f.pp[i]! / 10, 1]), lo: 70, hi: 130, mid: 100, fmt: (v) => v.toFixed(0), dir: 1, pitcherOnly: true },
];

type Stops = [number, [number, number, number]][];
/** College LOCATION ramp: pale yellow, orange, magenta, violet, indigo. */
const LOC: Stops = [[0, [250, 247, 237]], [0.25, [232, 118, 26]], [0.5, [214, 61, 154]], [0.75, [130, 80, 200]], [1, [64, 60, 160]]];
/** College DIVERGING ramp, red (bad) through neutral to teal (good); neutral darkened for a dark panel. */
const DIV: Stops = [[0, [196, 52, 52]], [0.5, [72, 78, 88]], [1, [30, 170, 160]]];

function ramp(stops: Stops, t: number): [number, number, number] {
  const u = Math.max(0, Math.min(1, t));
  for (let k = 1; k < stops.length; k++) {
    if (u <= stops[k][0]) {
      const [p0, c0] = stops[k - 1], [p1, c1] = stops[k];
      const s = (u - p0) / (p1 - p0);
      return [0, 1, 2].map((j) => Math.round(c0[j] + (c1[j] - c0[j]) * s)) as [number, number, number];
    }
  }
  return stops[stops.length - 1][1];
}

function countOk(c: number, g: string) {
  const b = Math.floor(c / 3), s = c % 3;
  switch (g) {
    case "first": return c === 0;
    case "pAhead": return s > b;
    case "even": return s === b && c !== 0;
    case "hAhead": return b > s;
    case "two": return s === 2;
    default: return true;
  }
}

function outcomeOk(f: File, i: number, g: string) {
  const o = f.o[i];
  switch (g) {
    case "swing": return SWING.has(o);
    case "whiff": return o === 2;
    case "called": return o === 1;
    case "bip": return BIP.has(o);
    case "hard": return BIP.has(o) && (f.e[i] ?? 0) >= 950;
    default: return true;
  }
}

/** Kernel surface for one panel: per-cell value (NaN = not drawn) and the panel's overall value. */
function surface(f: File, ix: number[], m: Metric) {
  const n = ix.length;
  const sigma = n <= 150 ? 0.5 : n >= 600 ? 0.18 : 0.5 - ((n - 150) / 450) * 0.32;
  const R = Math.ceil((3 * sigma) / CELL), inv = 1 / (2 * sigma * sigma);
  const num = new Float64Array(NX * NZ), den = new Float64Array(NX * NZ);
  let tn = 0, td = 0;
  for (const i of ix) {
    const a = m.of ? m.of(f, i) : [1, 1];
    if (!a) continue;
    tn += a[0]; td += a[1];
    const x = f.x[i] / 100, z = f.z[i] / 100;
    const ci = Math.floor((x - X0) / CELL), cj = Math.floor((z - Z0) / CELL);
    for (let dj = -R; dj <= R; dj++) {
      const j = cj + dj;
      if (j < 0 || j >= NZ) continue;
      const dz = Z0 + (j + 0.5) * CELL - z;
      for (let di = -R; di <= R; di++) {
        const k = ci + di;
        if (k < 0 || k >= NX) continue;
        const dx = X0 + (k + 0.5) * CELL - x;
        const wgt = Math.exp(-(dx * dx + dz * dz) * inv);
        if (wgt < 0.01) continue;
        num[j * NX + k] += wgt * a[0];
        den[j * NX + k] += wgt * a[1];
      }
    }
  }
  const val = new Float64Array(NX * NZ).fill(NaN);
  if (m.kind === "density") {
    let mx = 0;
    for (let c = 0; c < den.length; c++) mx = Math.max(mx, den[c]);
    for (let c = 0; c < den.length; c++) if (mx > 0 && den[c] / mx > 0.02) val[c] = den[c] / mx;
  } else {
    for (let c = 0; c < den.length; c++) if (den[c] >= MIN_EFF) val[c] = num[c] / den[c];
  }
  return { val, overall: td ? tn / td : NaN, n: td, sigma };
}

const chipCls = (on: boolean) =>
  `px-2 py-0.5 rounded-md text-[11px] border ${on ? "border-usf-gold/60 text-text-primary bg-white/[0.06]" : "border-border-subtle text-text-secondary hover:bg-white/[0.04]"}`;

function Chips<T extends string>({ opts, value, onChange }: { opts: readonly (readonly [T, string])[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {opts.map(([k, l]) => (
        <button key={k} type="button" onClick={() => onChange(k)} aria-pressed={value === k} className={chipCls(value === k)}>{l}</button>
      ))}
    </div>
  );
}

const PW = 190, PH = Math.round((PW * (Z1 - Z0)) / (X1 - X0));

function Panel({ title, color, surf, m, good, zone, cursor, setCursor }: {
  title: string; color?: string; surf: ReturnType<typeof surface>; m: Metric; good: number;
  zone: [number, number]; cursor: number | null; setCursor: (c: number | null) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(NX, NZ);
    for (let j = 0; j < NZ; j++) {
      for (let k = 0; k < NX; k++) {
        const v = surf.val[j * NX + k], p = ((NZ - 1 - j) * NX + k) * 4;
        if (!Number.isFinite(v)) continue;
        let rgb: [number, number, number], alpha = 235;
        if (m.kind === "density") { rgb = ramp(LOC, v); alpha = Math.round(255 * Math.min(1, v / 0.2)); }
        else if (m.kind === "rate") rgb = ramp(LOC, (v - m.lo) / (m.hi - m.lo));
        else rgb = ramp(DIV, 0.5 + 0.5 * Math.max(-1, Math.min(1, ((v - m.mid!) / ((m.hi - m.lo) / 2)) * good)));
        img.data.set([...rgb, alpha], p);
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [surf, m, good]);
  const fx = (x: number) => ((x - X0) / (X1 - X0)) * PW, fz = (z: number) => PH - ((z - Z0) / (Z1 - Z0)) * PH;
  const hover = (ev: React.MouseEvent) => {
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const k = Math.floor(((ev.clientX - r.left) / r.width) * NX), j = NZ - 1 - Math.floor(((ev.clientY - r.top) / r.height) * NZ);
    setCursor(k >= 0 && k < NX && j >= 0 && j < NZ ? j * NX + k : null);
  };
  const cv = cursor !== null ? surf.val[cursor] : NaN;
  return (
    <div className="rounded-lg border border-border-subtle p-2">
      <div className="flex items-baseline justify-between mb-1 gap-2">
        <span className="text-xs font-medium" style={{ color }}>{title}</span>
        <span className="font-data text-[13px] text-text-primary">
          {m.kind === "density" ? `${Math.round(surf.n)}` : Number.isFinite(surf.overall) ? m.fmt(surf.overall) : "—"}
        </span>
      </div>
      <div className="relative" style={{ width: PW, height: PH }} onMouseMove={hover} onMouseLeave={() => setCursor(null)}>
        <canvas ref={ref} width={NX} height={NZ} className="absolute inset-0 rounded" style={{ width: PW, height: PH }} />
        <svg width={PW} height={PH} className="absolute inset-0" role="img" aria-label={`${title}: ${m.label} by location`}>
          <rect x={fx(-0.83)} y={fz(zone[1])} width={fx(0.83) - fx(-0.83)} height={fz(zone[0]) - fz(zone[1])}
            fill="none" stroke="#fff" strokeOpacity={0.6} strokeDasharray="4 3" strokeWidth={1} />
          {cursor !== null && (
            <circle cx={((cursor % NX) + 0.5) * (PW / NX)} cy={PH - (Math.floor(cursor / NX) + 0.5) * (PH / NZ)} r={6}
              fill="none" stroke="#fff" strokeWidth={1.2} />
          )}
        </svg>
      </div>
      <p className="text-[9px] text-text-dim mt-1 font-data">
        {cursor !== null
          ? (Number.isFinite(cv) ? `here: ${m.kind === "density" ? `${pct(cv)} of peak` : m.fmt(cv)}` : "here: too few pitches")
          : `n=${Math.round(surf.n)} · σ ${surf.sigma.toFixed(2)} ft`}
      </p>
    </div>
  );
}

export function PitchExplorer({ id, season, side, level = "mlb" }: { id: string; season: number; side: "P" | "H"; level?: string }) {
  const [file, setFile] = useState<File | null | undefined>(undefined);
  const [off, setOff] = useState<Set<string>>(new Set()); // types switched OFF; empty = every type shown
  const [hand, setHand] = useState<"all" | "L" | "R">("all");
  const [cnt, setCnt] = useState<string>("all");
  const [out, setOut] = useState<string>("all");
  const [mkey, setMkey] = useState<string>("density");
  const [cursor, setCursor] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    setFile(undefined);
    fetch(`/api/data/pitches/${id}?side=${side}&season=${season}&level=${level}`)
      .then((r) => (r.ok ? r.json() : null)).then((j) => { if (live) setFile(j); }).catch(() => live && setFile(null));
    return () => { live = false; };
  }, [id, season, side, level]);

  const base = useMemo(() => {
    if (!file) return [] as number[];
    const ix: number[] = [];
    for (let i = 0; i < file.t.length; i++) {
      if (hand !== "all" && file.h[i] !== (hand === "R" ? 1 : 0)) continue;
      if (!countOk(file.c[i], cnt) || !outcomeOk(file, i, out)) continue;
      ix.push(i);
    }
    return ix;
  }, [file, hand, cnt, out]);

  const metrics = METRICS.filter((x) => !x.pitcherOnly || (file?.side === "P" && file.wp));
  const m = metrics.find((x) => x.key === mkey) ?? metrics[0];
  const good = (file?.side === "H" ? -m.dir : m.dir) || 1;
  const panels = useMemo(() => {
    if (!file) return [];
    const sel = base.filter((i) => !off.has(file.types[file.t[i]]));
    const ps = [{ title: off.size ? "Selected types" : "All pitches", color: undefined as string | undefined, surf: surface(file, sel, m) }];
    file.types.forEach((t, ti) => {
      if (off.has(t)) return;
      const ix = base.filter((i) => file.t[i] === ti);
      if (ix.length >= 20) ps.push({ title: t, color: colorOf(t), surf: surface(file, ix, m) });
    });
    return ps;
  }, [file, base, off, m]);

  if (file === undefined) return <p className="text-xs text-text-dim py-6">Loading pitches…</p>;
  if (!file) return <p className="text-xs text-text-dim py-6">No pitch-level file for this season.</p>;

  const pitcher = file.side === "P";
  const opp = pitcher ? "batter" : "pitcher";
  const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
  const row = (label: string, ix: number[], color?: string) => {
    const n = ix.length, sw = ix.filter((i) => SWING.has(file.o[i])).length;
    const bip = ix.filter((i) => BIP.has(file.o[i]));
    const ooz = file.q ? ix.filter((i) => file.q![i] === 0) : [];
    const pick = (a: Num[] | undefined, sc: number) => (a ? mean(ix.map((i) => a[i]).filter((v): v is number => v !== null).map((v) => v / sc)) : null);
    const rv = ix.reduce((a, i) => a + file.r[i], 0) / 1000;
    return { label, color, n, usage: base.length ? (100 * n) / base.length : null,
      whiffPlus: pick(file.wp, 10), pitchingPlus: pick(file.pp, 10), rv100: n ? (100 * rv) / n : null, rv,
      whiff: sw ? (100 * ix.filter((i) => file.o[i] === 2).length) / sw : null,
      chase: ooz.length ? (100 * ooz.filter((i) => SWING.has(file.o[i])).length) / ooz.length : null,
      zone: file.q && n ? (100 * ix.filter((i) => file.q![i] === 1).length) / n : null,
      csw: n ? (100 * ix.filter((i) => file.o[i] === 1 || file.o[i] === 2).length) / n : null,
      xwobacon: pick(file.w, 1000), xba: pick(file.ba, 1000), xslg: pick(file.sl, 1000), ev: pick(file.e, 10),
      hard: bip.length ? (100 * bip.filter((i) => (file.e[i] ?? 0) >= 950).length) / bip.length : null };
  };
  type Row = ReturnType<typeof row>;
  const rows = [row("All", base), ...file.types.map((t, ti) => row(t, base.filter((i) => file.t[i] === ti), colorOf(t))).filter((r) => r.n > 0)];
  const fmt = (v: number | null, d: number) => (v === null || !Number.isFinite(v) ? "—" : v.toFixed(d));
  const f3 = (v: number | null) => (v === null ? "—" : x3(v));
  const models: [string, (r: Row) => string][] = pitcher && file.wp
    ? [["Whiff+", (r) => fmt(r.whiffPlus === null ? null : Math.min(175, Math.max(50, r.whiffPlus)), 0)], ["Pitching+", (r) => fmt(r.pitchingPlus, 0)]] : [];
  const cols: [string, (r: Row) => string][] = [
    ["Pitches", (r) => String(r.n)], ["Usage", (r) => `${fmt(r.usage, 1)}%`], ...models,
    ["RV/100", (r) => fmt(r.rv100, 2)], ["Runs", (r) => fmt(r.rv, 1)], ["Whiff%", (r) => fmt(r.whiff, 1)],
    ["Chase%", (r) => fmt(r.chase, 1)], ["Zone%", (r) => fmt(r.zone, 1)], ["CSW%", (r) => fmt(r.csw, 1)],
    ["xwOBAcon", (r) => f3(r.xwobacon)], ["xBA", (r) => f3(r.xba)], ["xSLG", (r) => f3(r.xslg)],
    ["EV", (r) => fmt(r.ev, 1)], ["Hard%", (r) => fmt(r.hard, 1)],
  ];

  // season path: running run value by type, one point per day
  const paths = file.types.map((t, ti) => {
    if (off.has(t)) return null;
    let cum = 0;
    const p: [number, number][] = [];
    for (const i of base) {
      if (file.t[i] !== ti) continue;
      cum += file.r[i] / 1000;
      if (p.length && p[p.length - 1][0] === file.d[i]) p[p.length - 1][1] = cum; else p.push([file.d[i], cum]);
    }
    return p.length ? { t, p, total: cum } : null;
  }).filter(Boolean) as { t: string; p: [number, number][]; total: number }[];
  const lastDay = Math.max(1, ...file.d);
  const allCum = paths.flatMap((r) => r.p.map((q) => q[1]));
  const lo = Math.min(0, ...allCum), hi = Math.max(0, ...allCum);
  const SW = 360, SH = 120, sx = (d: number) => (d / lastDay) * SW, sy = (v: number) => SH - ((v - lo) / (hi - lo || 1)) * SH;
  const toggle = (t: string) => setOff((s) => { const n = new Set(s); if (n.has(t)) n.delete(t); else n.add(t); return n; });

  const legend = m.kind === "density" ? ["fewest", "most"] : m.kind === "rate" || good > 0 ? [m.fmt(m.lo), m.fmt(m.hi)] : [m.fmt(m.hi), m.fmt(m.lo)];
  const legendCss = `linear-gradient(90deg, ${(m.kind === "value" ? DIV : LOC).map(([, c]) => `rgb(${c})`).join(", ")})`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" onClick={() => setOff(new Set())} aria-pressed={off.size === 0} className={chipCls(off.size === 0)}>All types</button>
        {file.types.map((t) => (
          <button key={t} type="button" onClick={() => toggle(t)} aria-pressed={!off.has(t)}
            className={`px-2 py-0.5 rounded-md text-[11px] font-data border ${!off.has(t) ? "bg-white/[0.06] text-text-primary" : "border-border-subtle text-text-dim line-through hover:bg-white/[0.04]"}`}
            style={{ borderColor: !off.has(t) ? colorOf(t) : undefined }}>
            <span style={{ color: colorOf(t) }}>●</span> {t}
          </button>
        ))}
      </div>
      <Chips opts={[["all", `Both ${opp} hands`], ["L", `vs L${pitcher ? "HB" : "HP"}`], ["R", `vs R${pitcher ? "HB" : "HP"}`]] as const} value={hand} onChange={setHand} />
      <Chips opts={COUNTS} value={cnt as (typeof COUNTS)[number][0]} onChange={setCnt} />
      <Chips opts={OUTCOMES} value={out as (typeof OUTCOMES)[number][0]} onChange={setOut} />
      <div className="flex flex-wrap items-center gap-3">
        <Chips opts={metrics.map((x) => [x.key, x.label] as const)} value={m.key} onChange={setMkey} />
        <div className="flex items-center gap-1.5 text-[10px] text-text-dim font-data">
          <span>{legend[0]}</span><span className="inline-block h-2 w-28 rounded" style={{ background: legendCss }} /><span>{legend[1]}</span>
          {m.kind === "value" && <span>· teal = good for him {pitcher ? "on the mound" : "at the plate"}</span>}
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        {panels.map((p) => <Panel key={p.title} {...p} m={m} good={good} zone={file.zone} cursor={cursor} setCursor={setCursor} />)}
      </div>
      <p className="text-[10px] text-text-dim leading-[1.5] max-w-[90ch]">
        Catcher&rsquo;s view · {base.length.toLocaleString()} pitches after filters. Each panel is smoothed by a kernel that widens on thin
        samples; a cell is drawn once about {MIN_EFF} pitches sit within a bandwidth. The number over each panel is its overall value
        (pitch count on Where); hovering rings the same spot in every panel. Dashed box = his average rulebook zone.
      </p>
      <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
      <div className="space-y-3 min-w-0 max-w-full lg:max-w-[820px]">
      <div className="overflow-x-auto">
        <table className="text-[11px] font-data">
          <thead className="text-text-dim"><tr>
            <th className="pr-3 text-left font-normal">Type</th>
            {cols.map(([h]) => <th key={h} className="pr-3 text-right font-normal">{h}</th>)}
          </tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.label} className={r.label === "All" ? "text-text-primary border-b border-border-subtle" : "text-text-secondary"}>
              <td className="pr-3" style={{ color: r.color }}>{r.label}</td>
              {cols.map(([h, g]) => <td key={h} className="pr-3 text-right">{g(r)}</td>)}
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-wider text-text-dim">Run value through the season, by pitch type ({pitcher ? "pitcher" : "hitter"}-positive runs)</p>
        <svg width={SW} height={SH} className="mt-1" role="img" aria-label="running run value by pitch type across the season">
          <line x1={0} x2={SW} y1={sy(0)} y2={sy(0)} stroke="currentColor" className="text-white/20" />
          {paths.map((r) => (
            <polyline key={r.t} fill="none" stroke={colorOf(r.t)} strokeWidth={1.5}
              points={r.p.map(([d, v]) => `${sx(d).toFixed(1)},${sy(v).toFixed(1)}`).join(" ")}>
              <title>{`${r.t}: ${r.total.toFixed(1)} runs`}</title>
            </polyline>
          ))}
        </svg>
        <p className="text-[10px] text-text-dim">Left = his first game ({file.start}). The table and this chart follow every filter; the table lists each type even when its chip is off.</p>
      </div>
      <PitchSplits file={file as unknown as SplitFile} level={level} />
      </div>
      {pitcher && <div className="flex-1 min-w-[300px] max-w-[640px]"><PitchTrends file={file as unknown as TrendFile} /></div>}
      </div>
    </div>
  );
}
