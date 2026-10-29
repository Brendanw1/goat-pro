/**
 * Percentile rank calculation and color-coding utilities.
 * Used for hitter and pitcher profile percentile bars.
 */
import { baseCode } from "@/types";

interface Breakpoints {
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  /** Optional dense p1..p99 (99 values). When present it replaces the 5-point
   *  interpolation; only Stuff+ / ABStuff+ / Pitching+ carry it (scripts/bake_stuff_percentiles.py). */
  q?: number[];
}

import {
  HITTER_DISCIPLINE,
  PITCHER_DISCIPLINE,
  meetsGate,
  type Direction,
  type DisciplineMetric,
} from "./discipline";

/**
 * Plate discipline directions come from the table in ./discipline.ts, not from a
 * hand-kept list here. Some are measured (every HITTER_SKILL rate, every
 * PITCHER_SKILL rate) and the hitter Approach ones are assigned by scouting
 * convention — the metric's own note says which, and this file does not care.
 * Three pitcher entries used to be marked higher-is-better on intuition — Zone%,
 * Called Strike% and Z-Swing% — and all three test neutral against wOBA allowed
 * on our own data. A "neutral" metric still gets a rank; it just does not get a
 * verdict colour.
 */
const DISCIPLINE_DIRECTION = {
  hitter: new Map<string, Direction>(HITTER_DISCIPLINE.map((m) => [m.key, m.direction])),
  pitcher: new Map<string, Direction>(PITCHER_DISCIPLINE.map((m) => [m.key, m.direction])),
};

/** Profile-only descriptive rows (DisciplineMetric.descriptive): ranked, never coloured. */
const DESCRIPTIVE = {
  hitter: new Set(HITTER_DISCIPLINE.filter((m) => m.descriptive).map((m) => m.key)),
  pitcher: new Set(PITCHER_DISCIPLINE.filter((m) => m.descriptive).map((m) => m.key)),
};

/** Hitter profile rows that are style, not skill: ranked, never coloured (D-34). */
const HITTER_NEUTRAL = new Set(["pullPct", "laSd", "swingLength", "attackAngle", "wobaMinusXwoba"]);
/** Pitcher rows ranked without a verdict colour: luck is RV/100 minus xRV/100 (§71), neither good nor bad skill. */
const PITCHER_NEUTRAL = new Set(["rvLuck"]);

/** Hitter stats where LOWER values are better — invert the rank. oSwingPct is the hitter Chase% under its board key. */
const LOWER_IS_BETTER = new Set(["kPct", "kPctProj", "popTime", "oSwingPct"]);

/** The sample-adjusted twin ranks in its raw stat's direction: "whiffPctShrunk" reads as "whiffPct". */
const baseKey = (k: string) => k.replace(/Shrunk$/, "");

/** Pitcher stats where LOWER is better */
const PITCHER_LOWER_IS_BETTER = new Set([
  "bbPct", "era", "fip", "xwOBA_against", "xwOBACON_against",
  "adj_era", "adj_fip", "adj_xwoba_against",
  "relHeightSD", "relSideSD",
  // D-35 contact and bat tracking against him
  "xwobaAg", "xbaAg", "xslgAg", "xwobaconAg", "wobaAg", "evAg", "hardHitPctAg", "barrelPctAg",
  "sweetSpotPctAg", "pullAirPctAg", "batSpeedAg", "squaredUpPctAg", "blastPctAg",
]);

/**
 * Pitcher stats where HIGHER is better.
 *
 * `xrvPer100` and `adj_xrv_per_100` moved here from the lower-is-better set on
 * 2026-08-17. The ten xRV models had been fit against the negation of their
 * target, so a good pitcher scored *low* and this set encoded that; the models
 * were retrained and the two compensating negations removed, and the target is
 * pitcher-positive (K +0.270, BB −0.320). See docs/xrv-sign-fix.md.
 *
 * **This move and the recomputed breakpoints in data/export/percentiles.json are
 * one change.** Either alone ranks the whole leaderboard backwards while every
 * individual number on the page reads correctly — which is the same failure
 * mode, one level up, as the bug being fixed. `scripts/verify_xrv_population.py`
 * checks both halves together and refuses to pass on one.
 *
 * The adjusted twin moves with the raw one: `adj_xrv_per_100` is `xrvPer100`
 * divided by a positive park factor, so it carries the same convention.
 */
