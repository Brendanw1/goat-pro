"use client";

import { PITCH_CONFIG } from "@/lib/constants";

/**
 * Location value (PP20), read as runs. Each zone is priced at the league's
 * measured run value for that pitch family there; a pitcher's location runs
 * are his share of each pitch in each zone minus the league's share for the
 * SAME pitch, times the price. What's left of the total is pitch mix. The
 * bake asserts the parts sum to the total. Explanations live in the glossary.
 */

const ZONE_LABEL = ["Heart", "Shadow", "Chase", "Waste"];
const MORE = ["Attacks the heart", "Lives on the edges", "More pitches just off the plate", "More non-competitive pitches"];
const LESS = ["Stays out of the heart", "Fewer pitches on the edges", "Fewer pitches just off the plate", "Rarely wastes one"];
const FAM: Record<string, { label: string; code: keyof typeof PITCH_CONFIG }> = {
  FB: { label: "Four-seam", code: "FF" }, SI: { label: "Sinker", code: "SI" }, CT: { label: "Cutter", code: "CT" },
  SL: { label: "Slider", code: "SL" }, CB: { label: "Curveball", code: "CB" }, CH: { label: "Changeup", code: "CH" },
};
// target rings, waste (outer) to heart (inner), in a 120×138 box
const RING = [[0, 0, 120, 138], [14, 16, 92, 106], [28, 32, 64, 74], [42, 48, 36, 42]];

type Zone = [number, number, number]; // [his %, league % for this pitch, runs]
type Pitch = { fam: string; n: number; runs: number; zones: Zone[] };
type Cell = { fam: string; z: number; zone: Zone };

const runs = (v: number | null | undefined, nd = 1): string =>
  v == null || !Number.isFinite(v) ? "—" : `${+v.toFixed(nd) >= 0 ? "+" : "−"}${Math.abs(v).toFixed(nd)}`;
const tone = (v: number) => (v >= 0.05 ? "text-emerald-400" : v <= -0.05 ? "text-rose-400" : "text-text-secondary");
const tint = (r: number) =>
  Math.abs(r) < 0.1 ? "rgba(255,255,255,0.06)"
    : `rgba(${r > 0 ? "52,211,153" : "251,113,133"},${(0.22 + Math.min(Math.abs(r) / 1.5, 1) * 0.6).toFixed(2)})`;
const ordinal = (p: number): string => {
  const v = Math.round(p), r10 = v % 10, r100 = v % 100;
  return `${v}${r10 === 1 && r100 !== 11 ? "st" : r10 === 2 && r100 !== 12 ? "nd" : r10 === 3 && r100 !== 13 ? "rd" : "th"}`;
};

function Habit({ title, cell }: { title: string; cell: Cell | null }) {
  if (!cell) return null;
  const [his, lg, r] = cell.zone;
  return (
    <div className={`rounded-md border p-2.5 ${r >= 0 ? "border-emerald-400/30 bg-emerald-400/[0.06]" : "border-rose-400/30 bg-rose-400/[0.06]"}`}>
      <div className="text-[10px] uppercase tracking-wider text-text-dim">{title}</div>
      <div className="text-xs text-text-primary mt-1">
        {FAM[cell.fam]?.label}: {(his >= lg ? MORE : LESS)[cell.z].toLowerCase()}
      </div>
      <div className="text-[10px] text-text-dim mt-0.5 font-data">
        {his.toFixed(0)}% vs {lg.toFixed(0)}% avg · <span className={tone(r)}>{runs(r)} runs</span>
      </div>
    </div>
  );
}

