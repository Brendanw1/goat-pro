// ─── Pitch Types ───────────────────────────────────────────────────────────────

/** Handedness as it appears across TrackMan feeds. Normalize with `toHand()`. */
export type Handedness = "Left" | "Right" | "L" | "R" | null;

export type BasePitchType =
  | "FF" // Four-seam Fastball
  | "SI" // Sinker
  | "CH" // Changeup
  | "CB" // Curveball
  | "SL" // Slider
  | "SW" // Sweeper
  | "CT" // Cutter
  | "FS" // Splitter
  /**
   * Knuckleball. The one code with no model of its own — Stuff+ v5 trains eight
   * families and this is not one of them, so a KN cell is graded through the
   * CHANGEUP model and the profile cell carries `proxyGradedAs: "CH"` to say so.
   *
   * It is here because the alternative was worse: all 232 of 2026's knuckleballs
   * used to fall out of the R exporter as an unrecognised label and vanish from
   * 58 profile cells with no note, so a knuckleballer's pitch counts did not
   * reconcile against the database. 0.016% of the season — a correctness fix,
   * not a feature.
   */
  | "KN";

/**
 * The topo tagger numbers a second (third, fourth) shape group of the same type in one pitcher's class: "SL2" is a
 * second slider-shaped group, graded on the slider scale as its own row.
 */
export type PitchType = BasePitchType | `${BasePitchType}${2 | 3 | 4}`;

/** "SL2" -> "SL": the base code, for any per-type lookup that has no suffixed entry. */
export const baseCode = (code: string): string => code.replace(/\d+$/, "");

/** A per-base-code table widened to every repeat code ("SL2".."SL4"): same value, label gets " 2", short label "SL2". */
export function withRepeats<K extends string, T>(base: Record<K, T>, f: (v: T, n: number) => T = (v) => v): Record<K | `${K}${2 | 3 | 4}`, T> {
  const out: Record<string, T> = { ...base };
  for (const [c, v] of Object.entries<T>(base)) for (const n of [2, 3, 4]) out[`${c}${n}`] = f(v, n);
  return out as Record<K | `${K}${2 | 3 | 4}`, T>;
}

/**
 * One colour per pitch, chosen so no two are confusable on a dark ground.
 *
 * The previous set had two pairs that read as the same colour at the size these
 * are actually drawn — a fastball `#E84142` beside a sinker `#E87048`, and a
 * slider `#F5C518` beside a cutter `#F59E0B`. Those are the two most common
 * pairs in an arsenal, so the two collisions were the two that mattered.
 *
 * The scheme is family by temperature, member by hue: **fastballs warm** (red,
 * burnt orange, yellow), **breaking balls cool** (violet, blue, pink),
 * **offspeed green** (green, teal). Reading it needs no legend — a warm arc on
 * a count donut is a fastball — while every pair inside a family is separated
 * by hue *and* by lightness, which is what makes red / burnt orange / bright
 * yellow tell apart where red / orange-red did not.
 */
export const PITCH_COLORS: Record<PitchType, string> = withRepeats({
  FF: "#FF4D4D",
  SI: "#E8761A",
  CH: "#3FBF5F",
  CB: "#3B9EFF",
  SL: "#A56BFF",
  SW: "#FF5BB0",
  CT: "#FFD93D",
  FS: "#00C7B1",
  // Grey on purpose. Every other colour here marks a pitch the models grade
  // natively; KN is graded through the changeup model and is the one entry that
  // is a stand-in, so it reads as neutral rather than claiming a family.
  KN: "#8B93A3",
});

export const PITCH_LABELS: Record<PitchType, string> = withRepeats({
  FF: "Fastball",
  SI: "Sinker",
  CH: "Changeup",
  CB: "Curveball",
  SL: "Slider",
  SW: "Sweeper",
  CT: "Cutter",
  FS: "Splitter",
  KN: "Knuckleball",
}, (l, n) => `${l} ${n}`);

// ─── Hitter Leaderboard ────────────────────────────────────────────────────────