const PITCHER_HIGHER_IS_BETTER = new Set([
  "kPct", "kBbPct",
  "stuffPlus", "stuffPlusShrunk", "abStuffPlus", "abStuffPlusShrunk", "locPlus", "pitchingPlus", "xrvPlus", "velo", "ivb",
  "xrvPer100", "adj_xrv_per_100", "rvPer100Fb", "rvPer100Br", "rvPer100Os",
  "gbPct", "contactSuppressionZ", "extension",
  "spin", "highLocPct",
]);

/**
 * Whether a stat carries a good/bad direction at all.
 *
 * Callers use this to decide between a coloured bar and a plain one. True for a
 * metric with no direction (Zone% seen, Z-Swing% allowed) and for the hitter's
 * aggression rates (Swing%, Z-Swing%, 1st-Pitch Swing%), which the profile shows
 * as descriptive: a rank, no verdict colour.
 */
export function isNeutralStat(role: "hitter" | "pitcher", key: string): boolean {
  const statKey = baseKey(key);
  return DISCIPLINE_DIRECTION[role].get(statKey) === "neutral" || DESCRIPTIVE[role].has(statKey)
    || (role === "hitter" && HITTER_NEUTRAL.has(statKey)) || (role === "pitcher" && PITCHER_NEUTRAL.has(statKey));
}

/**
 * Given a value and breakpoints {p10, p25, p50, p75, p90}, return a
 * percentile rank 1-99 representing where the value falls in the distribution.
 *
 * Linear interpolation between breakpoints, flat at 5 below p10, and
 * extrapolated above p90 on the distribution's own width.
 *
 * ── The p90 extrapolation used to assume positive values ────────────────────
 * It scaled the overshoot by `p90 * 0.2`. That is only a distance if p90 is
 * positive; when it is negative the division flips sign and the *largest*
 * values come back as rank 1. Nothing caught it because every metric on the
 * board happened to have a positive p90 — until the Aug 2026 xRV retrain made
 * xRV/100 pitcher-positive, whose breakpoints run p10 −1.79 to p90 −0.10, all
 * negative. The five best pitchers by FIP ranked 1, 1, 1, 77, 87.
 *
 * The fix is to scale on `p90 − p75`, the local width of the distribution,
 * which is a distance whatever the sign. `Math.abs` on the old expression would
 * have papered over it while keeping a scale that has nothing to do with the
 * spread — a metric living near zero would extrapolate in huge steps.
 */
export function getPercentileRank(value: number, breakpoints: Breakpoints): number {
  if (breakpoints.q?.length === 99) return denseRank(value, breakpoints.q);
  const { p10, p25, p50, p75, p90 } = breakpoints;

  let rank: number;

  if (value <= p10) {
    // Flat. The bottom decile is not resolved: with only p10 as an anchor there
    // is no width below it to interpolate on, and inventing one would rank the
    // worst value in the league against a made-up floor.
    rank = 5;
  } else if (value <= p25) {
    // Between 10th and 25th
    rank = 10 + ((value - p10) / (p25 - p10 || 1)) * 15;
  } else if (value <= p50) {
    // Between 25th and 50th
    rank = 25 + ((value - p25) / (p50 - p25 || 1)) * 25;
  } else if (value <= p75) {
    // Between 50th and 75th
    rank = 50 + ((value - p50) / (p75 - p50 || 1)) * 25;
  } else if (value <= p90) {
    // Between 75th and 90th
    rank = 75 + ((value - p75) / (p90 - p75 || 1)) * 15;
  } else {
    // Above the 90th, extrapolated on the p75→p90 width — a real distance in the
    // metric's own units, with the right sign whatever the values are. Doubled
    // so a value one whole decile-width past p90 lands mid-way to 99 rather than
    // pinning there, which keeps the top decile readable instead of a wall of 99s.
    const width = Math.abs(p90 - p75) || Math.abs(p90) * 0.2 || 1;
    rank = 90 + Math.min(9, ((value - p90) / (width * 2)) * 9);
  }

  return Math.max(1, Math.min(99, Math.round(rank)));
}

/**
 * Rank on dense p1..p99 breakpoints: the value's interpolated position in q.
 * Grades are integers, so q has flat runs; a value sitting on a run gets the
 * middle of it rather than its first or last index.
 */
