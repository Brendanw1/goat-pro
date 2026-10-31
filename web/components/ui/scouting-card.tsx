"use client";

/**
 * Hitter scouting card (H10) + skill grades (H9), wave 3. The zone chart is
 * where he swings and what happens there, drawn in the catcher's view over the
 * plate (5x5: zone 3x3 + shadow/chase ring), vs RHP and vs LHP side by side, by pitch group or exact type (baked `zgrid`); the count
 * rows are his approach by situation. The 20-80 estimates are computed in
 * the bake from this season's percentiles (rank -> normal z -> 50+10z,
 * rounded to 5) — labelled estimates, never a model output, and nothing
 * here predicts next season.
 */
import { useState } from "react";
import { percentileRamp } from "@/lib/percentiles";
import { signedFixed } from "@/components/ui/shared-ui";

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

/* ----------------------------------------------------------- zone chart (zgrid) */
/** 5x5 cell order of the baked `zgrid[split].c` lists (web_export.py ZGRID_ORDER). */
const ZR = ["above", "high", "mid", "low", "below"] as const;
const ZC = ["xin", "in", "mid", "out", "xout"] as const;
const ZGRID_ORDER = ZR.flatMap((zz) => ZC.map((zx) => `${zz}-${zx}`));
const ZR_LABEL: Record<string, string> = { above: "Above zone", high: "Upper third", mid: "Middle", low: "Lower third", below: "Below zone" };
const ZC_LABEL: Record<string, string> = { xin: "Off inside", in: "Inside", mid: "Middle", out: "Away", xout: "Off away" };
const ZC_HEAD: Record<string, string> = { xin: "off", in: "In", mid: "Mid", out: "Away", xout: "off" };
const GROUPS = [["", "All pitches"], ["FB", "Fastballs"], ["BR", "Breaking"], ["OS", "Offspeed"]] as const;
/** Exact site pitch types (SC_TO_SITE codes); the bake ships a type only past 50 pitches of it from that hand. */
const TYPES = [["FF", "4-seam"], ["SI", "Sinker"], ["CT", "Cutter"], ["SL", "Slider"], ["SW", "Sweeper"],
  ["CB", "Curve"], ["CH", "Change"], ["FS", "Splitter"]] as const;

/**
 * Cell = [n, swings, whiffs, rv, bip, xwSum, hard]. No thin-cell floor (owner rule): every cell with
 * a denominator gets its raw value and prints its n, so the viewer judges the sample.
 */
type Cell = number[];
const base = {
  swing: (c: Cell) => (c[0] > 0 && c.length > 1 ? (100 * c[1]) / c[0] : null),
  whiff: (c: Cell) => (c.length > 1 && c[1] > 0 ? (100 * c[2]) / c[1] : null),
  rv: (c: Cell) => (c[0] > 0 && c.length > 1 ? (100 * c[3]) / c[0] : null),
  xw: (c: Cell) => (c.length > 5 && c[4] > 0 ? c[5] / c[4] : null),
  hard: (c: Cell) => (c.length > 5 && c[4] > 0 ? (100 * c[6]) / c[4] : null),
};
/** The sample behind a metric: pitches, swings (whiff) or balls in play (contact). */
const sampleOf = (b: Base, c: Cell) => (b === "whiff" ? `${c[1] ?? 0} sw` : b === "xw" || b === "hard" ? `${c[4] ?? 0} BIP` : `n=${c[0]}`);
type Base = keyof typeof base;
const pctFmt = (v: number) => `${Math.round(v)}%`;
const xwFmt = (v: number) => v.toFixed(3).replace(/^(-?)0\./, "$1.");
const xwSigned = (v: number) => (Math.abs(v) < 0.0005 ? ".000" : (v > 0 ? "+" : "−") + xwFmt(Math.abs(v)));
/**
 * The fill modes. seq = a level on the one-hue scale (lo..hi); div = a signed stat on the site's
 * good/bad ramp, grey at 0, green when good for the hitter (lowerGood flips it), saturating at cap.
 */
