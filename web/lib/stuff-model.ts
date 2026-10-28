/**
 * The XGBoost tree walker, plus the few shared Stuff+ pieces that outlived v5/v6.
 *
 * Stuff+ itself is v8 (LightGBM, lib/stuff-model-v7.ts): the live tool, practice, Fall, the season bakes and the
 * grader all read it. The v5/v6 grading paths this file held (feature builders, family folding, whiff calibration,
 * reference populations, training bounds) were removed on 2026-10-16 once the grader and calculator left them; git
 * history has them. What remains:
 *
 *   parseStuffModel / predictProbabilityF32   any binary:logistic XGBoost JSON, for lib/decision-score.ts
 *   deriveHvaa                                approach angle from a gun's numbers, for the grader
 *   PitchStuffScore / PitchStuffResponse      the 3D labs' per-pitch grade shape (lib/stuff-scoring.ts)
 */

/** A missing feature; the walker routes these by each node's `default_left`. */
type Feature = number | null;

export type BatterSide = "Left" | "Right";

// ─── Raw XGBoost JSON ────────────────────────────────────────────────────────

interface RawTree {
  left_children: number[];
  right_children: number[];
  split_indices: number[];
  split_conditions: number[];
  default_left: number[];
  split_type?: number[];
}

interface RawModel {
  learner: {
    learner_model_param: { base_score: string; num_feature: string };
    objective: { name: string };
    gradient_booster: { model: { trees: RawTree[] } };
  };
}

interface Tree {
  left: Int32Array;
  right: Int32Array;
  featureIndex: Int32Array;
  threshold: Float64Array;
  defaultLeft: Uint8Array;
}

export interface StuffModel {
  trees: Tree[];
  /** logit(base_score) — the intercept, already in margin space. */
  baseMargin: number;
  numFeature: number;
}


/** One pitch's baked Stuff+ v8 (lib/stuff-scoring.ts). Here so client components can name it without importing R2. */
export interface PitchStuffScore {
  /** Stuff+ v8 for this pitch, on the season card's scale (clipped 50-175). */
  grade: number;
  /** ABStuff+: the same prediction on the pooled scale; null when the bake predates it. */
  abStuff: number | null;
}

export interface PitchStuffResponse {
  /** Keyed by `PitchRecord.pitchId`. */
  scores: Record<string, PitchStuffScore>;
  scored: number;
  /** Records the per-pitch bake holds no grade for (no class booster or tag cell, or no file for the pitcher). */
  noModel: number;
  /** Kept for the response shape; the bake has no separate unscoreable count. */
  unscoreable: number;
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

/**
 * `base_score` is stored as the *string* `"[3.2518297E-1]"` — a stringified
 * one-element array, not JSON. It is a probability, and XGBoost adds its logit
 * to the margin. Confirmed against booster margins to 1.8e-8.
 */
function parseBaseScore(raw: string): number {
  const value = Number(String(raw).replace(/[[\]]/g, ""));
  if (!Number.isFinite(value) || value <= 0 || value >= 1) {
    throw new Error(`Stuff+ model has unusable base_score: ${raw}`);
  }
  return Math.log(value / (1 - value));
}

export function parseStuffModel(raw: unknown): StuffModel {
  const model = raw as RawModel;
  const learner = model?.learner;
  if (!learner?.gradient_booster?.model?.trees) {
    throw new Error("Not an XGBoost model JSON: missing gradient_booster.model.trees");
  }
  if (learner.objective?.name !== "binary:logistic") {
    throw new Error(`Unexpected objective: ${learner.objective?.name}`);
  }

  const trees = learner.gradient_booster.model.trees.map((tree): Tree => {
    if (tree.split_type?.some((type) => type !== 0)) {
      throw new Error("Categorical splits are not supported by this walker");
    }
    return {
      left: Int32Array.from(tree.left_children),
      right: Int32Array.from(tree.right_children),
      featureIndex: Int32Array.from(tree.split_indices),
      threshold: Float64Array.from(tree.split_conditions),
      defaultLeft: Uint8Array.from(tree.default_left),
    };
  });

  return {
    trees,
    baseMargin: parseBaseScore(learner.learner_model_param.base_score),
    numFeature: Number(learner.learner_model_param.num_feature),
  };
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

/**
 * Walk one tree. XGBoost sends a row left when `value < threshold`; a missing
 * value follows `default_left` instead. Leaves are marked by `left === -1`, and
 * a leaf's output is stored in `split_conditions`, the same array thresholds
 * live in.
 */
function walk(tree: Tree, features: readonly Feature[]): number {
  let node = 0;
  while (tree.left[node] !== -1) {
    const value = features[tree.featureIndex[node]];
    const goLeft =
      value === null || value === undefined || Number.isNaN(value)
        ? tree.defaultLeft[node] === 1
        : value < tree.threshold[node];
    node = goLeft ? tree.left[node] : tree.right[node];
  }
  return tree.threshold[node];
}

/**
 * P(class) the way XGBoost's own predict() computes it: features cast to float32,
 * margin accumulated in float32 from logit(base_score), float32 sigmoid. For a
 * consumer whose output is checked against an export to the last printed digit
 * (lib/decision-score.ts); no Stuff+ feature contract, so any binary:logistic model.
 */
const F32_TREES = new WeakMap<StuffModel, Tree[]>();
export function predictProbabilityF32(model: StuffModel, features: readonly Feature[]): number {
  const f = Math.fround;
  // The JSON prints each float32 split as its shortest decimal, which parses to a
  // double a hair off the float32 XGBoost compares against: snap it back.
  let trees = F32_TREES.get(model);
  if (!trees) {
    trees = model.trees.map((t) => ({ ...t, threshold: Float64Array.from(t.threshold, f) }));
    F32_TREES.set(model, trees);
  }
  const x = features.map((v) => (v == null || Number.isNaN(v) ? null : f(v)));
  let m = f(model.baseMargin);
  for (const tree of trees) m = f(m + walk(tree, x));
  return f(1 / f(1 + f(Math.exp(-m))));
}

/**
 * `hvaa` (v5's formula, the v8 `hvaa_v5` slot) when it was not measured: DERIVED from velo, IVB and release height,
 * which it is a linear function of (R^2 0.987). Pinned to a constant instead, it cost the grader a median 37 grade
 * points over 76,661 real pitches. Pooled coefficients, fitted on 99,005 tracked pitches from data/export/pitches3d
 * (2026-09-01). A caller holding the tracked value (a thrown pitch) uses that instead.
 */
export function deriveHvaa(velo: number, ivb: number, relH: number): number {
  return -3.73401 + 0.09506 * velo + 0.08399 * ivb - 1.05239 * relH;
}
