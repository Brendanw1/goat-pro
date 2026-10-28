"use client";

/**
 * The Stuff+ tab: the calculator, the published grades it is scored against,
 * and the model provenance for both.
 *
 * Split out of the 3D Lab, where all three sat below the trajectory scenes.
 * They are a different job from the rest of that tab — the lab answers "what
 * did he throw", this answers "what would it grade if it moved differently" —
 * and burying a calculator under four scene panels meant scrolling past the
 * whole lab to reach it.
 *
 * Still loaded through next/dynamic, though no longer because of three.js: the
 * 3D import was removed on 2026-09-01. It stays split so the Stuff+ tab's
 * booster-parsing client code is not in the profile's initial bundle.
 */

/*
  ── No import from "@/components/3d" ─────────────────────────────────────────
  That barrel is one line -- `export * from "./scouting-scenes"` -- and
  scouting-scenes.tsx imports `three`, `@react-three/fiber` and
  `@react-three/drei` at module scope. Importing PitchGradesProvider,
  PitchStuffProvider and SceneLoading from it put a 728 KB three.js chunk in this
  tab's chunk group (named in the loadable manifest against stuff-lab.tsx) for a
  tab with no 3D in it. All three were dead here anyway: the providers' only
  consumers are scene hover tooltips (scouting-scenes.tsx:1372) and SceneLoading
  was never rendered.

  usePitchStuff went with them. It fetched per-pitch scores whose only display
  was a note telling the reader to hover pitches in the 3D Lab -- a tab withdrawn
  on 2026-08-31. StuffCalculator was rendered nowhere and was deleted on
  2026-10-16 rather than ported off v6; it is in git history.
*/
import { GradePct, gradedN } from "@/components/ui/grade-pct";
import { gradeColor } from "@/lib/grades";

import type { PitchProfileRow, ReleasePoint } from "@/types";

/**
 * Graded Stuff+ straight from the profile — the published grades that
 * already flow through getPlayerProfile, computed over this pitcher's real
 * pitches. The calculator scores hypotheticals against the same models.
 */
function GradedStuff({ pitches, confidence, season }: { pitches: PitchProfileRow[]; confidence?: string | null; season?: number | string | null }) {
  const graded = pitches.filter((pitch) => typeof pitch.stuffPlus === "number" && !isNaN(pitch.stuffPlus));
  if (graded.length === 0) return <p className="text-xs text-text-dim">No graded Whiff+ for this pitcher.</p>;

  return (
    <div className="space-y-2">
      {graded.map((pitch) => {
        const value = pitch.stuffPlus as number;
        const hasCI = typeof pitch.stuffPlusCI_lo === "number" && typeof pitch.stuffPlusCI_hi === "number";
        return (
          <div key={pitch.pitchType} className="flex items-center justify-between gap-3 border-b border-white/[0.04] pb-2 text-xs last:border-0">
            <span className="w-8 shrink-0 font-data text-text-secondary">{pitch.pitchType}</span>
            <span className="font-data text-sm font-semibold" style={{ color: gradeColor(value) }}>{Math.round(value)}<GradePct metric="stuffPlus" value={value} n={gradedN(pitch)} code={pitch.pitchType} season={season} /></span>
            {/*
              The shrunk grade beside the raw one, and only when they DIFFER.
              Printing "105 · 105" on every well-sampled pitch would be noise —
              across the population the median gap is 0.2 points, so on a normal
              arsenal this column is silent. It appears exactly where it earns
              its place: a cell thin enough that the raw grade is partly sample.
            */}
            {typeof pitch.stuffPlusShrunk === "number"
              && Math.round(pitch.stuffPlusShrunk) !== Math.round(value) && (
              <span
                className="font-data text-[11px] text-text-dim"
              >
                →{Math.round(pitch.stuffPlusShrunk)}
              </span>
            )}
            {/* No per-row ABStuff+: the model grades it per pitcher only
                (train_mlb.py abs_grade), so a per-type chip repeated one number. */}
            <span className="flex-1 text-right font-data text-[11px] text-text-dim">
              {hasCI && <>[{pitch.stuffPlusCI_lo}–{pitch.stuffPlusCI_hi}] </>}
              {typeof pitch.nStuffSwings === "number" ? `${pitch.nStuffSwings} sw` : "—"}
            </span>
          </div>
        );
      })}
      {confidence && (
        <p className="pt-1 text-[11px] text-text-dim">
          Confidence: <span className="text-text-secondary">{confidence}</span>. Grades are per pitch class x batter side; the chip is the same-type percentile.
        </p>
      )}
    </div>
  );
}

export default function StuffLab({
  pitches, confidence, release = null, season,
}: {
  pitches: PitchProfileRow[];
  confidence?: string | null;
  /** His arm slot, for seeding PitchGrader's release-height and -side inputs. */
  release?: ReleasePoint | null;
  season?: number | string | null;
}) {
  /**
   * No pitches3d fetch here any more, and that is the point.
   *
   * There used to be a `recordsState` gate for the 3D calculator, and a comment
   * explaining that `PitchGrader` must NOT sit behind it — gating the one tool
   * that survives a missing export on the export was how a missing export hid
   * it. With the calculator withdrawn the fetch has no consumer, so the tab no
   * longer touches pitches3d at all, which is the surface validate-export.R
   * still flags as partially rebuilt.
   */

  return (
    <div className="space-y-5 animate-fade-up">
      <div>
        <h2 className="text-[11px] uppercase tracking-[0.2em] text-usf-gold">Whiff+</h2>
        <p className="mt-1 max-w-2xl text-sm text-text-secondary">
          What he throws, graded. Descriptive, not a forecast.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="glass-panel space-y-3 p-4">
          <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-text-dim">
            Graded Whiff+
          </h3>
          <GradedStuff pitches={pitches} confidence={confidence} season={season} />
        </div>
        <div className="glass-panel flex flex-wrap items-start gap-2 p-4 text-xs text-text-dim">
          <span className="rounded-full border border-border-subtle px-2.5 py-1">
            Whiff+: 6 LightGBM models (pitch class x batter side), 13 features each
          </span>
          <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-amber-300">
            Descriptive — not a forecast
          </span>
        </div>
      </div>
    </div>
  );
}
