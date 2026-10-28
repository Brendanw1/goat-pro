/**
 * Topo Level 1 pitch class (FB / BB / CH) for a live or practice pitch: the class Stuff+ v8 and Pitching+ v4 pick
 * their booster by.
 *
 * The class is a lookup in the frozen grid research/pitch-topo/topo.py built (models/stuff_v8/topo_l1.json): the
 * voxel a pitch's (arm-side horizontal break, induced vertical break, speed gap) falls in. The speed gap is release
 * speed minus the pitcher's 95th-percentile release speed in the same outing, which is what the tagger was fitted
 * on, so callers pass the outing's own pitches to outingTopVelo(). A pitch outside the grid, or in a voxel no class
 * owns, has no class and gets no grade, as in the season and game artifacts.
 */
export type TopoClass = "FB" | "BB" | "CH";

export interface TopoGrid {
  lo: number[];
  step: number[];
  nb: number;
  labels: Uint8Array;
}

const CLASSES: (TopoClass | null)[] = [null, "FB", "BB", "CH"];

export function parseTopoGrid(raw: { lo: number[]; step: number[]; nb: number; labels_b64: string }): TopoGrid {
  const labels = Uint8Array.from(atob(raw.labels_b64), (c) => c.charCodeAt(0));
  if (labels.length !== raw.nb ** 3) throw new Error(`topo grid: ${labels.length} labels for nb ${raw.nb}`);
  return { lo: raw.lo, step: raw.step, nb: raw.nb, labels };
}

/** Class of one pitch. `hbArm` is horizontal break signed so + is the pitcher's arm side (LHP flipped). */
export function topoClass(grid: TopoGrid, hbArm: number, ivb: number, ds: number): TopoClass | null {
  const v = [hbArm, ivb, ds].map((x, i) => Math.floor((x - grid.lo[i]) / grid.step[i]));
  if (v.some((i) => !Number.isFinite(i) || i < 0 || i >= grid.nb)) return null;
  return CLASSES[grid.labels[(v[0] * grid.nb + v[1]) * grid.nb + v[2]]] ?? null;
}

/** The outing's 95th-percentile release speed, linearly interpolated (duckdb quantile_cont, numpy's default). */
export function outingTopVelo(velos: number[]): number | null {
  const xs = velos.filter(Number.isFinite).sort((a, b) => a - b);
  if (!xs.length) return null;
  const h = (xs.length - 1) * 0.95, i = Math.floor(h);
  return i + 1 < xs.length ? xs[i] + (h - i) * (xs[i + 1] - xs[i]) : xs[i];
}

/** Stuff+ booster for a pitch. A TrackMan-TAGGED Cutter always takes the BB booster (owner 2026-10-14, cutter-fix arm b0,
 *  research/cutter-fix/RESULTS.md): the tagger split cutters FB/BB, and look-alike cutters were priced apart by which
 *  booster scored them. A consistency fix, not an accuracy gain. Pitching+ and the class shown (`cls`) keep the tagger's. */
export function stuffClass(p: { pitchType: string | null; typeSource: string | null }, cls: TopoClass | null): TopoClass | null {
  return cls && p.typeSource === "tagged" && p.pitchType === "Cutter" ? "BB" : cls;
}