function Target({ p }: { p: Pitch }) {
  const color = PITCH_CONFIG[FAM[p.fam]?.code]?.color ?? "#8B93A3";
  return (
    <div className="rounded-md border border-border-subtle p-2.5">
      <div className="flex items-center justify-between mb-2 text-[11px]">
        <span className="flex items-center gap-1.5 text-text-primary">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
          {FAM[p.fam]?.label ?? p.fam}
          <span className="text-text-dim">· {p.n.toLocaleString("en-US")}</span>
        </span>
        <span className={`font-data ${tone(p.runs)}`}>{runs(p.runs)}</span>
      </div>
      <div className="flex gap-3 items-center">
        <svg viewBox="0 0 120 138" className="w-[64px] shrink-0" aria-hidden>
          {RING.map(([x, y, w, h], i) => (
            <rect key={i} x={x} y={y} width={w} height={h} rx={4} fill={tint(p.zones[3 - i][2])}
              stroke="rgba(255,255,255,0.15)" strokeWidth={1} />
          ))}
          <rect x={35} y={40} width={50} height={58} fill="none" stroke="rgba(255,255,255,0.5)" strokeDasharray="3 3" />
        </svg>
        <table className="flex-1 text-[10px] font-data">
          <thead>
            <tr className="text-text-dim">
              <th className="text-left font-normal"><span className="sr-only">Zone</span></th>
              <th className="text-right font-normal">Him</th>
              <th className="text-right font-normal">Avg</th>
              <th className="text-right font-normal">Runs</th>
            </tr>
          </thead>
          <tbody>
            {p.zones.map(([his, lg, r], z) => (
              <tr key={z}>
                <td className="text-text-secondary font-sans">{ZONE_LABEL[z]}</td>
                <td className="text-right text-text-primary">{his.toFixed(0)}%</td>
                <td className="text-right text-text-dim">{lg.toFixed(0)}%</td>
                <td className={`text-right ${tone(r)}`}>{runs(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function LocationMixPanel({ data, name }: {
  data: { meta: any; pitcher: any } | null;
  playerId?: string;
  name?: string;
}) {
  if (!data?.meta) return null;
  const p = data.pitcher;
  if (!p?.byPitch) {
    return (
      <div className="glass-panel p-4">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim mb-2">Location value</h2>
        <p className="text-[11px] text-text-secondary">
          Not published for {name || "this pitcher"}: under {data.meta.gates?.minPitches ?? 200} located pitches.
        </p>
      </div>
    );
  }
  const pitches: Pitch[] = p.byPitch;
  const cells: Cell[] = pitches.flatMap((q) => q.zones.map((zone, z) => ({ fam: q.fam, z, zone })));
  const best = cells.reduce<Cell | null>((a, c) => (c.zone[2] > (a?.zone[2] ?? 0) ? c : a), null);
  const worst = cells.reduce<Cell | null>((a, c) => (c.zone[2] < (a?.zone[2] ?? 0) ? c : a), null);
  const big = cells.filter((c) => Math.abs(c.zone[2]) >= 0.3).sort((a, b) => b.zone[2] - a.zone[2]);
  const rest = p.locRuns - big.reduce((a, c) => a + c.zone[2], 0);

  return (
    <div className="glass-panel p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">Location value</h2>
        <span className="text-[10px] text-text-dim">{data.meta.season} · {p.n.toLocaleString("en-US")} pitches</span>
      </div>

      <div className="flex flex-wrap items-end gap-x-6 gap-y-2 mb-4">
        <div>
          <div className={`font-data text-2xl ${tone(p.runs)}`}>{runs(p.runs)} <span className="text-sm text-text-secondary">runs</span></div>
          <div className="text-[10px] text-text-dim">
            {runs(p.mix, 2)} per start{p.pct != null ? ` · ${ordinal(p.pct)} percentile` : ""}
          </div>
        </div>
        <div className="text-[11px] text-text-secondary font-data">
          Location <span className={tone(p.locRuns)}>{runs(p.locRuns)}</span>
          <span className="text-text-dim"> · </span>
          Pitch mix <span className={tone(p.mixRuns)}>{runs(p.mixRuns)}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
        <Habit title="Best habit" cell={best} />
        <Habit title="Costliest habit" cell={worst} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {pitches.map((q) => <Target key={q.fam} p={q} />)}
      </div>

      <details className="mt-3 border-t border-border-subtle pt-2.5 text-[11px]">
        <summary className="cursor-pointer text-[10px] uppercase tracking-wider text-text-dim">Where the runs came from</summary>
        <div className="mt-2 space-y-1 font-data">
          {big.map((c) => (
            <div key={`${c.fam}${c.z}`} className="flex justify-between gap-2">
              <span className="font-sans text-text-secondary">
                {FAM[c.fam]?.label} · {ZONE_LABEL[c.z]} <span className="text-text-dim">{c.zone[0].toFixed(0)}% vs {c.zone[1].toFixed(0)}%</span>
              </span>
              <span className={tone(c.zone[2])}>{runs(c.zone[2])}</span>
            </div>
          ))}
          <div className="flex justify-between text-text-dim"><span className="font-sans">Everything else</span><span>{runs(rest)}</span></div>
          <div className="flex justify-between"><span className="font-sans text-text-secondary">Pitch mix</span><span className={tone(p.mixRuns)}>{runs(p.mixRuns)}</span></div>
          <div className="flex justify-between border-t border-white/[0.05] pt-1">
            <span className="font-sans text-text-primary">Total</span><span className={tone(p.runs)}>{runs(p.runs)}</span>
          </div>
        </div>
      </details>
    </div>
  );
}