export interface HitterRow {
  id: string;
  name: string;
  team: string;
  /**
   * Which side he hits from. `null` when TrackMan never recorded a usable
   * side -- 2 batters with a plate appearance in 2026. The exporter used to
   * default those to "R", which presented an imputation as data.
   * "S" requires both sides observed AND a platoon-advantage rate >= 0.90;
   * see classify_batter_side() in R/utils.R.
   */
  bats: "L" | "R" | "S" | null;
  year: string; // Fr, So, Jr, Sr
  pa: number;
  avg: number;
  obp: number;
  slg: number;
  woba: number;
  xwoba: number | null;
  /** Fully-expected wOBA: P(BB)·0.69 + P(HBP)·0.72 + P(BIP)·xwOBACON, where K%
   *  and BB% are PREDICTED from plate discipline rather than observed. `xwoba`
   *  keeps his actual K% and BB% and only expects the contact; this expects the
   *  strikeouts and walks too. Gated at 50 PA, hence the narrower coverage.
   *  docs/models/xwoba.md §5.4. */
  true_xwoba?: number | null;
  ev90: number | null;
  maxEv: number | null;
  barrelPct: number | null;
  hardHitPct: number | null;
  chasePct: number;
  whiffPct: number;
  kPct: number;
  bbPct: number;
  swStrPct: number;
  // Model outputs
  decisionPlus: number | null;
}

// ─── Pitcher Leaderboard ───────────────────────────────────────────────────────

export interface PitcherRow {
  id: string;
  name: string;
  team: string;
  conference?: string;
  throws: string;
  year: string;
  ip: number;
  era: number;
  whip?: number | null;
  battersFaced?: number | null;
  pitches?: number | null;
  hits?: number | null;
  walks?: number | null;
  fip: number;
  kPct: number;
  bbPct: number;
  kBbPct: number;
  cswPct: number;
  whiffPct: number;
  velo: number;
  ivb: number;
  gbPct: number;
  stuffPlus: number;
  /**
   * `stuffPlus` shrunk toward 100 by its own standard error -- the same SE that
   * draws `stuffPlusCI_lo/hi` on the arsenal surface, combined across the
   * pitcher's cells. Beside the grade, never instead of it: `stuffPlus` is what
   * these pitches graded, this is what to believe about the arm.
   *
   * Not the swing-weighted mean of the cells' own `grade_shrunk` -- that
   * over-shrinks a composite, because each cell is pulled toward 100 by its own
   * reliability and an arsenal measured across five pitch types is then pulled
   * as if it had been measured on one of them. Derived in R/compute_models.R;
   * scripts/measure_pitcher_shrinkage.py carries the gates.
   *
   * Optional because an artifact scored before 2026-08-30 has no such field.
   */
  stuffPlusShrunk?: number | null;
  /** ABStuff+: the same Stuff+ v8 prediction on ONE scale across all pitch types. */
  abStuffPlus?: number | null;
  abStuffPlusShrunk?: number | null;
  locPlus: number;
  pitchingPlus: number;
  /** P7 family (pipeline/p7_export.py): K+ / Prevention+ project next season; Control+ is descriptive. */
  kPlus?: number | null;
  kProj?: number | null;
  preventionPlus?: number | null;
  controlPlus?: number | null;
  pitchingRunsPer100?: number | null;
  /** What should REPEAT next season, not what happened. Same three components
   *  as pitchingPlus at 0.58/0.28/0.13 instead of 0.40/0.30/0.30, because
   *  contact quality allowed survives a season at r 0.29 while whiff survives
   *  at 0.53. Provisional — one season pair, no holdout. */
  pitchingProj?: number | null;
  /** pitchingProj - pitchingPlus. Positive: his results UNDERSTATE him.
   *  Negative: they were partly borrowed. Sort on this, not on either grade. */
  pitchingGap?: number | null;
  xrvPlus?: number;
  xrvPer100?: number;
  /** Observed run value per 100, pitcher-positive. The outcome, not the model. */
  rvPer100?: number;
  /** rvPer100 - xrvPer100. Results minus stuff; read as luck. See withRvGap. */
  rvGap?: number | null;
  confidence?: string;
  contactSuppressionZ?: number;
}

// ─── Arsenal ───────────────────────────────────────────────────────────────────

export interface ArsenalCardData {
  pitchType: PitchType;
  topPitchers: ArsenalPitcherSummary[];
  avgVelo: number;
  avgWhiff: number;
  avgIvb: number;
}

export interface ArsenalPitcherSummary {
  id: string;
  name: string;
  team: string;
  primaryMetric: number; // The highlighted stat (varies by pitch type)
  primaryMetricLabel: string;
}

