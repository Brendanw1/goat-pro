/**
 * Stuff+ v7 scoring for the client what-if calculator.
 *
 * ── Why this is a separate module from stuff-model.ts ──────────────────────
 * That file's "one code path, no second scorer to drift" rule holds because v5
 * and v6 compute the SAME quantity: P(whiff | swing), graded against a whiff
 * population. v7 does not. It targets count-normalised CSW, is LightGBM rather
 * than XGBoost, and reaches a grade through an isotonic calibration map that has
 * no v5/v6 analogue. Folding it into predictWhiffProbability() would mean a
 * function named for whiff returning CSW, which is the kind of quiet lie the
 * mixed-scale defect was made of. Different quantity, different module; the
 * version switch still lives in ONE place (STUFF_MODEL_VERSION).
 *
 * ── The tree format ────────────────────────────────────────────────────────
 * research/stuff-model/export_browser_model.py flattens LightGBM's nested
 * tree_structure into parallel arrays using LightGBM's own child encoding: a
 * child >= 0 is an internal node index, a child < 0 is the leaf ~child. The
 * exporter verifies the flattening against LightGBM's own predict() before
 * writing, to 0.00000 grade points, so a mismatch found here is this walker's.
 *
 * ── Calibration is NOT optional here ───────────────────────────────────────
 * The frozen scale is built from per-PITCHER MEAN predictions, so a single
 * pitch is over-dispersed against it: sd 16.0 raw versus a season grade's 8.4,
 * calibration slope 0.70 against an ideal 1.0. The calculator shows exactly one
 * hypothetical pitch, so it is the worst case for this. Calibrated, the slope is
 * 0.98 and sd 11.8. Any caller that skips `calibrated` publishes a number about a
 * quarter too extreme, which on a what-if tool reads as "this tweak gained 8
 * points" when it gained 6.
 */

/** Feature order is positional in the model. Do not reorder. */
export const STUFF_FEATURE_ORDER_V7 = [
  "velo", "ivb", "hb", "spin", "ext", "rel_h", "rel_s", "axis", "hvaa_v5",
  "velo_diff", "spin_eff", "ivb_diff", "hb_diff",
] as const;

export type StuffFeatureV7 = (typeof STUFF_FEATURE_ORDER_V7)[number];

/** One flattened tree. `root` is the entry child reference, encoded as below. */
export interface TreeV7 {
  root: number;
  /** split feature index per internal node */ f: number[];
  /** threshold per internal node */ t: number[];
  /** left child reference per internal node */ l: number[];
  /** right child reference per internal node */ r: number[];
  /** 1 when a missing value goes left */ d: number[];
  /** leaf values, indexed by ~childRef */ v: number[];
}

export interface StuffModelV7 {
  key: string;
  features: string[];
  trees: TreeV7[];
}

export interface PopulationStatV7 {
  mean: number;
  sd: number;
}

export interface CalibrationV7 {
  x: number[];
  y: number[];
}

const GRADE_MIN = 50;
const GRADE_MAX = 175;

function isFiniteNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

/**
 * Pitching+ v3's binding order: v7's thirteen, then location and count. Same
 * flattened layout (export_browser_model.py --design pitching_v3), so it parses
 * with the same function against this order.
 */
export const PITCHING_FEATURE_ORDER_V3 = [...STUFF_FEATURE_ORDER_V7, "plate_x", "plate_z", "Balls", "Strikes"] as const;

export function parseStuffModelV7(
  raw: unknown,
  order: readonly string[] = STUFF_FEATURE_ORDER_V7,
): StuffModelV7 {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("stuff v7 model: not an object");
  }
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.trees) || o.trees.length === 0) {
    throw new Error("stuff v7 model: no trees");
  }
  if (!Array.isArray(o.features)) {
    throw new Error("stuff v7 model: no feature list");
  }
  // The feature vector is passed positionally, so a model whose order differs
  // from ours would score a plausible number from the wrong columns.
  const features = o.features as string[];
  if (features.length !== order.length
      || features.some((f, i) => f !== order[i])) {
    throw new Error(
      `stuff v7 model: feature order ${features.join(",")} does not match `
      + `${order.join(",")}`,
    );
  }
  return { key: String(o.key ?? ""), features, trees: o.trees as TreeV7[] };
}

/** Walk one tree. `features` is positional, in STUFF_FEATURE_ORDER_V7. */
export function walkTreeV7(tree: TreeV7, features: readonly (number | null)[]): number {
  let node = tree.root;
  let guard = 0;
  while (node >= 0) {
    // A malformed model must not hang the browser; depth cannot exceed the node
    // count, so exceeding it means the child references form a cycle.
    if (guard++ > tree.f.length) throw new Error("stuff v7: cyclic tree");
    const x = features[tree.f[node]];
    const goLeft = isFiniteNumber(x) ? x <= tree.t[node] : tree.d[node] === 1;
    node = goLeft ? tree.l[node] : tree.r[node];
  }
  return tree.v[~node];
}

