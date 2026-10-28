"use client";

import { PITCH_CONFIG } from "@/lib/constants";
import type { PitchProfileRow } from "@/types";

/**
 * Says when two rows in the arsenal carry the same Stuff+ number.
 *
 * Stuff+ v5 trains eight families against nine pitch types, so three types are
 * graded by a model that is not theirs — SW by the slider, FS and KN by the
 * changeup. Every Stuff+ field is then copied to both rows: the grade, both CI
 * bounds, both platoon splits, and the swing count. Nothing said so.
 *
 * What that looked like on a page. Luke Craytor's slider row was byte-identical
 * to his sweeper row — 117, [113, 121], 110 vs LHH, 120 vs RHH, 66 swings, all
 * four the same. Griffin Stieg's splitter row is his changeup row: grade 94 over
 * 59 swings, for a pitch he threw **seven times**. Measured 2026-08-30 across
 * data/export/players: 1,228 of 4,730 profiles (26.0%) carry at least one such
 * pair, 1,371 rows in all, and 506 of those show a swing count above 20 for a
 * pitch under 5% usage.
 *
 * ── Why this is not `ShapeTwinNote` ─────────────────────────────────────────
 * That note fires when two tags ARRIVE alike — inside 2 mph and 3 inches. This
 * one fires when two rows are GRADED alike, which is a different fact and does
 * not imply the other. Craytor trips both: his sweeper and slider are 0.03 sd
 * apart in each break axis. Stieg trips only this one: his splitter and changeup
 * are 5.6 inches apart in horizontal break, well outside the twin tolerance, and
 * still share a grade. A reader told only about shape would never learn that the
 * second pair's numbers are not independent.
 *
 * ── Why it is not `proxyGradedAs` either ────────────────────────────────────
 * That field means "this pitch has no model of its own and is borrowing one",
 * which is true of the knuckleball and false of the sweeper: the slider model is
 * the correct grader for a sweeper, not a fallback. This note is about the
 * numbers not being independent, which holds either way.
 */

function Pill({ type }: { type: string }) {
  const config = PITCH_CONFIG[type as keyof typeof PITCH_CONFIG];
  return (
    <span className="inline-flex items-center gap-1 font-data text-text-primary">
      <span
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: config?.color ?? "#8C9591" }}
      />
      {type}
    </span>
  );
}

/** A folded child and the row it shares its grade with, when that row is shown. */
interface SharedPair {
  child: PitchProfileRow;
  host: PitchProfileRow | null;
  hostType: string;
}

/**
 * The T2 gyro-slider display label (§48): a Statcast-slider season whose gyro
 * share is 75%+ reads as bullet-spin — little sweep, late drop. A label only,
 * per the owner's approval; the grade, scale and percentile pool are the
 * pooled slider's either way. Explanation lives in the glossary.
 */
export function GyroTag({ on = true }: { on?: boolean }) {
  if (!on) return null;
  return (
    <span
      className="inline-flex items-center rounded border border-border-subtle px-1 py-px text-[8px] font-semibold uppercase tracking-wider text-text-secondary"
      title="Gyro slider — bullet-spin slider (gyro share ≥ 75%): little sweep, late drop. A label only; graded on the same slider scale."
    >
      gyro
    </span>
  );
}

export function sharedGradePairs(pitches: PitchProfileRow[]): SharedPair[] {
  const byType = new Map<string, PitchProfileRow>();
  for (const row of pitches) if (row.pitchType) byType.set(row.pitchType, row);

  const out: SharedPair[] = [];
  for (const child of pitches) {
    const hostType = child.stuffGradeFrom;
    // Nothing to say when the row has its own model, or when no grade was
    // joined at all — an ungraded row shares nothing.
    if (!hostType || typeof child.stuffPlus !== "number") continue;
    out.push({ child, host: byType.get(hostType) ?? null, hostType });
  }
  return out.sort((a, b) => (b.child.usage ?? 0) - (a.child.usage ?? 0));
}

export function SharedGradeNote({ pitches }: { pitches: PitchProfileRow[] }) {
  const pairs = sharedGradePairs(pitches);
  if (pairs.length === 0) return null;

  return (
    <div className="border-t border-border-subtle bg-[#4ECDC4]/[0.04] px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[#4ECDC4]">
        One grade, two rows
      </div>
      <div className="mt-2 space-y-2">
        {pairs.map(({ child, host, hostType }) => {
          const model = PITCH_CONFIG[hostType as keyof typeof PITCH_CONFIG]?.label ?? hostType;
          return (
            <p
              key={child.pitchType}
              className="text-[11px] leading-relaxed text-text-secondary"
            >
              <Pill type={child.pitchType} />
              {host ? (
                <>
                  {" "}and <Pill type={hostType} /> are graded by one model
                  {" "}(<span className="text-text-primary">{model.toLowerCase()}</span>),
                  so their Whiff+ numbers are the same numbers rather than two that
                  agree.
                </>
              ) : (
                <>
                  {" "}is graded by the{" "}
                  <span className="text-text-primary">{model.toLowerCase()}</span> model —
                  there is no separate {hostType} row here, but the grade is still
                  that model&rsquo;s.
                </>
              )}
              {/* Only claimable when the host row is actually shown. With no
                  host row the family reduces to this pitch alone, so the swing
                  count IS its own — Craytor's splitter reads 2, which is his
                  three splitters and nothing else. Saying "the pair's" there
                  would be the same kind of wrong this note exists to fix. */}
              {host && typeof child.nStuffSwings === "number" && (
                <>
                  {" "}The{" "}
                  <span className="font-data text-text-secondary">
                    {child.nStuffSwings.toLocaleString()}
                  </span>{" "}
                  swings behind it are the pair&rsquo;s, not this pitch&rsquo;s.
                </>
              )}
            </p>
          );
        })}
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-text-dim">
        Usage, velocity, break and whiff above are each pitch&rsquo;s own — only the
        The Whiff+ column is shared. A sweeper is graded as a slider and a splitter
        shares the changeup grade, so each pair carries one number. That is
        deliberate: too few pitchers throw a true sweeper to scale it on its own.
      </p>
    </div>
  );
}