export interface ArsenalExpandedRow {
  id: string;
  name: string;
  team: string;
  usage: number;
  velo: number;
  ivb: number;
  hb: number;
  spin: number;
  vaa: number | null;
  ext: number;
  zonePct: number;
  whiffPct: number;
  cswPct: number;
  woba: number;
  // Model outputs
  stuffPlus: number | null;
  /**
   * The same grade shrunk toward 100 by how much of it is signal.
   *
   * `stuffPlus` answers "what did these pitches grade"; this answers "what
   * should I believe about him". They agree on real workload — median gap 0.2
   * points across the population — and diverge where they should: the cells
   * that move more than 5 points have a median of ONE swing behind them.
   *
   * Optional because an artifact scored before 2026-08-27 does not carry it.
   */
  stuffPlusShrunk?: number | null;
  stuffPlusCI_lo?: number | null;
  stuffPlusCI_hi?: number | null;
  /** ABStuff+ (one scale across pitch types) and its shrunk / band. */
  abStuffPlus?: number | null;
  abStuffPlusShrunk?: number | null;
  abStuffPlusCI_lo?: number | null;
  abStuffPlusCI_hi?: number | null;
  abStuffPlusVsLHH?: number | null;
  abStuffPlusVsRHH?: number | null;
  locPlus?: number | null;
  pitchingPlus?: number | null;
  xrvGrade?: number | null;
  n_pitches?: number;
  confidence?: string;
  runValue: number | null;
  // Contact suppression (per pitch type)
  /** Exit velocity allowed vs pitches with the SAME movement profile, sign
   *  flipped so higher is better. Shrunk by n/(n+30) BIP; null under 15 BIP,
   *  which is why it is ~60% populated. Keyed by the five clustered families
   *  (FB SI SL CB CH), so FF reads FB and CT/SW read SL.
   *  ../internal_draft_model/docs/contact_suppression_grades.md */
  contactSuppressionZ: number | null;
  /** The same comparison inside the pitcher's own conference. r = +0.96 with
   *  contactSuppressionZ; falls back to it when the conference cell is thin. */
  conferenceRelativeZ: number | null;
  /** Movement cluster has spin efficiency below 0.75 -- seam-shifted-wake
   *  proxy. Only FF and CT earn bonus credit for it. */
  /** Null where the pitcher has no pitch_grades row at all -- 1,864 of 4,728
   *  profiles. The exporter now emits the key rather than omitting it. */
}

// ─── Player Profile ────────────────────────────────────────────────────────────

export interface PlayerProfile {
  id: string;
  name: string;
  team: string;
  position: string;
  throws: "L" | "R";
  /**
   * Which side he hits from. `null` when TrackMan never recorded a usable
   * side -- 2 batters with a plate appearance in 2026. The exporter used to
   * default those to "R", which presented an imputation as data.
   * "S" requires both sides observed AND a platoon-advantage rate >= 0.90;
   * see classify_batter_side() in R/utils.R.
   */
  bats: "L" | "R" | "S" | null;
  year: string;
  height: string; // "6-2"
  weight: number;
  // Summary stats
  ip: number;
  era: number;
  fip: number;
  kPct: number;
  bbPct: number;
  /** ABStuff+ headline (Stuff+ v8 on one scale across pitch types) with shrunk and band. */
  abStuffPlus?: number | null;
  abStuffPlusShrunk?: number | null;
  abStuffPlusCI_lo?: number | null;
  abStuffPlusCI_hi?: number | null;
  // Arsenal breakdown
  pitches: PitchProfileRow[];
  /** The same rows grouped by the topo auto pitch type and graded per auto type (Stuff+ v8 / Pitching+ v4
   *  by_pitch_auto). Absent when the served models have no auto cells. Loc+, CS z and run values stay human. */
  pitchesAuto?: PitchProfileRow[];
  // Movement profile (IVB vs HB scatter data)
  movementProfile: MovementPoint[];
  // Percentiles
  percentiles: PercentileSet | null;
}

/**
 * A pitcher's arm slot, from the profile's `release` key.
 *
 * The export publishes this as an ARRAY OF ONE, not an object — R's toJSON does
 * not unbox a single-row frame. `profile-view.tsx` read it as `release.relHeight`
 * for months, which is `undefined` on an array, so the Release panel it guards
 * rendered on nobody. Take `release[0]`.
 *
 * `relSide` is signed from the PITCHER's view: positive is his arm side, so a
 * right-hander's four-seam sits near +1.5 ft and a left-hander's near -1.5.
 */
export interface ReleasePoint {
  relHeight?: number | null;
  relSide?: number | null;
  extension?: number | null;
  relHeightSD?: number | null;
  relSideSD?: number | null;
}

