# Pitch Quality (PQ) per pitch type, MLB and AAA: pre-registration

Owner ask 2026-11-06: "add pitch quality everywhere and to AAA pitchers as well everywhere on the goat pro site".
Written and committed before any fit or read below. Public data only (Savant MLB + AAA via the mart).

## What PQ is

The method of the college Pitch Quality grade, refit on public data: one per-pitch run-value model from the pitch's
shape, release, location and count, pitcher-cross-fit, averaged over a pitcher's pitches of one type, shown 20-80. It
sits beside Whiff+, Prevention+ (pitch) and Pitching+; it is never blended with them.

**Model (fixed).** The §71/§78 xRV v2 design, unchanged (`xrv_model.py`): a LightGBM outcome leg over {ball, called
strike, whiff, foul, HBP, in play} plus a contact leg (in-play run value with the batted ball valued by xwOBA, the
per-count line), features velo, IVB, arm-side HB, spin, extension, release height, arm-side release, plate x (inside
+), normalised plate z, balls, strikes, same hand, season. Per pitch PQ = 100 x xRV (runs, pitcher-positive).

**Cross-fit (the memorization rule).** Trained on MLB regular-season pitches 2020-2026 only, 5 folds grouped by pitcher.
Every MLB pitch is scored by the fold model that never saw its pitcher. AAA pitches (2023-2026) are scored by the same
fold models: a pitcher who also threw in MLB is scored by the model that left him out; an AAA-only pitcher by fold
(id mod 5), which never saw him either. So AAA is "MLB model on AAA data", out of sample for every pitcher.

**Unit.** Pitcher x season x site type (FF, SI, CT, SL, SW, CB, CH, FS; Statcast codes folded as the site does), per
level (MLB, AAA). Grade = mean per-pitch PQ over the unit's pitches.

## Gates per type x level (rules as college PREREG-v2, with Whiff+ in Stuff+'s place)

Target throughout: type RV/100 xBIP = 100 x mean per-pitch run value with balls in play valued by xwOBA (per-count
line, fit per level on that level's pitches), pitcher-positive. z within season (and level, type).

1. **Reliability.** Game-half split-half: each of the unit's games goes to half A or B by a fixed hash of
   (pitcher, game); units with 25+ pitches in each half; r of the two half means, z within season. Spearman-Brown
   pitch counts for r .70, .60 and .50. **Full** if the r .70 count <= 200; **provisional** if not but the r .60 count
   <= 200; otherwise fail.
2. **Distinct.** r(PQ, Whiff+ per type) on units at the display count < .90 (Whiff+ per type from the shipped
   export for that level).
3. **Means something next season.** Units with 50+ pitches of the type in S and S+1 (same level). Pearson r of PQ in S
   with type RV/100 xBIP in S+1, pitcher-cluster bootstrap (2,000, seed 13). Pass: lower 95% bound > 0.
4. **Adds over Whiff+** (claim tier, not a display gate). Same units. Out-of-fold OLS (5 pitcher-grouped folds) of next
   type RV/100 xBIP on z Whiff+, then on z Whiff+ + z PQ; Δr of the OOF predictions, paired pitcher bootstrap;
   two-sided p, Holm over the types tested at that level. Pass: Holm reject and lower bound > 0.

**Display.** Rules 1-3 pass: shown, claim **"adds to Whiff+"** if rule 4 passes, otherwise **"describes"**. Rules 1-2
pass but 3 fails: shown as **"limited data"** (no claim), as the college cutter row. Rule 1 or 2 fails: not shown, with a
data / handling / modeling diagnosis. A provisional type is marked "prov" until its r .70 count (if that is <= 400;
else provisional throughout).

**Low confidence.** From the r .50 count up to the first tier count a grade is shown muted, "not confident", on
profiles only (never on a leaderboard), as on the college site.

## Splits (vs LHH / vs RHH)

Unit x batter side (same / opposite hand to the pitcher), types that pass display. **A1** rule 1 on the side (25+ per
half): full at the r .70 count <= 200, provisional at the r .60 count <= 200. **A2** units with 25+ pitches that side in
S and S+1; r with next same-side type RV/100 xBIP, lower bound > 0. Shown if A1 and A2 pass; claim always
"describes" (no split-adds test; college v4 found the split adds nothing over the type grade).

## Scales

- **Own population:** 20-80 = 50 + 10 z within level x season x type over units at the type's first display count
  (sides: level x season x type x side at the side count), clipped to 20-80, rounded to 5. A 50 sinker is an average
  sinker of that level and season.
- **AAA on the MLB scale:** an AAA unit's PQ z-scored against the MLB reference of the same season and type. Valid for
  a type only if the scale check passes: pitchers with the type's display count at both levels in the same season
  (n >= 30); gap = AAA minus MLB PQ in MLB SD units; pass if |mean gap| <= .25 and the pitcher-bootstrap 95% CI lies in
  [-.5, +.5]. Shown beside the AAA-population grade only where valid.

## Seals and caveats

No sealed set is opened. The seasonal holdouts are spent (2020 MLB; AAA 2025->26 was opened once for §49), so every
read here is a dev read on all pairs, and nothing here is cited as confirmation on a clean holdout. MLB pools the
2020-22 and 2023+ Hawk-Eye eras through the season feature and within-season z, as §78 does.

## Outputs

`pipeline/pitch_quality.py` (`--demo` self-check, `fit`, `read`, `export`), `pipeline/results/pitch_quality_gates.json`
(every number above), `pipeline/results/pitch_quality_units.csv` (unit grades for the bake). Results appended below
once, after the read.
