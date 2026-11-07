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

## Results (read once, 2026-11-06)

Fit: 4,505,677 MLB and 2,681,548 AAA pitches, 5 pitcher folds (per-pitch r with RV xBIP .281 MLB, .343 AAA). One
handling fix before any number was seen: the first `read` stopped on a season whose reference had one unit (SD NaN);
`to2080` now returns no grade there. Numbers: `results/pitch_quality_gates.json`.

Rule 1 = split-half r at the mean half, pitches for r .70 / .60. Rule 3 = r with next type RV/100 xBIP [95%].
Rule 4 = Δr over Whiff+ [95%], Holm. No type passes rule 4, so no type "adds to Whiff+".

| Level | Type | 1: r, n70 / n60 | 2: r Whiff+ | 3: units, r [95%] | 4: Δr [95%] | Shown |
|---|---|---|---|---|---|---|
| MLB | FF | .58, 333 / 214 | | | | **no** (rule 1) |
| MLB | SI | .50, 359 / 231 | | | | **no** (rule 1) |
| MLB | CT | .49, 339 / 218 | | | | **no** (rule 1) |
| MLB | SL | .51, 302 / 194 | .08 | 1,515, .045 [-.015, .107] | +.001 [-.008, +.010] | limited (rule 3), prov from 195 |
| MLB | SW | .52, 273 / 175 | .14 | 583, .107 [.004, .206] | +.008 [-.048, +.063] | describes, prov 176, full 273 |
| MLB | CB | .54, 240 / 154 | .18 | 959, .140 [.063, .214] | +.038 [-.009, +.082] | describes, prov 155, full 240 |
| MLB | CH | .61, 176 / 113 | .11 | 1,227, .087 [.022, .157] | -.003 [-.025, +.018] | describes, full 176 |
| MLB | FS | .59, 217 / 140 | .15 | 246, .008 [-.149, .161] | -.018 [-.049, +.015] | limited (rule 3), prov from 140 |
| AAA | FF | .46, 408 / 262 | | | | **no** (rule 1) |
| AAA | SI | .41, 395 / 254 | | | | **no** (rule 1) |
| AAA | CT | .35, 436 / 281 | | | | **no** (rule 1) |
| AAA | SL | .48, 274 / 176 | -.04 | 751, .008 [-.071, .088] | -.005 [-.019, +.009] | limited (rule 3), from 177 |
| AAA | SW | .42, 318 / 204 | | | | **no** (rule 1) |
| AAA | CB | .48, 203 / 130 | .06 | 357, .077 [-.032, .177] | +.001 [-.050, +.054] | limited (rule 3), from 131 |
| AAA | CH | .47, 234 / 151 | .05 | 539, .139 [.041, .231] | +.023 [-.024, +.068] | describes, prov 151, full 234 |
| AAA | FS | .51, 192 / 124 | .18 | 86, .204 [-.064, .425] | +.187 [-.016, +.389] | limited (rule 3), from 193 |

**Splits.** Shown (A1 and A2 pass): MLB curveball and changeup, both sides; AAA changeup, both sides. Every other
side of a shown type fails A2 (lower bound <= 0) or A1.

**AAA on the MLB scale: fails for every type.** Same pitcher, same season: slider gap -.52 SD [-.72, -.31] (63
pitchers), changeup -.72 [-.95, -.46] (43); curveball (29) and splitter (8) are under 30 pitchers. AAA grades are shown
on the AAA scale only.

### Diagnosis of the failures

- **Fastballs and cutters, rule 1 (MLB n60 214-231, AAA 254-281): modeling + data.** The grade is a run value from shape
  and location, and for fastballs the location part moves game to game; MLB pitchers are a narrow population, so the
  true spread between them is small next to that noise (college four-seam needed 185 on a wider population). Not a
  handling error as far as checked: the same split-half function passes changeups at 176, and the fold scores
  correlate with the outcome per pitch at the level of the §71 model (.28 vs .20 for xRV v1 on a wider target).
- **Slider, splitter (MLB), slider / curveball / splitter (AAA), rule 3: modeling.** Reliable this season, but the
  per-type average of a context-free run value does not track next season's run value of that pitch; the slider read has
  1,515 units, so it is not power. It agrees with §71 (xRV did not forecast run value) and §51 (shape-only run value
  failed). AAA splitter is power (86 units).
- **Rule 4 everywhere: modeling.** PQ correlates only .05-.18 with Whiff+; its next-season signal is small and
  overlaps what Whiff+ already carries in run value. Nothing "adds".
- **AAA scale check: data.** AAA pitches grade lower for the same pitcher in the same season. Candidates: the AAA ABS
  zone (normalised height uses the AAA zone), the §14 tracking offsets, and selection (pitchers sent down while
  struggling). Not separable here; the MLB-scale AAA grade is not shown.

**What ships:** the shown cells above, with their claim ("describes" or "limited"), on profiles (MLB and AAA, with the
muted "not confident" tier from the r .50 count) and on the arsenal leaderboards (MLB and AAA, shown tiers only).