export interface PitchProfileRow {
  pitchType: PitchType;
  /** Pitches of this type. Exported since v2; optional for older artifacts. */
  n_pitches?: number | null;
  usage: number;
  velo: number;
  ivb: number;
  hb: number;
  spin: number;
  whiffPct: number;
  cswPct: number;
  woba: number;
  // Extended stats
  vaa: number | null;
  ext: number | null;
  zonePct: number | null;
  stuffPlus: number | null;
  // Contact suppression
  /** Exit velocity allowed vs pitches with the SAME movement profile, sign
   *  flipped so higher is better. Shrunk by n/(n+30) BIP; null under 15 BIP,
   *  which is why it is ~60% populated. Keyed by the five clustered families
   *  (FB SI SL CB CH), so FF reads FB and CT/SW read SL.
   *  ../internal_draft_model/docs/contact_suppression_grades.md */
  contactSuppressionZ: number | null;
  /** The same comparison inside the pitcher's own conference. r = +0.96 with
   *  contactSuppressionZ; falls back to it when the conference cell is thin. */
  conferenceRelativeZ: number | null;
  /** Movement cluster has spin efficiency below 0.75 -- seam-shifted-wake
   *  proxy. Only FF and CT earn bonus credit for it. */
  /** Null where the pitcher has no pitch_grades row at all -- 1,864 of 4,728
   *  profiles. The exporter now emits the key rather than omitting it. */
  // Unified model grades
  /** See PitchProfileRow.stuffPlusShrunk — same field, arsenal surface. */
  stuffPlusShrunk?: number | null;
  stuffPlusCI_lo?: number | null;
  stuffPlusCI_hi?: number | null;
  abStuffPlus?: number | null;
  abStuffPlusShrunk?: number | null;
  abStuffPlusCI_lo?: number | null;
  abStuffPlusCI_hi?: number | null;
  /**
   * The pitch type whose model produced this row's Stuff+ fields, or null when
   * the row is graded by its own.
   *
   * Stuff+ v5 trains eight families and nine pitch types exist, so three are
   * graded by a model that is not theirs: SW and FS by taxonomy — Luke
   * Craytor's sweeper and slider sit 0.03 sd apart in both break axes, one
   * pitch under two tags — and KN by borrowing, since no knuckleball model
   * exists at all.
   *
   * The consequence, and the reason this field exists: `stuffPlus`, both CI
   * bounds, both platoon splits, `stuffPlusSides`, `nStuffSwings` and
   * `nStuffPitches` are ALL copied to both rows. Measured 2026-08-30, 1,228 of
   * 4,730 profiles publish at least one such pair — and 506 of those rows show
   * a swing count above 20 for a pitch under 5% usage, a splitter thrown seven
   * times displaying the changeup's 59 swings.
   *
   * Distinct from `proxyGradedAs`, which says "this pitch has no model of its
   * own". That is true of KN and false of SW: after the fold the slider model
   * is the CORRECT grader for a sweeper, not a fallback. A row can carry both.
   *
   * The observed columns — usage, velo, break, whiff, counts — are genuinely
   * this tag's and are NOT shared.
   */
  stuffGradeFrom?: string | null;
  /** Swings the Stuff+ model scored — not every swing at this pitch type.
   *  NOT published since Stuff+ v7, which is fitted on every pitch rather than
   *  on swings, so `nStuffPitches` is the only Stuff+ denominator there is. */
  nStuffSwings?: number | null;
  /** What Stuff+ v7 EXPECTS this pitch type to do, on the raw CSW scale, for
   *  reading against the observed `cswPct`. v7 targets count-normalised CSW, so
   *  this is the quantity the grade is built from — v5's equivalent column was a
   *  whiff prediction and nothing consumed it. */
  predictedCswPct?: number | null;
  /** Called pitches the Loc+ model scored for this pitch type's family. */
  nLocTakes?: number | null;
  /** Pitches the Stuff+ model scored — the denominator behind the CI, which is
   *  larger than nStuffSwings because the grade averages over every pitch. */
  nStuffPitches?: number | null;
  // Platoon splits. Both models grade (family x platoon) and the site shows one
  // number per pitch type; these are the halves. `*Sides` is how many platoon
  // cells fed the collapse — 1 means the grade describes only the batters on
  // that side, which for Loc+ is 6,422 (pitcher, pitch type) pairs.
  stuffPlusVsLHH?: number | null;
  stuffPlusVsRHH?: number | null;
  stuffPlusSides?: number | null;
  locPlusVsLHH?: number | null;
  locPlusVsRHH?: number | null;
  locPlusSides?: number | null;
  /** Pitching+ v3's own (type, side) cells; null where the model wrote no cell (under 10 pitches). */
  pitchingPlusVsLHH?: number | null;
  pitchingPlusVsRHH?: number | null;
  locPlusCI_lo?: number | null;
  locPlusCI_hi?: number | null;
  /** Share of this Loc+ that is signal rather than sampling noise, 0–1. The
   *  grade is shrunk toward 100 by exactly this much, so a low value means the
   *  number is close to average because we have not seen enough of the pitch —
   *  not because the pitch is average. */
  locReliability?: number | null;
  /** Every swing at this pitch type. The denominator behind Whiff% and Contact%. */
  nSwings?: number | null;
  nPitches?: number | null;
  nPitchesLoc?: number | null;
  nZonePitches?: number | null;
  nOozPitches?: number | null;
  nZoneSwings?: number | null;
  nOozSwings?: number | null;
  nFirstPitch?: number | null;
  nTwoStrike?: number | null;
  // Per-pitch model grades. These WERE pitcher-level — locPlus coalesced to the
  // pitcher's overall figure and pitchingPlus was a blend computed in R — and
  // both are now this pitch type's own cell or null. docs/per-pitch-grades.md.
  // A folded family shares one cell: a cutter carries the slider family's Loc+
  // and Pitching+ because that is the unit each model grades.
  locPlus?: number | null;
  pitchingPlus?: number | null;
  xrvPlus?: number | null;
  xrvPer100?: number | null;
  /** Observed run value per 100, pitcher-positive. The outcome, not the model. */
  rvPer100?: number | null;
  /** rvPer100 - xrvPer100. Results minus stuff; read as luck. See withRvGap. */
  rvGap?: number | null;
}