const METRICS: { key: string; label: string; b: Base; vsLg: boolean; kind: "seq" | "div"; lo?: number; hi?: number;
  cap?: number; lowerGood?: boolean; fmt: (v: number) => string; what: string }[] = [
  { key: "swing", label: "Swing%", b: "swing", vsLg: false, kind: "seq", lo: 0, hi: 80, fmt: pctFmt, what: "swing rate" },
  { key: "whiff", label: "Whiff%", b: "whiff", vsLg: false, kind: "seq", lo: 0, hi: 60, fmt: pctFmt, what: "whiffs per swing" },
  { key: "whiffD", label: "Whiff% vs lg", b: "whiff", vsLg: true, kind: "div", cap: 15, lowerGood: true, fmt: (v) => signedFixed(v, 0), what: "whiff rate minus league's" },
  { key: "xw", label: "xwOBACON", b: "xw", vsLg: false, kind: "seq", lo: 0.2, hi: 0.6, fmt: xwFmt, what: "xwOBA on contact (balls in play)" },
  { key: "xwD", label: "xwOBACON vs lg", b: "xw", vsLg: true, kind: "div", cap: 0.1, fmt: xwSigned, what: "xwOBA on contact minus league's" },
  { key: "hard", label: "Hard-hit%", b: "hard", vsLg: false, kind: "seq", lo: 0, hi: 70, fmt: pctFmt, what: "95+ mph share of balls in play" },
  { key: "rv", label: "RV/100", b: "rv", vsLg: false, kind: "div", cap: 6, fmt: (v) => signedFixed(v, 1), what: "run value per 100 pitches" },
  { key: "rvD", label: "RV/100 vs lg", b: "rv", vsLg: true, kind: "div", cap: 6, fmt: (v) => signedFixed(v, 1), what: "run value per 100 pitches minus league's" },
];
/** Sequential ramp: one hue (blue), lightness carries the value — clear of the green/red good-bad colours. */
const SEQ_LO = "#1c2a35", SEQ_HI = "#8fd0f5";
const seqColor = (t: number) => `color-mix(in oklab, ${SEQ_HI} ${Math.round(100 * Math.max(0, Math.min(1, t)))}%, ${SEQ_LO})`;
const divColor = (d: number, cap: number) => percentileRamp(0.5 + Math.max(-1, Math.min(1, d / cap)) / 2);

const SEG = "rounded-full px-2.5 py-0.5 text-[10px] transition-colors";
function Seg<T extends string>({ value, set, opts }: { value: T; set: (v: T) => void; opts: readonly (readonly [T, string])[] }) {
  return (
    <div className="inline-flex flex-wrap gap-0.5 rounded-2xl border border-border-subtle p-0.5">
      {opts.map(([k, label]) => (
        <button key={k} type="button" aria-pressed={value === k} onClick={() => set(k)}
          className={`${SEG} ${value === k ? "bg-white/10 text-text-primary" : "text-text-dim hover:text-text-secondary"}`}>{label}</button>
      ))}
    </div>
  );
}

