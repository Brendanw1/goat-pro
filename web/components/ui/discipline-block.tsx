"use client";

import {
  denominatorFor,
  isProvisionalRank,
  isShrunkValue,
  rankableValue,
  reliability,
  type DisciplineMetric,
} from "@/lib/discipline";
import { getDisciplinePercentileRank, isNeutralStat } from "@/lib/percentiles";
import { PercentileGroup, type PctRow } from "@/components/ui/percentile-row";

/**
 * Plate discipline rows for a player profile, drawn with the shared PercentileRow.
 *
 * Two things separate these from a plain stat row. Descriptive metrics (isNeutralStat) get a grey circle and no
 * verdict colour — see the direction note in lib/discipline.ts. And every row is gated on its own denominator, so
 * a Z-Whiff% built on eleven zone swings shows the number and "n=11" instead of claiming a percentile.
 */

function ratioLabel(den: number, metric: DisciplineMetric): string {
  const r = reliability(metric, den);
  return `${den} events · reliability ${r.toFixed(2)} (half signal at ${metric.halfSignal})`;
}

/** One discipline metric as a percentile row, or null when the row has no value. */
export function disciplineRow(
  metric: DisciplineMetric,
  row: Record<string, unknown>,
  role: "hitter" | "pitcher",
  breakpoints: Record<string, unknown> | null | undefined,
  label: string = metric.longLabel,
): PctRow | null {
  const raw = row[metric.key];
  if (typeof raw !== "number" || !isFinite(raw)) return null;
  const den = denominatorFor(row, metric);
  const ranked = rankableValue(row, metric.key);
  const shrunk = isShrunkValue(row, metric.key);
  const rank =
    ranked === null
      ? null
      : getDisciplinePercentileRank(role, metric, ranked, breakpoints?.[metric.key] as never, den, shrunk);
  // A rank that got through on the shrunk floor rather than the reliability one is mostly the population: shown,
  // but drawn as a hollow "~" ring, because "62nd, measured" and "62nd, mostly the average changeup" must differ.
  const provisional = rank !== null && isProvisionalRank(metric, den);
  return {
    key: metric.key,
    label,
    display: raw.toFixed(1),
    rank,
    n: den,
    provisional,
    neutral: isNeutralStat(role, metric.key),
    title: `${metric.longLabel}: ${metric.note}${den === null ? "" : ` (${ratioLabel(den, metric)})`}`,
  };
}

export function DisciplineBlock({
  title,
  metrics,
  row,
  role,
  breakpoints,
  footnote,
}: {
  /** A node, not just a string, so a per-pitch-type block can carry its colour swatch. */
  title: React.ReactNode;
  metrics: DisciplineMetric[];
  row: Record<string, unknown> | null | undefined;
  role: "hitter" | "pitcher";
  breakpoints?: Record<string, unknown> | null;
  footnote?: string;
}) {
  if (!row) return null;
  const rows = metrics.map((m) => disciplineRow(m, row, role, breakpoints));
  if (!rows.some(Boolean)) return null;
  return (
    <div>
      <PercentileGroup title={title} rows={rows} />
      {footnote && <AboutThis>{footnote}</AboutThis>}
    </div>
  );
}

/** Methodology behind a one-line disclosure, so the note is a click away instead of a paragraph in the way. */
export function AboutThis({ children, label = "About these numbers" }: { children: React.ReactNode; label?: string }) {
  return (
    <details className="group -mt-2 mb-2 text-[10px] leading-relaxed text-text-dim">
      <summary className="cursor-pointer select-none text-text-secondary underline decoration-dotted underline-offset-2 hover:text-text-primary">
        {label}
      </summary>
      <p className="mt-1">{children}</p>
    </details>
  );
}

/**
 * Footnotes for the two halves of the block. The distinction between them is the
 * whole point of splitting the block, so it is stated on the page rather than
 * left to the glossary.
 */
export const SKILL_FOOTNOTE =
  "Ranked and coloured: each of these carries a small measured direction against wOBA once contact quality is held fixed (β ≈ 0.07–0.11 SD, t = 2.9–4.8).";

export const APPROACH_FOOTNOTE =
  "Swing%, Z-Swing% and 1st-Pitch Swing% describe how aggressive he is, not how good, and stay grey: rank only. They are collinear with each other (r = 0.73–0.81, VIF 15–59) and flat against wOBA. Zone% seen is grey too: it describes how he was pitched. O-Contact% and 2-Strike Chase% keep their assigned scouting colours.";

export const PITCHER_APPROACH_FOOTNOTE =
  "Coloured on assigned directions — attacking the zone, getting ahead and stealing strikes read as better — by scouting convention rather than by measurement. The measured finding is unchanged: all of these test flat against wOBA allowed (Zone% r = −0.08, 1st-Pitch Strike% r = −0.06), because filling the zone trades walks for damage and called strikes are mostly catcher and umpire. Z-Swing% allowed keeps no direction and stays grey: it describes the hitters he faced, not what he did.";

/** What the two degraded states of a rank mean. */
export const GATE_NOTE =
  "A percentile marked ~ is mostly the league: the rate was shrunk toward its population before ranking, and on this sample most of what is left is that population rather than the player — its bar is hatched, and hovering gives the event count. A count in place of a percentile (n58) means even the shrunk rate has too little of him in it to place.";