export interface MovementPoint {
  pitchType: PitchType;
  ivb: number;
  hb: number;
}

/**
 * The 11×11 KDE grid the R export used to attach to every pitcher profile.
 *
 * The export field is gone (spec §5.3 — it was 22.9 MB, and the client-side
 * surface engine replaces it), so nothing produces one of these any more. The
 * type survives because `components/3d/scouting-scenes.tsx` still declares an
 * optional `heatmaps` prop and a `HeatmapOverlay` that consume it; that overlay
 * now has no data source and should either be re-fed from
 * `/api/data/surface/pitcher/{id}` or removed. Left to whoever owns the 3D lab
 * rather than deleted out from under them.
 */
export interface LocationHeatmap {
  pitchType: PitchType;
  // 2D density grid (from KDE)
  grid: number[][];
  zonePct: number;
  // Zone boundaries (ft)
  xMin: number;
  xMax: number;
  zMin: number;
  zMax: number;
}

export interface PercentileSet {
  velo: number;
  ivb: number;
  extension: number;
  whiffPct: number;
  cswPct: number;
  kPct: number;
  stuffPlus: number | null;
  abStuffPlus?: number | null;
  abStuffPlusShrunk?: number | null;
}

// ─── Filters ───────────────────────────────────────────────────────────────────

export interface LeaderboardFilters {
  search?: string;
  team?: string;
  conference?: string;
  year?: string;
  minPA?: number;
  minIP?: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

// ─── API Response Wrappers ─────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ApiError {
  error: string;
  code: string;
}

// ─── TrackMan 3D Pitch Records ─────────────────────────────────────────────────

/**
 * Quality/completeness metadata for a 3D pitch record.
 * Indicates which fields were available in the source data.
 */
export interface PitchQualityMeta {
  /** Overall quality score (0-1) based on source completeness */
  qualityScore: number;
  /** Bitmask-style flags indicating available field groups */
  completenessFlags: {
    trajectory: boolean; // x0..az0 present
    plateLocation: boolean; // px, pz present
    breakMetrics: boolean; // breakX, breakZ, spinRate, spinAxis present
    releaseMetrics: boolean; // releaseSpeed, releaseAngle, releaseDirection, extension present
    contactMetrics: boolean; // contactPosition, launchAngle, exitVelocity present
  };
  /** Source system that produced this record */
  source: "trackman_v3" | "trackman_legacy" | "synthetic";
  /** Season year */
  season: number;
}

/**
 * A single pitch record with 3D trajectory data.
 *
 * All optional fields use `| null` (not `?`) to preserve nullable semantics:
 * - `null` = field was not available in source data
 * - `number` = field was present and valid
 *
 * Trajectory inputs use the constant-acceleration model (x0..az0).
 */
