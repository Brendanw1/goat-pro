"use client";

/**
 * Hitter scouting card (H10) + skill grades (H9), wave 3. The zone chart is
 * where he swings and what happens there, drawn in the catcher's view over the
 * plate, split by pitcher hand and pitch group (baked `zones`); the count
 * rows are his approach by situation. The 20-80 estimates are computed in
 * the bake from this season's percentiles (rank -> normal z -> 50+10z,
 * rounded to 5) — labelled estimates, never a model output, and nothing
 * here predicts next season.
 */
import { useMemo, useState } from "react";
import { percentileRamp } from "@/lib/percentiles";
import { signedFixed } from "@/components/ui/shared-ui";

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

/** Cell order of the baked `zones[split].c` lists (web_export.py ZONE_ORDER). */
const ZONE_ORDER = ROWS.flatMap((zz) => COLS.map((zx) => `${zz}-${zx}`));
const HANDS = [["A", "All"], ["R", "vs RHP"], ["L", "vs LHP"]] as const;
const GROUPS = [["", "All pitches"], ["FB", "Fastballs"], ["BR", "Breaking"], ["OS", "Offspeed"]] as const;
const METRICS = [["swing", "Swing%"], ["whiff", "Whiff% vs lg"], ["rv", "RV/100 vs lg"]] as const;
type Metric = (typeof METRICS)[number][0];
/** Diverging caps: a cell this far from league in its own split saturates. */
const CAP = { whiff: 15, rv: 6 } as const;
/** Swing% scale top: a fixed domain so splits compare at a glance. */
const SWING_MAX = 80;
/** Sequential swing-rate ramp: one hue (blue), lightness carries the value — clear of the green/red good-bad colours. */
const SEQ_LO = "#1c2a35", SEQ_HI = "#8fd0f5";
const seqColor = (t: number) => `color-mix(in oklab, ${SEQ_HI} ${Math.round(100 * Math.max(0, Math.min(1, t)))}%, ${SEQ_LO})`;
/** Diverging: the site's good/bad ramp (grey at league, green good for the hitter, red bad). */
const divColor = (d: number, cap: number) => percentileRamp(0.5 + Math.max(-1, Math.min(1, d / cap)) / 2);

const SEG = "rounded-full px-2.5 py-0.5 text-[10px] transition-colors";
function Seg<T extends string>({ value, set, opts }: { value: T; set: (v: T) => void; opts: readonly (readonly [T, string])[] }) {
  return (
    <div className="inline-flex gap-0.5 rounded-full border border-border-subtle p-0.5">
      {opts.map(([k, label]) => (
        <button key={k} type="button" aria-pressed={value === k} onClick={() => set(k)}
          className={`${SEG} ${value === k ? "bg-white/10 text-text-primary" : "text-text-dim hover:text-text-secondary"}`}>{label}</button>
      ))}
    </div>
  );
}

const pct = (a: number, b: number) => (b ? (100 * a) / b : null);