function denseRank(value: number, q: number[]): number {
  const lo = q.filter((x) => x < value).length;
  const hi = q.filter((x) => x <= value).length;
  let pos: number;
  if (hi > lo) pos = (lo + 1 + hi) / 2;
  else if (lo === 0) pos = 1;
  else if (lo === q.length) pos = 99;
  else pos = lo + (value - q[lo - 1]) / (q[lo] - q[lo - 1]);
  return Math.max(1, Math.min(99, Math.round(pos)));
}

/**
 * Get the percentile rank for a stat, automatically inverting for
 * stats where lower is better.
 */
export function getStatPercentileRank(
  statKey: string,
  value: number,
  breakpoints: Breakpoints
): number {
  const rank = getPercentileRank(value, breakpoints);
  statKey = baseKey(statKey);

  if (LOWER_IS_BETTER.has(statKey) || DISCIPLINE_DIRECTION.hitter.get(statKey) === "lower") {
    // Invert: a low value (good) should map to a high rank
    return Math.max(1, Math.min(99, 100 - rank));
  }

  return rank;
}

/* ── The percentile ramp ──────────────────────────────────────────────────────
 *
 * Five brand anchors, interpolated continuously in OKLab. The anchors are the
 * same five colours the old five-step function returned; what changed is that
 * ranks between them now land between them instead of snapping to a step, and
 * 50–74 is no longer a dead band that returned null.
 *
 * Why OKLab and not sRGB: a straight sRGB lerp from orange to grey to teal dips
 * in perceived chroma either side of the neutral and reads as a muddy band
 * around p50 — the same defect the step function had, in a smoother disguise.
 * OKLab is perceptually uniform enough that the ramp stays clean through the
 * neutral, and equal rank steps read as equal colour steps.
 */

/**
 * The ramp's neutral, and the fallback every caller reaches for when a value
 * cannot be ranked.
 *
 * ── Why it is not #6B7280 ───────────────────────────────────────────────────
 * It was, and measured on the painted pixels of a glass panel that grey is
 * 3.99:1 against the darkest ground in the app — under AA's 4.5:1 for the
 * 9–13px numbers it colours. Because the ramp interpolates through it, ranks
 * 44–52 all failed: nine of the ninety-nine, and precisely the league-average
 * band that most of the table sits in.
 *
 * Raising OKLab L from 0.551 to 0.587 clears the whole ramp with 4.65:1 at the
 * worst point. a and b are untouched, so the hue is the same grey and the
 * chroma-at-the-median contract in __tests__/percentiles.test.ts still holds.
 *
 * Exported because eight components had this hex inlined as their own
 * fallback, so fixing the anchor alone would have left eight greys at 3.99:1.
 */
export const NEUTRAL_GREY = "#757d8b";

const RAMP_ANCHORS: Array<{ rank: number; hex: string }> = [
  { rank: 1, hex: "#E84142" },  // red
  { rank: 25, hex: "#E87048" }, // orange
  { rank: 50, hex: NEUTRAL_GREY },
  { rank: 75, hex: "#4ECDC4" }, // teal
  { rank: 99, hex: "#4ead5b" }, // green
];

type Oklab = [number, number, number];

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function linearToSrgb(c: number): number {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(Math.max(0, Math.min(1, v)) * 255);
}

