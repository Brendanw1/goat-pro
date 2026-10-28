/**
 * Grade metadata for the frozen GOAT-Pro MLB models, read from the model card
 * baked into data/export/mlb_pitcher_grades.json (fingerprints echoed in
 * meta.json). The card's gate_status is `descriptive-only` (RESULTS-MLB §11/§13:
 * the location check passed under the college methodology, but no target beats
 * naive persistence on the clean pairs), so every grade on the site renders
 * under the descriptive label — AGENTS.md rule 3.
 *
 * Scale (pipeline/train_mlb.py `grade()`): 100 + 10·z per class×side cell,
 * pitch-weighted across cells, clipped to [50, 175]. 100 = MLB average, higher
 * is better. ABStuff+ is the same prediction on one scale across all pitch
 * types (the `_absolute` reference).
 */

export const MODEL_NAME = "GOAT-Pro P7 pitcher models (Whiff+ / K+ / Prevention+ / Control+ / Pitching+)";
export const GATE_STATUS = "descriptive-only" as const;

/** The label every grade surface carries, verbatim. */
export const DESCRIPTIVE_LABEL = "Descriptive — not a forecast";
export const DESCRIPTIVE_LINE =
  "Whiff+, Control+ and Pitching+ describe this season. K+ and Prevention+ are next-season projections; see the glossary.";

export const STUFF_TIP =
  "Whiff+: how well the pitch shape misses bats. 100 = average. See the glossary.";
export const PITCHING_TIP =
  "Pitching+: all-in value of every pitch (shape, location, count). 100 = average. See the glossary.";
export const K_TIP = "K+: projected strikeout rate next season. 100 = average. See the glossary.";
export const PREVENTION_TIP = "Prevention+: projected run prevention next season. 100 = average. See the glossary.";
export const CONTROL_TIP = "Control+: location value with the pitch shape held fixed. 100 = average. See the glossary.";

/** Grade colour bands, the site convention (100-centred). */
export function gradeColor(value: number | null | undefined): string | undefined {
  if (value === null || value === undefined || typeof value !== "number" || isNaN(value)) return undefined;
  if (value >= 120) return "#4ead5b";
  if (value >= 110) return "#4ECDC4";
  if (value >= 90) return undefined;
  if (value >= 80) return "#E87048";
  return "#E84142";
}

/** Confidence tier badge colours (pitch-count floors: HIGH ≥400, MODERATE ≥150, LOW ≥50). */
export function confidenceBadge(tier?: string | null): { bg: string; text: string; label: string } | null {
  if (!tier) return null;
  const colors: Record<string, { bg: string; text: string; label: string }> = {
    HIGH: { bg: "bg-emerald-500/20", text: "text-emerald-400", label: "HIGH" },
    MODERATE: { bg: "bg-teal-500/20", text: "text-teal-400", label: "MED" },
    LOW: { bg: "bg-amber-500/20", text: "text-amber-400", label: "LOW" },
    MINIMAL: { bg: "bg-gray-500/20", text: "text-gray-400", label: "MIN" },
  };
  return colors[tier] ?? colors.MINIMAL;
}

/** The descriptive chip, rendered by every grade surface. */
export function DescriptiveChip({ className = "" }: { className?: string }) {
  return (
    <span
      tabIndex={0}
      role="note"
      aria-label={DESCRIPTIVE_LABEL}
      title={DESCRIPTIVE_LINE}
      className={`inline-flex cursor-help items-center gap-1 rounded-full border border-usf-gold/40 bg-usf-gold/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-usf-gold focus-visible:outline focus-visible:outline-1 focus-visible:outline-usf-gold ${className}`}
    >
      <span aria-hidden>ⓘ</span> {DESCRIPTIVE_LABEL}
    </span>
  );
}
