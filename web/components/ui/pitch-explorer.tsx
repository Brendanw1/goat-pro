"use client";
/**
 * Pitch explorer: every pitch of a player-season (bake family `pitches`), filtered by pitch type, opponent
 * hand, count and outcome, drawn as a location grid (density, whiff%, RV/100 or xwOBA) plus run value by
 * pitch type and its season path. Descriptive throughout; colours read good/bad for the player whose page it is.
 */
import { useEffect, useMemo, useState } from "react";
import { PITCH_CONFIG } from "@/lib/constants";
import { percentileColor } from "@/lib/percentiles";
import type { PitchType } from "@/types";

type File = {
  side: "P" | "H"; season: number; types: string[]; outcomes: string[]; zone: [number, number]; start: string;
  t: number[]; x: number[]; z: number[]; h: number[]; c: number[]; o: number[]; r: number[];
  e: (number | null)[]; w: (number | null)[]; d: number[];
};

const colorOf = (t: string) => PITCH_CONFIG[t as PitchType]?.color ?? "#8C9591";
const X0 = -1.9, X1 = 1.9, Z0 = 0.4, Z1 = 4.6, NX = 10, NZ = 11;
const SWING = new Set([2, 3, 4, 5, 6, 7, 8]);
const BIP = new Set([4, 5, 6, 7, 8]);

const COUNTS = [["all", "All counts"], ["first", "0-0"], ["pAhead", "Pitcher ahead"], ["even", "Even"],
  ["hAhead", "Hitter ahead"], ["two", "Two strikes"]] as const;
const OUTCOMES = [["all", "All pitches"], ["swing", "Swings"], ["whiff", "Whiffs"], ["called", "Called strikes"],
  ["bip", "In play"], ["hard", "Hard-hit (95+)"]] as const;
const METRICS = [["density", "Where"], ["whiff", "Whiff%"], ["rv", "RV/100"], ["xwoba", "xwOBA"]] as const;

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

