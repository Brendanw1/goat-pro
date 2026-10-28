/**
 * Why a pitch grades what it grades on Whiff+: exact TreeSHAP of the cross-fit Whiff+ boosters (each pitch explained by
 * the fold model that never saw his pitches), baked by pipeline/whiff_shap.py. A point is what one input adds to or
 * takes from the grade against the league reference for that pitch class (overall) or pitch type (per-type cards);
 * a card's points sum to its grade minus 100. Port of the college site's lib/stuff-shap.ts groups.
 */
export interface WhiffShapRow { type: string; n: number; grade: number; points: Record<string, number> }
export interface WhiffShap { season: number; features: string[]; grade: number; overall: Record<string, number>; byType: WhiffShapRow[] }

/** Inputs shown as one row. Correlated inputs (approach angle with release height, break with its gap off the
 *  fastball) can split one effect into large opposite pieces; summed they read as one honest number. */
export const SHAP_GROUPS: { label: string; feats: string[] }[] = [
  { label: "Velocity", feats: ["velo"] },
  { label: "Speed gap off his fastball", feats: ["velo_diff"] },
  { label: "Vertical break (IVB)", feats: ["ivb", "ivb_diff"] },
  { label: "Ride at velocity", feats: ["velo_x_ivb"] },
  { label: "Horizontal break", feats: ["hb", "hb_diff"] },
  { label: "Approach angle & release height", feats: ["hvaa", "rel_h"] },
  { label: "Spin", feats: ["spin", "spin_eff"] },
  { label: "Extension & release side", feats: ["ext", "rel_s"] },
  { label: "Model baseline", feats: ["bias"] },
];

export const FEATURE_LABEL: Record<string, string> = {
  velo: "velo", velo_diff: "velo gap", ivb: "IVB", ivb_diff: "IVB gap", velo_x_ivb: "velo × IVB", hb: "HB",
  hb_diff: "HB gap", hvaa: "approach angle", rel_h: "release height", spin: "spin rate", spin_eff: "spin efficiency",
  ext: "extension", rel_s: "release side", bias: "fold baseline",
};

/** Grouped points, largest first; groups the model does not use are dropped. */
export function groupPoints(points: Record<string, number>) {
  return SHAP_GROUPS.flatMap((g) => {
    const parts = g.feats.filter((f) => f in points).map((f) => ({ feat: f, v: points[f] }));
    return parts.length ? [{ label: g.label, v: parts.reduce((a, p) => a + p.v, 0), parts }] : [];
  }).sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
}
