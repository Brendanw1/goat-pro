import { measured } from "./measured";
import { MLB_HALF_PITCHER } from "./measured-mlb-constants";
/**
 * Plate discipline metric definitions — one source of truth for the leaderboards,
 * the profiles and the glossary.
 *
 * Each entry carries three things a rate stat needs before it can be shown as a
 * percentile, all measured on the 2026 D1 season (1,429,810 pitches) rather than
 * assumed:
 *
 *   direction — is a higher number better? For several of these the answer is
 *               genuinely "neither", and colouring them green/red would invent a
 *               verdict the data does not support.
 *   denom     — which count the rate rests on. Chase% over 40 out-of-zone
 *               pitches and Chase% over 400 are not the same measurement.
 *   halfSignal — the denominator at which the metric is half signal, half
 *               binomial noise. Also the empirical-Bayes shrinkage constant.
 *
 * Reproduce with scripts/measure_discipline_signal.py and
 * scripts/measure_discipline_polarity.py. Findings: docs/plate-discipline-study.md
 *
 * ── On direction ──
 * Every hitter discipline rate is flat against wOBA on its own (Chase% r = −0.08,
 * Whiff% r = −0.03). They are not flat against K% and BB% — Whiff% → K% is
 * +0.54, Chase% → BB% is −0.40 — so they describe *how* a hitter reaches his
 * line, not how good the line is.
 *
 * Holding contact quality fixed, six of them do carry a small real direction
 * (β ≈ 0.07–0.11 SD of wOBA, t = 2.9–4.8). Those are the HITTER_SKILL rates, and
 * their directions are measured.
 *
 * The Approach rates are different, and the difference is worth stating plainly
 * because the table no longer looks it. The measured finding stands:
 *
 *   Aggression proxies. Swing%, Z-Swing% and F-Pitch-Swing% correlate 0.73–0.81
 *   with each other; fitted jointly every VIF lands between 15 and 59 and every
 *   coefficient goes insignificant. Their apparent direction runs through the
 *   walk channel, which is an approach trade-off rather than a skill.
 *
 *   Genuinely flat. O-Contact% tested neutral even with contact quality held
 *   (t = 1.68) — putting a bat on a pitch outside the zone is empty contact.
 *   2-Strike Chase% is flat too (wOBA partial +0.003, t = 0.14).
 *   Zone% seen is not a hitter attribute at all: odd/even game split 0.13.
 *
 * The Approach rates are nevertheless graded, on directions **assigned by
 * scouting convention rather than derived from the season** (2026-08-17, at the
 * project owner's instruction; see docs/plate-discipline-study.md §Approach
 * colours). Every such entry says so in its own note. Zone% seen is the one row
 * that keeps no direction, because it is not a hitter attribute at all.
 */

export type Direction = "higher" | "lower" | "neutral";

export interface DisciplineMetric {
  /** Field name on the leaderboard row. */
  key: string;
  /** Column header — kept to ~7 characters. */
  label: string;
  /** Profile row label. */
  longLabel: string;
  /** Field holding the count this rate divides by. */
  denom: string;
  direction: Direction;
  /** Denominator at which reliability reaches 0.5 (and the shrinkage constant). */
  halfSignal: number;
  /** What the metric measures, and what it was measured to predict. */
  note: string;
  /**
   * Which question the denominator has to answer before a rank is honest.
   *
   * "skill"       — will this repeat? Gated on den/(den+halfSignal) >=
   *                 MIN_RELIABILITY. The default, right for anything read as an
   *                 ability.
   * "measurement" — is this number precise? Gated on the denominator alone. Right
   *                 for a descriptive quantity, where year-to-year repeatability
   *                 is the wrong test.
   */
  gate?: "skill" | "measurement";
  /** Minimum denominator when gate is "measurement". */
  minDenom?: number;
  /**
   * Descriptive on the PLAYER PROFILE: ranked, but drawn grey with no verdict colour, because it
   * says how a player goes about it rather than how well (design review 2026-10-23, H5). Leaderboards
   * still colour on `direction`; only `isNeutralStat`, which the profile reads, honours this.
   */
  descriptive?: true;
}