export interface PitchRecord {
  /** Unique pitch identifier (Statcast game_pk + at-bat + pitch number) */
  pitchId: string;
  /** Pitcher identifier (canonical PitcherId) */
  pitcherId: string;
  /** Batter identifier (canonical BatterId) */
  batterId: string;
  /** Normalized pitch type code */
  pitchType: PitchType;
  /** Topo-tagger pitch type (spec 2026-10-06-topo-pitch-tagger); null when untagged. */
  autoType?: PitchType | null;
  autoConf?: number | null;
  autoDesc?: string | null;
  autoLow?: boolean | null;
  /** ISO 8601 timestamp */
  timestamp: string;
  gameId?: string | null;
  pitcherName?: string | null;
  batterName?: string | null;
  /**
   * TrackMan's own spelling, passed straight through by the exporter: the data
   * contains "Left"/"Right". This was declared as "L"|"R", which no exported
   * record has ever matched — TypeScript then rejected comparisons against the
   * values actually present. Both spellings are allowed because other feeds in
   * this repo use the short form; normalize with `toHand()` rather than
   * comparing inline.
   */
  pitcherThrows?: Handedness;
  batterSide?: Handedness;
  inning?: number | null;
  balls?: number | null;
  strikes?: number | null;
  outs?: number | null;
  count?: string | null;
  pitchCall?: string | null;
  playResult?: string | null;
  /**
   * Plate-appearance result: "Strikeout" | "Walk" | "Undefined".
   *
   * Authoritative when present, and set only on the pitch that ended the plate
   * appearance. Absent from exports built off the VT raw feed, which has no
   * `KorBB` column at all — so a consumer must fall back to deriving it. See
   * `isStrikeoutPitch` in lib/pitch-outcomes.ts.
   */
  korBB?: string | null;

  // ─── Trajectory Constants (constant-acceleration model) ───────────────────────
  /** Initial x-position at release (ft) */
  x0: number;
  /** Initial y-position at release (ft) — typically ~50-55 ft from home */
  y0: number;
  /** Initial z-position at release (ft) */
  z0: number;
  /** Initial x-velocity (ft/s) */
  vx0: number;
  /** Initial y-velocity (ft/s) — negative toward home plate */
  vy0: number;
  /** Initial z-velocity (ft/s) */
  vz0: number;
  /** x-acceleration (ft/s²) */
  ax0: number;
  /** y-acceleration (ft/s²) */
  ay0: number;
  /** z-acceleration (ft/s²) — gravity-adjusted */
  az0: number;

  // ─── Derived Plate Location ──────────────────────────────────────────────────
  /** Horizontal plate location (ft from center, batter's perspective) */
  px: number | null;
  /** Vertical plate location (ft from ground) */
  pz: number | null;

  // ─── Break Metrics (optional — may be unavailable in legacy data) ────────────
  /** Horizontal break (ft) */
  breakX: number | null;
  /** Vertical break (ft) */
  breakZ: number | null;
  /** Spin rate (rpm) */
  spinRate: number | null;
  /** Spin axis (degrees, 0 = top spin, 180 = bottom spin) */
  spinAxis: number | null;

  // ─── Release Metrics (optional) ──────────────────────────────────────────────
  /** Release speed (mph) */
  releaseSpeed: number | null;
  /** Release angle (degrees, 0 = horizontal) */
  releaseAngle: number | null;
  /** Release direction (degrees, 0 = straight toward catcher) */
  releaseDirection: number | null;
  /** Extension (ft beyond rubber) */
  extension: number | null;
  /** Release height and side, retained for release-cluster views */
  releaseHeight?: number | null;
  releaseSide?: number | null;
  /** TrackMan plate-flight duration */
  zoneTime?: number | null;

  // ─── Contact Metrics (optional — only for batted balls) ──────────────────────
  /** 3D contact position [x, y, z] in ft (null if not batted ball) */
  contactPosition: [number, number, number] | null;
  /** Launch angle (degrees) */
  launchAngle: number | null;
  /** Exit velocity (mph) */
  exitVelocity: number | null;
  /** Optional batted-ball landing data */
  sprayAngle?: number | null;
  distance?: number | null;
  bearing?: number | null;
  hitType?: string | null;

  // ─── Stuff+ v5 Model Features ────────────────────────────────────────────────
  /** Feature values matching train_stuff_plus_v5.py, for seeding the calculator */
  stuffFeatures?: StuffFeatures | null;

  // ─── Quality Metadata ────────────────────────────────────────────────────────
  qualityMeta: PitchQualityMeta;
}