/** Hex to OKLab. Coefficients from Björn Ottosson's reference implementation. */
function hexToOklab(hex: string): Oklab {
  const r = srgbToLinear(parseInt(hex.slice(1, 3), 16));
  const g = srgbToLinear(parseInt(hex.slice(3, 5), 16));
  const b = srgbToLinear(parseInt(hex.slice(5, 7), 16));

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToHex([L, A, B]: Oklab): string {
  const l_ = L + 0.3963377774 * A + 0.2158037573 * B;
  const m_ = L - 0.1055613458 * A - 0.0638541728 * B;
  const s_ = L - 0.0894841775 * A - 1.291485548 * B;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  const r = linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const g = linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const b = linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);

  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/** Anchors converted once, so a ramp lookup is two lerps and a matrix multiply. */
const RAMP_LAB: Array<{ rank: number; lab: Oklab }> = RAMP_ANCHORS.map((a) => ({
  rank: a.rank,
  lab: hexToOklab(a.hex),
}));

/**
 * The ramp itself, for legends. t: 0 = worst, 1 = best.
 *
 * t maps onto the 1–99 rank scale, so the anchors sit where the table in
 * docs/plate-discipline-study.md says they do (t = 0.5 is rank 50, the neutral).
 */
export function percentileRamp(t: number): string {
  const clamped = Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 0.5;
  const rank = 1 + clamped * 98;

  let i = 0;
  while (i < RAMP_LAB.length - 2 && rank > RAMP_LAB[i + 1].rank) i++;
  const lo = RAMP_LAB[i];
  const hi = RAMP_LAB[i + 1];
  const f = (rank - lo.rank) / (hi.rank - lo.rank);

  return oklabToHex([
    lo.lab[0] + (hi.lab[0] - lo.lab[0]) * f,
    lo.lab[1] + (hi.lab[1] - lo.lab[1]) * f,
    lo.lab[2] + (hi.lab[2] - lo.lab[2]) * f,
  ]);
}

/**
 * Colour for a percentile rank, 1–99. Continuous, so a rank of 60 reads as grey
 * shaded toward teal rather than as no colour at all.
 *
 * Interpolated in OKLab: sRGB interpolation through a neutral midpoint dips in
 * chroma and reads as a muddy band around p50.
 *
 * Never returns null. That is the point of the change — the old function
 * returned null for 50–74, so "average" and "cannot be ranked" rendered
 * identically. Callers wanting *no* colour must decide that themselves (see
 * `isNeutralStat`). Input is clamped to 1–99.
 */
/** 1 -> "1st", 22 -> "22nd", 13 -> "13th"; rounds first. The one ordinal helper for the site. */
export const ordinal = (p: number): string => {
  const v = Math.round(p), r10 = v % 10, r100 = v % 100;
  return `${v}${r10 === 1 && r100 !== 11 ? "st" : r10 === 2 && r100 !== 12 ? "nd" : r10 === 3 && r100 !== 13 ? "rd" : "th"}`;
};

export function percentileColor(rank: number): string {
  const r = Number.isFinite(rank) ? Math.max(1, Math.min(99, rank)) : 50;
  return percentileRamp((r - 1) / 98);
}



/**
 * Get the percentile rank for a pitcher stat, automatically inverting for
 * stats where lower is better for pitchers.
 */
export function getPitcherPercentileRank(
  statKey: string,
  value: number,
  breakpoints: Breakpoints
): number {
  const rank = getPercentileRank(value, breakpoints);
  statKey = baseKey(statKey);

  if (PITCHER_LOWER_IS_BETTER.has(statKey) || DISCIPLINE_DIRECTION.pitcher.get(statKey) === "lower") {
    // Invert: a low value (good for pitcher) should map to a high rank
    return Math.max(1, Math.min(99, 100 - rank));
  }

  return rank;
}

/**
 * Rank a plate discipline rate, gated on how many events back it.
 *
 * Returns null when the denominator is too small for the rate to mean anything —
 * the caller shows the number without a percentile rather than dressing up noise
 * as a ranking. `value` should be the shrunk twin where one exists; see
 * rankableValue() in ./discipline.ts.
 *
 * The metric arrives as an object rather than as loose arguments because the gate
 * needs four fields off it (key, halfSignal, gate, minDenom) and every caller
 * already holds it. Which gate applies is the metric's own decision — see the
 * `gate` doc comment in ./discipline.ts.
 */
export function getDisciplinePercentileRank(
  role: "hitter" | "pitcher",
  metric: DisciplineMetric,
  value: number,
  breakpoints: Breakpoints | null | undefined,
  denominator: number | null | undefined,
  /**
   * Whether `value` is the shrunk twin — pass `isShrunkValue(row, key)`, never a
   * literal. It picks which floor the gate applies; see `meetsGate`.
   */
  shrunk = false
): number | null {
  if (!breakpoints) return null;
  if (!meetsGate(metric, denominator, shrunk)) return null;

  return role === "hitter"
    ? getStatPercentileRank(metric.key, value, breakpoints)
    : getPitcherPercentileRank(metric.key, value, breakpoints);
}

/**
 * Text colour for a signed number (run values, deltas, z-scores): green when it
 * is good for the player on the card, red when bad, nothing inside ±`band`, where
 * the sign is noise. Every caller passes a value already signed for its subject
 * (pitcher-positive on a pitcher, hitter-positive on a hitter), so the sign is
 * the verdict. Returns "" for neutral; the caller keeps its own text class.
 */
export function signTone(v: number | null | undefined, band = 0): string {
  if (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) <= band) return "";
  return v > 0 ? "text-emerald-400" : "text-rose-400";
}