/**
 * Raw count-normalised CSW prediction. LightGBM regression with an L2 objective,
 * so the model output is the plain sum of leaf values -- no link function, unlike
 * the logistic v5/v6 path.
 */
export function predictRawV7(
  model: StuffModelV7,
  features: readonly (number | null)[],
): number {
  let sum = 0;
  for (const tree of model.trees) sum += walkTreeV7(tree, features);
  return sum;
}

/**
 * Apply the isotonic calibration map by linear interpolation, clamping outside
 * its fitted range. Monotone by construction, so a clamp cannot reorder anything.
 */
export function calibrateV7(p: number, cal: CalibrationV7): number {
  const { x, y } = cal;
  if (x.length === 0) return p;
  if (p <= x[0]) return y[0];
  if (p >= x[x.length - 1]) return y[y.length - 1];
  let lo = 0;
  let hi = x.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (x[mid] <= p) lo = mid; else hi = mid;
  }
  const span = x[hi] - x[lo];
  return span === 0 ? y[lo] : y[lo] + ((p - x[lo]) / span) * (y[hi] - y[lo]);
}

/**
 * Clipped but NOT rounded, matching stuff.py's stuff_plus(). Rounding is a display
 * concern and belongs at the edge: the season artifact rounds because a stored
 * grade is read as an integer, while a what-if slider that rounds mid-computation
 * would show a tweak as worth 0 points when it is worth 0.4.
 */
function toGrade(p: number, stat: PopulationStatV7): number {
  if (!isFiniteNumber(p) || !isFiniteNumber(stat?.sd) || stat.sd === 0) return NaN;
  const z = (p - stat.mean) / stat.sd;
  return Math.min(GRADE_MAX, Math.max(GRADE_MIN, 100 + 10 * z));
}

/** What the UI prints. The artifact applies the same rounding. */
export function displayGradeV7(grade: number): number | null {
  return Number.isFinite(grade) ? Math.round(grade) : null;
}

/**
 * Per-cell grade: "how good is this pitch, as a pitch of its type against this
 * side". Every (type x side) cell is centred at 100 by construction, so this
 * CANNOT rank a slider against a sinker -- use gradeAbsoluteV7 for that.
 */
export function gradeV7(
  model: StuffModelV7,
  features: readonly (number | null)[],
  stat: PopulationStatV7,
  cal: CalibrationV7,
): number {
  return toGrade(calibrateV7(predictRawV7(model, features), cal), stat);
}

/**
 * Absolute grade: one pooled reference for every pitch type, so types are
 * comparable. CAVEAT, do not drop it: this ranks CSW-GENERATION, not pitch
 * VALUE. A sinker that lives on weak contact grades about 90 and should not.
 */
export function gradeAbsoluteV7(
  model: StuffModelV7,
  features: readonly (number | null)[],
  absoluteReference: PopulationStatV7,
  cal: CalibrationV7,
): number {
  return toGrade(calibrateV7(predictRawV7(model, features), cal), absoluteReference);
}

/**
 * ABStuff+ from a grade that is already on a (type x side) cell's scale. Both grades are the same prediction read
 * against different references, so the map is exact: z_abs = (cell.sd * z_cell + cell.mean - abs.mean) / abs.sd.
 * For a surface that holds only a cell grade, not the prediction. Clipped like
 * gradeAbsoluteV7; null when either reference is unusable.
 */
export function absFromCellGrade(grade: number, cell: PopulationStatV7 | undefined, abs: PopulationStatV7 | undefined): number | null {
  if (!isFiniteNumber(grade) || !cell || !abs || !isFiniteNumber(cell.sd) || !isFiniteNumber(abs.sd) || abs.sd === 0) return null;
  const z = (cell.sd * ((grade - 100) / 10) + cell.mean - abs.mean) / abs.sd;
  return Math.min(GRADE_MAX, Math.max(GRADE_MIN, 100 + 10 * z));
}

/** Artifact key for a (pitch type, batter side) cell, e.g. `Fastball_vs_RHH`. */
export function stuffModelKeyV7(pitchType: string, batterSide: "Left" | "Right"): string {
  return `${pitchType}_vs_${batterSide === "Left" ? "L" : "R"}HH`;
}