/**
 * Stuff+ v5 model features, derived at export time.
 *
 * These MUST match the derivations in `train_stuff_plus_v5.py` exactly — the
 * model scores off-distribution otherwise. Notably `tiltDegrees` uses the
 * training convention `(h*60 + m)/720*360`, which is neither TrackMan's
 * `SpinAxis` column nor `PitchRecord.spinAxis`, and is deliberately left
 * unwrapped (12:01–12:59 exceed 360).
 */
export interface StuffFeatures {
  /** EffectiveVelo (mph); falls back to release speed when absent */
  effVelo: number | null;
  /** VertApprAngle − (−8.368 + 1.157 × PlateLocHeight); 0 when either is missing */
  hvaa: number;
  /** Training-convention tilt in degrees, unwrapped */
  tiltDegrees: number;
  /** min(1, √(ivb² + hb²) / (spin × 0.0085 × velo/90)); 0.7 default */
  spinEff: number;
  /** Fastball baseline velo − this pitch's velo; positive = slower. 0 for FF */
  veloDiff: number;
  /** This pitch's IVB − fastball baseline IVB. 0 for FF */
  ivbDiff: number;
  /** This pitch's HB − fastball baseline HB. 0 for FF */
  hbDiff: number;

  // ── Stuff+ v7's slots ──────────────────────────────────────────────────────
  // Separate fields, not replacements, because they are DIFFERENT QUANTITIES.
  // v7 builds its differentials against the 90th percentile of the pitcher's
  // release speed and the mean shape within 2.5 mph of it, where v5 uses the
  // FF/FF_SI/ALL anchor ladder; `veloDiffV7` also runs the other way round
  // (`velo - fb_velo`, where v5 ships `fb_velo - velo`). Feeding a v5 field into
  // a v7 slot scores the pitch off-distribution and raises nothing.
  //
  // Optional and nullable: they are absent from exports written before
  // 2026-09-25, and null where the inputs were missing. v7 is LightGBM and
  // handles a missing feature natively, so null must be passed through rather
  // than defaulted — unlike v5's 0/0.7 conventions above.
  //
  // v7's `axis` slot has no field here: it takes raw `PitchRecord.spinAxis`.
  // It is NOT `tiltDegrees`.
  hvaaV7?: number | null;
  spinEffV7?: number | null;
  veloDiffV7?: number | null;
  ivbDiffV7?: number | null;
  hbDiffV7?: number | null;
}

/**
 * A single swing/batted-ball record with kinematic data.
 *
 * Mirrors PitchRecord structure for batter-side queries.
 */
export interface SwingMetrics {
  /** Unique swing identifier (matches pitchId for pitch-level data) */
  swingId: string;
  /** Batter identifier */
  batterId: string;
  /** Pitcher identifier */
  pitcherId: string;
  /** Pitch type faced */
  pitchType: PitchType;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Batter handedness — required for handedness-aware spray normalization */
  batterSide?: Handedness;
  pitcherThrows?: Handedness;
  px?: number | null;
  pz?: number | null;
  balls?: number | null;
  strikes?: number | null;
  pitchCall?: string | null;
  playResult?: string | null;
  /** "Strikeout" | "Walk" | "Undefined"; absent in exports from the VT feed. */
  korBB?: string | null;
  distance?: number | null;
  bearing?: number | null;
  sprayAngle?: number | null;
  hitType?: string | null;

  // ─── Shape of the pitch swung at ─────────────────────────────────────────────
  /**
   * Duplicated from the pitcher-side record for the same pitch id rather than
   * joined at read time — a batter's plate appearances come from ~100 different
   * pitchers, so resolving them would mean fetching ~100 multi-MB files to
   * describe 130 swings. Verified identical to the pitcher-side values across
   * 39,951 records.
   *
   * Optional because exports written before these fields existed omit them, and
   * because the hitter lab must keep working against one of those.
   */
  releaseSpeed?: number | null;
  breakX?: number | null;
  breakZ?: number | null;
  spinRate?: number | null;
  spinAxis?: number | null;
  extension?: number | null;
  releaseHeight?: number | null;
  releaseSide?: number | null;
  /** All fourteen v5 features derive from the fields above plus this block. */
  stuffFeatures?: StuffFeatures | null;

  // ─── Swing Kinematics ────────────────────────────────────────────────────────
  /** Bat speed at contact (mph) */
  batSpeed: number | null;
  /** Attack angle (degrees, upward = positive) */
  attackAngle: number | null;
  /** Time from commit to contact (seconds) */
  timeToContact: number | null;