function ZonePlot({ title, split, lg, metric, note }: {
  title: string; split: { s: string; c: Cell[] } | null; lg: Cell[] | null; metric: (typeof METRICS)[number]; note: string;
}) {
  if (!split) {
    return (
      <div className="rounded-lg border border-border-subtle p-3">
        <div className="text-[11px] font-semibold text-text-primary">{title}</div>
        <p className="mt-6 mb-6 text-center text-[11px] text-text-dim">{note}</p>
      </div>
    );
  }
  const side: "R" | "L" = split.s === "L" ? "L" : "R";
  // Catcher's view: a RHH stands on the left (3B side), so his inside columns are the left ones.
  const cols = side === "R" ? ZC : [...ZC].reverse();
  const OW = 38, IW = 50, OH = 32, IH = 40, G = 3, BOX = 30;
  const X0 = side === "R" ? BOX + 12 : 6, Y0 = 18;
  const colX: number[] = [], colW = cols.map((c) => (c === "xin" || c === "xout" ? OW : IW));
  for (let i = 0, x = X0; i < cols.length; x += colW[i] + G, i++) colX.push(x);
  const rowH = ZR.map((r) => (r === "above" || r === "below" ? OH : IH));
  const rowY: number[] = [];
  for (let i = 0, y = Y0; i < ZR.length; y += rowH[i] + G, i++) rowY.push(y);
  const zx0 = colX[1] - G / 2, zx1 = colX[4] - G / 2, zy0 = rowY[1] - G / 2, zy1 = rowY[4] - G / 2;
  const gridR = colX[4] + colW[4], plateY = rowY[4] + OH + 12;
  const W = side === "R" ? gridR + 6 : gridR + BOX + 12, H = plateY + 26;
  const boxX = side === "R" ? 4 : gridR + 8;

  return (
    <div className="rounded-lg border border-border-subtle p-3">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-semibold text-text-primary">{title}</span>
        <span className="text-[9px] text-text-dim">bats {side} here</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 w-full max-w-[330px] h-auto" role="img"
        aria-label={`${title}: zone chart, catcher's view, ${side === "R" ? "right" : "left"}-handed batter`}>
        {cols.map((zx, i) => (
          <text key={zx} x={colX[i] + colW[i] / 2} y={Y0 - 6} textAnchor="middle" className="fill-text-dim" fontSize={8}>{ZC_HEAD[zx]}</text>
        ))}
        {ZR.map((zz, ri) => cols.map((zx, ci) => {
          const key = `${zz}-${zx}`;
          const c = split.c[ZGRID_ORDER.indexOf(key)] ?? [0];
          const l = lg?.[ZGRID_ORDER.indexOf(key)] ?? null;
          const own = base[metric.b](c), lgv = l ? base[metric.b](l) : null;
          const v = metric.vsLg ? (own != null && lgv != null ? own - lgv : null) : own;
          let fill = "rgba(127,127,127,0.06)", dark = false;
          if (v != null && metric.kind === "seq") {
            const t = (v - metric.lo!) / (metric.hi! - metric.lo!);
            fill = seqColor(t); dark = t > 0.55;
          } else if (v != null) {
            fill = divColor(metric.lowerGood ? -v : v, metric.cap!);
          }
          const ln = (b: Base, label: string, fmt: (x: number) => string, dfmt: (x: number) => string, extra = "") => {
            const a = base[b](c), g = l ? base[b](l) : null;
            return a == null ? null : `${label} ${fmt(a)}${extra}${g != null ? ` (league ${fmt(g)}, ${dfmt(a - g)})` : ""}`;
          };
          const tip = [
            `${title} · ${ZR_LABEL[zz]}, ${ZC_LABEL[zx].toLowerCase()} · ${c[0]} pitches`,
            ln("swing", "swung", (x) => `${f1(x)}%`, (x) => signedFixed(x, 1)),
            ln("whiff", "whiff", (x) => `${f1(x)}%`, (x) => signedFixed(x, 1), " of swings"),
            c.length > 4 && c[4] === 0 ? "no balls in play" : null,
            ln("xw", "xwOBACON", xwFmt, xwSigned, c.length > 4 ? ` on ${c[4]} BIP` : ""),
            ln("hard", "hard-hit", (x) => `${f1(x)}%`, (x) => signedFixed(x, 1)),
            ln("rv", "run value", (x) => `${signedFixed(x, 1)}/100`, (x) => signedFixed(x, 1)),
          ].filter(Boolean).join("\n");
          const x = colX[ci], y = rowY[ri], w = colW[ci], h = rowH[ri];
          const txt = v != null ? metric.fmt(v) : "·";
          return (
            <g key={key}>
              <rect x={x} y={y} width={w} height={h} rx={3} fill={fill}>
                <title>{tip}</title>
              </rect>
              <text x={x + w / 2} y={y + h / 2} textAnchor="middle" fontSize={w < 40 ? 8.5 : 10.5}
                className={`font-data pointer-events-none ${v != null ? (dark ? "fill-[#0c1218]" : "fill-text-primary") : "fill-text-dim"}`}>{txt}</text>
              <text x={x + w / 2} y={y + h / 2 + 11} textAnchor="middle" fontSize={7} fillOpacity={0.65}
                className={`font-data pointer-events-none ${dark ? "fill-[#0c1218]" : "fill-text-primary"}`}>
                {sampleOf(metric.b, c)}
              </text>
            </g>
          );
        }))}
        {/* rulebook strike zone around the inner 3x3 */}
        <rect x={zx0} y={zy0} width={zx1 - zx0} height={zy1 - zy0} fill="none" stroke="currentColor" strokeOpacity={0.75}
          strokeWidth={1.5} className="text-text-primary" />
        {/* home plate under the zone; catcher's view, the point toward the catcher */}
        <path d={`M ${zx0} ${plateY} H ${zx1} V ${plateY + 7} L ${(zx0 + zx1) / 2} ${plateY + 17} L ${zx0} ${plateY + 7} Z`}
          fill="currentColor" fillOpacity={0.08} stroke="currentColor" strokeOpacity={0.55} className="text-text-primary" />
        <rect x={boxX} y={zy0} width={BOX} height={zy1 - zy0} rx={2} fill="none" stroke="currentColor" strokeOpacity={0.3}
          strokeDasharray="4 3" className="text-text-dim" />
        <text x={boxX + BOX / 2} y={(zy0 + zy1) / 2 + 3} textAnchor="middle" fontSize={9} className="fill-text-secondary font-data">{side}HH</text>
      </svg>
    </div>
  );
}