/**
 * Build v7's thirteen-feature vector from an exported pitch record.
 *
 * ── Order is binding ────────────────────────────────────────────────────────
 * `reference_population.json` carries `feature_order_is_binding`. The boosters
 * index by POSITION, so a vector in the wrong order is not an error, it is a
 * different pitch. This builds from STUFF_FEATURE_ORDER_V7 rather than a
 * hand-written literal so the two cannot drift.
 *
 * ── Every v7 slot takes a v7 field ──────────────────────────────────────────
 * Three of them have v5 near-namesakes that are NOT interchangeable:
 *   axis      raw `spinAxis`, never `stuffFeatures.tiltDegrees` — that is v5's
 *             (h*60+m)/720*360 convention, left unwrapped past 360
 *   velo_diff `veloDiffV7` (`velo - fb_velo`); v5's `veloDiff` is the NEGATIVE
 *             of this, built against a different baseline
 *   ivb/hb_diff  `ivbDiffV7`/`hbDiffV7`, against the velocity-window mean rather
 *             than the FF/FF_SI/ALL anchor, and never zeroed for a four-seam
 *
 * `hvaa_v5` keeps its confusing name from the training code: it is v5's hvaa
 * FORMULA, and v7 genuinely uses it, so `hvaaV7` and `stuffFeatures.hvaa` agree
 * except that the v7 field preserves null where v5 substitutes 0.
 *
 * Returns null when the export predates 2026-09-25 and carries no v7 fields at
 * all — scoring those with v5 values would be silent and wrong. Individual
 * nulls inside the vector are fine: LightGBM handles a missing feature natively.
 */
export function featuresFromRecordV7(
  record: {
    releaseSpeed?: number | null; breakZ?: number | null; breakX?: number | null;
    spinRate?: number | null; extension?: number | null;
    releaseHeight?: number | null; releaseSide?: number | null;
    spinAxis?: number | null;
    // The index signature is load-bearing, not slack typing: this object also
    // carries v5's fields (hvaa, tiltDegrees, veloDiff, ...) and only the v7
    // ones are read here. Naming just the v7 keys would make every real record
    // fail the excess-property check.
    stuffFeatures?: {
      hvaaV7?: number | null; spinEffV7?: number | null; veloDiffV7?: number | null;
      ivbDiffV7?: number | null; hbDiffV7?: number | null;
      [k: string]: unknown;
    } | null;
  },
): (number | null)[] | null {
  const { releaseSpeed, breakZ, breakX } = record;
  // The three with no defensible fallback, same rule the v5 builder uses.
  if (releaseSpeed == null || breakZ == null || breakX == null) return null;

  const d = record.stuffFeatures ?? null;
  // An export with none of the v7 fields cannot be scored by v7 at all. Saying
  // so beats quietly grading it against v5-convention numbers.
  if (d == null || (d.veloDiffV7 === undefined && d.hvaaV7 === undefined)) return null;

  const slot: Record<StuffFeatureV7, number | null> = {
    velo: releaseSpeed,
    ivb: breakZ,
    hb: breakX,
    spin: record.spinRate ?? null,
    ext: record.extension ?? null,
    rel_h: record.releaseHeight ?? null,
    rel_s: record.releaseSide ?? null,
    axis: record.spinAxis ?? null,
    hvaa_v5: d.hvaaV7 ?? null,
    velo_diff: d.veloDiffV7 ?? null,
    spin_eff: d.spinEffV7 ?? null,
    ivb_diff: d.ivbDiffV7 ?? null,
    hb_diff: d.hbDiffV7 ?? null,
  };
  return STUFF_FEATURE_ORDER_V7.map((f) => slot[f]);
}

// ── Stuff+ v8: the pure half of the per-pitch grade ──────────────────────────────
// v8 keeps v7's thirteen features and this walker; what changed is which booster grades a pitch (its topo class) and
// which reference scales it (its TrackMan tag). These live here, not in lib/live/scorer.ts, because that module reads
// R2 and the client grader cannot import it. The scorer re-exports them, so there is one copy of each rule.

const SIDE_KEY = (s: "Left" | "Right") => (s === "Left" ? "LHH" : "RHH");
const TAG_CELLS = new Set(["Fastball", "Sinker", "Cutter", "Slider", "Sweeper", "Curveball", "ChangeUp", "Splitter"]);

/** Booster key for a class x side, e.g. `BB_vs_RHH` (models/stuff_v8/stuff_<key>, models/pitching_v4/pp_<key>). */
export function classModelKey(cls: "FB" | "BB" | "CH", side: "Left" | "Right"): string {
  return `${cls}_vs_${SIDE_KEY(side)}`;
}

/**
 * Reference-cell key for the pitch's TrackMan tag or topo name. Sweeper is its own cell; a repeat group ("Slider 2")
 * is graded on its base type's scale; null off the eight.
 */
export function tagReferenceKey(tag: string | null, side: "Left" | "Right"): string | null {
  const t = tag?.replace(/ \d$/, "") ?? null;
  return t && TAG_CELLS.has(t) ? `${t}_vs_${SIDE_KEY(side)}` : null;
}

