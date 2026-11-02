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
import { type MouseEvent as RMouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { HEX_DY, HEX_NX, HEX_NY, HEX_S, type HexCols, hexCenter, quantile, smoothHex, sumHex, typesOf } from "@/lib/zone-hex";
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
/** Hover lines for one cell or hex: every metric, with the league's figure and the difference when known. */
function metricLines(c: Cell, l: Cell | null, bip: string): string[] {
  const ln = (b: Base, label: string, fmt: (x: number) => string, dfmt: (x: number) => string, extra = "") => {
    const a = base[b](c), g = l ? base[b](l) : null;
    return a == null ? null : `${label} ${fmt(a)}${extra}${g != null ? ` (league ${fmt(g)}, ${dfmt(a - g)})` : ""}`;
  };
  const pf = (x: number) => `${f1(x)}%`, d1 = (x: number) => signedFixed(x, 1);
  return [
    ln("swing", "swung", pf, d1),
    ln("whiff", "whiff", pf, d1, " of swings"),
    c.length > 4 && !(c[4] > 0) ? "no balls in play" : null,
    ln("xw", "xwOBACON", xwFmt, xwSigned, c.length > 4 ? ` on ${bip} BIP` : ""),
    ln("hard", "hard-hit", pf, d1),
    ln("rv", "run value", (x) => `${signedFixed(x, 1)}/100`, d1),
  ].filter((x): x is string => x != null);
}
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
/** Levels: viridis (perceptually uniform, monotone lightness, readable on the dark theme). */
const VIRIDIS = ["#440154", "#482878", "#3e4989", "#31688e", "#26828e", "#1f9e89", "#35b779", "#6ece58", "#b5de2b", "#fde725"];
/** Signed: saturated red (bad for the hitter) through a neutral grey to saturated green (good). */
const DIVERGE = ["#f0443a", "#c4494a", "#4a5060", "#2e9e5e", "#2fd573"];
const hexRgb = (c: string) => [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16));
/** Evenly spaced stops, linear in sRGB between neighbours (close enough at 5-10 stops). */
function ramp(stops: string[], t: number): string {
  const u = (Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 0.5) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(u)), f = u - i;
  const a = hexRgb(stops[i]), b = hexRgb(stops[i + 1]);
  return `#${a.map((v, k) => Math.round(v + (b[k] - v) * f).toString(16).padStart(2, "0")).join("")}`;
}
/** Dark text on light fills, light text on dark ones (WCAG relative luminance). */
const isLight = (hex: string) => {
  const [r, g, b] = hexRgb(hex).map((v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.3;
};
const seqColor = (t: number) => ramp(VIRIDIS, t);
const divColor = (d: number, cap: number) => ramp(DIVERGE, 0.5 + Math.max(-1, Math.min(1, d / cap)) / 2);
const SEQ_BG = `linear-gradient(to right, ${VIRIDIS.join(", ")})`, DIV_BG = `linear-gradient(to right, ${DIVERGE.join(", ")})`;
/** Hover box shared by the Zones and Smooth views. */
type Tip = { x: number; y: number; text: string } | null;
function TipBox({ tip }: { tip: Tip }) {
  if (!tip) return null;
  return (
    <div className="pointer-events-none absolute z-20 max-w-[260px] whitespace-pre-line rounded-md border border-border-subtle bg-[#0b1016]/95 px-2 py-1.5 font-data text-[10px] leading-snug text-text-primary shadow-lg"
      style={{ left: tip.x + 14, top: tip.y + 14 }}>{tip.text}</div>
  );
}
/** Cursor position inside the panel (the TipBox's offset parent). */
const relPos = (e: RMouseEvent, el: HTMLElement) => { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

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

function ZonePlot({ title, split, lg, metric, note, scale }: {
  title: string; split: { s: string; c: Cell[] } | null; lg: Cell[] | null; metric: (typeof METRICS)[number]; note: string;
  scale: [number, number];
}) {
  const [tip, setTip] = useState<Tip>(null);
  const box = useRef<HTMLDivElement>(null);
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
    <div ref={box} className="relative rounded-lg border border-border-subtle p-3">
      <TipBox tip={tip} />
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
          if (v != null) {
            fill = metric.kind === "seq" ? seqColor((v - scale[0]) / (scale[1] - scale[0] || 1)) : divColor(metric.lowerGood ? -v : v, metric.cap!);
            dark = isLight(fill);
          }
          const tipText = [`${title} · ${ZR_LABEL[zz]}, ${ZC_LABEL[zx].toLowerCase()} · ${c[0]} pitches`, ...metricLines(c, l, String(c[4] ?? 0))].join("\n");
          const x = colX[ci], y = rowY[ri], w = colW[ci], h = rowH[ri];
          const txt = v != null ? metric.fmt(v) : "·";
          return (
            <g key={key}>
              <rect x={x} y={y} width={w} height={h} rx={3} fill={fill}
                onMouseMove={(e) => box.current && setTip({ ...relPos(e, box.current), text: tipText })} onMouseLeave={() => setTip(null)} />
              <text x={x + w / 2} y={y + h / 2} textAnchor="middle" fontSize={w < 40 ? 8.5 : 10.5}
                className={`font-data pointer-events-none ${v != null ? (dark ? "fill-[#0c1218]" : "fill-text-primary") : "fill-text-dim"}`}>{txt}</text>
              <text x={x + w / 2} y={y + h / 2 + 11} textAnchor="middle" fontSize={7} fillOpacity={0.85}
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

/* ------------------------------------------------------------ Smooth view (zone_hex) */
const BWS = [["0.12", "Fine 0.12 ft"], ["0.2", "Medium 0.2 ft"], ["0.3", "Broad 0.3 ft"]] as const;
/** Smoothed denominator a hex needs to set the signed views' colour cap (it is drawn at full colour regardless). */
const CAP_SUPPORT = { n: 6, sw: 4, bip: 3 } as const;
const hexCache = new Map<string, Promise<any>>();
const getJson = (url: string) => {
  if (!hexCache.has(url)) hexCache.set(url, fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  return hexCache.get(url)!;
};

function ZoneSmooth({ title, file, hand, grp, metric, bw, season, level, scale }: {
  title: string; file: any; hand: "R" | "L" | "A"; grp: string; metric: (typeof METRICS)[number]; bw: number;
  season: number; level: string; scale: [number, number];
}) {
  const hands = hand === "A" ? (["R", "L"] as const) : [hand];
  const own = useMemo(() => sumHex(hands.flatMap((h) => typesOf(grp).map((t) => file?.h?.[h]?.[t]))), [file, hand, grp]); // eslint-disable-line react-hooks/exhaustive-deps
  // his side in this panel: the hand's majority side (All: the bigger hand's)
  const side: "R" | "L" = hand === "A"
    ? ((file?.s?.R ?? file?.s?.L) === "L" ? "L" : "R")
    : file?.s?.[hand] === "L" ? "L" : "R";
  const [lg, setLg] = useState<HexCols | null>(null);
  const [tip, setTip] = useState<Tip>(null);
  const [hov, setHov] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true; // league surface: the vs-league fills and the league figures on hover
    getJson(`/api/data/zone-hex-league?season=${season}&stand=${side}&hand=${hand}&split=${grp}&level=${level}`)
      .then((j) => live && setLg(j?.i?.length ? j : null));
    return () => { live = false; };
  }, [season, side, hand, grp, level]);
  const sm = useMemo(() => (own ? smoothHex(own, bw) : null), [own, bw]);
  const smLg = useMemo(() => (lg ? smoothHex(lg, bw) : null), [lg, bw]);
  const raw = useMemo(() => new Map((own?.i ?? []).map((k, r) => [k, own!.n[r]])), [own]);

  if (!own || !sm) {
    return (
      <div className="rounded-lg border border-border-subtle p-3">
        <div className="text-[11px] font-semibold text-text-primary">{title}</div>
        <p className="mt-6 mb-6 text-center text-[11px] text-text-dim">No pitches here.</p>
      </div>
    );
  }
  const den = metric.b === "whiff" ? 1 : metric.b === "xw" || metric.b === "hard" ? 4 : 0; // column of the denominator
  const denKey = den === 1 ? "sw" : den === 4 ? "bip" : "n";
  const cellOf = (s: Float64Array[], k: number): Cell => s.map((col) => col[k]);
  const N = HEX_NX * HEX_NY;
  const vals: (number | null)[] = new Array(N).fill(null);
  for (let k = 0; k < N; k++) {
    if (sm[den][k] < 0.05) continue; // past the kernel's reach: no pitch within ~2.5 bandwidths
    const v = base[metric.b](cellOf(sm, k));
    if (v == null) continue;
    if (metric.vsLg) {
      const l = smLg ? base[metric.b](cellOf(smLg, k)) : null;
      vals[k] = l == null ? null : v - l;
    } else vals[k] = v;
  }
  const div = metric.kind === "div";
  // levels: the league-anchored scale shared with the Zones view; signed: 95th pct of |value| over well-sampled hexes
  const pool = (min: number) => vals.filter((v, k): v is number => v != null && sm[den][k] >= min);
  const solid = pool(CAP_SUPPORT[denKey]);
  const shown = solid.length >= 20 ? solid : pool(1);
  const [lo, hi] = scale;
  const cap = div ? Math.max(quantile(shown.map(Math.abs), 0.95) || 0, metric.b === "xw" ? 0.02 : 1) : 0;
  const color = (v: number) => (div ? divColor(metric.lowerGood ? -v : v, cap) : seqColor(hi > lo ? (v - lo) / (hi - lo) : 0.5));

  const P = 78, XL = -1.6, XR = 1.6, ZT = 4.6, ZB = 0.2, BOX = 30;
  const flip = side === "R" ? -1 : 1; // catcher's view: a RHH's inside (+x) is screen-left
  const X0 = side === "R" ? BOX + 10 : 4;
  const sx = (x: number) => X0 + (flip * x - XL) * P, sy = (z: number) => (ZT - z) * P;
  const W = X0 + (XR - XL) * P + (side === "R" ? 4 : BOX + 10), H = (ZT - ZB) * P + 4;
  const R = (HEX_S / Math.sqrt(3)) * P * 1.04;
  const hexPath = (cx: number, cy: number) =>
    `M${[0, 1, 2, 3, 4, 5].map((a) => { const t = (Math.PI / 3) * a + Math.PI / 6; return `${(cx + R * Math.cos(t)).toFixed(1)},${(cy + R * Math.sin(t)).toFixed(1)}`; }).join("L")}Z`;
  const zx0 = sx(-0.83 * flip), zx1 = sx(0.83 * flip);
  const zl = Math.min(zx0, zx1), zr = Math.max(zx0, zx1);
  const boxX = side === "R" ? 4 : W - BOX - 4;
  const fmtLegend = (v: number) => metric.fmt(v);

  /** Cursor -> nearest lattice hex (row first, then column within the row's offset). */
  const onMove = (e: RMouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W, py = ((e.clientY - r.top) / r.height) * H;
    const x = flip * ((px - X0) / P + XL), z = ZT - py / P;
    const j = Math.round((z - 0.5) / HEX_DY), i = Math.round((x + 1.5 - (j % 2 ? HEX_S / 2 : 0)) / HEX_S);
    if (j < 0 || j >= HEX_NY || i < 0 || i >= HEX_NX || !box.current) { setTip(null); setHov(null); return; }
    // a denominator under 0.05 is past the kernel's reach: zero it so its rate reads as absent, not 100%
    const reach = (x: Cell) => x.map((q, ci) => ((ci === 0 || ci === 1 || ci === 4) && q < 0.05 ? 0 : q));
    const k = j * HEX_NX + i, c = reach(cellOf(sm, k)), l = smLg ? reach(cellOf(smLg, k)) : null, v = vals[k];
    const [hx, hz] = hexCenter(k);
    const where = `${Math.abs(hx) < 0.005 ? "middle" : `${Math.abs(hx).toFixed(1)} ft ${hx > 0 ? "inside" : "away"}`}, ${hz.toFixed(1)} ft high`;
    const text = [
      `${title} · ${where}`,
      v != null ? `${metric.label} ${metric.fmt(v)} (smoothed)` : `${metric.label}: no ${denKey === "n" ? "pitches" : denKey === "sw" ? "swings" : "balls in play"} within reach`,
      `kernel sample ${c[0].toFixed(1)} pitches · ${c[1].toFixed(1)} swings · ${c[4].toFixed(1)} BIP · ${raw.get(k) ?? 0} pitches in this hex`,
      ...(c[0] >= 0.05 ? metricLines(c, l, c[4].toFixed(1)) : []),
    ].join("\n");
    setHov(k); setTip({ ...relPos(e, box.current), text });
  };

  return (
    <div ref={box} className="relative rounded-lg border border-border-subtle p-3">
      <TipBox tip={tip} />
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-semibold text-text-primary">{title}</span>
        <span className="text-[9px] text-text-dim">bats {side} here · {own.n.reduce((a, b) => a + b, 0)} pitches</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 w-full max-w-[330px] h-auto cursor-crosshair" role="img"
        aria-label={`${title}: smoothed ${metric.what}, catcher's view`}
        onMouseMove={onMove} onMouseLeave={() => { setTip(null); setHov(null); }}>
        {vals.map((v, k) => {
          if (v == null) return null;
          const [x, z] = hexCenter(k);
          return <path key={k} d={hexPath(sx(x), sy(z))} fill={color(v)} />;
        })}
        {/* the standard zone (his zone scaled to 1.5–3.5) in thirds */}
        <rect x={zl} y={sy(3.5)} width={zr - zl} height={sy(1.5) - sy(3.5)} fill="none" stroke="currentColor" strokeOpacity={0.8}
          strokeWidth={1.5} className="text-text-primary pointer-events-none" />
        {[1 / 3, 2 / 3].map((t) => (
          <g key={t} className="text-text-primary pointer-events-none" stroke="currentColor" strokeOpacity={0.25}>
            <line x1={zl} x2={zr} y1={sy(1.5 + 2 * t)} y2={sy(1.5 + 2 * t)} />
            <line x1={zl + (zr - zl) * t} x2={zl + (zr - zl) * t} y1={sy(3.5)} y2={sy(1.5)} />
          </g>
        ))}
        <path d={`M ${zl} ${sy(0.55)} H ${zr} V ${sy(0.47)} L ${(zl + zr) / 2} ${sy(0.36)} L ${zl} ${sy(0.47)} Z`}
          fill="currentColor" fillOpacity={0.08} stroke="currentColor" strokeOpacity={0.55} className="text-text-primary pointer-events-none" />
        <rect x={boxX} y={sy(3.5)} width={BOX} height={sy(1.5) - sy(3.5)} rx={2} fill="none" stroke="currentColor"
          strokeOpacity={0.3} strokeDasharray="4 3" className="text-text-dim pointer-events-none" />
        <text x={boxX + BOX / 2} y={sy(2.5) + 3} textAnchor="middle" fontSize={9} className="fill-text-secondary font-data pointer-events-none">{side}HH</text>
        {hov != null && (() => { const [x, z] = hexCenter(hov); return <path d={hexPath(sx(x), sy(z))} fill="none" stroke="#fff" strokeWidth={1.5} className="pointer-events-none" />; })()}
      </svg>
      {(div ? shown.length > 0 : true) && (
        <div className="mt-2 max-w-[330px]">
          <div className="h-2 rounded-full" style={{ background: div ? DIV_BG : SEQ_BG }} />
          <div className="mt-1 flex justify-between text-[9px] text-text-dim font-data">
            {div ? (
              <><span>{fmtLegend(metric.lowerGood ? cap : -cap)}</span><span>{metric.vsLg ? "league" : "0"}</span><span>{fmtLegend(metric.lowerGood ? -cap : cap)}</span></>
            ) : (
              <><span>≤{fmtLegend(lo)}</span><span>{fmtLegend((lo + hi) / 2)}</span><span>≥{fmtLegend(hi)}</span></>
            )}
          </div>
          <p className="text-[9px] text-text-dim">
            {div ? "ends = 95th percentile of |value| over its well-sampled hexes" : "ends = league 5th–95th percentile of zone cells, same filter (as in Zones)"}
            {metric.vsLg && !smLg ? " · loading league…" : ""}
          </p>
        </div>
      )}
    </div>
  );
}

export function ZoneGridPanel({ data, league, level = "mlb" }: { data: any | null; league?: any | null; level?: string }) {
  const [view, setView] = useState<"hand" | "all">("hand");
  const [mode, setMode] = useState<"buckets" | "smooth">("buckets");
  const [bw, setBw] = useState<string>("0.2");
  const [hexFile, setHexFile] = useState<any>(undefined);
  useEffect(() => {
    if (mode !== "smooth" || !data?.id || hexFile !== undefined) return;
    let live = true;
    getJson(`/api/data/zone-hex/${data.id}?season=${data.season}&level=${level}`).then((j) => live && setHexFile(j));
    return () => { live = false; };
  }, [mode, data?.id, data?.season, level, hexFile]);
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
  // Level scale anchored to the league: 5th–95th percentile of the league's cells for the panels shown
  // (same side, hand and filter), so both panels and both views share it; fixed fallback if no league slice.
  const lgVals = hands.flatMap((h) => {
    const sp = zg[`${h}${grp}`];
    return ((sp ? league?.[sp.s]?.[`${h}${grp}`] : null) ?? []) as Cell[];
  }).map((c) => base[m.b](c)).filter((v): v is number => v != null);
  const lgLo = quantile(lgVals, 0.05), lgHi = quantile(lgVals, 0.95);
  const scale: [number, number] = m.kind === "seq" && lgVals.length >= 5 && lgHi > lgLo ? [lgLo, lgHi] : [m.lo ?? 0, m.hi ?? 1];
  const legend = m.kind === "seq"
    ? { bg: SEQ_BG, lo: `≤${m.fmt(scale[0])}`, mid: m.fmt((scale[0] + scale[1]) / 2), hi: `≥${m.fmt(scale[1])}` }
    : {
        bg: DIV_BG,
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
          <Seg value={mode} set={setMode} opts={[["buckets", "Zones"], ["smooth", "Smooth"]] as const} />
          <Seg value={view} set={setView} opts={[["hand", "vs RHP | vs LHP"], ["all", "All pitchers"]] as const} />
          {mode === "smooth" && <Seg value={bw} set={setBw} opts={BWS} />}
          <Seg value={grp} set={setPick} opts={GROUPS} />
        </div>
        {types.length > 0 && <div><Seg value={grp} set={setPick} opts={types} /></div>}
        <div><Seg value={mkey} set={setMkey} opts={METRICS.map((x) => [x.key, x.label] as const)} /></div>
      </div>
      <div className={`grid gap-3 ${hands.length === 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 max-w-[360px]"}`}>
        {mode === "smooth" && hands.map((h) => (
          hexFile ? (
            <ZoneSmooth key={h} title={h === "A" ? "All pitchers" : h === "R" ? "vs RHP" : "vs LHP"} file={hexFile} hand={h}
              grp={grp} metric={m} bw={Number(bw)} season={data.season} level={level} scale={scale} />
          ) : (
            <p key={h} className="text-[11px] text-text-dim py-6">{hexFile === null ? "No smooth surface for this season." : "Loading…"}</p>
          )
        ))}
        {mode === "buckets" && hands.map((h) => {
          const key = `${h}${grp}`;
          const sp = zg[key] ?? null;
          return (
            <ZonePlot key={h} title={h === "A" ? "All pitchers" : h === "R" ? "vs RHP" : "vs LHP"} split={sp}
              lg={sp ? league?.[sp.s]?.[key] ?? null : null} metric={m} scale={scale}
              note={`Under 50 ${typeLabel || "pitches"} from ${h === "R" ? "righties" : h === "L" ? "lefties" : "anyone"} — no chart.`} />
          );
        })}
      </div>
      {mode === "buckets" && <div className="mt-3 w-full max-w-[340px]">
        <div className="h-2 rounded-full" style={{ background: legend.bg }} />
        <div className="mt-1 flex justify-between text-[9px] text-text-dim font-data">
          <span>{legend.lo}</span><span>{legend.mid}</span><span>{legend.hi}</span>
        </div>
        <p className="mt-1 text-[9px] text-text-dim">
          {m.kind === "seq" ? `a level, not a verdict · ends = ${lgVals.length >= 5 ? "league's 5th–95th percentile cells, same filter" : "fixed range"}` : m.lowerGood ? "green = fewer whiffs than league (good for the hitter), red = more" : "green = good for the hitter, red = bad"}
        </p>
      </div>}
      {mode === "smooth" && (
        <p className="mt-3 text-[10px] leading-relaxed text-text-dim">
          Smooth: raw counts per 0.1 ft hexagon, smoothed in your browser with a Gaussian kernel of the chosen bandwidth
          ({bw} ft), numerator and denominator separately, so each hex shows a kernel-pooled rate. His zone is scaled to a
          standard 1.5–3.5 ft so the outline sits in thirds. Every hex is drawn at full colour however thin its sample —
          hover any spot for the smoothed value, every metric with the league&apos;s, the kernel sample (effective pitches,
          swings, balls in play) and where it is. Levels share the Zones scale (the league&apos;s 5th–95th percentile cells for
          this filter); signed views are capped at their 95th percentile of |value| over well-sampled hexes; league =
          the league&apos;s surface for the same side, hand and filter at the same bandwidth.
        </p>
      )}
      {switchHitter && (
        <p className="mt-2 text-[10px] text-text-secondary">Switch hitter: each panel is drawn from the side he batted from most in it.</p>
      )}
      {mode === "buckets" && <p className="mt-3 text-[10px] leading-relaxed text-text-dim">
        Catcher&apos;s view: a right-handed batter stands on the left. The outlined 3x3 is the rulebook zone in thirds
        (plate width with the ball&apos;s radius, ±0.83 ft; his own top and bottom); the outer ring is every pitch outside
        it on that side, shadow and chase together. Inside/away are his (each pitch placed by the side he batted from).
        Every cell is coloured by its raw value with its sample under it (pitches; swings for whiff; balls in play for
        xwOBACON and hard-hit%) — a value on three pitches is three pitches, so read the n. Hard-hit% stands in for
        EV90, which a cell of a few balls cannot hold. League = every hitter on the same side in the same season, split and cell. Run value is Statcast&apos;s
        change in run expectancy per pitch, hitter-positive.
      </p>}
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
