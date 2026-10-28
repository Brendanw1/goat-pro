import type { Handedness, PitchRecord, PitchType } from "@/types";

/**
 * Characteristic grades: how one pitch's shape compares to its own peers.
 *
 * Same 100-centred, 10-per-SD scale the Stuff+ grades use, so a reader does not
 * have to hold two scales in their head. Clamped to the published 70-130 range
 * for the same reason.
 *
 * Norms come from `pitches3d/shape_norms.json`, computed over the full export by
 * `scripts/compute-shape-norms.mjs`, and are split by pitcher handedness because
 * horizontal break flips sign between a righty and a lefty.
 */

export interface NormStat {
  mean: number;
  sd: number;
  n: number;
}

export interface ShapeNormGroup {
  velo: NormStat;
  spin: NormStat;
  ext: NormStat;
  relHeight: NormStat;
  absIvb: NormStat;
  absHb: NormStat;
  totalBreak: NormStat;
}

export interface ShapeNorms {
  minSample: number;
  groups: Record<string, ShapeNormGroup>;
}

export type Hand = "Left" | "Right";

/** Collapse TrackMan's two spellings to one. Returns null for anything else. */
export function toHand(value: Handedness | undefined): Hand | null {
  if (value === "Left" || value === "L") return "Left";
  if (value === "Right" || value === "R") return "Right";
  return null;
}

export function shapeNormKey(pitchType: PitchType, hand: Hand): string {
  return `${pitchType}_${hand}`;
}

/** 100 + 10z, clamped. Returns null when the norm is too thin to mean anything. */
export function gradeAgainst(value: number | null | undefined, stat: NormStat | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (!stat || !(stat.sd > 0)) return null;
  const z = (value - stat.mean) / stat.sd;
  return Math.max(70, Math.min(130, Math.round(100 + z * 10)));
}

export interface CharacteristicGrades {
  velo: number | null;
  /** Total break magnitude — the headline "does it move" number. */
  movement: number | null;
  ride: number | null;
  run: number | null;
  spin: number | null;
  extension: number | null;
}

/**
 * Movement grades use MAGNITUDE, not signed value.
 *
 * Signed grading is incoherent across pitch types: a curveball's IVB is
 * negative, so "above average" would mean less drop — the opposite of what a
 * higher number should convey. Magnitude answers the question being asked, which
 * is whether this pitch moves more than its peers.
 */
export function characteristicGrades(
  record: PitchRecord,
  norms: ShapeNorms | null,
  hand: Hand | null,
): CharacteristicGrades | null {
  if (!norms || !hand) return null;
  const group = norms.groups[shapeNormKey(record.pitchType, hand)];
  if (!group) return null;

  const ivb = record.breakZ;
  const hb = record.breakX;
  const total =
    typeof ivb === "number" && typeof hb === "number" ? Math.hypot(ivb, hb) : null;

  return {
    velo: gradeAgainst(record.releaseSpeed, group.velo),
    movement: gradeAgainst(total, group.totalBreak),
    ride: gradeAgainst(typeof ivb === "number" ? Math.abs(ivb) : null, group.absIvb),
    run: gradeAgainst(typeof hb === "number" ? Math.abs(hb) : null, group.absHb),
    spin: gradeAgainst(record.spinRate, group.spin),
    extension: gradeAgainst(record.extension, group.ext),
  };
}

/** Shared colour ramp for any 100-centred grade. */
export function gradeColor(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "#6E7A75";
  if (value >= 120) return "#4ead5b";
  if (value >= 110) return "#4ECDC4";
  if (value >= 90) return "#F0F2F4";
  if (value >= 80) return "#E87048";
  return "#E84142";
}