/** A staged reference that predates the Sweeper cells: grade sweepers on the Slider scale until the new one lands. */
export function withSweeperFallback<T>(cells: Record<string, T> | null | undefined): Record<string, T> | null {
  if (!cells) return null;
  const out = { ...cells };
  for (const side of ["LHH", "RHH"]) out[`Sweeper_vs_${side}`] ??= out[`Slider_vs_${side}`];
  return out;
}

/** A pitch's shape, with `hvaa` already formed (lib/stuff-hvaa.ts: F1L for Stuff+ v8, hvaa_v5 for Pitching+ v4). */
export interface ShapeV7 {
  velo: number | null; ivb: number | null; hb: number | null; spin: number | null; ext: number | null;
  relH: number | null; relS: number | null; axis: number | null; hvaa: number | null;
}

/**
 * v7's thirteen features in STUFF_FEATURE_ORDER_V7 from a shape and the pitcher's fastball reference (p90 velo, mean
 * IVB/HB within 2.5 mph of it). The differentials are pitch MINUS fastball. Spin efficiency is the live tool's:
 * total break over the break a fully transverse spin of that rate would give, capped at 1.
 */
export function featureVectorV7(
  s: ShapeV7,
  base: { fbVelo: number | null; fbIvb: number | null; fbHb: number | null } | null,
): (number | null)[] {
  const theoretical = s.spin != null && s.velo != null ? s.spin * 0.0085 * (s.velo / 90) : null;
  const spinEff = theoretical != null && theoretical > 0 && s.ivb != null && s.hb != null
    ? Math.min(1, Math.hypot(s.ivb, s.hb) / theoretical)
    : null;
  const d = (v: number | null, ref: number | null | undefined) => (v != null && ref != null ? v - ref : null);
  return [
    s.velo, s.ivb, s.hb, s.spin, s.ext, s.relH, s.relS, s.axis, s.hvaa,
    d(s.velo, base?.fbVelo), spinEff, d(s.ivb, base?.fbIvb), d(s.hb, base?.fbHb),
  ];
}

/**
 * Why a feature vector cannot be graded, or null. The v8 boosters were fit with no missing values (missing_type None on
 * every split): LightGBM scores a null as 0 and this walker sends it down default_left, and neither is the pitch. A null
 * fastball differential would read a curveball as "same speed as his fastball". So a pitch with any null shape input
 * gets no grade and a reason, never an invented one (decided 2026-10-11).
 */
export function missingInputs(x: readonly (number | null)[]): string | null {
  const NAMES = ["velo", "IVB", "HB", "spin", "extension", "release height", "release side", "spin axis", "approach angle",
    "fastball baseline", "spin efficiency", "fastball baseline", "fastball baseline"];
  const gone = [...new Set(x.slice(0, 13).flatMap((v, i) => (v == null || !Number.isFinite(v) ? [NAMES[i]] : [])))];
  return gone.length ? (gone.includes("fastball baseline") && gone.length === 1 ? "waiting for a fastball baseline" : `missing ${gone.join(", ")}`) : null;
}

export interface PitchGradeV8 {
  /** Calibrated Stuff+ against the pitch's tag cell, to 0.1; null when it cannot be formed. */
  stuffPlus: number | null;
  /** ABStuff+: the same prediction on the pooled `absolute_reference`. Null whenever stuffPlus is. */
  abStuffPlus: number | null;
  /** The calibrated prediction both grades read. Unrounded, unclipped; null whenever stuffPlus is. */
  pred: number | null;
}

/** Both v8 grades from one calibrated prediction. The live scorer and the grader both end here. */
export function gradeFromPredV8(pred: number, stat: PopulationStatV7, abs: PopulationStatV7 | null | undefined): PitchGradeV8 {
  const grade = toGrade(pred, stat);
  if (!Number.isFinite(grade)) return { stuffPlus: null, abStuffPlus: null, pred: null };
  const ab = abs ? toGrade(pred, abs) : NaN;
  return {
    stuffPlus: Math.round(grade * 10) / 10,
    abStuffPlus: Number.isFinite(ab) ? Math.round(ab * 10) / 10 : null,
    pred,
  };
}

/**
 * The what-if twin's order: v8's thirteen minus `hvaa_v5`. Approach angle is velo, IVB and release height to R^2 0.987,
 * so it cannot be held while those move; the twin (models/stuff_v8_whatif) never saw it and answers only deltas.
 */
export const STUFF_WHATIF_FEATURE_ORDER_V8 = STUFF_FEATURE_ORDER_V7.filter((f) => f !== "hvaa_v5");
const HVAA_AT = STUFF_FEATURE_ORDER_V7.indexOf("hvaa_v5");
/** A v8 vector as the twin reads it. */
export function withoutHvaa<T>(x: readonly T[]): T[] {
  return x.filter((_, i) => i !== HVAA_AT);
}