  // ─── Contact Metrics (optional — only for batted balls) ──────────────────────
  /** 3D contact position [x, y, z] in ft (null if not batted ball) */
  contactPosition: [number, number, number] | null;
  /** Launch angle (degrees) */
  launchAngle: number | null;
  /** Exit velocity (mph) */
  exitVelocity: number | null;

  // ─── Quality Metadata ────────────────────────────────────────────────────────
  qualityMeta: PitchQualityMeta;
}

/**
 * Query parameters for 3D pitch record API routes.
 */
export interface PitchRecordQuery {
  /** Season year filter */
  season?: number;
  /** Pitch type filter */
  pitchType?: PitchType;
  /** Count state filter (e.g. "0-0", "0-2", "3-2") */
  count?: string;
  /** Inclusive lower bound on `timestamp`, as an ISO-8601 date or datetime */
  from?: string;
  /** Inclusive upper bound on `timestamp`, as an ISO-8601 date or datetime */
  to?: string;
  /** Maximum number of records to return */
  limit?: number;
}

/**
 * API response wrapper for 3D pitch record arrays.
 */
export interface PitchRecordResponse {
  data: PitchRecord[];
  total: number;
  query: PitchRecordQuery;
}

/**
 * API response wrapper for swing metrics arrays.
 */
export interface SwingMetricsResponse {
  data: SwingMetrics[];
  total: number;
  query: PitchRecordQuery;
}

// ─── Per-pitch decision run value ──────────────────────────────────────────────

/**
 * One swing decision, valued in runs. `docs/per-pitch-drv.md`.
 *
 * Deliberately not called "Decision+": a `+` is a 100-centred population grade
 * and a single pitch has no population. `drv` measures what one decision was
 * worth, so it carries no reliability — there is nothing to be reliable about.
 * Aggregating these into a claim about the hitter is a different object and needs
 * `DecisionsMeta.aggregationFloor`.
 */
export interface PitchDecision {
  /** Pitch id — the same key `SwingMetrics.swingId` carries. */
  pitchId: string;
  gameId: string;
  inning: number;
  /** Plate appearance within the inning. */
  pa: number;
  pitchOfPa: number;
  balls: number;
  strikes: number;
  pitchType: PitchType;
  /** Horizontal plate location, feet from centre, catcher's view. */
  plateX: number;
  /** Plate location height in feet. */
  plateZ: number;
  pitcher: string;
  /** TrackMan `PitchCall`. */
  call: string;
  swung: boolean;
  /** Run value of the decision he made. Positive is a better call. */
  drv: number;
  /** Run value of swinging, whether or not he did. */
  rvSwing: number;
  /** Pitcher handedness. Absent when TrackMan did not record it. */
  pHand?: "L" | "R";
  /** The pitcher's team — who this was against. The code the site displays. */
  pTeam?: string;
  /** TrackMan `PlayResult`, on batted balls only. Absent means not in play. */
  playResult?: string;
  /** "Strikeout" or "Walk" when the pitch ended the plate appearance that way. */
  korbb?: string;
  /** Outs when the pitch was thrown. Absent when the half-inning would not reconstruct. */
  outs?: number;
  /**
   * Runners aboard, 0-3, from the flow reconstruction — a COUNT, not which bases.
   * `docs/re-runner-count-handoff.md` §1: naming the bases buys 0.0008 runs/pitch.
   *
   * For DESCRIPTION only. `docs/decision-leverage.md` measured weighting a grade
   * by base-out leverage: reliability falls 0.6479 -> 0.6211 and a shuffled index
   * costs the same, so it carries no base-out information.
   */
  runners?: number;
  /** Run value of taking, whether or not he did. */
  rvTake: number;
  /** Share of D1 hitters who would have swung. */
  pSwing: number;
}

/**
 * Denominators a consumer needs before turning pitches into a claim about a
 * player. Published beside the data on purpose — the alternative is every caller
 * inventing its own floor.
 */
export interface DecisionsMeta {
  unit: "runs";
  nBatters: number;
  nPitches: number;
  /** Pitches at which an aggregate is half signal. */
  drvDhalf: number;
  minRankReliability: number;
  /** Fewest pitches an aggregate needs before it may be ranked. */
  aggregationFloor: number;
  note: string;
}

export interface BatterDecisions {
  batterId: string;
  batter: string;
  nPitches: number;
  /** Sum of `drv` over 100 pitches. A measurement of this sample, not a grade. */
  drvPer100: number;
  pitches: PitchDecision[];
}