/**
 * Capability — did the hitter swing at a ball, and did he hit what he swung at.
 * All six carry a supported direction.
 */
/** Half-signal denominators, one per metric: measured by scripts/measure_discipline_signal.py, read by R too. */
const HALF_H = measured<Record<string, number>>("DISCIPLINE_HALF_HITTER");
// Pitcher constants: the MLB re-measure (pipeline/measure_discipline_mlb.py,
// split-half 2023-25 Spearman-Brown, 2026 held out). Hitter constants stay
// college until their own re-measure runs.
const HALF_P = MLB_HALF_PITCHER;

export const HITTER_SKILL: DisciplineMetric[] = [
  {
    key: "chasePct", label: "Chase%", longLabel: "Chase%",
    denom: "nOozPitches", direction: "lower", halfSignal: HALF_H.chasePct,
    note: "Swings at pitches outside the zone, over pitches outside the zone (FanGraphs O-Swing%). Predicts walks (r = −0.40) far more than production (β = −0.07 SD of wOBA holding contact quality).",
  },
  {
    key: "whiffPct", label: "Whiff%", longLabel: "Whiff%",
    denom: "nSwings", direction: "lower", halfSignal: HALF_H.whiffPct,
    note: "Swings and misses over swings. The most reliable hitter discipline rate on the board (odd/even game split 0.73) and the strongest driver of strikeouts (r = +0.54).",
  },
  {
    key: "contactPct", label: "Con%", longLabel: "Contact%",
    denom: "nSwings", direction: "higher", halfSignal: HALF_H.contactPct,
    note: "Contact over swings — the complement of Whiff%. Shown alongside it because scouts read the two in opposite directions.",
  },
  {
    key: "zContactPct", label: "Z-Con%", longLabel: "Z-Contact%",
    denom: "nZoneSwings", direction: "higher", halfSignal: HALF_H.zContactPct,
    note: "Contact on in-zone swings over in-zone swings. The strongest single discipline term against wOBA once contact quality is held fixed (β = +0.10, t = 4.2). Missing strikes is the costly kind of miss.",
  },
  {
    key: "zWhiffPct", label: "Z-Whf%", longLabel: "Z-Whiff%",
    denom: "nZoneSwings", direction: "lower", halfSignal: HALF_H.zWhiffPct,
    note: "Whiffs on in-zone swings over in-zone swings. The complement of Z-Contact%; the cleanest read on bat-to-ball against pitches a hitter should handle.",
  },
  {
    key: "swStrPct", label: "SwStr%", longLabel: "SwStr%",
    denom: "nPitches", direction: "lower", halfSignal: HALF_H.swStrPct,
    note: "Swinging strikes over all pitches — swing rate and miss rate rolled together. Useful as a summary, ambiguous as a diagnosis, which is why Whiff% sits next to it.",
  },
];

/**
 * Approach — how the hitter operates. Ranked, and coloured on directions
 * *assigned* rather than measured; every note below says so. The season's finding
 * (collinear proxies, flat partials against wOBA) is unchanged — what changed is
 * what we do about it. Zone% seen keeps no direction: it is not a hitter
 * attribute, so there is nothing to be good at.
 */