export function ZoneGridPanel({ data, league }: { data: any | null; league?: any | null }) {
  const [hand, setHand] = useState<"A" | "R" | "L">("A");
  const [grp, setGrp] = useState<"" | "FB" | "BR" | "OS">("");
  const [metric, setMetric] = useState<Metric>("swing");
  const zones = data?.zones ?? null;
  const split = zones?.[`${hand}${grp}`] ?? null;
  // A switch hitter's sides differ by pitcher hand; each split draws on the side he batted from most in it.
  const switchHitter = zones?.R?.s && zones?.L?.s && zones.R.s !== zones.L.s;
  const ev = useMemo(() => {
    const m = new Map<string, any>();
    for (const c of data?.cells ?? []) m.set(`${c.zz}-${c.zx}`, c);
    return m;
  }, [data]);

  if (!zones || !split) {
    return (
      <div className="glass-panel p-4">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim mb-2">Where he swings</h2>
        <p className="text-[11px] text-text-dim">No zone data for this season.</p>
      </div>
    );
  }
  const side: "R" | "L" = split.s === "L" ? "L" : "R";
  const lgSplit = league?.[side]?.[`${hand}${grp}`] ?? {};

  // Geometry (SVG units). Catcher's view: a RHH stands on the left (3B side), so his inside column is the left one.
  const CW = 56, ZH = 46, BH = 30, X0 = 70, Y0 = 22;
  const cols = side === "R" ? COLS : [...COLS].reverse();
  const rowY: Record<string, [number, number]> = {
    above: [Y0, BH], high: [Y0 + BH + 4, ZH], mid: [Y0 + BH + 4 + ZH, ZH], low: [Y0 + BH + 4 + 2 * ZH, ZH],
    below: [Y0 + BH + 8 + 3 * ZH, BH],
  };
  const zoneTop = rowY.high[0], zoneBot = rowY.low[0] + ZH, gx1 = X0 + 3 * CW;
  const plateY = rowY.below[0] + BH + 14, W = gx1 + 70, H = plateY + 34;
  const boxX = side === "R" ? 8 : gx1 + 22;

  const cellsOut = ZONE_ORDER.map((key, i) => {
    const [zz, zx] = key.split("-");
    const [n = 0, sw, wh, rv] = (split.c?.[i] ?? [0]) as number[];
    const ok = sw != null;
    const lg = lgSplit[key] as number[] | undefined;
    const swing = ok ? pct(sw, n) : null;
    const whiff = ok && sw >= 5 ? pct(wh, sw) : null;
    const rv100 = ok ? (100 * rv) / n : null;
    const lgSwing = lg ? pct(lg[1], lg[0]) : null;
    const lgWhiff = lg ? pct(lg[2], lg[1]) : null;
    const lgRv = lg && lg[0] ? (100 * lg[3]) / lg[0] : null;
    const dWhiff = whiff != null && lgWhiff != null ? whiff - lgWhiff : null;
    const dRv = rv100 != null && lgRv != null ? rv100 - lgRv : null;
    let fill = "rgba(127,127,127,0.06)", label = "—";
    if (metric === "swing" && swing != null) { fill = seqColor(swing / SWING_MAX); label = `${Math.round(swing)}%`; }
    if (metric === "whiff" && dWhiff != null) { fill = divColor(-dWhiff, CAP.whiff); label = signedFixed(dWhiff, 0); }
    if (metric === "rv" && dRv != null) { fill = divColor(dRv, CAP.rv); label = signedFixed(dRv, 1); }
    const dark = metric === "swing" && swing != null && swing / SWING_MAX > 0.55;
    const e = hand === "A" && grp === "" ? ev.get(key) : null;
    const tip = [
      `${ROW_LABEL[zz]}, ${COL_LABEL[zx].toLowerCase()} · ${n} pitches${ok ? "" : ` — under 15, too thin to rate`}`,
      swing != null && `swung ${f1(swing)}%${lgSwing != null ? ` (league ${f1(lgSwing)}%)` : ""}`,
      whiff != null && `whiff ${f1(whiff)}% of swings${lgWhiff != null ? ` (league ${f1(lgWhiff)}%, ${signedFixed(dWhiff, 1)})` : ""}`,
      rv100 != null && `run value ${signedFixed(rv100, 1)}/100 pitches${lgRv != null ? ` (league ${signedFixed(lgRv, 1)}, ${signedFixed(dRv, 1)})` : ""}`,
      e?.avgEv && `${e.avgEv} mph avg EV · ${e.hardHitPct ?? "—"}% hard-hit`,
    ].filter(Boolean).join("\n");
    const x = X0 + cols.indexOf(zx as any) * CW, [y, h] = rowY[zz];
    return { key, x, y, h, fill, label, n, ok, dark, tip };
  });

  const legend = metric === "swing"
    ? { bg: `linear-gradient(to right, ${SEQ_LO}, ${SEQ_HI})`, lo: "0%", mid: `${SWING_MAX / 2}%`, hi: `${SWING_MAX}%+` }
    : {
        bg: `linear-gradient(to right, ${[0, 0.25, 0.5, 0.75, 1].map((t) => percentileRamp(t)).join(", ")})`,
        lo: metric === "whiff" ? `+${CAP.whiff} more whiffs` : `−${CAP.rv} runs`, mid: "league",
        hi: metric === "whiff" ? `−${CAP.whiff} fewer` : `+${CAP.rv} runs`,
      };

  return (
    <div className="glass-panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">Where he swings</h2>
          <p className="text-[10px] text-text-dim">
            {metric === "swing" ? "fill = swing rate" : metric === "whiff" ? "fill = whiff rate vs league, same cell and split" : "fill = run value per 100 pitches vs league, same cell and split"} · hover for n, whiff and damage
          </p>
        </div>
        <span className="text-[10px] text-text-dim">{data.season} · catcher&apos;s view</span>
      </div>
      <div className="flex flex-wrap gap-2 mb-3">
        <Seg value={hand} set={setHand} opts={HANDS} />
        <Seg value={grp} set={setGrp} opts={GROUPS} />
        <Seg value={metric} set={setMetric} opts={METRICS} />
      </div>
      <div className="flex flex-col gap-3">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[340px] h-auto" role="img"
          aria-label={`Zone chart, catcher's view, ${side === "R" ? "right" : "left"}-handed batter`}>
          {/* column heads */}
          {cols.map((zx, i) => (
            <text key={zx} x={X0 + i * CW + CW / 2} y={Y0 - 8} textAnchor="middle" className="fill-text-dim" fontSize={9}>{COL_LABEL[zx]}</text>
          ))}
          {cellsOut.map((c) => (
            <g key={c.key}>
              <rect x={c.x + 1} y={c.y} width={CW - 2} height={c.h} rx={3} fill={c.fill}
                stroke={c.ok ? "none" : "currentColor"} strokeOpacity={0.12} strokeDasharray={c.ok ? undefined : "3 3"}>
                <title>{c.tip}</title>
              </rect>
              <text x={c.x + CW / 2} y={c.y + c.h / 2 + (c.h > 36 ? 0 : 3)} textAnchor="middle" fontSize={11}
                className={`font-data pointer-events-none ${c.ok ? (c.dark ? "fill-[#0c1218]" : "fill-text-primary") : "fill-text-dim"}`}>
                {c.ok ? c.label : c.n ? `n=${c.n}` : "·"}
              </text>
              {c.ok && c.h > 36 && (
                <text x={c.x + CW / 2} y={c.y + c.h / 2 + 13} textAnchor="middle" fontSize={8}
                  fillOpacity={0.7} className={`font-data pointer-events-none ${c.dark ? "fill-[#0c1218]" : "fill-text-primary"}`}>n={c.n}</text>
              )}
            </g>
          ))}
          {/* strike zone outline around the inner 3x3 */}
          <rect x={X0} y={zoneTop - 2} width={3 * CW} height={zoneBot - zoneTop + 4} fill="none"
            stroke="currentColor" strokeOpacity={0.7} strokeWidth={1.5} className="text-text-primary" />
          {/* home plate, catcher's view: the point faces the catcher (down) */}
          <path d={`M ${X0} ${plateY} H ${gx1} V ${plateY + 9} L ${X0 + 1.5 * CW} ${plateY + 22} L ${X0} ${plateY + 9} Z`}
            fill="currentColor" fillOpacity={0.08} stroke="currentColor" strokeOpacity={0.55} className="text-text-primary" />
          {/* batter's box + hand */}
          <rect x={boxX} y={zoneTop} width={40} height={zoneBot - zoneTop} rx={2} fill="none"
            stroke="currentColor" strokeOpacity={0.3} strokeDasharray="4 3" className="text-text-dim" />
          <text x={boxX + 20} y={(zoneTop + zoneBot) / 2} textAnchor="middle" fontSize={10} className="fill-text-secondary font-data">
            {side}HH
          </text>
          <text x={side === "R" ? 4 : W - 4} y={plateY + 18} textAnchor={side === "R" ? "start" : "end"} fontSize={8} className="fill-text-dim">
            {side === "R" ? "3B side" : "1B side"}
          </text>
        </svg>
        <div className="w-full max-w-[340px]">
          <div className="h-2 rounded-full" style={{ background: legend.bg }} />
          <div className="mt-1 flex justify-between text-[9px] text-text-dim font-data">
            <span>{legend.lo}</span><span>{legend.mid}</span><span>{legend.hi}</span>
          </div>
          {metric !== "swing" && (
            <p className="mt-1 text-[9px] text-text-dim">green = good for the hitter, red = bad</p>
          )}
          {switchHitter && (
            <p className="mt-2 text-[10px] text-text-secondary">
              Switch hitter: each split draws from the side he batted from most in it (here {side === "R" ? "right" : "left"}-handed).
            </p>
          )}
        </div>
      </div>
      <p className="mt-3 text-[10px] leading-relaxed text-text-dim">
        Catcher&apos;s view: a right-handed batter stands on the left. Inside/away are his inside/away (each pitch is
        placed by the side he batted from), and those columns run on past the plate edge; the top and bottom thirds
        reach 0.35 ft past the zone, and the rows above and below the box are the chase band beyond that. Cells under 15 pitches show only their n (dashed). League = every hitter on the same
        side in the same season, split and cell. Run value is Statcast&apos;s change in run expectancy per pitch, from the
        hitter&apos;s side.
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