/**
 * Direction, not judgement: sky = more than his season, amber = less. More IVB
 * is good on a heater and bad on a changeup, so green/red would lie for half
 * the rows. Inside `band` it stays neutral: that much is game-to-game noise.
 */
export function deltaTone(d: number | null, band: number, thin: boolean): string {
  if (thin) return "text-text-dim";
  if (d == null || Math.abs(d) < band) return "";
  return d > 0 ? "text-sky-300" : "text-amber-300";
}

/**
 * Percentile of a per-GAME plus grade, from that grade's own game-level spread (normal approximation). Measured on the
 * 2026 export, 2026-10-04: one pitcher-game per value. Season grades have their own spread (scales.json) and must not
 * use these. Re-measure if a model is re-scaled.
 */
/**
 * percentiles.json cut to what one profile reads. One population in the MLB
 * MVP — all graded pitcher-seasons — so this only keeps the two sections the
 * profile ranks against, and the client prop stays small.
 */
export function profilePercentiles(p: any): any {
  if (!p) return p;
  return { pitchers: p.pitchers, pitchers_per_type: p.pitchers_per_type };
}

/** stuff_percentiles.json (scripts/bake_stuff_percentiles.py): dense MLB breakpoints for Stuff+ / ABStuff+ / Pitching+. */
export interface StuffPercentiles {
  season?: number | string;
  population?: { rule: string; n: number };
  pitchers?: Record<string, { q: number[]; n: number }>;
  per_type?: Record<string, Record<string, { q: number[]; n: number }>>;
  /** The authoritative pools: a 2023 grade ranks in by_season["2023"]. */
  by_season?: Record<string, StuffPercentiles>;
  /** Pooled fallback for undated callers. */
  pooled?: StuffPercentiles;
  /** (batter side x type) pools, `LHH` / `RHH`: same-season MLB cells of that type vs that side with 50+ pitches vs it. Older bakes lack it. */
  per_type_side?: Record<"LHH" | "RHH", Record<string, Record<string, { q: number[]; n: number }>>>;
}

/**
 * Sample floors for ranking a player on his profile (design review 2026-10-23, H4). Under the floor a percentile
 * row shows the sample ("n=13") instead of a rank, and the panel says why, because a 3-inning reliever at the 99th
 * percentile reads as elite to a coach scanning colour.
 *   - pitches 100: a pitcher's model grades (Stuff+, ABStuff+, Loc+, Pitching+, xRV+), the site's existing grade
 *     floor (GRADE_PCT_FLOOR.pitcher).
 *   - bf 50 / pa 50: everything else on the pitcher / hitter panel. The PV+ boards' floor for listing a player at
 *     all (players under 50 PA or BF are not listed; research/prospect-value/RESULTS.md).
 * Plate discipline rows keep their own per-metric reliability gates (lib/discipline.ts).
 */
export const PROFILE_PCT_FLOOR = { pitches: 100, bf: 50, pa: 50 } as const;

/** The pool a grade of `season` ranks in: its own season, else pooled/legacy. */
export function seasonSection(sp: StuffPercentiles | null | undefined, season?: string | number | null): StuffPercentiles | null {
  if (!sp) return null;
  if (season !== undefined && season !== null && sp.by_season) {
    const s = sp.by_season[String(season)];
    if (s) return s;
  }
  return sp.pooled ?? sp;
}

export const fromQ = (q: number[]): Breakpoints => ({ p10: q[9], p25: q[24], p50: q[49], p75: q[74], p90: q[89], q });

/**
 * Overlay the dense Stuff+ / ABStuff+ breakpoints onto percentiles.json's MLB default
 * scope (pitchers, pitchers_per_type). Tier and conference scopes keep theirs, and
 * every other metric is left exactly as it was. Mutates and returns `p`.
 */
export function overlayStuffPercentiles(p: any, s: StuffPercentiles | null | undefined): any {
  if (!p || !s) return p;
  if (p.pitchers && s.pitchers) for (const [k, v] of Object.entries(s.pitchers)) p.pitchers[k] = fromQ(v.q);
  if (s.per_type) for (const [t, block] of Object.entries(s.per_type)) {
    const dst = p.pitchers_per_type?.[t];
    if (dst) for (const [k, v] of Object.entries(block)) dst[k] = fromQ(v.q);
  }
  return p;
}