export const HITTER_APPROACH: DisciplineMetric[] = [
  {
    key: "swingPct", label: "Swing%", longLabel: "Swing%",
    denom: "nPitches", direction: "higher", descriptive: true, halfSignal: HALF_H.swingPct,
    note: "Swings over all pitches. Direction assigned (more aggression = better) by scouting convention, not measured: it correlates 0.81 with Chase% and 0.81 with Z-Swing%, the three cannot be separated in a joint fit (VIF 15–59), and every coefficient goes insignificant.",
  },
  {
    key: "zSwingPct", label: "Z-Swg%", longLabel: "Z-Swing%",
    denom: "nZonePitches", direction: "higher", descriptive: true, halfSignal: HALF_H.zSwingPct,
    note: "Swings at in-zone pitches over in-zone pitches. Direction assigned, not measured: its apparent direction runs entirely through walks (r = −0.31 with BB%) — taking strikes buys walks and costs damage, and at D1 the trade is close to even.",
  },
  {
    key: "oContactPct", label: "O-Con%", longLabel: "O-Contact%",
    denom: "nOozSwings", direction: "higher", halfSignal: HALF_H.oContactPct,
    note: "Contact on out-of-zone swings. Direction assigned, not measured: it tested flat against wOBA even with contact quality held (t = 1.68) — fouling off a ball keeps the at-bat alive without producing anything. The most reliable rate here per event (half signal at 30 swings) and the scarcest: the median hitter offers at only 58 pitches outside the zone all season.",
  },
  {
    key: "firstPitchSwingPct", label: "F-Swg%", longLabel: "1st-Pitch Swing%",
    denom: "nFirstPitch", direction: "higher", descriptive: true, halfSignal: HALF_H.firstPitchSwingPct,
    note: "Swings on 0-0 over plate appearances. Direction assigned by scouting convention, not measured — it is collinear with the other two swing rates (r = 0.73–0.81). The second most repeatable thing a hitter does (odd/even game split 0.75), and a near-pure read on approach.",
  },
  {
    key: "twoStrikeChasePct", label: "2K-Ch%", longLabel: "2-Strike Chase%",
    denom: "nTwoStrikeOoz", direction: "lower", halfSignal: HALF_H.twoStrikeChasePct,
    note: "Chase rate with two strikes. Direction assigned (lower = better), not measured — it agrees with Chase% because chasing is chasing. The protection argument was tested and is real on its own terms: holding overall Chase% fixed (the two correlate +0.713), more two-strike chasing cuts strikeouts (partial r = −0.287, t = −12.4) and costs walks (−0.162, t = −6.8), and nets nothing in production (wOBA +0.003, t = +0.14). Since wOBA cannot separate the two directions, agreeing with Chase% is worth more than a K%-channel argument the production number does not cash.",
  },
  {
    key: "zonePctSeen", label: "Zone%", longLabel: "Zone% seen",
    denom: "nPitchesLoc", direction: "neutral", halfSignal: HALF_H.zonePctSeen,
    gate: "measurement", minDenom: 100,
    note: "Share of pitches in the zone. Context, not a skill, and the only Approach row with no direction — a hitter cannot be good at it. Gated on the count of located pitches rather than on reliability: 1,848 pitches to half signal answers 'would this repeat next season' (odd/even game split 0.13, so no), but 100 located pitches measure what he actually saw to a binomial SE under 5pp, and one precise description ranks fairly against another. D1 pitchers barely change their zone rate by hitter, so 'he gets pitched around' is mostly noise at this level.",
  },
];

