/**
 * Pitch Quality (PQ): per pitch type on the 20-80 scale (pipeline/pitch_quality.py, PREREG-pitch-quality.md).
 * 50 = the average pitch of that type in that season and level; 10 points = one SD. The colour reuses the site's
 * 100-centred grade ladder shifted by 50 (60 -> 110 teal, 70 -> 120 green, 40 -> 90, 30 -> 80).
 */
import { gradeColor } from "@/lib/grades";

export const PQ_TIP =
  "Pitch Quality (PQ, 20-80): the runs this pitch type is expected to save from its shape, release, location and count, graded against the average pitch of that type in the same season and level (50 = average, 60 = plus, 70 = plus-plus). Cross-fit by pitcher: no pitch is graded by a model that saw its pitcher. Shown beside Whiff+ and Prevention+, never blended with them.";
export const PQ_SPLIT_TIP =
  "PQ vs left- / right-handed hitters, each on its own scale. Descriptive: a pitcher's own platoon gap is mostly noise unless it is large on many pitches.";
export const PQ_NULL_TIP =
  "No PQ: four-seamers, sinkers and cutters are not graded (not reliable enough), and other types need their reliable pitch count";
/** Low confidence: under the type's first tier count but past its reliability .50 count. Profiles only. */
export const PQ_LOW_HEX = "rgba(240,242,244,0.42)";

export const pqColor = (v: unknown, tier?: string | null): string | undefined =>
  typeof v !== "number" ? undefined : tier === "low" ? PQ_LOW_HEX : gradeColor(v + 50);

/** The small muted line under a grade: provisional, limited data, or not confident. */
export const pqMarker = (tier: string | null | undefined): string | null =>
  tier === "provisional" ? "prov" : tier === "limited" ? "limited" : tier === "low" ? "not confident" : null;

type PqCell = {
  pitchQuality?: number | null; pitchQualityTier?: string | null; pitchQualityClaim?: string | null;
  pitchQualityNeed?: number | null; pitchQualityMlb?: number | null; n_pitches?: number | null; nPitches?: number | null;
};

/** Hover text for one PQ cell; `aaa` adds the scale line (AAA grades sit on the AAA population). */
export function pqTitle(p: PqCell, aaa = false): string {
  if (typeof p.pitchQuality !== "number") return PQ_NULL_TIP;
  const n = p.n_pitches ?? p.nPitches;
  if (p.pitchQualityTier === "low") {
    return `Not confident: ${n ?? "?"} pitches${typeof p.pitchQualityNeed === "number" ? `, graded from ${p.pitchQualityNeed}` : ""}; about half of this grade is noise at this sample.`;
  }
  const scale = aaa
    ? typeof p.pitchQualityMlb === "number"
      ? `AAA scale; ${p.pitchQualityMlb} on the MLB scale`
      : "AAA scale (no MLB-scale grade: this type failed the scale check)"
    : null;
  const claim = p.pitchQualityClaim === "limited data"
    ? "limited: reliable within a season, but it did not track next season's run value"
    : p.pitchQualityClaim;
  return [claim, p.pitchQualityTier === "provisional" && "provisional sample", scale,
    typeof n === "number" && `${n} pitches`].filter(Boolean).join(" · ");
}