export function ZoneGridPanel({ data, league }: { data: any | null; league?: any | null }) {
  const [view, setView] = useState<"hand" | "all">("hand");
  const [pick, setPick] = useState<string>("");
  const [mkey, setMkey] = useState<string>("swing");
  const metric = METRICS.find((m) => m.key === mkey) ?? METRICS[0];
  const zg = data?.zgrid ?? null;
  if (!zg?.A) {
    return (
      <div className="glass-panel p-4">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim mb-2">Where he swings</h2>
        <p className="text-[11px] text-text-dim">No zone data for this season.</p>
      </div>
    );
  }
  const hands = view === "hand" ? (["R", "L"] as const) : (["A"] as const);
  const types = TYPES.filter(([t]) => hands.some((h) => zg[`${h}${t}`]));
  const grp = TYPES.some(([t]) => t === pick) && !types.some(([t]) => t === pick) ? "" : pick;
  const typeLabel = ({ FF: "four-seamers", SI: "sinkers", CT: "cutters", SL: "sliders", SW: "sweepers", CB: "curveballs",
    CH: "changeups", FS: "splitters", FB: "fastballs", BR: "breaking balls", OS: "offspeed pitches" } as Record<string, string>)[grp] ?? "";
  const switchHitter = zg.R?.s && zg.L?.s && zg.R.s !== zg.L.s;
  const m = metric;
  const legend = m.kind === "seq"
    ? { bg: `linear-gradient(to right, ${SEQ_LO}, ${SEQ_HI})`, lo: m.fmt(m.lo!), mid: m.fmt((m.lo! + m.hi!) / 2), hi: `${m.fmt(m.hi!)}+` }
    : {
        bg: `linear-gradient(to right, ${[0, 0.25, 0.5, 0.75, 1].map((t) => percentileRamp(t)).join(", ")})`,
        lo: m.fmt(m.lowerGood ? m.cap! : -m.cap!), mid: m.vsLg ? "league" : "0", hi: m.fmt(m.lowerGood ? -m.cap! : m.cap!),
      };

  return (
    <div className="glass-panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">Where he swings</h2>
          <p className="text-[10px] text-text-dim">fill = {m.what}{m.vsLg ? ", same side, split and cell" : ""} · hover any cell for all of it</p>
        </div>
        <span className="text-[10px] text-text-dim">{data.season} · catcher&apos;s view</span>
      </div>
      <div className="flex flex-col gap-2 mb-3">
        <div className="flex flex-wrap gap-2">
          <Seg value={view} set={setView} opts={[["hand", "vs RHP | vs LHP"], ["all", "All pitchers"]] as const} />
          <Seg value={grp} set={setPick} opts={GROUPS} />
        </div>
        {types.length > 0 && <div><Seg value={grp} set={setPick} opts={types} /></div>}
        <div><Seg value={mkey} set={setMkey} opts={METRICS.map((x) => [x.key, x.label] as const)} /></div>
      </div>
      <div className={`grid gap-3 ${hands.length === 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 max-w-[360px]"}`}>
        {hands.map((h) => {
          const key = `${h}${grp}`;
          const sp = zg[key] ?? null;
          return (
            <ZonePlot key={h} title={h === "A" ? "All pitchers" : h === "R" ? "vs RHP" : "vs LHP"} split={sp}
              lg={sp ? league?.[sp.s]?.[key] ?? null : null} metric={m}
              note={`Under 50 ${typeLabel || "pitches"} from ${h === "R" ? "righties" : h === "L" ? "lefties" : "anyone"} — no chart.`} />
          );
        })}
      </div>
      <div className="mt-3 w-full max-w-[340px]">
        <div className="h-2 rounded-full" style={{ background: legend.bg }} />
        <div className="mt-1 flex justify-between text-[9px] text-text-dim font-data">
          <span>{legend.lo}</span><span>{legend.mid}</span><span>{legend.hi}</span>
        </div>
        <p className="mt-1 text-[9px] text-text-dim">
          {m.kind === "seq" ? "a level, not a verdict" : m.lowerGood ? "green = fewer whiffs than league (good for the hitter), red = more" : "green = good for the hitter, red = bad"}
        </p>
      </div>
      {switchHitter && (
        <p className="mt-2 text-[10px] text-text-secondary">Switch hitter: each panel is drawn from the side he batted from most in it.</p>
      )}
      <p className="mt-3 text-[10px] leading-relaxed text-text-dim">
        Catcher&apos;s view: a right-handed batter stands on the left. The outlined 3x3 is the rulebook zone in thirds
        (plate width with the ball&apos;s radius, ±0.83 ft; his own top and bottom); the outer ring is every pitch outside
        it on that side, shadow and chase together. Inside/away are his (each pitch placed by the side he batted from).
        Every cell is coloured by its raw value with its sample under it (pitches; swings for whiff; balls in play for
        xwOBACON and hard-hit%) — a value on three pitches is three pitches, so read the n. Hard-hit% stands in for
        EV90, which a cell of a few balls cannot hold. League = every hitter on the same side in the same season, split and cell. Run value is Statcast&apos;s
        change in run expectancy per pitch, hitter-positive.
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