/* ── Percentile chips beside a season grade ──────────────────────────────────
 *
 * stuff_percentiles.json is the only population a displayed Stuff+ / ABStuff+ / Pitching+ can be ranked in: same-season MLB
 * pitchers with 100+ graded pitches, and per type their cells with 50+. A grade is ranked only when it is the same
 * kind of number on at least the same sample:
 *   - a pitcher's season grade, on 100+ pitches          -> `pitchers[metric]`
 *   - one pitch type's season grade, on 50+ pitches      -> `per_type[code][metric]` (ABStuff+ especially: an FF
 *     91 is a median four-seamer, an SL 120 a median slider, so ranking across types would mislead)
 *   - no fall surfaces ship in the MLB MVP
 *   - a (pitch type x batter side) grade, on 50+ pitches vs that side -> `per_type_side[LHH|RHH][code][metric]`: the
 *     profile's split grades would rank among MLB cells of that type vs that side. There is no
 *     pitcher-level side grade on the site, so no pitcher-level side pool.
 * Everything else gets no percentile: per-game and per-session grades, live single pitches, staff averages, and any grade under its floor. A rank of a 20-pitch grade against 100-pitch arms reads as a finding
 * when it is mostly noise. Pitching+ uses the same rules on this artifact's own pitchers;
 * per-game Pitching+ stays raw and chip-less. The grade itself stays anchored (100 = MLB average); only display changes.
 */
export const GRADE_PCT_FLOOR = { pitcher: 100, type: 50 } as const;
const TYPE_NOUN: Record<string, string> = {
  FF: "four-seamers", SI: "sinkers", SL: "sliders", SW: "sweepers", CT: "cutters", FC: "cutters",
  CB: "curveballs", CU: "curveballs", KC: "curveballs", CH: "changeups", FS: "splitters",
  ST: "sweepers", SV: "sliders", FO: "forkballs", EP: "eephus",
};
const ord = (v: number) => {
  const t = v % 100;
  return `${v}${t >= 11 && t <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[v % 10] ?? "th"}`;
};

/** The per-type pool a pitch code ranks in: its base code, except a Sweeper ranks among sliders (owner 2026-10-20: the
 *  Sweeper tag tracks the operator, so the same pitch must not change pools with the label). */
export const pctPool = (code: string) => (baseCode(code) === "SW" ? "SL" : baseCode(code));

/** {p, title} for a season grade, or null when no valid population exists (see the rule above). */
export function gradePct(
  sp: StuffPercentiles | null | undefined,
  metric: string,
  value: number | null | undefined,
  /** pitches the grade rests on; null/undefined = unknown, which is not rankable */
  n: number | null | undefined,
  /** pitch type for a per-pitch grade; omit for the pitcher's overall grade */
  code?: string | null,
  /** rank inside the season's own population; undefined falls back to pooled */
  season?: string | number | null,
  /** batter side for a split grade (needs `code`; n = pitches vs that side); omit for the all-hitters grade */
  side?: "L" | "R",
): { p: number; title: string } | null {
  const secs = seasonSection(sp, season);
  if (!secs || typeof value !== "number" || !Number.isFinite(value) || typeof n !== "number") return null;
  if (code !== undefined && !code) return null;
  const floor = code ? GRADE_PCT_FLOOR.type : GRADE_PCT_FLOOR.pitcher;
  if (n < floor) return null;
  const pool = code ? pctPool(code) : null;
  if (side && !pool) return null;
  const hh = side === "L" ? "LHH" : "RHH";
  const q = pool ? (side ? (secs.per_type_side as any)?.[hh]?.[pool]?.[metric]?.q : secs.per_type?.[pool]?.[metric]?.q) : secs.pitchers?.[metric]?.q;
  if (!q || q.length !== 99) return null;
  const p = getPercentileRank(value, fromQ(q));
  const seasonStr = String(season ?? secs.season ?? "");
  const who = pool ? `${seasonStr} MLB ${TYPE_NOUN[pool] ?? `${code}s`} ${side ? `vs ${hh} ` : ""}(${floor}+ pitches${side ? " vs that side" : ""})` : `${seasonStr} MLB pitchers (${floor}+ pitches)`;
  return { p, title: `${ord(p)} percentile among ${who}` };
}