function Chips<T extends string>({ opts, value, onChange }: { opts: readonly (readonly [T, string])[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {opts.map(([k, l]) => (
        <button key={k} type="button" onClick={() => onChange(k)} aria-pressed={value === k}
          className={`px-2 py-0.5 rounded-md text-[11px] border ${value === k ? "border-usf-gold/60 text-text-primary bg-white/[0.06]" : "border-border-subtle text-text-secondary hover:bg-white/[0.04]"}`}>
          {l}
        </button>
      ))}
    </div>
  );
}

export function PitchExplorer({ id, season, side, level = "mlb" }: { id: string; season: number; side: "P" | "H"; level?: string }) {
  const [file, setFile] = useState<File | null | undefined>(undefined);
  const [types, setTypes] = useState<Set<string>>(new Set());
  const [hand, setHand] = useState<"all" | "L" | "R">("all");
  const [cnt, setCnt] = useState<string>("all");
  const [out, setOut] = useState<string>("all");
  const [metric, setMetric] = useState<string>("density");

  useEffect(() => {
    let live = true;
    setFile(undefined);
    fetch(`/api/data/pitches/${id}?side=${side}&season=${season}&level=${level}`)
      .then((r) => (r.ok ? r.json() : null)).then((j) => { if (live) setFile(j); }).catch(() => live && setFile(null));
    return () => { live = false; };
  }, [id, season, side, level]);

  // rows passing every filter but the type filter (the type table shows each type under the same filters)
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
  const rows = useMemo(() => (types.size && file ? base.filter((i) => types.has(file.types[file.t[i]])) : base), [base, types, file]);

  if (file === undefined) return <p className="text-xs text-text-dim py-6">Loading pitches…</p>;
  if (!file) return <p className="text-xs text-text-dim py-6">No pitch-level file for this season.</p>;

  const pitcher = file.side === "P";
  const oppLabel = pitcher ? "batter" : "pitcher";
  // goodness 0-100 for the page's player -> the site's percentile ramp
  const good = (m: string, v: number) => {
    const clamp = (q: number) => Math.max(1, Math.min(99, q));
    if (m === "whiff") return clamp(50 + (pitcher ? 1 : -1) * ((v - 0.25) / 0.2) * 50);
    if (m === "rv") return clamp(50 + (v / 4) * 50);
    return clamp(50 + (pitcher ? -1 : 1) * ((v - 0.36) / 0.25) * 50);
  };

  // grid
  const cells = Array.from({ length: NX * NZ }, () => ({ n: 0, sw: 0, wh: 0, r: 0, wn: 0, ws: 0 }));
  for (const i of rows) {
    const x = file.x[i] / 100, z = file.z[i] / 100;
    if (x < X0 || x >= X1 || z < Z0 || z >= Z1) continue;
    const cl = cells[Math.floor(((z - Z0) / (Z1 - Z0)) * NZ) * NX + Math.floor(((x - X0) / (X1 - X0)) * NX)];
    cl.n++; cl.r += file.r[i];
    if (SWING.has(file.o[i])) cl.sw++;
    if (file.o[i] === 2) cl.wh++;
    const w = file.w[i];
    if (w !== null) { cl.wn++; cl.ws += w / 1000; }
  }
  const maxN = Math.max(1, ...cells.map((c) => c.n));
  const W = 220, H = (W * (Z1 - Z0)) / (X1 - X0), cw = W / NX, ch = H / NZ;
  const px = (x: number) => ((x - X0) / (X1 - X0)) * W, pz = (z: number) => H - ((z - Z0) / (Z1 - Z0)) * H;

  // per-type table + season path
  const byType = file.types.map((t, ti) => {
    const ix = base.filter((i) => file.t[i] === ti);
    const n = ix.length, sw = ix.filter((i) => SWING.has(file.o[i])).length;
    const wh = ix.filter((i) => file.o[i] === 2).length, csw = ix.filter((i) => file.o[i] === 1 || file.o[i] === 2).length;
    const ws = ix.map((i) => file.w[i]).filter((w): w is number => w !== null);
    const es = ix.map((i) => file.e[i]).filter((e): e is number => e !== null);
    const rv = ix.reduce((a, i) => a + file.r[i], 0) / 1000;
    let cum = 0;
    const path = ix.map((i) => { cum += file.r[i] / 1000; return [file.d[i], cum] as [number, number]; });
    return { t, n, usage: base.length ? (100 * n) / base.length : 0, rv100: n ? (100 * rv) / n : null, rv,
      whiff: sw ? (100 * wh) / sw : null, csw: n ? (100 * csw) / n : null,
      xw: ws.length ? ws.reduce((a, b) => a + b, 0) / ws.length / 1000 : null,
      ev: es.length ? es.reduce((a, b) => a + b, 0) / es.length / 10 : null, path };
  }).filter((r) => r.n > 0);
  const lastDay = Math.max(1, ...file.d);
  const allCum = byType.flatMap((r) => r.path.map((p) => p[1]));
  const lo = Math.min(0, ...allCum), hi = Math.max(0, ...allCum);
  const PW = 320, PH = 120, sx = (d: number) => (d / lastDay) * PW, sy = (v: number) => PH - ((v - lo) / (hi - lo || 1)) * PH;
  const f = (v: number | null, d: number) => (v === null || !Number.isFinite(v) ? "—" : v.toFixed(d));
  const toggle = (t: string) => setTypes((s) => { const n = new Set(s); if (n.has(t)) n.delete(t); else n.add(t); return n; });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        {file.types.map((t) => (
          <button key={t} type="button" onClick={() => toggle(t)} aria-pressed={types.has(t)}
            className={`px-2 py-0.5 rounded-md text-[11px] font-data border ${types.has(t) ? "bg-white/[0.08] text-text-primary" : "text-text-secondary hover:bg-white/[0.04]"}`}
            style={{ borderColor: types.has(t) ? colorOf(t) : undefined }}>
            <span style={{ color: colorOf(t) }}>●</span> {t}
          </button>
        ))}
        {types.size > 0 && <button type="button" onClick={() => setTypes(new Set())} className="px-2 py-0.5 text-[11px] text-text-dim hover:text-text-secondary">all types</button>}
      </div>
      <Chips opts={[["all", `Both ${oppLabel} hands`], ["L", `vs L${pitcher ? "HB" : "HP"}`], ["R", `vs R${pitcher ? "HB" : "HP"}`]] as const} value={hand} onChange={setHand} />
      <Chips opts={COUNTS} value={cnt as any} onChange={setCnt} />
      <Chips opts={OUTCOMES} value={out as any} onChange={setOut} />
      <div className="grid gap-5 lg:grid-cols-[auto_1fr]">
        <div>
          <Chips opts={METRICS} value={metric as any} onChange={setMetric} />
          <svg width={W} height={H} className="mt-2" role="img" aria-label={`${rows.length} pitches by location, ${metric}`}>
            {cells.map((c, k) => {
              const i = k % NX, j = Math.floor(k / NX);
              let fill: string | null = null, tip = `${c.n} pitches`;
              if (metric === "density" && c.n) { fill = `rgba(232,180,60,${(0.12 + 0.88 * c.n / maxN).toFixed(3)})`; }
              if (metric === "whiff" && c.sw >= 8) { const v = c.wh / c.sw; fill = percentileColor(good("whiff", v)); tip = `whiff ${(100 * v).toFixed(0)}% of ${c.sw} swings`; }
              if (metric === "rv" && c.n >= 15) { const v = (100 * c.r) / 1000 / c.n; fill = percentileColor(good("rv", v)); tip = `${v.toFixed(1)} runs/100 on ${c.n} pitches`; }
              if (metric === "xwoba" && c.wn >= 5) { const v = c.ws / c.wn; fill = percentileColor(good("xwoba", v)); tip = `xwOBA ${v.toFixed(3).replace(/^0/, "")} on ${c.wn} in play`; }
              return fill ? <rect key={k} x={i * cw} y={H - (j + 1) * ch} width={cw - 1} height={ch - 1} fill={fill} rx={2}><title>{tip}</title></rect> : null;
            })}
            <rect x={px(-0.83)} y={pz(file.zone[1])} width={px(0.83) - px(-0.83)} height={pz(file.zone[0]) - pz(file.zone[1])}
              fill="none" stroke="currentColor" className="text-text-secondary" strokeWidth={1.2} />
          </svg>
          <p className="mt-1 text-[10px] text-text-dim max-w-[220px]">
            Catcher&rsquo;s view · {rows.length.toLocaleString()} pitches. Rates need 8+ swings, RV 15+ pitches, xwOBA 5+ balls in play per cell.
            Green = good for {pitcher ? "him on the mound" : "him at the plate"}.
          </p>
        </div>
        <div className="space-y-3 overflow-x-auto">
          <table className="text-[11px] font-data">
            <thead className="text-text-dim"><tr>
              {["Type", "Pitches", "Usage", "RV/100", "Runs", "Whiff%", "CSW%", "xwOBA", "EV"].map((h) => <th key={h} className="pr-3 text-right first:text-left font-normal">{h}</th>)}
            </tr></thead>
            <tbody>{byType.map((r) => (
              <tr key={r.t} className="text-text-secondary">
                <td className="pr-3" style={{ color: colorOf(r.t) }}>{r.t}</td>
                <td className="pr-3 text-right">{r.n}</td><td className="pr-3 text-right">{f(r.usage, 1)}%</td>
                <td className="pr-3 text-right" style={{ color: r.n >= 50 && r.rv100 !== null ? percentileColor(good("rv", r.rv100)) : undefined }}>{f(r.rv100, 2)}</td>
                <td className="pr-3 text-right">{f(r.rv, 1)}</td><td className="pr-3 text-right">{f(r.whiff, 1)}</td>
                <td className="pr-3 text-right">{f(r.csw, 1)}</td><td className="pr-3 text-right">{r.xw === null ? "—" : r.xw.toFixed(3).replace(/^0/, "")}</td>
                <td className="pr-3 text-right">{f(r.ev, 1)}</td>
              </tr>
            ))}</tbody>
          </table>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-text-dim">Run value through the season, by pitch type ({pitcher ? "pitcher" : "hitter"}-positive runs)</p>
            <svg width={PW} height={PH} className="mt-1" role="img" aria-label="cumulative run value by pitch type across the season">
              <line x1={0} x2={PW} y1={sy(0)} y2={sy(0)} stroke="currentColor" className="text-white/20" />
              {byType.map((r) => (
                <polyline key={r.t} fill="none" stroke={colorOf(r.t)} strokeWidth={1.5}
                  points={r.path.filter((_, k) => k % 4 === 0 || k === r.path.length - 1).map(([d, v]) => `${sx(d).toFixed(1)},${sy(v).toFixed(1)}`).join(" ")}>
                  <title>{`${r.t}: ${r.rv.toFixed(1)} runs on ${r.n} pitches`}</title>
                </polyline>
              ))}
            </svg>
            <p className="text-[10px] text-text-dim">Left = his first game ({file.start}); the type table and this chart follow every filter but the type chips.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
