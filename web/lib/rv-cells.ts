/**
 * Measured run value cells, shared by the leaderboard column, the arsenal
 * tables and the run-value card. Only the MEASURED half of the college pair
 * ships (RV/100): xRV/100 is NEEDS-MODEL and stripped — so these hints say
 * what happened, never what a model expects.
 *
 * Scale: pitcher-positive runs saved per 100 pitches. Statcast attributes each
 * pitch's run-expectancy change to the pitcher on the mound
 * (delta_pitcher_run_exp), baked as 100 * sum / n over the gated pitches.
 */

export const RV100_TIP =
  "RV/100: runs actually saved per 100 pitches. Measured, not modelled — a record of what happened, not a forecast.";

/** Signed 2-dp: +0.42 / -1.30 / 0.00; "—" for a missing value. */
export const signed = (v: number | null | undefined, dp = 2): string =>
  v === null || v === undefined || !Number.isFinite(v as number)
    ? "—"
    : `${(v as number) > 0 ? "+" : ""}${(v as number).toFixed(dp)}`;