/** Pitcher rates with a measured direction against wOBA allowed. */
export const PITCHER_SKILL: DisciplineMetric[] = [
  {
    key: "whiffPct", label: "Whiff%", longLabel: "Whiff%",
    denom: "nSwings", direction: "higher", halfSignal: HALF_P.whiffPct,
    note: "Whiffs over swings. The most reliable pitcher outcome rate (half signal at 66 swings) and the strongest of these against wOBA allowed (r = −0.18).",
  },
  {
    key: "chasePct", label: "Chase%", longLabel: "Chase% induced",
    denom: "nOozPitches", direction: "higher", halfSignal: HALF_P.chasePct,
    note: "Swings drawn at pitches outside the zone. Works through walks as much as whiffs (r = −0.25 with BB% allowed) — a pitcher who gets hitters to expand does not need the zone.",
  },
  {
    key: "zWhiffPct", label: "Z-Whf%", longLabel: "Z-Whiff%",
    denom: "nZoneSwings", direction: "higher", halfSignal: HALF_P.zWhiffPct,
    note: "Whiffs on in-zone swings. Missing bats inside the zone is the part of whiff that does not depend on chase. Needs 93 zone swings to be half signal — the median slider draws 24, so per-pitch-type values are shrunk before they are ranked.",
  },
  {
    key: "oWhiffPct", label: "O-Whf%", longLabel: "O-Whiff%",
    denom: "nOozSwings", direction: "higher", halfSignal: HALF_P.oWhiffPct,
    note: "Whiffs on out-of-zone swings. Half signal at only 40 swings, the best events-to-signal ratio of any pitcher rate here.",
  },
  {
    key: "zContactPct", label: "Z-Con%", longLabel: "Z-Contact% allowed",
    denom: "nZoneSwings", direction: "lower", halfSignal: HALF_P.zContactPct,
    note: "Contact allowed on in-zone swings — the complement of Z-Whiff%.",
  },
  {
    key: "oContactPct", label: "O-Con%", longLabel: "O-Contact% allowed",
    denom: "nOozSwings", direction: "lower", halfSignal: HALF_P.oContactPct,
    note: "Contact allowed on out-of-zone swings. Drawing the chase is only half the job; letting the hitter reach it gives the pitch back.",
  },
  {
    key: "putawayPct", label: "PutAwy%", longLabel: "PutAway%",
    denom: "nTwoStrike", direction: "higher", halfSignal: HALF_P.putawayPct,
    note: "Strikeouts over two-strike pitches — how often a pitcher finishes once he is ahead.",
  },
  {
    key: "swStrPct", label: "SwStr%", longLabel: "SwStr%",
    denom: "nPitches", direction: "higher", halfSignal: HALF_P.swStrPct,
    note: "Swinging strikes over all pitches.",
  },
  {
    key: "cswPct", label: "CSW%", longLabel: "CSW%",
    denom: "nPitches", direction: "higher", halfSignal: HALF_P.cswPct,
    note: "Called strikes plus whiffs over all pitches. Holds up against wOBA allowed (r = −0.20), but almost entirely through the whiff half — the called-strike half needs 717 pitches to be half signal and tests neutral on its own.",
  },
];

/**
 * Pitcher rates that describe an approach.
 *
 * Coloured on directions **assigned** rather than measured, the same way
 * `HITTER_APPROACH` is and for the same reason: every one of these tests flat or
 * near-flat against wOBA allowed, and the ranking is still worth showing, so the
 * direction comes from scouting convention and each note says so. Leaving them
 * neutral is what the block did until 2026-08-18, which produced five ranked
 * rows in identical grey — a percentile with no verdict beside it, on a page
 * where every other percentile is coloured.
 *
 * `zSwingPct` keeps no direction. It is this block's `zonePctSeen`: how often
 * hitters offer at his strikes is mostly a fact about the hitters he faced, so
 * there is nothing for him to be good at.
 */
export const PITCHER_APPROACH: DisciplineMetric[] = [
  {
    key: "zonePct", label: "Zone%", longLabel: "Zone%",
    denom: "nPitchesLoc", direction: "higher", halfSignal: HALF_P.zonePct,
    note: "Share of pitches in the zone. Direction assigned (attacking the zone = better) by scouting convention, not measured: it tests neutral against wOBA allowed (r = −0.08), because filling the zone trades walks for damage and at D1 the trade is close to even. Unlike the hitter's Zone% seen this IS his own choice, which is why it carries a direction there and not here.",
  },
  {
    key: "zSwingPct", label: "Z-Swg%", longLabel: "Z-Swing% allowed",
    denom: "nZonePitches", direction: "neutral", halfSignal: HALF_P.zSwingPct,
    note: "How often hitters offer at his in-zone pitches. The only Approach row with no direction, and the pitcher's twin of Zone% seen: it is mostly a property of the hitters he faced rather than of him. Also the weakest-signal swing rate on either side (half signal at 179 zone pitches).",
  },
  {
    key: "swingPct", label: "Swing%", longLabel: "Swing% induced",
    denom: "nPitches", direction: "higher", halfSignal: HALF_P.swingPct,
    note: "Swings over all pitches. Direction assigned (dictating the at-bat = better) by scouting convention, not measured — inducing swings is neither good nor bad on its own, and what matters is whether they miss, which is Whiff% one block up.",
  },
  {
    key: "calledStrikePct", label: "CS%", longLabel: "Called Strike%",
    denom: "nPitches", direction: "higher", halfSignal: HALF_P.calledStrikePct,
    note: "Called strikes over all pitches. Direction assigned (stealing strikes = better), not measured, and read with the noise in mind: 717 pitches for half signal against a median 384 thrown, and an odd/even game split of 0.35. Mostly catcher, umpire and count — the reliability gate holds most pitchers out of a rank here on purpose.",
  },
  {
    key: "firstPitchStrikePct", label: "F-Str%", longLabel: "1st-Pitch Strike%",
    denom: "nFirstPitch", direction: "higher", halfSignal: HALF_P.firstPitchStrikePct,
    note: "Strikes on 0-0. Direction assigned (get ahead) by the oldest convention in pitching, not measured: it does not separate pitchers by results here (r = −0.06 with wOBA allowed) once you account for how noisy it is.",
  },
];

export const HITTER_DISCIPLINE = [...HITTER_SKILL, ...HITTER_APPROACH];
export const PITCHER_DISCIPLINE = [...PITCHER_SKILL, ...PITCHER_APPROACH];

const BY_KEY = {
  hitter: new Map(HITTER_DISCIPLINE.map((m) => [m.key, m])),
  pitcher: new Map(PITCHER_DISCIPLINE.map((m) => [m.key, m])),
};

export function disciplineMetric(role: "hitter" | "pitcher", key: string): DisciplineMetric | undefined {
  return BY_KEY[role].get(key);
}

/**
 * Reliability of one observation: den / (den + halfSignal).
 *
 * Reported rather than hidden, because "48% on 12 swings" and "48% on 300" are
 * the same number and not the same fact.
 */
export function reliability(metric: DisciplineMetric, den: number | null | undefined): number {
  if (typeof den !== "number" || !isFinite(den) || den <= 0) return 0;
  return den / (den + metric.halfSignal);
}

/** Below this an UNSHRUNK rate is more noise than signal and gets no percentile. */
export const MIN_RELIABILITY = 0.4;

/**
 * The floor for a rate that has already been shrunk: a tenth of it must be his.
 *
 * A shrunk rate does not need the reliability floor, because shrinkage IS the
 * reliability correction — `shrink_rate` in `R/compute_discipline.R` blends the
 * player with the population at weight `den/(den + halfSignal)`, which is
 * `reliability()` to the digit, using the same constant. Holding a shrunk value
 * to `MIN_RELIABILITY` applies that correction twice: once by moving the number
 * to where it can be trusted, and again by refusing to show where it landed.
 *
 * That double-count is what put "n36" in five of the nine rows on a changeup
 * with 128 pitches behind it. The number those rows would have shown is not a
 * guess — it is "indistinguishable from the average changeup", which is both
 * true and useful, and it is what the shrinkage was for.
 *
 * A floor still belongs, because at `den` = 1 the shrunk value is the population
 * mean and its rank is the same 50th percentile for everyone. 0.1 is that floor,
 * expressed as weight rather than as events so it scales with the metric: a
 * Z-Whiff% needs 11 zone swings (half signal 93), a Called Strike% needs 80
 * pitches (717). Below it the rank would be a fact about the league wearing a
 * player's name.
 */
export const MIN_SHRUNK_WEIGHT = 0.1;

/**
 * The floor for RANKING a shrunk Decision+ value, measured rather than assumed.
 *
 * `MIN_RELIABILITY` above is a convention, and a defensible one for the metrics
 * it was chosen for. It was never measured on decision run value, and the
 * Decision+ family inherited it anyway — including for the per-type cells, which
 * are shrunk, and which the argument at `MIN_SHRUNK_WEIGHT` says should therefore
 * not be held to an unshrunk floor at all.
 *
 * `docs/decision-coverage-floor.md` measured it three ways, which agree:
 *
 *  - §3, marginal cohorts. The batters between 0.20 and 0.25 reliability still
 *    predict an independent even-half outcome (r +0.133, 95% CI [+0.013,
 *    +0.252]). The ones just below, 0.15 to 0.20, do not (+0.005, [−0.131,
 *    +0.153]). Same for non-overlapping pitch bands: 60–100 clears zero, 20–60
 *    does not.
 *  - §2, subsample curve. Holding each batter's outcome fixed and varying only
 *    how many pitches the metric gets, 63 pitches — reliability 0.25 — still
 *    carries 62% of the signal available at 260.
 *  - §6, pair accuracy. A cell at 0.25 orders two hitters the way an independent
 *    sample does 66.7% of the time, against 50% for a coin flip.
 *
 * Between `MIN_SHRUNK_WEIGHT` and this, a value is shown but not ranked — see
 * `isProvisionalRank`, which is what that distinction is for.
 *
 * Kept equal to `DECISION_MIN_RANK_RELIABILITY` in `R/compute_models.R`;
 * `scripts/test-decision-plus.R` asserts the two match, because
 * `plate-discipline-study.md` §5 flags exactly this kind of drift as a risk.
 */
export const DECISION_MIN_RANK_RELIABILITY = 0.25;

/**
 * Does this denominator clear the metric's gate?
 *
 * The only place the gates are chosen between, so no caller can accidentally
 * hold a descriptive row to the repeatability standard — which is exactly what
 * kept Zone% seen showing "n846" instead of a rank on a hitter who had been
 * measured to a binomial SE of 1.7pp.
 *
 * `shrunk` says whether the value about to be ranked is the `<metric>Shrunk`
 * twin. Pass `isShrunkValue(row, key)`; it is not a claim a caller should make
 * from memory. It does NOT relax the "measurement" gate: shrinkage fixes
 * repeatability, and that gate is about the precision of a description, which
 * pulling a number toward the mean makes worse rather than better.
 */
export function meetsGate(
  metric: DisciplineMetric,
  den: number | null | undefined,
  shrunk = false,
): boolean {
  if (typeof den !== "number" || !isFinite(den) || den <= 0) return false;
  if (metric.gate === "measurement") return den >= (metric.minDenom ?? 0);
  return reliability(metric, den) >= (shrunk ? MIN_SHRUNK_WEIGHT : MIN_RELIABILITY);
}

/**
 * Is the rank about to be drawn resting mostly on the population rather than on
 * the player? True for a shrunk row that clears the shrunk floor but not the
 * reliability floor.
 *
 * The rows this describes are shown rather than hidden, and shown differently:
 * a reader who cannot tell "62nd, measured" from "62nd, mostly the league's
 * average changeup" has been told something false by omission.
 */
export function isProvisionalRank(
  metric: DisciplineMetric,
  den: number | null | undefined,
): boolean {
  return metric.gate !== "measurement" && reliability(metric, den) < MIN_RELIABILITY;
}

/** Shown under a board while it sorts by rankableValue() (the arsenal pitch-type board). */
export const SHRUNK_SORT_NOTE =
  "Sorted by the sample-adjusted rate (pulls thin samples toward average); hover a cell for the raw rate and count.";

/**
 * The value a percentile should rank: the shrunk twin where the export produced
 * one, the raw rate otherwise.
 *
 * Breakpoints are computed from the shrunk distribution (see
 * add_discipline_breakpoints in R/compute_discipline.R), so ranking a raw value
 * against them would overstate every extreme.
 */
export function rankableValue(row: Record<string, unknown>, key: string): number | null {
  const shrunk = row[`${key}Shrunk`];
  if (typeof shrunk === "number" && isFinite(shrunk)) return shrunk;
  const raw = row[key];
  return typeof raw === "number" && isFinite(raw) ? raw : null;
}

/**
 * Did `rankableValue` return the shrunk twin?
 *
 * Reads the row rather than being asserted by the caller, because it decides
 * which floor `meetsGate` applies and a wrong answer either hides a safe rank or
 * shows an unprotected one. The two functions are deliberately written against
 * the same key so they cannot disagree about which value is in play.
 */
export function isShrunkValue(row: Record<string, unknown>, key: string): boolean {
  const shrunk = row[`${key}Shrunk`];
  return typeof shrunk === "number" && isFinite(shrunk);
}

/** Denominator behind a row's rate, or null when the export did not carry it. */
export function denominatorFor(row: Record<string, unknown>, metric: DisciplineMetric): number | null {
  const d = row[metric.denom];
  return typeof d === "number" && isFinite(d) ? d : null;
}
