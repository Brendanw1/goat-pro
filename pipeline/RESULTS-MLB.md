# GOAT-Pro target bake-off and physics features (MLB Statcast, 2026-10-25)

MLB Statcast 2023-2026, 2,629,857 regular-season pitches. Everything here is
reproducible from `pipeline/`: `physics.py` builds the drag/Magnus features,
`bakeoff.py bake` runs the four-target bake-off plus a physics-feature arm
(`results/bakeoff_targets.json` has every number, `bakeoff_targets_PREFIXFIX.json`
the pre-bug-fix run), and `bakeoff.py export --target csw_norm` bakes the winner
to `data/export/mlb_pitcher_grades.json` in one command.

The design is the college one (research/stuff-model RESULTS.md §14, ported in
train_mlb.py): A_noev feature shape, monotone LightGBM (velo +1, ext +1), one
booster per pitch class x batter side with a 3,000-row pooled fallback, frozen
per-cell 100-centred scale on 2023-24, grades 2023-26. All statistics are
computed on raw mean predictions per pitcher-season (100+ pitches), evaluate.py's
`grades()`, because the frozen scale is affine per cell and cannot change any
Pearson r.

---

## 1. The headline

**Two findings, and the second one is the more valuable document.**

1. **The target verdict replicates the college result: csw_norm stays.** On the
   clean 2025->2026 pair it forecasts CSW% (0.477), whiff% (0.443), K/PA (0.458)
   and RV/100 (0.242) better than every alternative, beats the rv and rv_cnorm
   designs significantly on the whole whiff family (paired pitcher bootstrap),
   ties rv_cnorm on RV/100, and is the most reliable grade at every pitch count
   (split-half r = 0.807 at 25 pitches; next best 0.777).
2. **The v1 location leak was a one-line bug, and the college check found it.**
   `np.polyfit(x, y, 1)` returns `[slope, intercept]`; the v1 `hvaa`
   residualization evaluated the fit as `slope + intercept*plate_z`, so "hvaa"
   was raw approach angle with a 1.2 deg/ft tilt — correlating **0.997 with
   plate height within every pitch class**. Fixing it raised year-over-year
   stickiness 0.781 -> 0.827 and split-half reliability at 25 pitches
   0.562 -> 0.807, while making per-pitch log loss WORSE (0.5617 -> 0.5797):
   the leak was subsidizing per-pitch accuracy, which is the college's central
   lesson reproduced in one number.

## 2. Method

**Splits.** Train 2023-24, validate 2025, test 2026, never tuned on 2026. The
count baselines (E[CSW|count], E[whiff|count], E[rv|count]) are fitted on the
training seasons only. Grades for 2023-24 are IN-SAMPLE (the fit saw them); the
college work had out-of-fold training-season predictions and this budget did
not buy them. 2025->2026 is the clean pair — neither season was trained on —
and the verdict leans on it.

**Targets.** Each variant's natural row set, as in the college bake-off:
`csw_norm` is undefined on balls in play (the v1 convention), the rest are
defined on every pitch. Grades are scored on every pitch either way.

| target | definition |
|---|---|
| csw_norm | csw / E[CSW \| count] — the v1 incumbent |
| whiff_norm | whiff (swinging strike, incl. blocked) / E[whiff \| count], every pitch |
| rv | raw per-pitch run value (-delta_run_exp) |
| rv_cnorm | rv - E[rv \| count] (difference, not ratio: rv is signed) |

**Statistics.** Per-pitch fit (log loss via un-normalising `pred x E[outcome|count]`
for the CSW/whiff family, RMSE on raw rv for the rv family) is reported but
CANNOT rank across targets — different units, and the college rule applies:
log loss and RMSE rank only within one target. Ranking is done on:

- **stickiness**: YoY Pearson r of the season grade, pairs (23,24), (24,25),
  (25,26), n >= 30 pitchers (here 487-517 per pair at the 100-pitch floor);
- **reliability**: within-season split-half r, two disjoint random halves, no
  Spearman-Brown correction, 2026;
- **predictiveness**: season-N grade vs N+1 CSW%, whiff%, K/PA, RV/100, each
  against the naive persistence baseline (season N actual vs N+1 actual), with
  the PAIRED pitcher bootstrap (boot 2000, seed 13; the SAME resampled pitchers
  for every design). "Beats naive" iff the lower bound of the |r| difference
  exceeds 0 — evaluate.py verbatim;
- **location-independence**: evaluate.py's check verbatim (§5);
- outcomes never come off the model's own rows: CSW% over all pitches, whiff%
  per swing, K/PA from the `events` column (strikeout / strikeout_double_play
  over plate appearances), RV/100 = mean rv x 100.

## 3. Physics features (pipeline/physics.py)

The nine parameters decompose, Nathan's convention, as
`a = a_grav + a_drag + a_magnus` with gravity (0, 0, -32.174) ft/s^2, drag the
component of (a - a_grav) antiparallel to the velocity, and Magnus everything
else (the transverse component). Active spin is
`|a_magnus| / (0.00583 * spin_rps * velo_mph)` clipped to [0, 1.1]; Magnus-implied
movement integrates a_magnus over the flight time (0.5 * a * t^2, inches).

**Constant check.** 0.00583 is ft/s^2 per (revolution-per-SECOND x mph). Used
with raw rpm it overshoots 60x and four-seamers come out at 0.015; with rpm/60
the formula reproduces max four-seam break of ~17 in at league velo/spin. No
other unit pairing is dimensionally sane.

**Validation on 2023-26.** Means: FF 0.890, SI 0.918, CH 0.915, FS 0.914, ST
0.564, CU 0.544, KC 0.509, FC 0.411, SL 0.278. The ordering matches published
active spin exactly (fastball family high, gyro slider lowest). The levels are
the MOVEMENT-DERIVED active spin — Savant ships both measurands ("measured"
from the 3D spin vector, ~0.92 for FF, vs "inferred from movement", ours). No
scalar correction can move ours onto the spin-vector scale (SI sits ABOVE FF
here, CU below — the reverse of any uniform offset), so the residuals against
the task's stated bands (FF 0.90-0.95, CU 0.6-0.75, SI ~0.85) are the known
method difference plus Magnus-coefficient saturation at high spin parameter,
not an implementation error. Cross-checks that pin the decomposition itself:
mag_ivb/mag_hb reproduce measured pfx breaks per type (FF 13.4 vs 15.7 in ride,
CU -8.9 vs -10.0); |a_drag| ~31 ft/s^2 at 94 mph is Cd ~0.30 aerodynamics; the
sinker's arm-side a_magnus of ~17 ft/s^2 reproduces its ~14 in of run; the ax
handedness mirror is exact.

**As model inputs: rejected.** `csw_norm_physics` (the 11 A_noev features +
spin_eff, mag_ivb, mag_hb, mag_break, a_drag) is worse on every grade
statistic: YoY 0.818 vs 0.827, split-half at 25 pitches 0.775 vs 0.807, K/PA
0.444 vs 0.458, and MORE location-dependent (pitcher-grade vs mean height 0.094
vs 0.072). Every clean-pair difference vs csw_norm is within noise (largest
|d| = 0.0147 [-0.0038, +0.0334] on K/PA) — the block adds nothing and its
location profile disqualifies it. This matches the college shadow test, where
spin_eff sat below the noise floor in all six cells, and goes one further: on
MLB the movement twins of ivb/hb actively dilute the grade.

## 4. Target bake-off

### 4.1 The comparative table

Raw-mean-prediction grades, 100+ pitches. Predictiveness is the CLEAN pair
(2025 grade vs 2026 actual; naive = 2025 actual vs 2026 actual). Location is
evaluate.py's check, 2026 (§5).

| variant | YoY 23-24 / 24-25 / 25-26 | rel@25 | rel@100 | CSW 25>26 | whiff 25>26 | K/PA 25>26 | RV/100 25>26 | loc height/side |
|---|---|---|---|---|---|---|---|---|
| **csw_norm** | .787 / .818 / **.827** | **.807** | **.935** | **.477** | .443 | .458 | **.242** | .072 / .145 |
| whiff_norm | .797 / .856 / **.841** | .731 | .920 | .369 | **.550** | **.486** | .218 | .024 / .064 |
| rv | .752 / .766 / .803 | .777 | .896 | .352 | .345 | .388 | .220 | **.007** / .040 |
| rv_cnorm | .753 / .760 / .797 | .747 | .898 | .361 | .346 | .395 | .218 | **.007** / .039 |
| csw_norm_physics | .780 / .808 / .818 | .775 | .921 | .480 | .432 | .444 | .234 | .094 / .156 |

Naive persistence baselines on the same 487 pitchers, 2025->2026: CSW .493,
whiff .608, K/PA .543, RV/100 .167.

### 4.2 Per-target readings

**csw_norm** — best or tied on every whiff-family outcome and RV/100, best
reliability (stabilises at r = 0.7 by 25 pitches), 0.827 YoY. Its CSW edge is
significant against BOTH rv designs (+0.117 [+0.061,+0.172] vs rv_cnorm) and
whiff_norm (+0.106 [+0.048,+0.165]).

**whiff_norm** — the stickiest grade of the bake (.841) and the best whiff%
forecaster (.550, +0.107 [+0.054,+0.161] over csw_norm, +0.204 over rv_cnorm).
But it loses CSW to csw_norm significantly, its K/PA edge is within noise
(-0.028 [-0.083,+0.026]), and it has the worst location profile of the CSW
family: pitcher-grade vs mean |plate side| 0.133-0.228, per-pitch r with plate
height 0.165-0.177. A whiff probability is an edge-of-zone event, so the model
reads edge-ness out of shape. College disposition: a descriptive xWhiff, not
the grade.

**rv / rv_cnorm** — statistically indistinguishable from each other on every
measure (largest pairwise |d| = 0.008). The most location-independent grades in
the bake — pitcher-grade vs mean height 0.007, the college v8 number exactly —
and they buy NOTHING for it: they lose CSW (-0.117 to -0.125), whiff (-0.098)
and K/PA (-0.065 to -0.071) to csw_norm, all significant, and RV/100 is a tie
(+0.022-0.024, ns). Count normalisation changes rv by ~nothing on MLB (the
count mix is less leveraged than D1's).

### 4.3 Versus the naive persistence baseline

This is where MLB differs from college, and it is the honest bad news:

| outcome | naive r | best design | best vs naive | verdict |
|---|---|---|---|---|
| CSW% | .493 | csw_norm .477 | -0.016 [-0.089,+0.058] | tie with naive |
| whiff% | .608 | whiff_norm .550 | -0.059 [-0.123,+0.004] | not beaten |
| K/PA | .543 | whiff_norm .486 | -0.057 [-0.136,+0.020] | not beaten |
| RV/100 | .167 | csw_norm .242 | +0.075 [-0.049,+0.197] | not significant |

**No target beats the naive persistence baseline on any outcome in the clean
2025->2026 pair.** csw_norm ties the naive baseline on CSW — its own target
family — and on RV/100, and significantly LOSES on K/PA (-0.085
[-0.166,-0.005]) and whiff% (-0.165 [-0.242,-0.091]). The only beats-naive
results anywhere in the bake are in-sample: csw_norm on CSW 23->24 (+0.073*),
rv/rv_cnorm on RV/100 23->24 (+0.130*/+0.138*), whiff_norm on whiff 23->24
(+0.074*). MLB's season-to-season persistence (K/PA naive r = .543 vs college
.436) is a much harder floor, and a 487-pitcher pair has one standard error of
about 0.035.

The pre-fix run's single clean-pair gate pass — rv_cnorm RV/100 +0.112
[+0.001,+0.221] — was the hvaa bug talking: post-fix it is +0.051
[-0.068,+0.167]. A gate result that depends on a location leak is not a gate
result, which is exactly why the location check exists.

## 5. Location-independence: the diagnosis

**What their check measures vs what the v1 gate printed.** The college check
(evaluate.py `location_dependence`) is PITCHER-level: the season grade (mean
prediction, 100+ pitches) against the pitcher's MEAN plate height, MEAN
mirrored plate side and MEAN edge distance, with a per-pitch |r| supplement.
The v1 gate printed only the per-pitch pooled |r| of prediction vs plate_z —
no pitcher floor, no horizontal axis, no pitcher-level row. The numbers are
not comparable, which is why the v1 0.138 "pooled" looked catastrophically
worse than the college 0.01 while some of the gap was metric, not model.

**The bug the check found.** Implementing their check verbatim on the v1 build
gave pitcher-grade vs mean height = 0.108 (2026) — and the feature attribution
table found `corr(hvaa, plate_z) = 0.997` within FB vs RHH, ON THE TRAINING
SEASONS. An OLS residual cannot correlate with its own regressor: `np.polyfit`
returns `[slope, intercept]`, v1 evaluated it as `a + b*plate_z` with a = slope,
so hvaa = vaa - (slope + intercept*plate_z) = raw VAA with a 1.2 deg/ft tilt.
The "residualized approach angle" had never been residualized.

**Post-fix numbers** (hvaa vs plate_z within FB vs RHH: 0.002):

| | pre-fix | post-fix |
|---|---|---|
| hvaa vs plate_z (within FB vs RHH) | 0.997 | 0.002 |
| csw_norm YoY 25-26 | .781 | .827 |
| csw_norm split-half @25 | .562 | .807 |
| csw_norm per-pitch log loss (2026) | .5617 | .5797 (worse) |
| pitcher-grade vs mean height (2026) | .108 | .072 |
| pitcher-grade vs mean side (2026) | .101 | .145 |
| per-pitch r vs plate_z (2026) | .134 | .232 |

The leak was subsidizing per-pitch accuracy and suppressing the grade: with the
location proxy removed, the model per pitch is worse and the grade is better on
every college statistic. (The per-pitch and side numbers move UP post-fix — the
raw-VAA feature had been absorbing the target's location variance into one
column; the remaining correlation is the shape-location coupling described
below, no longer misattributed to hvaa.)

**What remains, and what it is.** Post-fix, the csw_norm grade's remaining
location correlation is NOT feature leakage: every feature is location-free
(hvaa 0.002; the others are release, movement and velo). It is shape->
location-CHOICE coupling concentrated in fastballs: within FB vs RHH, ivb
correlates 0.263 with plate_z and ivb_diff 0.227 (high-ride fastballs are
thrown up in the zone), and the CSW target rewards exactly that, so the model's
ride->CSW mapping tracks where fastballs are thrown (within-cell pred vs
plate_z: FB 0.22-0.30, BB 0.05-0.09, CH 0.04-0.06). The rv family does not
inherit it (0.018-0.038 per pitch) because run value at fixed shape is not
"higher = better" the way called strikes are.

**The honest standard statement.** Under the college check, the rv-family
grades on MLB MEET the college standard (0.007 vs their v8's 0.007); the
csw_norm grade does not (0.072 height, 0.145 side, 0.232 per-pitch). We could
not reproduce the college per-pitch 0.002 mechanism on our build — with a
verified location-free feature set and the same design, the CSW target's
shape-location coupling alone produces 0.2+ within fastballs on MLB. On MLB
data, the college standard for location and the college standard for
predictiveness are in tension: rv targets are location-clean but forecast
nothing better than csw_norm; csw_norm forecasts best but its grade tracks
pitchers' location habits through the ride/height choice. csw_norm ships with
this documented and its features verified clean; the rv family remains
registered for anything that needs strict location independence.

## 6. The verdict

**Keep csw_norm.** The college result replicates on MLB with the leak fixed:

- it forecasts CSW%, whiff%, K/PA and RV/100 better than every alternative on
  the clean pair, significantly better than both rv designs on the whiff family;
- it is the most reliable grade at every pitch count (0.807 at 25 pitches —
  FanGraphs-style reliability by ~25 pitches, where rv needs 50+);
- its 0.827 YoY is within noise of whiff_norm's 0.841 with better location
  behaviour (height 0.072 vs edge 0.216 for whiff_norm's family);
- count normalisation does real work here as in college: raw rv's grade is
  never distinguishable from rv_cnorm's, and neither earns its location
  cleanliness with any forecasting gain.

Rejected: rv and rv_cnorm (stickier in-sample only, significantly worse on the
whiff family, no RV/100 edge), whiff_norm (best whiff forecaster and stickiest
grade, but a significant CSW loss and the worst edge-location profile — keep as
a descriptive xWhiff), physics features (noise at grade level, more
location-dependent).

**Gate status: PROVISIONAL.** Under the college paired-bootstrap methodology,
no target beats the naive persistence baseline on any outcome in the clean
2025->2026 pair (§4.3). The export model card says exactly that. No leaderboard
built from this artifact may carry a forecast claim (GOAT-Pro clean-room rule
3) until a design passes a gate on a clean pair.

## 7. Caveats

1. **2023-24 grades are in-sample.** The 23->24 and 24->25 stickiness and
   predictiveness pairs involve at least one trained-on season. The college
   work folded training seasons out-of-fold by whole games; that is the first
   upgrade this pipeline should buy (4 folds x 6 boosters x 4 targets, ~30
   machine-minutes).
2. **One clean pair.** 2025->2026 is a single 487-pitcher comparison; the
   bootstrap quantifies pitcher resampling, not season resampling. The RV/100
   result that survived pre-fix (+0.112*) did not survive the bug fix, which is
   a live demonstration of how fragile single-pair margins are.
3. **Naive persistence is stronger on MLB than D1.** K/PA naive r .543 (college
   .436), CSW .493 (college ~.45). A grade that "ties persistence on its own
   target family" is a weaker claim on MLB than the same words were in college.
4. **Log loss is not cross-target comparable**; per-pitch fit is reported for
   completeness (csw_norm 0.5813, whiff_norm 0.3349, rv 0.2246 RMSE — different
   units).
5. **spin_eff and friends are measured, validated, and unused.** The physics
   module stays: it is the reference implementation for any future spin-axis
   work, and the decomposition is cheap and verified.
6. **The location tension (§5) is unresolved by design choice.** If a consumer
   needs strict location independence (a grade that cannot correlate with
   where a pitcher throws), the rv boosters in `pipeline/models/` are the
   registered alternative.

## 8. Reproducibility

```
python pipeline/physics.py                      # physics validation
python pipeline/bakeoff.py bake --with-physics  # the bake-off (~7 min)
python pipeline/bakeoff.py export --target csw_norm   # the shipping artifact
```

Every number in this document is in `pipeline/results/bakeoff_targets.json`
(pre-fix run preserved as `bakeoff_targets_PREFIXFIX.json`); the grades are in
`data/export/mlb_pitcher_grades.json` with the model card. Seed 13, boot 2000;
the statistics functions mirror evaluate.py's and the synthetic smoke tests are
in the git history.

## 9. Small-sample regime (within-season), 2026-10-25

`pipeline/tests_small_sample.py` → `results/small_sample.json`. Frozen v1 Stuff+
on a pitcher's first N pitches (fastball anchors recomputed on those N only)
vs his CSW% on the same N, predicting his rest-of-season CSW% (≥300 taken
pitches left). 2025 primary; 2026 has the plate_z convention shift (hvaa). These tests use the v1 feature spec without the §10 2026 re-referencing that the export applies; moving them to v2 is open.

| N | 2025 grade r | 2025 naive r | 2025 CV R² naive / both | 2026 grade r | 2026 naive r | 2026 CV R² naive / both |
|---|---|---|---|---|---|---|
| 25 | **.246** | .128 | .004 / .057 | **.318** | .231 | .046 / .134 |
| 50 | **.290** | .243 | .051 / .110 | **.360** | .254 | .059 / .158 |
| 100 | .290 | **.324** | .095 / .145 | .340 | .336 | .102 / .172 |
| 200 | .315 | **.441** | .185 / .223 | .368 | .354 | .112 / .189 |
| 400 | .319 | **.528** | .267 / .287 | .380 | **.462** | .199 / .257 |

n = 521→357 (2025), 511→346 (2026, full season via `pitches_all` since 2026-10-25; the Aug-7-truncated run had grade wins through 100 and r .35–.43).

**Verdict:** the product claim holds, with a measured crossover. Stuff+ alone beats
observed CSW% through ~50 pitches in both seasons; naive overtakes it by 100–200
pitches. The blend (naive + grade) has the best CV R² at **every** N in both
seasons, so the shippable form is a sample-weighted blend, not either alone.
**Survivorship (checked):** the sample is pitchers who threw N+300 more. Range restriction is negligible (survivors' first-N CSW% SD is 1–5% below all arms'), and at a 100-pitch remainder (`python tests_small_sample.py 100`, +~150 arms/season) the verdict holds: grade wins through 50 (2026: 100), blend best at every N. Same pattern as the college forecast's survivorship study (research/pitcher-forecast/RESULTS.md, SURVIVORSHIP D): ranking survives, level may not, so ship as "if he holds a role".
**Caveats:**
The debut subset (no prior-season pitches, n=30–98) reverses between seasons
(2025: naive wins at every N; 2026: grade wins ≤100), so no rookie-specific claim.

## 10. 2026 plate re-referencing (ABS convention break), 2026-10-25

`pipeline/referencing_2026.py` -> `results/referencing_2026.json`. The 2026
Savant CSV changed conventions (docs/savant-gap-map.md): plate_x/plate_z from
middle-of-plate, sz_top/sz_bot ABS-defined. The mart confirms the audit:
zone height 1.830 -> 1.593 ft (-13%), sz_top -0.22, mean plate_z -0.076 ft vs
2025, while 2024->2025 was stable. One offseason does not move a league's
average plate_z 0.9 in: the convention moved, not the pitchers. Since the v1
hvaa residualization is fitted on 2023-24 plate_z and Pitching+ consumes
plate_x/plate_z, raw 2026 scoring injects a systematic offset.

**Map.** Per-feature affine, least squares on p1..p99 quantile pairs, 2026
matched onto 2025, from the mart over the exact FEATURE_SQL population; a
feature with |slope-1| < 0.02 and |intercept| < 0.02 maps to identity:

| feature | slope | intercept | decision |
|---|---|---|---|
| plate_x | 1.0057 fit | +0.0179 fit | **IDENTITY** (guard: deltas under 0.02) |
| plate_z | 0.9977 | +0.0763 ft | applied — absorbs the convention drop |
| sz_top | 1.8078 | -2.3785 ft | reported only (ABS compression; not a model feature) |
| sz_bot | 2.1064 | -1.8135 ft | reported only (same) |

The map is applied to season-2026 rows only, before hvaa/plate features reach
any consumer — implemented as a wrapper that repairs the loaded frame EXACTLY
(vaa is a function of the nine parameters alone, so
hvaa' = hvaa + s*(plate_z_raw - plate_z_mapped) with the untouched per-class
train fit; verified to 2e-15 against an independent recompute, train rows
bit-identical). 2026 hvaa moves onto the reference level (FB mean 0.149 ->
0.064 vs 2025's 0.019; the remainder is population, not convention). Per-throw
check: the plate_z fit is homogeneous (L +0.065 / R +0.081 intercept).

**Gates (train_mlb main() definitions), before -> after:**

| gate | before | after |
|---|---|---|
| stuff per-pitch r vs csw / leak \|r vs plate_z\| | .193 / .270 | .192 / .281 |
| pitching per-pitch r vs rv | .312 | .312 |
| stuff+ YoY 23->24 / 24->25 (baseline, untouched) | .738 / .794 | same |
| **stuff+ YoY 25->26** | **.789** | **.800** |
| pitching+ YoY 25->26 (supplementary) | .507 | .505 |
| predict 2026 CSW%: grade r / naive | .208 / .313 | .208 / .313 (invariant by construction: its predictor is the 2025 grade; the map touches 2026 features only) |

**Verdict.** The convention break was NOT silently damaging the v1 gates: the
raw 2025->2026 stuff+ pair was already ABOVE the 23->24/24->25 baseline
(.789 vs .766), and re-referencing moves it further up (.800, the best pair).
Pitching+ YoY moves .002 (noise); per-pitch stats are flat. Pitcher-level, the
map shifts 2026 stuff+ grades by 1.0 points on average (p90 2.3, max 5.1;
3 of 753 pitchers move >5 points; grade r(before, after) = .989). So the map
is adopted as the feature-level correctness fix — it is exact, it removes a
verified convention offset from every 2026 hvaa and plate value, and it costs
nothing on any gate — but it is NOT a gate-improvement event, and the export
is therefore left unchanged (default).

**Export follow-up (if ever adopted for the artifact):** wire
`referencing_2026.apply_2026_reference` into `train_mlb.load_features` (the
wrapper is already exact against the cache), then regenerate in one command:
`python pipeline/bakeoff.py export --target csw_norm`. As long as that wiring
is absent, the export command bakes UNREFERENCED 2026 grades.
*(Wired 2026-10-24: `bakeoff.export` now applies `apply_2026_reference` at the
top of the export path and the artifact is regenerated — see §13.)*

## 11. Location check — verbatim college methodology (v1 vs v2), 2026-10-24

`pipeline/location_check.py` -> `results/location_check.json`. The college
check (vt_baseball evaluate.py `location_dependence`, their standard L)
implemented verbatim — same statistic, same aggregation, same 100-pitch floor
— and run against BOTH designs on 2025, the out-of-sample season: the
pitcher's season grade (MEAN raw prediction, >= 100 pitches) vs his MEAN plate
height and MEAN arm-mirrored plate side, |r| across pitcher-seasons, plus the
pooled per-pitch |r| supplement (no floor). v2 = stuff_v2 (the 11 v1 features
+ spin_eff per-class-constrained + velo_x_ivb). The college's documented D1
numbers: A_noev .007 grade-vs-mean-height (v5 .147, v6 .112); per-pitch |r|
vs plate height/side <= .002.

| design | height | side | per-pitch plate_z | per-pitch plate_x_arm | n_pitchers |
|---|---|---|---|---|---|
| v1 (11 feats, csw_norm) | .110 | .145 | .295 | .138 | 722 |
| **v2 (+ spin_eff, velo_x_ivb)** | **.104** | **.143** | **.294** | **.137** | 722 |

2026 continuity row (both designs scored on the same raw, unreferenced plate
frame): v1 .063 / .137, per-pitch .216 / .122; v2 .059 / .135, .216 / .121.
(v1's 2026 numbers sit next to §5's .072 / .145 / .232 — those were computed
with bakeoff.py's variant that also drops rows with null plate coordinates;
this module drops only on the prediction, the college's drop semantics. Same
story under both readings.)

**Verdict (college GATE.md semantics, materiality bar 0.01): v2 replaces v1.**
Not one check number is materially worse — all four headline numbers are
marginally BETTER (worst delta +0.000; height -0.006, side -0.002, per-pitch
-0.001 on both axes). The proxy worry recorded in results/stuff_v2.json ("v2
0.269 vs v1 0.138" pooled |r vs plate_z|) was a stale comparison: on the same
frame and season v1 reads .295, and v2 equals it — the per-class monotone
spin_eff adds no location dependence out-of-sample. The HOLD in
stuff_v2.json ("v2 replaces v1 only after the verbatim college evaluate.py
location check") is lifted by this section; spin_eff stays in the feature set.

**D1-vs-MLB population difference (documented, per the verdict rule).** Both
designs sit an order of magnitude above the D1 absolutes (.007 height, .002
per-pitch), and the gap is a property of the MLB population + CSW target, not
of either feature set: every feature is verified location-free (hvaa vs
plate_z 0.002 within class post-fix, §5), and the remaining correlation is
shape->location-CHOICE coupling — high-ride fastballs are AIMED up in the zone
(ivb vs plate_z 0.263 within FB vs RHH) and the CSW target rewards ride, so
any grade that prices ride correctly tracks where fastballs are thrown (§5;
stuff_v2.json: "pitch-design intent, not the model seeing plate coordinates").
The college .007 was achieved on D1 TrackMan data, where that coupling is
weaker; as recorded in §5/§7.6, the rv-family designs remain the registered
location-clean alternative for any consumer that needs strict independence.

**Mirror check (side-footnote).** Against RAW plate_x (no L/R mirroring) both
grades read .000-.005: arm-side and glove-side pitcher means cancel across
handedness, so the unmirrored side check would hide a real .14 dependence.
The arm-mirrored column the college specifies is load-bearing, and our
`plate_x_arm` (train_mlb._load_features, arm-side positive; Statcast's
batter-view x negates RHP where college's catcher-view TrackMan negates LHP —
same semantics) was built for exactly this.

**Export follow-up (NOT run here).** v2 winning means the shipping artifact
should be regenerated with the v2 design — but `bakeoff.export` currently
hard-bakes the v1 feature list (`tm.STUFF_FEATURES` + global MONO). Wire
stuff_v2's FEATURES/CLASS_MONO into it (follow-up claim needed), then the
one-command refresh is: `python pipeline/bakeoff.py export --target csw_norm`.
Until that wiring exists, the export command keeps baking the v1 design.
*(Done 2026-10-24: `bakeoff.export` imports the v2 design from stuff_v2 and
the artifact is regenerated — see §13.)*

Reproduce: `python pipeline/location_check.py` (~4 min warm; v1 boosters from
cache, v2 retrains deterministically — rerun reproduced identical numbers).

## 14. AAA vs MLB Hawk-Eye comparability, 2026-10-25

`pipeline/aaa_audit.py` → `results/aaa_audit.json`. AAA backfill: 2,217–2,232
regular-season games per season, 2023–2026, ~670k pitches/season, every park
(mart view `pitches_aaa`). Paired within pitcher: same pitcher, same pitch type,
same season, ≥30 pitches at each level (n = 23–380 pitchers per cell). Values are
MLB − AAA.

| Measurement | All AAA parks | AAA without the 5 high parks (ABQ, RNO, SL, ELP, LV) | Read |
|---|---|---|---|
| Extension | +0.08 to +0.12 ft, every cell | same | **tracking offset**: uniform across pitch types and seasons, CIs ±0.01–0.02 |
| Release height | −0.03 to −0.09 ft, every cell | same | **tracking offset**, same pattern |
| Velo | +0.2 to +0.6 mph | same | effort or calibration; not separable here |
| Spin | +8 to +31 rpm | same | as velo |
| FF ivb | +0.34 to +0.52 in | +0.01 to +0.14 | **mostly altitude**: thin air in the 5 high parks |
| SI/CH arm-side run | +0.53 to +0.82 in | +0.21 to +0.39 | ~half altitude, residual remains |
| Sweeper glove-side | −0.58 to −0.81 in | −0.32 to −0.52 | ~half altitude, residual remains |
| CU ivb (drop) | −0.55 to −0.74 in | −0.40 to −0.54 | residual remains |
| sz_top | +0.20 to +0.31 ft 2023–25; +0.02 in 2026 | same | AAA ran the ABS zone throughout; MLB's 2026 zone now matches it (gap map) |

**Verdict:** AAA is not interchangeable with MLB without adjustment (rule 6 holds). To use
it: shift AAA extension (+0.10 ft) and release height (−0.06 ft) to the MLB scale,
park-adjust or exclude the 5 high-altitude parks, and treat 2023–25 AAA plate_z/sz like
2026 MLB. The leftover breaking-ball and run differences (0.2–0.5 in, larger
movement in MLB) are unexplained: candidates are the ball, effort, or calibration. A
per-park split is the next test. For the survivorship follow-up (§9), AAA CSW% also
needs a competition-level adjustment, and these offsets come before it.

## 15. Small-sample test with demoted pitchers kept (AAA-filled), 2026-10-25

`python tests_small_sample.py --aaa` → `results/small_sample_aaa.json`. Pitchers
short of 300 MLB rest-of-season pitches keep their place when MLB + AAA rest
reaches 300; AAA CSW% (low-altitude parks, after the pitcher's Nth MLB pitch)
is shifted by the paired level gap, MLB − AAA = −1.8 CSW pts (2023 −1.76, 2024
−2.00, 2025 −1.63, 2026 −1.89; CI ±0.4; ≥200 pitches at each level, n 218–254).
AAA dates are capped at the MLB frame's last date (the `pitches` view ends
2026-08-07; later games live only in day-files and the pipeline doesn't read them).

| N | 2025 grade / naive r | 2025 CV R² naive / both | 2026 grade / naive r | 2026 CV R² naive / both |
|---|---|---|---|---|
| 25 | **.291** / .182 | .021 / .091 | **.302** / .184 | .027 / .105 |
| 50 | **.325** / .287 | .077 / .147 | **.342** / .242 | .053 / .140 |
| 100 | .329 / **.362** | .125 / .184 | .337 / .334 | .109 / .170 |
| 200 | .361 / **.455** | .203 / .256 | .366 / .357 | .123 / .194 |
| 400 | .358 / **.507** | .251 / .281 | .400 / **.423** | .170 / .239 |

n = 598→415 (2025), 612→409 (2026, full season): +77–101 pitchers at N=25 vs §9.

**Verdict:** §9's pooled claim survives the survivorship fix: grade wins through 50
pitches, blend best at every N. **But the demoted group alone (n 48–79) is
unproven:** 2025 grade ≥ naive at every N; 2026 (full season) grade r .02–.12 vs naive .06–.28
(the Aug-7-truncated run had −.17 to −.01). At n≈60–100 the CI is ±.2–.25, so this reads as noise until a third season or a larger
pooled sample decides it. That group is where a small-sample grade matters most,
so the open question is the product's own question.

## 16. Probe: observed vs movement-implied spin axis (seam-wake signature), 2026-10-25

`pipeline/probe_axis.py`. Statcast convention (180 = backspin); LHP mirrored.
Median deviation: SI −19°, ST −31°, FS −18°, CH −12°, CU 0°, FF +8°, SL +9°,
FC +25°. 2025 split-half r .94–.99 (n 75–499 arms); 2024→25 YoY CH .85, CU .94,
FC .78, FF .88, FS .75, SI .87, SL .88, ST .70. Between-pitcher SD 5–12°, SL 25°.

**Read:** a stable, measurable pitcher trait that college TrackMan could not
produce (its axis is movement re-expressed). The sign pattern matches lab SSW
findings (sinkers and changeups seam-driven, curveballs Magnus-driven). SL's 25°
spread is the gyro confound: low-efficiency spin leaves small movement whose
direction is noisy. Not yet tested as a predictor; queued as program item 1
(docs/pitch-model-research-program.md). spin_axis drifts ~16° on SL across 2023–26
(era audit), so any pooled model uses within-season deviation only.

## 13. v2 export wired + out-of-fold training-season grades, 2026-10-24

**Export (§10/§11 follow-ups closed).** `python pipeline/bakeoff.py export
--target csw_norm` now reads the winning design FROM `pipeline/stuff_v2.py`
(`FEATURES`/`CLASS_MONO` via the shared `prepare`/`train_boosters` — no
duplicated constants, so the artifact and the gate run cannot drift) and
applies the §10 2026 plate re-referencing before anything consumes a plate
column or hvaa. Regenerated artifact: `data/export/mlb_pitcher_grades.json`,
3,206 pitcher-seasons (row set unchanged), 6 v2 stuff boosters re-saved to
`pipeline/models/`. Model card: `features_stuff` = the 13 v2 features (spin_eff
per-class monotone + velo_x_ivb), per-class mono recorded, `gate_status`
**descriptive-only** — "location check passed under college methodology
(RESULTS-MLB §11); no forecast claims (predictiveness vs naive mixed)" — and
the derived §10 affine params recorded verbatim (plate_x IDENTITY; plate_z
0.9977 / +0.0763 ft). Artifact YoY (all graded pitchers): 23→24 .744, 24→25
.784, 25→26 **.795** — the re-referencing moves the v2 clean pair up, same
direction and size as v1's .789→.800 (§10). Non-csw_norm targets keep the v1
bake-off arm (ungated, card stays PROVISIONAL).

**OOF.** `python pipeline/stuff_v2.py --oof` → `results/oof_v2.json`. College
`harness.oof_train` semantics (research/stuff-model): 4 whole-game folds
(`crc32(game_pk) % 1000` banded into 4) over the TRAIN seasons only; per
class × side cell, fit on 3 folds' taken pitches, predict the held fold's
train-season pitches — all of them, taken or not, so grade construction matches
production — and grade the training seasons from those predictions with the
production frozen scale (per-cell league constants, no pitcher identity: what
deployment scores new seasons with). Coverage of train rows 1.0000. The BEFORE
numbers reproduce the stored gate run exactly (Δ +0.000000 × 3 — the refactor
to shared helpers is byte-neutral, and LightGBM retrains are deterministic).

| pair | YoY before (in-sample) | after (OOF) | Δ |
|---|---|---|---|
| 2023→2024 | .744 | .743 | −.001 |
| 2024→2025 | .784 | .785 | +.001 |
| 2025→2026 | .783 | — (no training season involved; verified immovable) |

Predictiveness vs naive on CSW% (grade r):

| pair | grade before | grade after | naive |
|---|---|---|---|
| 2023→2024 | .266 | .246 | .240 |
| 2024→2025 | .307 | **.322** | .241 |

**Verdict.** The v2 grade's stickiness is NOT an in-sample artifact: with every
training-season prediction out-of-fold, both training-involved YoY pairs move
±.001. §7.1's first caveat ("2023-24 grades are in-sample") is retired for the
stuff leg — the season-grade YoY numbers of §4/§11 stand as out-of-sample.
Predictiveness splits honestly: 23→24's small edge over naive (.266 vs .240)
was mostly in-sample optimism and drops to a tie (.246 vs .240), while 24→25
actually IMPROVES out-of-fold (.307 → .322) — the in-sample fit was spending
capacity on train-season noise that folding removes. No verdict changes: still
descriptive-only (the clean-pair 25→26 predictiveness remains below naive,
.211 vs .313, untouched by construction).

**Caveats.**
1. The count baseline E[CSW|count] is fitted on the full TRAIN window (the
   held fold's games included) — mirroring the college implementation. It is an
   11-cell league constant, so the fold leakage through it is negligible next
   to the booster leakage being measured.
2. The frozen scale comes from full-train booster predictions — the deployment
   construction; it is identical on both sides of the comparison, so the
   before/after delta isolates booster in-sample-ness.
3. The shipped artifact still carries in-sample 2023-24 stuff grades by design
   (production fits on 2023-24); `oof_v2.json` is the out-of-fold alternative,
   and this section quantifies what the difference is worth: ±.001 on YoY.
4. Stuff leg only. Pitching+ (rv) train-season grades remain in-sample; the rv
   leg was not re-gated and nothing in the export changes for it beyond §10.

Reproduce: `python pipeline/stuff_v2.py --oof` (~20 min warm: 6 full fits +
24 fold fits; the v2 leg retrains deterministically — no booster cache),
`python pipeline/bakeoff.py export --target csw_norm` (~5 min warm).

## 17. Stuff+ memorizes pitchers, and a cross-fitted v2 fixes it, 2026-10-25

`pipeline/memorization_check.py`, `pipeline/crossfit_v2.py` → `results/memorization_check.json`,
`results/crossfit_v2.json`, `results/crossfit_v2_grades.csv`.

**Finding.** v2 per-pitch fit (r of prediction vs csw): .29 on its 2023–24 training
seasons, .07 on 2025–26. Pitcher-grouped holdout inside 2023–24 (train on half the
pitchers by crc32(pitcher)): **seen pitchers .377/.380, unseen pitchers .055/.060**,
equal to the 2025–26 level. The boosters recognize pitchers (release point and the
pitcher-relative velo/ivb/hb diffs fingerprint them) and replay their own CSW.
Game-fold OOF (§13) cannot see this: every pitcher sits in every fold. This is the
pitcher-identity failure Resnick describes (Pitcher Greeks, aidanresnick.com,
2026-08-28; kb `sources/web/aidanresnick-com-189ea41696.md`).

**Fix.** 4 pitcher folds; each fold's pitches, in every season, are predicted by
boosters trained on the other folds' 2023–24 pitches. Same frozen scale, grading
and gates (stuff_v2's own, through a lookup booster).

| | Standard v2 | Cross-fitted v2 | Naive CSW% |
|---|---|---|---|
| Per-pitch fit 2023 / 24 / 25 / 26 | .293 / .294 / .070 / .068 | .061 / .061 / .058 / .061 | |
| YoY 23→24 / 24→25 / 25→26 | .744 / .784 / .785 | **.789 / .825 / .824** | |
| r next CSW% 23→24 / 24→25 / 25→26 | .266 / .307 / .257 | .112 / .204 / .233 | .240 / .241 / .365 |
| Location leak | .265 | .233 | |

**Verdict.** The standard v2's wins over naive were mostly memorization of *training-season*
grades: a 2023 or 2024 grade replays that season's own CSW% (24→25: .307 → .204). Out of time
the leak is small: 2025–26 per-pitch r .057 all vs .053 unseen pitchers; 25→26 .257 → .233.
The college check (2026-10-26, `vt_baseball/research/stuff-model/RESULTS.md`) shows the same
pattern, and there the "beats naive" claims survive cross-fitting. Honest Stuff+ v2 is *stickier* and *loses to naive on next-season
CSW% in every pair*. Affected claims: the §8/§13 gate numbers, `naive_tests.json`
("Stuff+ wins K% alone"; re-run against cross-fit grades in §19, where it loses K%
to naive in every pair), §9/§15 (re-run in §18), and the export (`data/export` ships
the standard v2). **Recommendation: ship cross-fitted grades; make pitcher-grouped
holdout a standing gate.** The college harness should be checked for the same leak.

## 18. Small-sample test, cross-fitted (honest), 2026-10-25

`python tests_small_sample.py --aaa --crossfit` (v1 spec, 4 pitcher folds) →
`results/small_sample_aaa_crossfit.json`.

| N | 2025 grade / naive r | 2025 CV R² naive / both | 2026 grade / naive r | 2026 CV R² naive / both |
|---|---|---|---|---|
| 25 | **.230** / .182 | .021 / .062 | **.266** / .184 | .027 / .086 |
| 50 | .259 / **.287** | .077 / .120 | **.284** / .242 | .053 / .109 |
| 100 | .245 / **.362** | .125 / .150 | .279 / **.334** | .109 / .153 |
| 200 | .259 / **.455** | .203 / .220 | .315 / **.357** | .123 / .179 |
| 400 | .238 / **.507** | .251 / .256 | .321 / **.423** | .170 / .213 |

**Verdict.** The product claim shrinks but survives. Alone, Stuff+ beats observed CSW%
only through ~25 pitches (50 in 2026), not 50–100. Blended, it adds forecast value at
every N in both seasons. Debut pitchers (never in training anyway) now match or beat
the pooled rows; demoted pitchers stay inconsistent (2025 grade ≥ naive at most N,
2026 near zero).

## 19. Head-to-head vs TJStuff+, 2026-10-25

`pipeline/benchmark_tjstuff.py` → `results/benchmark_tjstuff.json`. TJStuff+ scored per
pitch from its LightGBM dump (`vt_baseball/tjstuff_lgbm_model.json`). The reconstruction
matches the published 2026 values at r .966 (n 2,018 pitcher × pitch types, published ≈
1.8 + 0.99 × ours). Benchmark only; never shipped. Same pitchers, ≥50 taken pitches in both
seasons, n 544–552.

| Pair | YoY: ours CF / TJ | r next CSW%: ours CF / TJ / naive | r next K%: ours CF / TJ / naive |
|---|---|---|---|
| 23→24 | .811 / **.846** | **.202** / .196 / .380 | .324 / .376 / **.426** |
| 24→25 | .826 / **.865** | **.199** / .169 / .399 | .307 / .327 / **.385** |
| 25→26 | .826 / **.869** | **.224** / .199 / .412 | .408 / .371 / **.420** |

(Standard, memorizing v2: CSW .373/.322/.270, K .429/.397/.432: inflated, see §17.)

**Verdict.** Honest Stuff+ beats TJStuff+ on next-season CSW% in all three pairs, and
on K% only in 25→26. TJStuff+ is stickier. Neither beats naive persistence on either
outcome. TJStuff+'s training window is unknown; any overlap with 2023–26 favors it.

## 20. Seam-wake axis deviation, verdict under the honest harness, 2026-10-25

Pre-registered rule (COLLABORATION.md). Under standard v2 (`ssw_test.py`) it PASSED,
but that harness memorizes pitchers (§17), and axis_dev is itself a stable per-pitcher
trait. Re-run cross-fitted (`crossfit_v2.py --axis` → `results/crossfit_v2_axis.json`):
fit 2025 .058→.061, 2026 .061→.062; r next CSW% 24→25 .204→.208, 25→26 .233→.241;
leak .233→.231; **YoY drops .012 / .013 / .016 (rule allows ≤.01)**. **REJECTED.**
The pitch-level signal is real but small, and it costs stability. A pitcher-level
version (season mean deviation per pitch type) is the follow-up, if anyone wants it.

## 21. Probe: swing disruption from bat tracking (program item 4, first slice), 2026-10-26

`pipeline/probe_bat_tracking.py` → `results/probe_bat_tracking.json`. Tracked swings
2024–26. Each metric is taken relative to the batter's season mean (batter quality
cancels), then averaged per pitcher-season (≥100 tracked swings). Increment = 5-fold CV R²
over naive + cross-fit Stuff+, without / with a pitch-mix control (FB and CH share).

| Metric | Split-half | YoY 24→25 / 25→26 | ΔR² next CSW% 24→25 / 25→26 (mix-controlled) | ΔR² next K% |
|---|---|---|---|---|
| Contact depth (d_intercept_y) | .890 | .800 / .857 | −.004 / +.001 | ≤ 0 |
| Timing disruption (abs_intercept) | .725 | .720 / .774 | **+.006 / +.009** | ≤ 0 |
| Swing length vs norm | .850 | .779 / .820 | −.005 / −.003 | ≤ +.003 |
| Bat speed vs norm | .518 | .530 / .614 | −.001 / +.011 | ≤ 0 |

Baseline (honest): naive + cross-fit Stuff+ beats naive alone at the season level: K% CV R²
.300 → .333 (24→25), .291 → .379 (25→26); CSW% .239 → .252, .265 → .293.

**Read:** bat tracking measures stable pitcher traits, but the contact-depth signal is pitch
mix (the same trap the college deception study fell into). Timing disruption survives the mix
control on CSW% in both pairs, small (+.006/+.009) and with no K% gain. It is a candidate link
for the decomposed outcome model, not a standalone grade. Next test: pitch-level, cross-fitted
(does a per-pitch timing-disruption model add to csw_norm?).

## 22. Decision-point features (program item 3): not buildable from public data, 2026-10-26

Statcast publishes a constant-acceleration fit (the nine parameters). Under constant
acceleration, the deviation from straight-line flight over any final window τ is ½·a·τ²:
a fixed multiple of the same acceleration that `pfx` (movement) already encodes, given velo
and release. "Late break" or "post-commit movement" computed from the nine parameters is
therefore a reparametrization of features the model already has, and adds no information.
Real late-break needs the raw Hawk-Eye ball track (team-only), which goes to the owner's pro
tracking-data project. Item 3 is closed for public data without a run.

## 23. Revealed preference: do teams trust high-Stuff+ relievers? (program item 6), 2026-10-26

`pipeline/probe_revealed_leverage.py` → `results/probe_revealed_leverage.json`. Empirical
leverage index: the mean |win-probability swing| of a PA by its start state (inning, half,
outs, bases, score diff ±4), scaled so the league mean is 1. gmLI = LI of a reliever's first
PA per appearance (manager trust). Relievers: <30 pitches per appearance, ≥15 appearances,
both seasons. A first proxy, closeness = 1 − |2·WE − 1|, failed (closers enter with leads;
base R² ≤ .08) and is replaced.

| Pair | n | r(Stuff+ N, gmLI N+1) | CV R² base (gmLI, K%, RV/100 in N) | + cross-fit Stuff+ | Δ |
|---|---|---|---|---|---|
| 23→24 | 184 | .294 | .242 | .271 | **+.029** |
| 24→25 | 183 | .264 | .230 | .254 | **+.024** |
| 25→26 | 198 | .263 | .203 | .205 | +.002 |

**Read:** teams hand more leverage to relievers our grade likes, beyond what their leverage
and results already explain, in 2 of 3 pairs. That is an outside referee our model never saw.
It shows the grade carries information that front offices act on, not that they are right
(a shared velocity bias would look the same). n ≈ 190 per pair; descriptive.

## 24. Measured arm angle (Hawk-Eye pose), cross-fitted, 2026-10-26

`crossfit_v2.py --feature-set arm|arm_swap` → `results/crossfit_v2_arm*.json`; paired pitcher
bootstrap `paired_bootstrap.py` → `results/bootstrap_crossfit_v2_arm.json` (2000 draws).
Δ vs cross-fitted v2:

| | Fit 2025 / 26 | r next CSW% 23→24 / 24→25 / 25→26 | YoY | Leak |
|---|---|---|---|---|
| v2 + arm_angle | +.0025 / +.0017 | +.011 / +.014 / +.032 | −.000 / −.008 / −.007 | +.00005 |
| arm_angle replaces rel_h/rel_s | −.006 / −.007 | +.007 / +.024 / +.022 | −.011 / −.009 / +.007 | **−.026** |

Bootstrap, v2 + arm_angle, Δr with next season: CSW% 23→24 +.007 [−.011, +.025], **24→25 +.018
[+.001, +.035], 25→26 +.022 [+.004, +.039]**; K% +.002 / +.002 / +.009, all CIs span 0.

**Verdict.** v2 + arm_angle passes every substantive clause of the pre-registered rule. It fails
the zero-tolerance leak clause by 0.00005 (numerical noise; that clause should have carried a
tolerance, and future rules will). The CSW% gain is positive in all three pairs and significant
in the two out-of-time pairs. Recommendation: **adopt arm_angle in the next Stuff+ version**
(stuff_v2.py is kb-session's: proposal in the ledger). The college "arm angle adds nothing"
null was data-limited (a proxy angle); measured angle adds. The swap variant fails (fit drops)
but cuts the location leak by .026: release point is carrying some location, worth a
follow-up.

## 25. Empirical-Bayes blend (program item 5): REJECTED, 2026-10-26

`blend_eb.py` on `results/small_sample_rows.csv` (`tests_small_sample.py --aaa --crossfit
--dump`). Fitted on 2024: prior CSW% = 23.98 + 0.101 × Stuff+, k = 394 taken pitches.

| | N=25 | 50 | 100 | 200 | 400 |
|---|---|---|---|---|---|
| 2025 EB / per-N OLS / naive | .056 / .062 / .021 | .114 / .120 / .077 | .133 / .150 / .125 | .205 / .220 / .203 | .251 / .256 / .251 |
| 2026 EB / per-N OLS / naive | −.025 / .086 / .027 | .023 / .109 / .053 | .093 / .153 / .109 | .142 / .179 / .123 | .208 / .213 / .170 |

**Verdict: REJECTED** (misses by more than .01 at 6 of 10 cells). Two causes, both lessons:
(1) the prior's level was fitted on 2024 and the 2026 ABS zone moved league CSW%; the frozen
rule pays for that bias most where it leans hardest on the prior (small N). (2) The bar was
unfair: the per-N OLS is cross-validated *inside* the test season, so it re-learns that season's
level, which a live product cannot. Next attempt (new pre-registration, needs 2027 to confirm):
re-center the prior on the season's league CSW% to date, which is known live.

## 26. Results above stuff: a persistent skill, 2026-10-26

`pipeline/residual_persistence.py` → `results/residual_persistence.json` (Sonnet sub-agent,
reviewed). Residual = season CSW% − OLS(CSW% ~ cross-fit Stuff+), fitted within season (the
2026 zone change can't leak); pitchers with ≥300 taken pitches; 2,114 pitcher-seasons.
Stuff+ explains r ≈ .28–.30 of CSW%; residual SD 2.6–2.9 CSW points.

| | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|
| Split-half r (odd/even games) | .51 | .41 | .46 | .43 |
| Full-season reliability (Spearman-Brown) | .67 | .59 | .63 | .60 |

| Pair | YoY r [95% CI] | Persistence slope | Pitch-mix-adjusted YoY |
|---|---|---|---|
| 23→24 | .498 [.42, .57] | .48 [.39, .57] | .487 |
| 24→25 | .501 [.42, .58] | .52 [.42, .63] | .471 |
| 25→26 | .528 [.44, .60] | .51 [.41, .60] | .434 |

What travels with it (pooled, n = 1,075, habits z-scored within season): correlates of the
residual are chase rate +.39, FB share −.34, first-pitch strike% +.28. CV R² of next-season
residual: habits alone .12, residual alone .258, both .277.

**Read.** About half of a pitcher's CSW% above or below his stuff carries into next season, and
it survives a pitch-mix control. This is why naive persistence beats Stuff+ on CSW% (§17): last
season's CSW% carries this second, sticky component, and Stuff+ by design does not. Two parts
are mixed in it and cannot be separated here: non-stuff skill (getting chases, getting ahead)
and stuff the model misses. Either way, the forecast should be Stuff+ plus about half the prior
residual, which is the structure the blend results (§11, §18) were finding. For a coach: a
pitcher who beats his stuff mostly keeps beating it; the chase and get-ahead habits explain a
slice, and most of it is unexplained, which is the open question for program item 7 (command).

## 27. AAA → MLB: does Stuff+ judge prospects better than AAA results? 2026-10-26

`pipeline/aaa_translation.py` → `results/aaa_translation.json`, `results/aaa_translation_rows.csv`.
AAA pitches 2023–25 graded by the shipping cross-fitted v2 (export fold models), with §14
adjustments (AAA ext +0.10 ft, rel_h −0.06 ft; the five high-altitude parks dropped). AAA 2026
is excluded (its plate convention is unaudited). Pitchers with ≥300 AAA taken pitches in S;
outcome = MLB CSW% / K% per taken pitch in S+1 (≥100 taken).

| Population, outcome | n | r AAA Stuff+ | r AAA result | CV R² result / Stuff+ / both |
|---|---|---|---|---|
| Prospects (no MLB pitch in S), K% | 169 | **.26** | .18 | .010 / .025 / .035 |
| Prospects, CSW% | 169 | .23 | .24 | .041 / .045 / .071 |
| All AAA arms, K% | 602 | **.26** | .22 | .034 / .052 / .073 |
| All AAA arms, CSW% | 602 | .15 | **.24** | .047 / .012 / .056 |

**Read.** For true prospects, AAA Stuff+ predicts next-season MLB strikeout rate better than
their AAA strikeout rate does, and matches AAA CSW% on CSW%. The combination is best in every row.
This is the opposite of the MLB-to-MLB result (§17, where naive wins). It makes sense: the
AAA-to-MLB jump breaks results (new competition, new park, new zone) more than it breaks pitch
shape. n = 169 is directional (CI about ±.15 on r). It is a candidate for the product's prospect
page, and should be re-tested with 2026 AAA once its plate convention is audited.

## 28. What goes into Stuff+, what each input is worth, and what can come out (2026-10-26)

`pipeline/feature_importance.py` → `results/feature_importance.json`, `feature_importance_by_pitch_type.csv`;
ablations `crossfit_v2.py --feature-set ±f` → `results/crossfit_v2_<set>.json`; paired pitcher bootstrap
vs a fresh cross-fit baseline (`crossfit_v2_base`). Pre-registered in the ledger before running.

**Inputs (v2, 13 features; one LightGBM per class FB/BB/CH × batter side; target csw_norm):**
velo, ivb, hb, spin, ext, rel_h, rel_s (raw measurements); velo_diff, ivb_diff, hb_diff (vs the
pitcher-season fastball anchor: p95 velo, mean movement within 2.5 mph); hvaa (VAA residualized on
plate_z per class, TRAIN-fitted); spin_eff (trajectory-derived active spin); velo_x_ivb. Monotone:
velo +, ext + everywhere; spin_eff + FB / − BB; velo_x_ivb + FB. Params: 800 trees, lr .03,
63 leaves, min_child 100, row/col subsample .8.

**Importance (fold 0 held out; unseen = pitchers the model never saw).** Gain misleads: `spin` and
`rel_s` hold ~10% of gain each but are worth .002/.004 of per-pitch r on unseen pitchers. They are
pitcher fingerprints (87% / 99% of variance between pitcher-seasons). Real signal on unseen pitchers:
hvaa .053, rel_h .030, ivb .029, velo / velo_diff / ivb_diff / hb ~.010 each.

**What drives the grade, by Statcast pitch type** (permutation loss of unseen per-pitch r):

| Type | Drivers |
|---|---|
| FF | hvaa .113, rel_h .076, ivb .036, velo_x_ivb .014 |
| SI | ivb .034, hvaa .025, rel_h .021, hb .015 |
| FC | ivb .051, hvaa .048, ivb_diff .023 |
| SL | velo .027, velo_diff .026, spin_eff .014 (gyro) |
| ST | velo .029, little else |
| CU | velo .023, hvaa .016 |
| CH | hvaa .019, velo_diff .018 |

FS too thin in the sample. Noise is about ±.005.

**Ablations (cross-fit; Δ vs baseline; bootstrap 95% CI on next-season r):**

| Change | Fit 25 / 26 | YoY Δ (3 pairs) | Leak Δ | Next-season r (bootstrap) | Verdict (pre-reg) |
|---|---|---|---|---|---|
| − release (ext, rel_h, rel_s) | −.010 / −.010 | −.03 | −.028 | K% −.020/−.044*/−.022 | keep |
| − fastball-relative diffs | −.009 / −.007 | to −.047 | −.012 | K% −.029/−.002/−.036* | keep |
| − hvaa | −.013 / −.014 | ±.02 | −.033 | ~0 | keep (largest fit loss) |
| − ext alone | .000 / −.001 | −.03 | −.007 | K% −.017/−.027/−.048* | keep |
| − spin_eff, velo_x_ivb | +.001 / .000 | ~0 | +.003 | CSW ~0; K% −.010/−.001/−.005 | removable by rule; K% leans keep |
| **− spin (raw rpm)** | +.001 / .000 | ~0 | −.001 | **CSW −.005/+.007/+.011; K% −.001/+.014/+.013** | **removable** |
| + a_drag | +.002 / +.001 | −.024/−.027/−.020 | +.010 | K% −.014* on 24→25 | **rejected** |
| minimal set (7 features) | −.010 / −.011 | to −.032 | −.030 | ~0 | not better |

\* CI excludes zero.

**Read.**
1. **Raw spin rate does nothing once the model can't memorize pitchers.** Removing it costs no fit and
   nudges next-season K% up in two of three pairs. Spin's job is already done by movement (ivb/hb) plus
   spin_eff. **Proposal to kb-session: drop `spin` in v3** (with arm_angle, §24).
2. **Extension is the quiet driver of season-level prediction.** It is near-zero per pitch but the
   largest K% loss when removed (2025→26 CI excludes zero). It is a perceived-velocity effect that
   accrues over many pitches.
3. **hvaa is the single most valuable input per pitch**, mostly through fastballs. **Correction (§29): much of
   that value is plate height.** With rel_h, ivb, velo and ext beside it, hvaa recovers FB plate_z at R² .86.
4. **Drag fails.** Small fit gain bought with stability and leak. MECHANISM-MLB.md's "low priority" stands.
5. The release-point leak/fit trade is real (−.028 leak for −.010 fit); arm_angle (§24) is the better route.

## 29. Pitch-type cells, physics candidates, and a location channel in hvaa (2026-10-26)

Same cross-fit harness and paired bootstrap as §28; pre-registered in the ledger.

| Change | Fit 25 / 26 | YoY (3 pairs) | Leak (plate_z) | Next-season r vs base (bootstrap) | Verdict |
|---|---|---|---|---|---|
| base | .058 / .061 | .789 / .825 / .824 | .233 | n/a | n/a |
| cells by Statcast type (FF, SI, FC, SL, ST, CU, CH, FS) | .050 / .050 | .794 / .819 / .829 | .157 | CSW −.027 / −.044* / −.039*; K −.013 / −.027 / −.032 | **rejected** |
| + nm_ivb, nm_hb (non-Magnus break, in) | .066 / .067 | .782 / .807 / .812 | .234 | CSW +.007 / +.001 / +.006; K ~0 | **rejected** (YoY −.018, −.012 > .01) |
| + hhaa (HAA resid. on plate_x) | .137 / .139 | .776 / .808 / .780 | .167 | CSW +.020 / +.015 / +.019; K ~0 | **rejected: location leak** |

\* CI excludes zero.

**Pitch-type cells lose.** A type cell only compares a sweeper with sweepers. The class model knows a
sweeper's shape is worth more than a gyro slider's, and type cells throw that away. Grades *by* pitch
type should be read off the class model (per-type averages, §28 driver table), not trained separately.
This bears on the topo Level-2 key (ledger request to kb-session): test it as a display layer or as a
feature inside class cells, not as cells.

**Non-Magnus movement is real per-pitch signal, but not a season grade.** It adds +.008 / +.006
per-pitch fit, the largest honest gain of any candidate, with no location channel (it is built from the
accelerations, not the plate). But it costs stickiness beyond the rule and leaves next-season r flat.
Keep it for pitch-level work (pitch design, seam-shifted-wake reports), not for Stuff+. It matches
§20's axis-angle result, now in movement units.

**hhaa doubled the fit by reconstructing plate_x.** With rel_s and hb beside it, HAA residualized on
plate_x recovers plate_x at R² .91 (FB), .999 (BB), .99 (CH). (The residualization pools both throwing
hands, and HAA is geometry: release side, horizontal break and plate side.) **The leak gate checks
plate_z only, so it could not see this.** Proposal: the gate adds |r(pred, plate_x_arm)|.

**The same geometry applies to hvaa, which ships.** Linear R² of plate_z from rel_h, ivb, velo, ext is
.07 (FB); adding hvaa makes it **.86** (BB .35, CH .05). Residualizing VAA on plate_z cannot remove
height while the other terms of the trajectory sit next to it. Dropping hvaa (§28) costs per-pitch fit
(−.013) and leak falls .233 → .200, but next-season r is unchanged (CSW +.006 / +.007 / −.004,
K −.021 / −.001 / −.009, all CIs cross 0). So hvaa's per-pitch value is mostly "this fastball was up",
while its season value is about nil. A location-free flat-VAA is a function of rel_h, ivb, velo and ext,
which the model already has. **Question for kb-session/owner: v3 without hvaa** (Stuff+ that does
not know where the pitch went; the §11 location check compared v2 with v1, not with zero).

Candidate v3 for one pre-registered run: v2 − spin − hvaa + arm_angle, judged on the cross-fit gates
plus a plate_x leak gate.

## 30. Model structure: tuning, targets, an additive model, and a decomposed outcome model (2026-10-26)

Owner approved all four; rules pre-registered in the ledger. Same cross-fit harness, same 13 inputs
unless noted. Every row is compared with `crossfit_v2_base` by paired pitcher bootstrap (2000 draws)
on next-season CSW%, K% and RV/100 (`paired_bootstrap.py` now reports RV/100). Leak gate now also
reports |r(pred, plate_x_arm)|. Baseline (re-run, identical grades): fit .058 / .061, YoY .79 / .82 / .82, leak z / x .233 / .134.

| Run | Fit 25 / 26 | YoY | Leak z / x | Next K% Δr | Next RV/100 Δr | Next CSW% Δr | Verdict |
|---|---|---|---|---|---|---|---|
| Tuned (15 leaves, min 1000, 71 trees) | .064 / .067 | .72 / .74 / .73 | .346 / .186 | +.018 / +.002 / −.016 | −.015 / +.042 / −.016 | +.021 / +.017 / +.022 | fails (YoY, leak) |
| Target: whiff per swing | .005 / .013 | .82 / .86 / .80 | .161 / .125 | **+.070\* / +.092\* / +.044** | −.017 / **+.087\*** / −.005 | −.038 / −.038 / −.082\* | fails rule (CSW) |
| Target: swinging strikes / count avg | .014 / .017 | .81 / .86 / .81 | .139 / .116 | +.059 / +.072\* / +.028 | −.029 / +.067 / −.019 | −.033 / −.054 / −.083\* | fails rule (CSW) |
| Target: raw run value | .018 / .020 | .84 / .87 / .87 | .014 / .046 | −.047 / −.029 / −.073\* | −.055\* / −.024 / −.059\* | −.061\* / −.072\* / −.081\* | fails |
| Target: run value − count/location model | .013 / .015 | .83 / .85 / .86 | .014 / .027 | −.029 / −.007 / −.044 | −.023 / +.009 / −.041 | −.048 / −.043 / −.083\* | fails |
| Additive (boosted stumps, depth 1) | .058 / .064 | .82 / .84 / .82 | .341 / .177 | −.001 / −.027 / −.016 | +.008 / +.030 / .000 | +.013 / +.010 / +.010 | ties (descriptive) |
| Decomposed v0: Stuff | n/a | .68 / .64 / .63 | .006 / .014 | −.029 / −.022 / −.072\* | −.030 / +.039 / −.054 | −.046 / −.021 / −.080\* | fails |
| Decomposed v1: Stuff | n/a | **.83 / .86 / .87** | .121 / .014 | −.070\* / +.028 / −.115\* | −.009 / +.089\* / −.061 | −.098\* / +.015 / −.093\* | fails |
| Decomposed v1: Pitching | n/a | .64 / .59 / .60 | .026 / .010 | −.037 / −.004 / −.109\* | +.016 / **+.133\*** / +.008 | −.002 / +.047 / −.071 | n/a (vs Stuff+) |

\* 95% bootstrap interval excludes zero. Fit for targets other than csw_norm is r with CSW, so it is
not comparable across rows; decomposed fit is in `stuff_decomp.json`. Grades of a model that predicts a
different outcome naturally lose on the baseline's own target, which the rule did not allow for.

**1. Tuning on per-pitch fit is the wrong objective.** The tuned trees fit unseen pitches better and
lose stability (−.07 to −.10) while the plate-height leak jumps .233 → .346. A smaller model leans on
the cheapest strong signal, which is location (via hvaa). Settings must be chosen on next-season
pitcher outcomes on held-out pitchers.

**2. The target is the biggest lever.** Whiff per swing is the best K% target of anything tested
(significant 2 of 3 pairs), the only one with a significant RV/100 gain, and it carries less location.
It loses CSW% because CSW is half called strikes, and called strikes are location. By the rule,
nothing replaces csw_norm. The read: **Stuff+ should be a swing-side model, and called strikes belong
to Location+.** That split needs its own pre-registration (next).

**3. Raw run value as a target is very sticky and predicts worst.** Base-out state, defense and luck
make it mostly noise per pitch; removing count + location helps a little.

**4. The algorithm is not the bottleneck.** A purely additive model (no interactions beyond the one
engineered velo × ivb) ties LightGBM on all nine comparisons and is slightly stickier.

**5. The decomposed design works mechanically and gives the stickiest Stuff+ we have (.83–.87).**
v0 lost stability because one random count/location draw per pitch added noise as large as the
between-pitcher spread; v1's 24 shared contexts and xwOBA-based contact value fixed that. It still
predicts K% and CSW% worse: it optimizes run value, including contact quality. Its Pitching+ has the
best RV/100 gain recorded (+.133, 24→25). The 2025→26 pair is worst for every run-value model; the
2026 zone change is the likely cause and is untested.

**6. The leak gate has a floor.** Decomposed Stuff never sees location, yet r(pred, plate_z) is .121.
That is shape–location coupling (pitchers with ride throw up), not leakage, so roughly half of the
baseline's .233 is true leakage. v0's .006 was diluted by its own noise.

**Next (pre-register before running):** a swing-side Stuff+ (decomposed, swing branch only: whiff,
foul, contact value) + called-strike Location+, judged on K% and RV/100 with CSW% reported; tuning
scored on next-season pitcher r; double ML.

## 31. Swing-side Stuff+ from the decomposed models (2026-10-26)

`stuff_decomp.py` grade `e_swing`: value given a swing (whiff, foul, contact branches of the v1
models), averaged over the same 24 league contexts as §30's Stuff. Called strikes are left to
Location+. Pre-registered (ledger) vs `crossfit_v2_base`.

| | YoY | Leak z / x | Next K% Δr | Next RV/100 Δr | Next CSW% Δr |
|---|---|---|---|---|---|
| Swing-side Stuff | .81 / .81 / .82 | .126 / .151 | −.014 / +.024 / −.075\* | −.023 / +.093 / −.055 | −.029 / +.027 / −.020 |

**FAILED** (K% not ≥ 0 in 2 of 3, one CI-negative; horizontal leak above .134). The swing branch mixes
whiffs with foul and contact value, which dilutes the strikeout signal that made §30's whiff-per-swing
target win. The decomposed sub-models also lack hvaa and were not tuned. The §30 v1 Stuff and Pitching
grades re-ran identically (deterministic).

## 32. Double machine learning Stuff+ (2026-10-26)

`crossfit_v2.py --target csw_dml`: per class, LightGBM nuisance models on context only (plate_x_arm,
plate_z, balls, strikes, batter side, throwing hand), TRAIN-fitted, partial location and count out of
csw_norm AND each of the 13 inputs; the cross-fit v2 is then fit residual on residual (monotone
directions kept). Pre-registered vs `crossfit_v2_base`.

| | Fit 25 / 26 | YoY | Leak z / x | Next K% Δr | Next RV/100 Δr | Next CSW% Δr |
|---|---|---|---|---|---|---|
| base | .058 / .061 | .79 / .83 / .82 | .233 / .134 | n/a | n/a | n/a |
| double ML | .038 / .039 | .82 / .84 / .84 | **.010 / .037** | −.035 / −.035 / −.036 | −.024 / −.014 / −.030 | −.013 / +.025 / −.042 |

**FAILED** (K% below zero in all three pairs, though no single interval excludes zero). What it shows:
location can be removed completely (leaks .010 / .037, below the .12 shape-coupling floor of §30,
because residualized inputs also lose the "pitchers with ride throw up" coupling) while stability
rises. The price is about .035 of next-season K% r in every pair: that is what location knowledge,
leaked or coupled, was worth to the baseline. The current csw_norm v2 sits at one end of a
purity-vs-prediction frontier, double ML at the other.

Next (pre-registered in the ledger): whiff-per-swing target + double ML, §30's best K% target with
location fully removed.

## 34. Whiff-per-swing Stuff+ with double ML: the first structure change to pass (2026-10-26)

`crossfit_v2.py --target wps_dml`: the target is whiff on swings (§30's best K% target) and both the
target and all 13 inputs have location + count partialled out (§32). Pre-registered vs
`crossfit_v2_base`: K% and RV/100 Δr ≥ 0 in ≥ 2 of 3 pairs with none CI-negative, YoY drop ≤ .02,
leak z ≤ .15, x ≤ .134; CSW% reported, not gated.

| | Fit 25 / 26 | YoY | Leak z / x | Next K% Δr | Next RV/100 Δr | Next CSW% Δr |
|---|---|---|---|---|---|---|
| base (csw_norm v2) | .058 / .061 | .79 / .83 / .82 | .233 / .134 | n/a | n/a | n/a |
| whiff/swing + DML | .029 / .033 | **.84 / .87 / .85** | **.020 / .051** | +.012 / +.053 / +.027 | +.001 / **+.070\*** / +.004 | −.042 / −.018 / −.045 |

**PASSED on every clause.** It is stickier than any honest Stuff+ so far, carries almost no location,
and predicts next-season strikeouts and run value at least as well as the shipped model in every
pair (RV/100 significantly in 2024→25). It gives up CSW%, by design: called strikes are a location
outcome and belong to Location+. Per-pitch fit is lower because it is scored against CSW.

Why the combination works when neither half did: whiff per swing (§30) brought the K% signal but kept
location; double ML (§32) removed location but its CSW target then lost the called-strike signal it
had been leaning on. A swing-only target has little location to lose, so removing it costs nothing.

**Proposal to kb-session / owner:** v3 Stuff+ = this design, with Location+ built on called strikes
(and command) so Stuff+ + Location+ covers what CSW covered. Feature engineering (§33) now runs on
this baseline. Not shipped: stuff_v2.py and the export are kb-session's and the owner's call.

## 33. Feature engineering on the §34 model: nothing to add (2026-10-26)

Every run used `--target wps_dml` (inputs residualized after the edit), with a paired bootstrap against
`crossfit_v2_wps_dml`. Rules were pre-registered in the ledger and amended to this baseline before any
result was read. Δr is change in correlation with next-season K% / RV/100 (pairs 23→24 / 24→25 / 25→26);
\* means the CI excludes 0.

| Variant | YoY | Leak z / x | K% Δr | RV/100 Δr | Verdict |
|---|---|---|---|---|---|
| base §34 | .84 / .87 / .85 | .020 / .051 | | | |
| + perceived velo (60.5 ft / flight time) | .83 / .85 / .83 | .020 / .049 | −.005 / −.013 / −.009 | −.011 / −.003 / −.017\* | fail (YoY −.016, K down) |
| + plate speed | .83 / .86 / .83 | .022 / .049 | −.001 / −.006 / .000 | −.003 / +.005 / −.008 | fail (K 24→25 −.006, YoY −.016) |
| usage-anchored diffs (vs most-thrown FB) | .82 / .86 / .83 | .022 / .041 | −.001 / −.016 / −.017 | −.004 / −.007 / −.010 | fail (K down 3/3) |
| v3 set (−spin −hvaa +arm angle) | **.85 / .87 / .85** | .035 / .052 | −.012 / −.003 / −.019 | +.001 / +.005 / −.010 | fail (K down 3/3, leak z +.015) |
| v3 set + all of the above | .82 / .85 / .81 | .033 / .046 | −.033 / −.038 / −.039\* | −.025 / −.009 / −.027 | fail |

Reading: velocity is already fully expressed by `velo` + `ext`; perceived velocity and plate speed are
near-linear re-expressions of them (raw acceleration was shown to be redundant in §29), so they only add
variance. The usage anchor is noisier than the class-primary anchor. Dropping spin + hvaa for arm angle
is the one change that holds stability, but it costs K% and lets more pitch height back in. **§34 ships as
specified.** Further gains need new information (arsenal/tunneling at pitcher level, or the topo key), not
new transforms of the same 13 measurements.

## 35. Arsenal and tunneling on top of v3: fails (2026-10-26)

`pipeline/arsenal.py`. Seven pitcher-season features from shape and release only:
- tunnel separation at 0.167 s before the plate, with each pitch re-aimed at the primary FB's plate spot and release held fixed;
- tunnel ratio;
- release spread;
- velo gap;
- number of types;
- usage entropy;
- shape diversity.

The trajectory math checks out: back-propagated release lands within 0.003 ft of Statcast's (median). Every feature is sticky, with YoY .62–.75.

The test fits a ridge on the v3 grade, with and without the features, on same-season K% (or RV/100). It is cross-fit by pitcher fold and judged on next-season outcomes with a paired bootstrap against v3 alone.

| Target | Next K% Δr | Next RV/100 Δr | Verdict |
|---|---|---|---|
| K% model | +.014 / −.001 / +.026 | | fail: no CI-positive pair |
| K% model + role (pitches/game) | +.015 / −.003 / +.026 | | fail |
| RV/100 model | | +.004 / +.034 / **−.054\*** | fail: CI-negative |
| RV/100 model + role | | +.008 / +.029 / **−.071\*** | fail |

**Fails the pre-registered rule.** The tunnel terms get almost no weight (standardized coefficients ≤ .07, mostly the wrong sign). Disguise at the decision point, measured from average trajectories, adds nothing that v3's pitch-vs-primary differences don't already carry.

The only consistent arsenal signal is shape diversity (+) against usage entropy (−): distinct pitches, thrown with a clear primary. It is not enough to clear the bar.

One side note, not gated: the K% arsenal model predicts next-season CSW% better (+.024 / +.027 / +.046\*). That fits Location+ owning called strikes, because a deep, distinct arsenal buys more takes in the zone. Logged as a lead for the Location+ v2 build.

Limit: these are average trajectories. Tunneling of actual consecutive pitches (sequence-level, BP-style pairs) is untested, and it would need a sequencing model, not a Stuff+ input.

## 36. Location+ v2 (called strikes): fails, and why that matters for v3 (2026-10-26)

`crossfit_v2.py --name loc_v2` with location-only inputs (plate_x_arm, plate_z, balls, strikes; class
x side cells; csw_norm target; pitcher cross-fit) and `pipeline/loc_gate.py`. Pre-registered in
`docs/v3-stuff-proposal.md`.

| | Result | Rule | |
|---|---|---|---|
| Per-pitch fit (CSW) | .35 | | location explains six times what shape does |
| Location+ YoY | .44 / .53 / .46 | ≥ .5 | fail |
| Location+ alone vs next CSW% | .144 / .058 / .047 (v2: .112 / .204 / .233) | | |
| Joint ridge (v3 + Location+) next CSW% Δr vs v2 | −.001 / −.040 / −.075 | ≥ −.01 every pair | **fail** |
| r(v3, Location+) | −.04 to −.11 | | the two are nearly orthogonal, as designed |

**Read:** location dominates which pitch gets a called strike or whiff, but a pitcher's average
location value barely repeats and barely predicts next season. Adding it to v3 does not rebuild the CSW%
signal that v2 had. So v2's extra CSW% came from the **shape x location interaction** (the right shape
in the right spot, e.g. a riding FB up), which neither a location-free Stuff+ nor an additive Location+
can hold. That is what a joint Pitching+ model is for, and it matches FanGraphs' design, where Pitching+
is its own model, not a blend of Stuff+ and Location+.

**Consequence for v3:** shipping v3 Stuff+ does not need a Location+ partner to be honest; it is the
better Stuff+ on K% and RV/100 (pending the §37 holdout). CSW%-style process belongs to Pitching+.

## 37. Untouched 2021–22 holdout: v3's predictive gain does not confirm (2026-10-26)

About 40 variants were chosen on the same three season pairs, so §34's pass carries selection luck.
2021–22 Statcast had never been read by any test. `GOAT_LO=2021` loads it, training stays 2023–24 with
pitcher-fold cross-fit, and 2021–22 pitches are scored out of fold only. The rule was pre-registered in
the ledger. As a reproducibility check, the 2023–26 numbers came out identical to §30/§34.

| Holdout pair | YoY v2 / v3 | Next K% Δr | Next RV/100 Δr | Next CSW% Δr |
|---|---|---|---|---|
| 2021→22 | .841 / **.872** | +.008 [−.055, +.065] | +.032 [−.020, +.084] | +.011 |
| 2022→23 | .820 / **.873** | −.019 [−.072, +.034] | −.029 [−.078, +.025] | −.046 |
| Two-pair mean | | **−.006** (rule ≥ 0) | +.002 | |

**Not confirmed.** No pair is CI-negative and stability holds, but the K% mean is below zero, so by the
pre-registered rule the §34 K% / RV gain counts as selection luck. What survives everywhere is that
v3 is *stickier* (+.03 to +.05 YoY in all five pairs) and *location-free* (leak .03 vs .24) at **equal**
predictive power. The v3 build request is on hold. A stickier, cleaner grade that predicts no better is
a legitimate product choice, but it is the owner's call, not a modeling result.

Lesson for every later claim: the 2021→22 and 2022→23 pairs are now the confirmation set. A variant
counts only if it passes on 2023–26 and then on 2021–23 untouched.

## 38. Per-pitch-type grades: distinct and sticky, but no better a forecast than the class grade (2026-10-26)

Owner ask: grade sliders against sliders and curveballs against curveballs, not one shared BB grade.
Today `web_export.py` gives every type in a class the class grade. `pipeline/type_grades.py` grades
each site type from its own out-of-fold predictions (v2 cross-fit, 2021–26) on a per-type 100 + 10z
scale (TRAIN 2023–24, pitcher x type ≥ 50 pitches). The yardstick is r with that type's
next-season whiff/swing (≥ 50 swings both seasons). Both rules were pre-registered in the ledger.

| Type | Pairs | YoY | Own pitches | Shrunk (k = 150) | Class grade |
|---|---|---|---|---|---|
| FF | 1607 | .87 | .332 | .348 | **.354** |
| SI | 885 | .90 | .230 | .257 | **.284** |
| CT | 450 | .80 | .329 | .384 | .384 |
| SL | 932 | .84 | .341 | .348 | **.352** |
| SW | 375 | .85 | .100 | .102 | .102 |
| CB | 503 | .87 | .400 | **.404** | .393 |
| CH | 709 | .85 | .288 | .290 | **.292** |
| FS | 154 | .85 | .232 | .233 | **.238** |

**Both rules fail.** Own pitches only: 1 of 8. Shrunk toward the class: 1 of 8, worst −.027 (SI).
The per-type grade is a real, sticky measure of each pitch, but pooling the whole class forecasts a
type's next-season whiff rate slightly better. That is consistent with arsenal effects: a
pitcher's slider whiffs depend partly on his other breaking balls. Two further points:
- Sweepers are barely forecastable by shape at all (r .10 by any grade).
- By-type *models* were already rejected (§29).

Showing per-type grades is therefore a display choice that costs at most .03 r. It is not a modeling gain.

## 39. Per-pitch program, items 1–4: all seven candidates fail (2026-10-26)

`GOAT_LO=2021`, so one run per candidate gives the selection pairs (2023–26) and the untouched
confirmation pairs (2021–23). Rules were pre-registered in the ledger. Δr is next-season K% / RV/100
vs the baseline (selection pairs 23→24, 24→25, 25→26); \* means the CI excludes 0. Change test =
r of predicted vs realized Δ whiff/swing for pitcher x type pairs across consecutive seasons (`change_test.py`).

| Candidate | vs | YoY (sel.) | Leak z / x | K% Δr | RV/100 Δr | Confirm 21–23 K / RV | Change-test FB / BB / CH r | Verdict |
|---|---|---|---|---|---|---|---|---|
| base v2 | | .79 / .83 / .82 | .237 / .136 | | | | .129 / .202 / .130 | |
| v3 (wps_dml) | | .84 / .87 / .85 | .028 / .051 | | | | **.196** / .157 / .117 | |
| C1a fixed effects (csw) | v2 | .83 / .84 / .83 | .111 / .039 | −.004 / −.020 / −.030 | −.014 / −.001 / +.028 | −.006 / −.022, +.005 / −.009 | .112 / .132 / .098 | fail (K ≥ 0 0/3; CSW −.048\*) |
| C1b fixed effects (wps_dml) | v3 | .78 / .80 / .77 | .039 / .044 | −.080\* / −.058\* / −.065\* | −.055\* / −.072\* / −.022 | −.066\* / −.028 | .139 / .094 / .070 | fail |
| C2a slot-relative movement | v2 | .77 / .79 / .80 | .185 / .127 | +.014 / −.009 / +.023 | −.018 / +.002 / −.017 | +.006 / +.016, −.018 / −.030 | .158 / .194 / .138 | fail (RV ≥ 0 1/3, YoY −.026, CSW −.055\*) |
| C2b acceleration for break | v2 | .78 / .81 / .80 | .152 / .098 | −.013 / +.003 / −.002 | +.002 / +.015 / −.013 | +.005 / +.019, +.001 / +.001 | .127 / .159 / .126 | fail (K ≥ 0 1/3), passes confirmation |
| C2c + direction vs arm angle | v2 | .79 / .82 / .82 | .238 / .134 | −.009 / −.002 / −.002 | −.007 / −.002 / −.007 | −.001 / +.004, +.007 / +.002 | .141 / .203 / .142 | fail (K ≥ 0 0/3) |
| C3 swing run value (DML) | v3 | .84 / .87 / .84 | .017 / .037 | −.010 / −.019 / −.029 | −.005 / −.033 / −.019 | −.041 / −.020, +.005 / −.008 | .175 / .091 / .100 | fail |
| C4 slider-shaped FC → BB | v2 | .79 / .82 / .83 | .242 / .138 | −.012 / +.004 / +.000 | −.002 / +.009 / −.002 | +.003 / −.009, +.003 / −.007 | .141 / .204 / .130 | fail (RV ≥ 0 1/3), null |

**What it means.**
1. **Within-pitcher fixed effects** (Resnick's identification) remove location leak and raise stickiness on
   the CSW target, but they cost next-season K%/CSW%. On the whiff target they hurt everywhere. Our
   K%/RV signal is partly between-pitcher information that within-pitcher variation can't recover from
   Statcast's small within-arm spread. The memorization the probe sees (15-NN names the pitcher 65%
   per pitch, 90% per season, unchanged across feature sets) is not what drives next-season prediction
   once the cross-fit is in place.
2. **Slot-relative movement** is the best *physics* candidate. It lowers both leaks and prices
   pitch changes better (change-test FB .158 vs .129), but it loses run value and stability.
   Acceleration does the reverse: it is neutral on forecast and lowers leak.
3. **The richer swing target** (whiff/foul/contact quality, Pitch Profiler's design) is weaker than plain
   whiff per swing on K%. Contact quality from shape is mostly noise at the pitcher level.
4. **Cutter routing** is a null.
5. **The change test separates models that ties on forecast cannot.** v3 prices fastball changes best of all
   (r .196 vs v2 .129, slope .59), while v2 prices breaking-ball changes better (.202 vs .157). The
   change test is now part of the standard gates.

## 40. Topo Level-1 class as the grading key (C5): fails on K% / RV, wins on CSW% and stability (2026-10-26)

Keys come from `pipeline/topo_keys.py` (commit 5d54056). The landscape is fit on 2023–24 from the public
`pitch-classes-statcast` code; its L1 classes agree 97.61% with Statcast's three classes (FC excluded),
reproducing the published number. The key changes class on 8.1% of pitches, mostly cutters to BB, and
leaves 0.9% unmatched or unassigned on Statcast's class. Run: `crossfit_v2.py --key topo`, GOAT_LO=2021,
v2 target, vs `holdout_base`. The rule is the same pre-registered three-part rule as §39.

| | Selection 23→24 / 24→25 / 25→26 | Confirmation 21→22 / 22→23 |
|---|---|---|
| Next K% Δr | −.009 / −.007 / −.008 | +.004 / −.003 |
| Next RV/100 Δr | −.009 / −.005 / +.003 | +.011 / −.005 |
| Next CSW% Δr (reported) | +.019 / +.006 / **+.036\*** | **+.027\*** / +.013 |
| YoY (base → topo) | .79→.80 / .83→.86 / .82→.84 | .84→.84 / .82→.86 |
| Change test FB / BB / CH r | .129→.141 / .202→.213 / .130→.137 | |
| Leak z / x | .237→.249 / .136→.141 | |

**Fails the rule** (K% ≥ 0 in 0 of 3; the z leak rises .012). But on the outcome the v2 model actually
targets, CSW%, the topo key is better in all five pairs, significantly in two. It is also stickier and
prices pitch changes better in every class. The CSW% gain is a lead, not a result: CSW% was reported,
not gated, so claiming it now would move the goalposts. If pursued, it needs its own pre-registration
on fresh evidence; the 2020 season is the last untouched Statcast year.


## 41. T1: tuning on a pitcher-level objective: fails the overall rule, helps 6 of 8 pitch types (2026-10-26)

Pre-registration: COLLABORATION.md S1 + T1. `pipeline/tune_pitcher.py` → `results/tune_pitcher.json`; gate `crossfit_v2.py --params <per class> --name t1_tuned`, GOAT_LO=2021, vs `holdout_base`.

**Tuning ceiling (inner CV, TRAIN only; r of 2023 pitcher × type prediction with 2024 whiff/swing):** FB .229 → .233 (+.005, 7 leaves, 200 trees): capacity tuning is exhausted for fastballs. BB .337 → .397 (+.060, 31 leaves, min_child 5000, 200 trees; SW .18 → .33, CB .48 → .55). CH .276 → .386 (+.110, 63 leaves, 25 trees; 169 pairs). The shipped params (800 trees, lr .03) overfit BB and CH. Best-of-60 selection inflates these gains.

**Gate (pitcher-level, paired bootstrap):**

| pair | CSW% Δr | K% Δr | RV/100 Δr |
|---|---|---|---|
| 21→22 (conf) | +.048* | +.003 | −.008 |
| 22→23 (conf) | +.023 | +.011 | −.015 |
| 23→24 | +.031 | +.022 | −.014 |
| 24→25 | +.031 | +.015 | +.030 |
| 25→26 | +.031 | −.001 | −.008 |

YoY .78/.78/.76/.76/.75 (S1 floor met). Leaks z .317 / x .167 vs base .249 / .141. Change test r FB .176 vs .129, BB .236 vs .202, CH .166 vs .130.
**Verdict: FAILED** — RV/100 ≥ 0 in 1 of 3 selection pairs, confirmation RV/100 mean −.012, both leaks above base + .002. K% passes, CSW% up in every pair, change test up in every class.

**Per type (S1, `type_compare.py`, r of shrunk type grade with next whiff/swing, selection / confirmation):** FF +.033* / +.025 IMPROVES; SI −.027 / −.079* **HURT**; CT +.082* / +.071 IMPROVES; SL .000 / +.026 IMPROVES; SW +.100* / +.067 IMPROVES; CB +.027 / +.031 IMPROVES; CH +.031 / +.039 IMPROVES; FS +.162 / +.115 NEUTRAL (change test). Per-type routing is barred because SI is HURT.

**Read:** shallower BB/CH models forecast each pitch's whiffs better but lean more on shape that tracks location (the leak), which costs run value. The FB gain is ~0, and the FB-class change is what hurts sinkers.


## 42. T1b: tuned BB + CH, shipped FB: passes K%, the sealed 2020 pair and every pitch type; fails RV/100 and the leak gate (2026-10-26)

Pre-registration: COLLABORATION.md T1b (chosen after §41). GOAT_LO=2020, `crossfit_v2_t1b` vs `crossfit_v2_base2020`. **2020 is now spent: no untouched season remains.**

| pair | CSW% Δr | K% Δr | RV/100 Δr |
|---|---|---|---|
| 20→21 (sealed) | +.016 | +.018 | +.009 |
| 21→22 (conf) | +.020 | +.018 | +.003 |
| 22→23 (conf) | +.012 | +.016 | +.006 |
| 23→24 | +.013 | +.020 | −.003 |
| 24→25 | +.018 | +.016 | +.019 |
| 25→26 | +.030* | +.012 | −.003 |

YoY .77–.82 (S1 floor met). Change test FB .143 = base, BB .227 vs .193, CH .153 vs .112. Leaks z .301 / x .145 vs base .237 / .136.

| rule part | result |
|---|---|
| (i) selection K% ≥ 0 in ≥ 2 of 3, none CI-neg | ✓ 3 of 3 |
| (i) selection RV/100 ≥ 0 in ≥ 2 of 3 | ✗ 1 of 3 (−.003, +.019, −.003) |
| (i) confirmation | ✓ K% +.018/+.016, RV/100 +.003/+.006 |
| (i) change test FB | ✓ unchanged |
| (ii) leaks ≤ base + .002 | ✗ z +.064, x +.009 |
| (iii) sealed 2020→21 | ✓ K% +.018, RV/100 +.009 |
| (iv) no type HURT | ✓ (FB types identical by construction) |

**Verdict: FAILED** on RV/100 (two −.003 pairs) and the leak gate. Per type (Δr selection / confirmation / sealed): SW +.100* / +.067 / n<30, CB +.027 / +.031 / +.108, CH +.031 / +.039 / +.036, SL .000 / +.026 / −.017 (NEUTRAL), FS +.162 / +.115 / n<30 (NEUTRAL on change test). K% and every BB/CH type improve in every period, including the sealed one; the cost is that BB/CH grades correlate more with pitch height (breaking balls and changeups thrown low).

## 43. T1b audit: is the tuned BB/CH gain stuff or location? (2026-10-26, post-hoc, descriptive)

`pipeline/t1b_audit.py` (GOAT_LO=2020): pitcher × site type × season, pairs 2020–26, BB/CH types, base2020 vs t1b shrunk type predictions; 1000-draw pitcher bootstrap. Post-hoc (after §42 failed), so it decides nothing by itself; it tests whether §42's leak failure means what the gate assumes.

| test (r with next season, pooled BB/CH, n ≈ 4,000) | base | tuned | Δr [95% CI] |
|---|---|---|---|
| whiff/swing | .244 | .265 | +.021 [+.004, +.039] |
| whiff/swing, own location habits partialled (mean height, zone%, low%) | .270 | .291 | +.021 [+.003, +.040] |
| whiff/swing out of zone | .492 | .537 | +.045 [+.026, +.067] |
| whiff/swing in zone | .044 | .036 | −.008 [−.032, +.019] |
| RV/100 of that pitch | .069 | .059 | −.010 [−.020, +.003] |
| next-season mean height (does the grade forecast location?) | −.009 | −.004 | +.005 [−.020, +.029] |
| same-season r(grade, mean height) | .012 | −.001 | — |

By type, location-partialled whiff Δr: CH +.061*, FS +.133*, SW +.059*, CB +.004, SL −.007. Displayed 2026 type grades move 3.5–4.9 points on average (r .81–.91 with base); 21–39% of pitcher-types move ≥ 5.

**Read:** at the level the grade is shown (pitcher × type × season) the tuned grade is no more tied to location habits than base, and its whiff gain survives removing them; the §42 leak rise is a per-pitch effect (pitch-to-pitch predictions track height through shape) that does not reach the season grade. The gain is in chase-zone whiffs. It does not convert to run value (−.010, CI crosses 0): better whiff forecasts, not better run forecasts.


## 44. P0 power and P1 AAA audit (2026-10-26)

**P0: the pooled judge has power.** `pipeline/judge.py` (outcome panel K/PA, (K−BB)/PA, RV/100, xRV/100; composite = mean of pooled Δr over all MLB season pairs; one paired pitcher bootstrap). On T1b vs base2020 (2023→24 skipped, n ≈ 570 per pair): SE per outcome .005, **composite SE .0045 → minimum detectable effect ≈ .013** (80% power, two-sided .05). Single-pair SE ≈ .018 (MDE ≈ .05), which is why the old 2-of-3 sign rules were coin flips. The owner's ship bar (.02, CI > 0) is above the MDE.

T1b under the new judge: K% +.015 [+.005, +.024], K−BB% +.003, RV/100 +.005, xRV/100 +.009, **composite +.008 [−.001, +.016]**: not a lead.

Definition change: earlier sections' "K%" (`paired_bootstrap.py`) is strikeouts per non-BIP pitch, r .948 with K/PA across 5,193 pitcher-seasons. From §44 on, K% is K/PA.

**P1: AAA 2026 plate convention matches AAA 2024–25** (pitch-level means, regular season; no outcomes read):

| | plate_z | sz_top | sz_bot |
|---|---|---|---|
| AAA 2023 | 2.248 | 3.060 | 1.620 |
| AAA 2024 | 2.258 | 3.195 | 1.612 |
| AAA 2025 | 2.277 | 3.198 | 1.613 |
| AAA 2026 | 2.264 | 3.194 | 1.612 |
| MLB 2025 | 2.324 | 3.435 | 1.605 |
| MLB 2026 | 2.254 | 3.215 | 1.622 |

No convention break inside AAA from 2024 on; AAA has always matched the MLB 2026 (ABS) convention. AAA 2023 has a lower sz_top (partial ABS) with a similar plate_z.

**Frozen AAA recipe for step 6 (P1):** §27's adjustments (extension +0.10 ft, release height −0.06 ft, five high-altitude parks dropped, seasons coded +1000) plus the MLB 2026 plate_z map (×0.9977, +0.0763 ft; plate_x identity) on every AAA season, because AAA uses the convention that map was built for. §27 scored AAA without the plate map (small hvaa effect; noted, not re-run). Design: AAA 2023→24 and 2024→25 = development; **AAA 2025→26 = sealed final check**, next-season outcome = AAA + MLB combined, promoted pitchers reported separately.


## 45. P0 step 2: target study (2026-10-26)

Same inputs, same capacity (T1b: FB shipped params, BB/CH tuned), pitcher-fold cross-fit, GOAT_LO=2020; only the training target changes. Judge = P0 composite, 2023→24 skipped (T1b capacity was tuned on it), five MLB pairs, n ≈ 570 per pair. Swing-side decomposed (`stuff_decomp.py`) runs at its own fixed capacity (noted in advance).

| target | composite Δr vs csw_norm (t1b) | K/PA | (K−BB)/PA | RV/100 | xRV/100 | leak z | grade YoY (range) |
|---|---|---|---|---|---|---|---|
| **wps** (whiff / swing) | **+.043 [+.020, +.066]** | +.067* | +.071* | +.023 | +.012 | .132 | .78–.86 |
| wps_dml (location + count partialled) | +.006 [−.017, +.028] | +.001 | +.002 | +.004 | +.016 | .041 | .84–.87 |
| csw_norm (t1b, reference) | 0 | | | | | .301 | |
| rv (reference only) | −.023 [−.045, +.000] | −.036* | −.012 | −.014 | −.030* | .010 | .82–.86 |
| decomposed e_swing | −.024 [−.054, +.003] | | | | | .130 | .80–.82 |
| decomposed e_stuff | −.042 [−.072, −.014] | | | | | .120 | .83–.87 |

vs the shipped grade (base2020): wps +.051 [+.026, +.076]; wps_dml +.014 [−.010, +.036]; rv −.015 [−.037, +.007].

wps by pair (composite vs t1b): 2020→21 +.067, 21→22 +.056, 22→23 +.023, 24→25 +.056, 25→26 +.015, positive in all five. Including 2023→24 changes nothing (+.041 [+.021, +.061]).

**Power note:** composite SE here is .011–.013, not §44's .0045. §44 measured two nearly identical grades (T1b vs base); SE scales with how different the candidates are. For a target change the MDE is ≈ .033. wps clears it.

**Per type (S1, wps vs t1b, whiff/swing Δr):** FF / SI / CT IMPROVE (FF +.056/+.086, SI +.179/+.134, CT +.079/+.132 selection/confirmation); SL, SW, CB, CH, FS NEUTRAL; no type HURT. Direction is negative on CB (−.044/−.076), CH (−.041/−.020, sealed 2020 −.122 [−.245, +.003]) and FS (−.065/−.018). Two caveats: t1b's BB/CH capacity was selected on this same per-type outcome in 2023→24 (selection period favours t1b), and capacity was tuned for csw_norm. Step 4 re-tunes BB/CH under the winning target. FF type-grade YoY drops .864 → .669 (selection), above the S1 floor.

**Read:** the swing-side winner is **wps**, and it is also the best pure forecaster of everything tried; RV-trained targets lose even on run value. The gain is K and K−BB (≈ +.07); RV/100 and xRV/100 are positive with CIs crossing 0. wps_dml removes location from the target and gives the gain back, so part of what wps learns is shape that predicts where swings happen (leak .132, under csw_norm's .301). Grades still trail the naive prior-season stat for next-season CSW (crossfit "grade vs naive"), as before. Not shipped: step 2 picks the target; the ship decision is after steps 3–5 on the final model.


## 46. P0 step 3: input batch on wps (2026-10-26)

Each edit to the wps model (T1b capacity, GOAT_LO=2020), judged vs s2_wps, 2023→24 skipped. Because the two grades are close, composite SE is .002–.005 (MDE ≈ .006–.013).

| edit | composite Δr | K/PA | (K−BB)/PA | RV/100 | xRV/100 | leak z (wps .132) | per-type HURT |
|---|---|---|---|---|---|---|---|
| −hvaa | −.002 [−.010, +.007] | +.003 | −.009 | −.001 | +.001 | **.271** | none |
| −spin | **−.008 [−.016, −.001]** | −.014* | −.009 | −.004 | −.005 | .120 | FF, CT |
| −(spin_eff, velo_x_ivb) | +.001 [−.004, +.005] | +.001 | −.004 | +.002 | +.003 | .141 | SI |
| +arm_angle | −.002 [−.008, +.005] | +.002 | −.002 | −.004 | −.003 | .130 | none |
| acceleration for break | −.003 [−.012, +.006] | −.004 | +.001 | −.007 | −.002 | .210 | none |
| primary-FB anchor (for p95 band) | −.002 [−.010, +.005] | +.001 | −.008 | −.001 | −.002 | .129 | none |
| +non-Magnus accel | +.002 [−.001, +.005] | +.001 | .000 | +.003 | +.005* | .132 | SL |

**Read:** the owner's hypothesis (inputs nobody else uses are likely wrong) is not supported, and neither is its mirror (inputs everyone else uses would help). Our unique inputs are redundant rather than wrong: removing spin_eff/velo_x_ivb or swapping the p95 anchor for the primary fastball changes nothing (|Δ| ≤ .002), and adding the consensus inputs (arm angle, acceleration, non-Magnus) changes nothing either. The one input that matters is raw spin (−.008 when removed, FF and CT HURT). hvaa adds no forecast value, but removing it doubles the location leak (.132 → .271): residualized on plate_z, it absorbs the height signal that other shape inputs otherwise carry. Keep it in Stuff+; it stays out of the Location+ split (step 7) as planned. **Step 3 winner: wps with its inputs unchanged.**


## 47. P0 step 4: BB/CH capacity re-tune under wps (2026-10-26)

Screen (`tune_pitcher.py --target wps --classes BB,CH`, inner pitcher-CV on TRAIN 2023–24): BB best nl7 / mc1000 / 800 trees (r .363 → .378), CH best nl7 / mc100 / 50 trees (.247 → .336). Gate (P0 composite vs s2_wps, 2023→24 skipped):

| change | composite Δr | K/PA | (K−BB)/PA | RV/100 | xRV/100 | leak z | HURT |
|---|---|---|---|---|---|---|---|
| **BB re-tuned** | **+.008 [+.004, +.013]** | +.008* | +.008* | +.008* | +.010* | .146 | none (SW IMPROVES; CB +.061* selection, +.134* sealed) |
| CH re-tuned | +.001 [−.002, +.004] | | | | | .132 | none |
| both | +.010 [+.004, +.015] | | | | | .147 | none |

**Adopted: BB re-tune only** (pre-registered rule: a change is adopted when its own CI is above 0; the CH change's is not, and "both" ≈ BB + noise). Model = **s4_bb**: wps target, v2 inputs, FB shipped params, BB nl7/mc1000/lr .1/800 trees, CH nl63/mc1000/lr .1/25 trees.

**Cumulative (s4_bb, 2023→24 skipped):** vs csw_norm at T1b capacity +.052 [+.029, +.074]; **vs the shipped grade +.059 [+.035, +.083]**, K/PA +.089*, RV/100 +.036* (first run-value CI above 0 in the program). Per type vs t1b: FF / SI / CT / SL IMPROVE, SW / CB / CH / FS NEUTRAL, none HURT. The re-tune recovers §45's CB deficit (CB r .455 vs t1b .439); CH (−.041 / −.020) and FS (−.065 / −.018) still trail t1b on whiff/swing, inside the noise. All selection is in-sample on MLB; AAA 2025→26 (step 6) is the holdout.


## 48. P0 step 5: reliability per type + T2 gyro sliders (2026-10-26)

`step5.py` on s4_bb per-pitch out-of-fold predictions. Split-half r of the half means (one random split per pitcher × season × type cell):

| type | grade, 25 pitches | grade, 100 | whiff/swing, 25 swings | 100 | 200 | whiff/swing ≥ .70 at |
|---|---|---|---|---|---|---|
| FF | .85 | .95 | .31 | .60 | .74 | 200 |
| SI | .93 | .98 | .20 | .58 | .69 | > 200 |
| CT | .92 | .98 | .36 | .65 | .55* | > 200 |
| SL | .97 | .99 | .40 | .71 | .70 | 100 |
| SW | .96 | .99 | .38 | .66 | — | > 100 |
| CB | .98 | .99 | .42 | .71 | — | 100 |
| CH | .97 | .99 | .42 | .70 | .73 | 200 |
| FS | .95 | .99 | .42 | .76 | — | 100 |

\* few cells (< 60). — = fewer than 30 cells.

**Read:** the grade is reliable (≥ .85) by 25 pitches for every type, while the outcome it forecasts needs 100–200+ swings. Caveat: a shape model's split-half reliability is near-automatic (a pitcher's shape barely varies within a season), so this is reliability, not validity. Display minimums stay set by validity (MIN_N 50 swings for type grades), not by this table.

**T2 (cut fixed in advance: SL gyro share ≥ .75):** 1,476 SL-gyro vs 2,602 SL-other pitcher-seasons. Gyro sliders whiff more (.356 vs .325), and the grade sees it (mean prediction .338 vs .318). The grade forecasts next-season whiff/swing worse inside the gyro group (r .267 vs .391); YoY .85 vs .88. Group switch rate .176 (≤ .20 ✓). A within-group display scale lowers pooled r .358 → .342 (−.016, inside the .02 allowance ✓). **Pre-registered rule passes: an SL-gyro display label may ship.** Recommendation: ship the label on the pooled slider scale, not a separate scale, since centring costs r. No grade changes.


## 49. P0 step 6: AAA final check, seal opened once (2026-10-26) — NOT CONFIRMED

s4_bb vs the shipped recipe, both `crossfit_v2.py --aaa` (MLB 2023–24 training, pitcher-fold cross-fit, frozen AAA recipe); `aaa_judge.py`, AAA grade in S → AAA + MLB in S+1. AAA grades: ~1,150 pitchers per season, mean 95–100 (base 95–96), SD ≈ 9.5. Location leak on MLB: s4_bb .119, base .254.

| pair | n | K/PA | (K−BB)/PA | RV/100 | xRV/100 | composite (SE) |
|---|---|---|---|---|---|---|
| 2023→24 (dev) | 660 | +.158 | +.127 | +.034 | +.049 | +.092 (.033) |
| 2024→25 (dev) | 685 | +.040 | +.036 | −.027 | −.032 | +.004 (.028) |
| **2025→26 (sealed)** | **707** | **+.065** | **+.017** | **−.076** | **−.017** | **−.003 (.030)** |
| pooled, all three | | +.088 [+.049, +.128] | +.060 [+.023, +.103] | −.023 | .000 | +.031 [−.001, +.066] |

Promoted (no MLB in S, ≥ 50 taken MLB pitches in S+1; reported, not judged): sealed pair +.098 (n 103, SE .082); pooled +.110 [+.028, +.194], K/PA +.166*, K−BB +.186*.

**Verdict under the pre-registered rule (sealed pair alone, composite): ≤ 0 → NOT CONFIRMED. s4_bb does not ship.**

**Read:** the result splits by outcome, the same way it did on MLB. The strikeout gain replicates on pitchers no decision touched: K/PA is positive in all three AAA pairs, including the sealed one (+.065), and pooled across AAA its CI is above 0. It is largest for the pitchers who get called up. The run-value gain does not replicate: RV/100 is negative on the sealed pair (−.076), xRV/100 is flat, and on MLB those two were the weakest parts of the +.059 (§47). The honest reading is that a whiff-per-swing Stuff+ is a better strikeout forecaster and not a better run-prevention forecaster, so the composite's MLB gain was partly selection on the run-value half. Single-pair SE is .03 (MDE ≈ .08), so the sealed pair could not have confirmed a gain smaller than about .08. Even so, the point estimate is at zero, not merely underpowered. No further changes are tested on AAA 2025→26: it is spent.


## 50. P7 step 7.1: K+ projection — CONFIRMED (2026-10-26)

`kproj.py`: ridge on Marcel K%, K% and SwStr% in S, the Whiff+ grade in S, log PA → next-season K/PA. Dev = 80% of pitchers (5-fold pitcher-grouped CV); verdict read once on the sealed 20% (`crc32("p7:" + id) % 5 == 0`). Pairs 2020→21 … 2025→26, ≥ 50 taken both seasons.

| | dev (n ≈ 440 / pair) | **sealed (n ≈ 100 / pair)** |
|---|---|---|
| Δr K+ − Marcel, pooled | +.048 [+.035, +.061] | **+.040 [+.010, +.072]** |
| RMSE reduction (K/PA) | .0031 [.0024, .0038] | **.0020 [.0006, .0035]** |
| pairs where K+ > Marcel | 6 / 6 | 6 / 6 |

Sealed per pair r (Marcel → K+): .455→.460, .606→.626, .668→.697, .480→.534, .526→.633, .402→.427. The Whiff+ grade alone beats last-season K% in 4 of 6 sealed pairs. Standardized ridge weights: Marcel .020, Whiff+ .014, SwStr% .005, K% .004, log PA ≈ 0 (alpha 31.6).

**Read:** a projection that adds Whiff+ to Marcel forecasts next-season strikeout rate better than Marcel on pitchers no step-7 choice touched. Whiff+ carries the second-largest weight; shape adds information that three years of results do not have. Display: K+ = 100 + 10 × (projection − .2227) / .0387 (frozen on dev pitcher-seasons with ≥ 100 PA). Caveat: steps 2–6 read the sealed pitchers' outcomes when choosing the Whiff+ model itself.


## 51. P7 step 7.2: Stuff+ (RV), a run-value shape grade — FAILED (2026-10-26)

s4_bb inputs and capacity, targets xrv (rv with balls in play valued by the count-specific xwOBA line) and rv. P0 composite, 2023→24 skipped.

| | vs shipped, dev | **vs shipped, sealed** | vs Whiff+, dev | vs Whiff+, sealed |
|---|---|---|---|---|
| xrv: RV/100 | +.020 [−.007, +.046] | **−.037 [−.081, +.013]** | −.031 | −.008 |
| xrv: xRV/100 | +.020 [−.008, +.045] | **−.031 [−.081, +.020]** | −.027 | +.007 |
| xrv: composite | +.022 [−.001, +.043] | −.035 | −.049* | −.048 |
| rv: composite (reference) | −.021 | — | | |

Leak z: xrv .025, rv .008 (Whiff+ .146). YoY .80–.86.

**Read:** a shape grade trained on run value, even with balls in play valued by contact quality instead of results, does not forecast next-season run value better than the shipped grade on sealed pitchers, and it never beats Whiff+ on run value. Batted-ball run value is not forecastable from pitch shape alone at the pitcher level. **No "traditional" Stuff+ (RV) ships.** xrv remains available as an internal shape component for Pitching+ (7.5), where it can be judged together with location.


## 52. P7 step 7.3: run-prevention stack — CONFIRMED (2026-10-26)

`stack.py`: ridge on Whiff+, K+ (out of fold), BB% and GB% in S → next-season RV/100 and xRV/100. Benchmarks in S: K−BB%, FIP, xFIP per PA. K−BB% was the best on dev (mean r .252 RV, .256 xRV; xFIP .242, FIP .217).

| target | dev Δr vs K−BB% | **sealed Δr vs K−BB%** | sealed pairs won |
|---|---|---|---|
| RV/100 | +.071 [+.046, +.095] | **+.086 [+.042, +.130]** | 6 / 6 |
| xRV/100 | +.111 [+.082, +.139] | **+.098 [+.040, +.152]** | 6 / 6 |

Standardized weights (RV): K+ .43, GB% .12, BB% −.11, Whiff+ −.01 (Whiff+ enters through K+).

**Diagnostic (dev only, after the seal):** removing Whiff+ from both K+ and the stack costs .014 [.002, .025] on RV/100 and .012 [.002, .021] on xRV/100. Most of the stack's lead over K−BB% comes from three years of strikeout history, walks and ground balls; Whiff+ adds a smaller, real increment. A fair critique: K−BB% here is one season, while the stack sees Marcel history. A Marcel-regressed K−BB% benchmark would close part of the gap and was not pre-registered.

**Read:** strikeout skill (K+), walks and ground balls together forecast next-season run prevention better than K−BB%, FIP or xFIP. Whiff+ contributes through K+. This is the first run-value result in the program that holds on held-out pitchers.


## 53. P7 step 7.4: Location+ — NOT CONFIRMED (narrow miss) (2026-10-26)

`location_plus.py`. Per-pitch umpire-neutral run value (swings at xrv; called pitches valued by p(called strike), with 2026 fitted separately; HBP at actual rv); pitcher-fold cross-fit on dev pitchers' 2023–24 pitches. Claim: Location+ in S adds to next-season RV/100 beyond Whiff+ and the xrv shape grade.

| | L_direct (dev) | **L_ctrl (dev)** | **L_ctrl (sealed, read once)** |
|---|---|---|---|
| claim: Δr RV/100 | +.023 [+.008, +.038] | +.052 [+.030, +.075], 6/6 | **+.0385 [−.0006, +.0767]**, 5/6 |
| Δr xRV/100 | +.005 | +.035 [+.018, +.051] | +.032 [+.003, +.061] |
| added to Prevention+, RV/100 | +.003 | +.013 [+.003, +.023] | +.002 [−.017, +.020] |
| split-half r at 100 / 200 / 400 / 800 pitches | .31 / .46 / .62 / .71 | .41 / .57 / .74 / .81 | |
| YoY (≥ 300 pitches both) | .653 | .677 | |
| r with Whiff+ | −.078 | −.016 | |

Components (dev; r with the L_ctrl grade): waste % −.56 (mean 35.5%), heart % +.25 (25.3%), edge % +.25 (11.7%).

**Verdict under the pre-registered rule: the sealed RV/100 CI touches 0 → NOT CONFIRMED.** The miss is narrow: point estimate +.039 with 5/6 pairs positive, and the expected-run-value version of the claim (reported, not judged) clears 0. Location+ adds nothing to Prevention+ on sealed pitchers.

**Read:** shape-controlled location value is a stable pitcher trait (reliable at ~400 pitches, consistent with FanGraphs' figure; YoY .68), independent of Whiff+ (r −.02), and driven mostly by avoiding non-competitive pitches (waste % r −.56), the "limit waste pitches" finding. It probably carries next-season run value beyond shape, but the sealed group (~100 pitchers per pair) could not confirm it at the pre-registered bar, and once K, walks and ground balls are known (Prevention+) it adds nothing measurable. The "heart %" component correlates positively, against its name. As defined (p(called strike) ≥ .95, |x| ≤ 0.5 ft) it counts in-zone strikes, not middle-middle mistakes; the definition needs fixing before display.


## 54. Correction: pitcher-clustered bootstrap; Location+ critique (2026-10-26)

**Bug (found by the senior R&D critique of §53):** every pooled CI since §44 (`judge.py`, `aaa_judge.py`, `kproj.py`, `stack.py`) resampled pitchers independently within each season pair, although one pitcher appears in up to six pairs. The CIs were too narrow. Fix: `judge.cluster_w` makes one multinomial draw over every distinct pitcher, shared by all pairs (self-checked). Point estimates are unchanged. The sealed sets were re-read only to recompute these intervals; no model or choice changed.

| result | was | **corrected CI** | verdict |
|---|---|---|---|
| §45 wps vs csw_norm, composite | [+.020, +.066] | [+.017, +.071] | unchanged |
| §46 −spin, composite | [−.016, −.001] | **[−.018, +.002]** | **weakens**: K/PA still −.014 [−.026, −.003]; "only spin matters" now rests on K alone |
| §47 BB re-tune, composite | [+.004, +.013] | [+.003, +.014] | unchanged (adopted) |
| §47 s4_bb vs shipped, composite | [+.035, +.083] | [+.032, +.087] | unchanged |
| §49 AAA pooled composite | [−.001, +.066] | [−.004, +.065] | unchanged (not confirmed) |
| §50 K+ sealed Δr | [+.010, +.072] | [+.014, +.068] | unchanged (confirmed) |
| §51 Stuff+ (RV) sealed RV/100 | [−.081, +.013] | [−.083, +.012] | unchanged (failed) |
| §52 Prevention+ sealed RV / xRV | [+.042, +.130] / [+.040, +.152] | [+.041, +.131] / [+.038, +.163] | unchanged (confirmed) |
| §53 Location+ sealed RV/100 | [−.0006, +.077] | [−.0001, +.078] | unchanged (not confirmed) |

**Critique findings on Location+ (accepted):**
- **It is mostly a control grade.** r(grade, BB%) −.59 on dev. Beyond BB%, it adds +.028 [.014, .044] (dev); beyond Prevention+, it adds nothing on sealed pitchers.
- **It credits strike-throwing, not command quality.** Conditioning on shape pushes damage from hittable strikes into g, so strike-throwers with hittable arsenals grade as elite (2025: Mikolas 122.9, Paddack 120.8).
- **Deviation from pre-registration:** the shape controls are `stuff_v2.FEATURES`, which include hvaa, although the row said "no hvaa." The bias is conservative (some location value is absorbed into g). It is disclosed here; no re-fit.
- **HBP mask** also catches about 405 PAs that ended on a caught stealing or pickoff (2023–24). Use `description == 'hit_by_pitch'` at the next fit.
- **"Heart %"** is a naming problem, not a bug: it counts sure strikes. Coach-facing components: Zone %, Edge %, Meatball % (inner third on both axes, using sz_top/sz_bot), Waste %, Mistake %.
- **No verdict-relevant leakage** (the xrv base grade scores sealed pitchers out of fold; any contamination strengthens the base, not Location+).
- **Dev diagnostic:** Location+ predicts next-season BB% beyond BB%, +.038 [.013, .061].


## 55. P7 step 7.4b: BB+ projection — NOT CONFIRMED; Control+ rename (2026-10-26)

`bbproj.py`: ridge on Marcel BB%, BB% in S, Control+ in S and log PA → next-season BB/PA. Clustered pitcher bootstrap.

| | dev | **sealed (read once)** |
|---|---|---|
| Δr BB+ − Marcel | +.015 [+.003, +.027] | **+.016 [−.004, +.038]** (4 of 6 pairs) |
| RMSE reduction (BB/PA) | .0007 [.0003, .0010] | **.0010 [.0003, .0017]** |

Standardized weights: Marcel .013, Control+ −.004 (more Control+ → fewer walks), log PA −.003, BB% ≈ 0.

**Verdict: the claim needed r and RMSE both above 0; r's CI crosses 0 → NOT CONFIRMED.** Control+ helps walk forecasts a little (error falls on sealed pitchers), but the gain over Marcel is too small to confirm at ~100 pitchers per pair. No BB+ on the site. Location+ is renamed **Control+**, descriptive only (owner ok).


## 56. P7 step 7.5: Pitching+ — NOT CONFIRMED (ties SIERA) (2026-10-26)

`pitching_plus.py`: per-pitch umpire- and catcher-neutral value (swings at xrv), f(shape, location, count) − E[y | count], pitcher-fold cross-fit on dev pitchers' 2023–24 pitches; P_adj adds batter prior-season wOBA and scores at league average. Judge: r(grade in S, −RA9 in S+1); pairs with ≥ 50 taken pitches in S and ≥ 20 IP in S+1 (dev n ≈ 345 per pair, sealed ≈ 82). RA9 from runs scored on his pitches and outs recorded (2025 starters with 150+ IP: mean 3.92 over 172 IP); SIERA per Swartz & Seidman (2025 mean 4.17).

Benchmarks on dev (mean r with next-season −RA9): SIERA .212, K−BB% .208, xFIP .195, RA9 in S .139.

| | P_raw (dev) | P_adj (dev) | **P_raw (sealed, read once)** |
|---|---|---|---|
| claim: Δr vs SIERA | +.002 [−.045, +.048] | −.006 | **−.027 [−.109, +.057]** |
| vs RA9 in S | +.075 [+.016, +.128] | +.067* | +.052 [−.051, +.172] |
| vs K−BB% on next RV/100 | −.005 | −.023 | +.066 [−.021, +.152] |
| added to Prevention+ (RA9) | +.008 [−.003, +.020] | +.007 | +.004 [−.017, +.027] |
| YoY (≥ 300 pitches) / split-half at 400 | .735 / .85 | .741 / .84 | |
| r with Whiff+ / Control+ | .54 / .58 | .54 / .57 | |

**Verdict: NOT CONFIRMED.** Pitching+ forecasts next-season RA9 about as well as SIERA (dev tie, sealed −.027 with a wide CI) and adds nothing measurable to Prevention+. The batter adjustment does not help.

**Read:** an all-in pitch-level run model, done carefully (umpire- and catcher-neutral, contact quality instead of results, no leverage), matches SIERA but does not beat it. It is a stable pitcher trait (YoY .74, reliable at ~400 pitches), mixing stuff and command about equally (r .54 with Whiff+, .58 with Control+). As a forecast of runs it does not improve on a five-number formula from K, BB and batted-ball mix, consistent with the run-value shape results (§45, §51): whatever pitch-level models add beyond outcomes shows up in strikeouts, not in runs. RA9 is noisy (≥ 20 IP), so power is low; a tie is the honest reading. Pitching+ can be shown as a descriptive grade; Prevention+ remains the validated run-prevention number.


## 57. P7 step 7.6: sequencing — detectable, sticky, not forecast-useful (2026-10-26)

`sequencing.py`. Previous pitch in the same PA (class, Δvelo/IVB/HB/VAA, previous location, distance, same type). f = Pitching+ P_raw; f_seq adds the previous pitch; f_placebo shuffles it among the same pitcher's pitches in the same game and count.

| test | result | pre-registered verdict |
|---|---|---|
| (a) exists: MSE reduction, f_seq net of placebo (dev, held-out pitchers) | +3.2e-5 [+2.1e-5, +4.3e-5] = 0.12% of per-pitch MSE | **pass** |
| (a) context: f_seq vs f alone / f_placebo vs f | −8.4e-5 / −11.6e-5 (both worse than f) | |
| (b) trait: YoY of pitcher-season sequencing value (≥ 300 pitches) | .59 [.54, .64], 1,576 pairs; SD 0.38 runs / 100 pitches | **pass** |
| (c) claim, sealed once: adds to next-season RV/100 beyond Pitching+ | **+.009 [−.009, +.025]**, 4/6 pairs | **NOT CONFIRMED** |

2025 extremes (dev, ≥ 1,000 pitches; runs / 100 pitches): top Sugano +.37, G. Williams +.26, Kochanowicz +.25, Roupp +.23, Woo +.22; bottom C. Sánchez −.49, Freeland −.39, Gore −.32, Elder −.30, Pivetta −.29.

**Read:** the order of pitches carries a real but very small signal. Actual previous pitches beat shuffled ones, yet adding previous-pitch features of any kind makes the out-of-sample fit worse, so the gain is mostly the model learning which sequences a pitcher habitually throws. The pitcher-level score is sticky (.59), but stickiness is expected if it reflects arsenal structure (which pitch pairs a pitcher owns) rather than a sequencing skill. Sánchez, an elite sinker–changeup pitcher, ranking last points that way. It does not forecast next-season run value beyond Pitching+. **Where sequencing value lives:** it is not a measurable, forecastable pitcher skill at the pitch level in public data. It is better shown as pitch-pair description (Tunnel+, kb-session's port) than as a grade.

## §58 Whiff+ within-pitcher location check (2026-10-26, prompted by college v9)

College v9 failed partly on a within-pitcher location tie (pred vs plate height). Same check on
the shipped MLB Whiff+ (s4_bb cross-fit preds, 2020-26, deviations from pitcher-season means):

| Class | within r(pred, plate_z) | inputs with the largest within r | location part / grade SD (pitcher-seasons ≥100) | r(grade, mean plate_z) |
|---|---|---|---|---|
| FB | +.396 | ivb +.21, rel_h +.18, hvaa −.14 | .24 | +.36 |
| BB | −.309 | rel_h +.12, ivb +.10 | .07 | −.13 |
| CH | −.057 | velo −.20, rel_h +.17 | .01 | +.02 |

No input carries location (each within r ≤ .21). The model adds up small pitch-to-pitch shape
changes that move with location (a fastball released higher with more ride ends up higher). The
effect on a season grade is the within slope × the pitcher's mean height. For BB and CH it is
negligible (≤7% of grade SD). For FB it is about 24% of grade SD (≈6% of variance). Most of the FB
r(grade, mean plate_z) +.36 is the between-pitcher coupling in §11 (ride pitchers elevate).
**Not a blocker for the export. FB Whiff+ partly credits elevating.** Next FB refit:
add a within-pitcher leak gate (|r| ≤ .20) and test location-residualized ivb/rel_h.

## §59 Buyback / decay (Driveline idea): decay confirmed, buyback not (2026-10-27)
Pre-registered in `pipeline/PREREG-buyback-decay.md`; the code is `pipeline/buyback_decay.py`.
- **Exposure:** within a game, count the earlier-PA pitches this batter saw from this pitcher: same type (S) and
  other types (O).
- **Fit:** fixed effects for pitcher × type × season. A strict version uses pitcher × type × game plus batter × season.
  SEs clustered by pitcher.
- **Result:** D = bO − bS > 0 in selection 2023–26 (+0.0021; strict +0.0014) and in confirmation 2021–22 (+0.0015;
  strict +0.0011) runs per pitch per earlier look. The effect is all decay (bS < 0, bO ≈ 0).
- **Dose-response:** saturates after 2–3 looks (about −0.005 runs per pitch).
- **Location:** not a mediator.
- **Placebo:** the future-exposure placebo was withdrawn before confirmation. It measures the pitcher reacting to the
  current pitch, not confounding.
- **Use:** a usage optimizer should price repeated looks with a concave per-type decay curve. There is no general
  buyback term.

## §60 Decay-aware usage optimizer: gaps persist, the realized edge is not confirmed (2026-10-27)
Pre-registered in `pipeline/PREREG-usage-opt.md`; the code is `pipeline/usage_opt.py`.
- **Setup:** the unit is pitcher × season × platoon. Values are count-adjusted run value per pitch, shrunk. Decay is
  the §59 curve. Bounds are ±10 pts per type.
- **Paper edge:** median about 1.2 runs/season for SP and 0.4 for RP (p90 about 2.5–2.75).
- **Replicates:** within-pitcher type-value gaps persist at about 60% of the shrunk prediction, in both windows.
  Pitchers close only about 10% of the gap year over year.
- **Not confirmed:** the realized gain from actual usage moves. The intent-to-treat design (April usage, May-on
  value) gives a T3 slope of 2.3 [1.0, 3.6] in selection but 1.3 [−0.2, 2.9] in confirmation.
- **Decay vs static:** decay-aware calibration is no better than static.
- **The naive design is invalid:** usage reacts to in-season performance, which gives a T2 slope of +4.3. The
  ITT design removes that (−0.1 / −0.3, consistent with decay only).
- **Open:** a per-count minimax test, because fastballs' strike-throwing burden could explain the persistent
  fastball-vs-breaking-ball gap.

## §61 Per-count minimax (restart 1/4): equilibrium-consistent, except fastball vs breaking ball (2026-10-27)
Pre-registered in `pipeline/PREREG-count-minimax.md`; the code is `pipeline/count_frame.py` + `pipeline/count_minimax.py`.
- **Setup:** the node is pitcher × season × count × batter side. Values are the Pitching+ target y (denoised realized)
  and pitchval_raw (model).
- **Usage vs value:** within node, more-used types have the higher realized value. The slope is +1.17 / +0.87
  runs/100 per unit usage share (selection / confirmation), the equilibrium sign, so misallocation is not supported.
  - That slope is steeper than §59 decay implies, which points at predictability (step 2).
  - Usage beats the model value (M4 +0.46 / +0.33): pitchers know more than the model.
- **The fastball "strike burden" does not explain the FB-vs-BB gap:** within-count FB−BB is −0.22 / −0.32 runs/100 vs
  season −0.17 / −0.29. That is the Kovash–Levitt anomaly, small (about 1 run per SP-season per 10-pt shift).
- **Conclusion for §60:** the season optimizer's "edge" is mostly equilibrium behaviour misread as average-value gaps.

## §62 Pitch predictability (restart 2/4): not priced (2026-10-27)
Pre-registered in `pipeline/PREREG-predictability.md`; the code is `pipeline/predictability.py`.
- **Setup:** p = P(own type | pitcher, season, count, side, previous type), cross-fit from the other game-parity half.
  The model is a ~ p + Pitching+ value + FE(pitcher × season × count × side × type × half) + FE(prev × type × count).
- **Result:** β = +0.003 [−.004, +.009] (selection) and +0.000 [−.009, +.009] (confirmation). Placebos are null.
  Swing, whiff, chase and contact are all null.
- **Method lesson:** a leave-one-game-out p produced a spurious −0.026, because pitchers throw more of what is working
  that day. The pre-registered shuffled placebo caught it.

## §63 Count-state usage policy with off-policy evaluation (restart 3/4): no edge (2026-10-27)
Pre-registered in `pipeline/PREREG-count-policy.md`; the code is `pipeline/count_policy.py`.
- **Setup:** behavior μ is the pitcher's own cross-fit node mix in t+1. The policies tilt μ toward season-t
  quality (P1) or shrunk performance (P2), shift FB → BB (P3), or save the offspeed (P4). They are scored on t+1
  by the doubly robust estimator as a contrast with the identity policy.
- **First-run lesson:** the raw DR estimator was biased (−0.02, caught by the random-tilt placebo). The identity
  contrast fixes it.
- **Results:**
  - P1/P2 +0.008–0.021 runs/100 in both windows, but they fail the placebo rule in confirmation.
  - Net of usage response they are worth ≤ 0.25 runs per SP season.
  - P3 is inconsistent; P4 is null.
- **Program conclusion:** MLB usage is near-equilibrium. Mix optimization is not where the edge is.

## §64 Whiff+ on AAA for the site (Minors Phase 2, display only) (2026-10-27)

`crossfit_v2.py --aaa --aaa-hi 2026` with the s4_bb recipe (wps; BB nl7/mc1000/lr.1/800, CH nl63/mc1000/lr.1/25),
GOAT_LO=2020: trained on MLB 2023–24, pitcher-fold cross-fit, AAA 2023–26 scored out of fold with the frozen §44
adjustments (AAA 2026 shares AAA 2024–25's plate convention, §44 P1; its seal was spent in step 6). No test: display.
`aaa_export.py` → `data/export/aaa_pitcher_models.json` (Whiff+ overall / by type / by class, ≥ 50 taken pitches,
4,047 pitcher-seasons, label "MLB model on AAA data").

| check | value |
|---|---|
| MLB rows vs shipped s4_bb grades | r .983, mean −0.06, sd 1.58 (refit noise; s6 run: same) |
| AAA rows vs step-6 run (s6_s4bb), 2023–25 | r .996, mean +0.00 |
| AAA same-season r(Whiff+, whiff/swing), ≥ 100 swings | .422 (MLB .482) |
| pitchers at both levels in a season (n 1,822) | r .817; AAA reads +1.4 higher |
| AAA season means 2023/24/25/26 | 98.0 / 99.0 / 101.0 / 101.5 (sd ≈ 7.5) |

Not exported for AAA: K+, Prevention+, Control+, Pitching+ (not validated there; step 6 confirmed the K gain only).

## §65 Display floors for Whiff+ (owner: Hopkins CB, "all Whiff+ grades there") (2026-10-27)

Split-half reliability of the per-type out-of-fold mean (`pred_s4_bb`, before the k=150 class shrink), seed 13:

| N | CB | CH | CT | FF | FS | SI | SL | SW |
|---|---|---|---|---|---|---|---|---|
| 5 | .906 | .856 | .753 | .544 | .844 | .706 | .897 | .834 |
| 10 | .950 | .922 | .839 | .706 | .902 | .834 | .938 | .903 |
| 25 | .977 | .967 | .930 | .846 | .961 | .928 | .973 | .962 |

Pitching+ class value (`pitchval_raw`), same method: N=50 FB .496 / BB .578 / CH .681; N=100 .660 / .720 / .826.

Before: every type or class cell under 50 pitches was dropped (3.7% of pitches; 2026: 1,323 pitcher-types,
e.g. Hopkins' 39-pitch CB), and pitcher-seasons under 50 taken pitches had no Whiff+ at all.
**Change (display only; scale still frozen on TRAIN cells ≥ 50, every existing grade byte-identical):** Whiff+ by
type and by class from 10 pitches (every type ≥ .70 at N=10); overall Whiff+ from 10 graded pitches (projections stay
at ≥ 50 taken and are blank on the added rows). Pitching+ by class stays at 50 (too noisy lower). Added: MLB 5,101 type
+ 2,317 class grades + 410 pitcher-seasons; AAA 5,596 + 2,518 + 596. Hopkins 2026: CB 131.2 (n 39) beside FF 138.8.
Tiny samples can sit on the grade scale's 50 floor (3 MLB, 16 AAA added rows). `model_card.floors` records the floors.

## §66 P7 family on AAA (D-05, owner ask via ledger row 151), pre-registered 2026-10-27 before any read

**Design: frozen transfer.** Nothing is fitted on AAA. The shipped MLB ridges, refit on every MLB pair exactly as `p7_export.py` does them, are applied unchanged to AAA inputs. Those inputs follow the §44 recipe: high-altitude parks dropped, Whiff+ from `crossfit_v2_s7_aaa`, and AAA history only for Marcel, with the AAA league K% as the prior. `aaa_p7.py`.
- **Pairs:** AAA S → S+1 for 2023→24, 2024→25, 2025→26.
- **Pair floor:** ≥ 50 taken AAA pitches in S, and ≥ 50 taken pitches in S+1, AAA and MLB pooled.
- **Outcomes in S+1:** pooled across both levels, as in `aaa_judge.py`.
- **Bootstrap:** pitcher-clustered across pairs, 2,000 draws, seed 13.

**Claims (each read once):**
1. **K+:** Δr(K+ − AAA Marcel K%) on S+1 K/PA. CONFIRMED if the 95% CI lower bound is > 0 **and** at least 2 of 3 pairs are > 0. RMSE is reported, not judged: frozen MLB weights carry a level offset.
2. **Prevention+:** Δr(Prevention+ − AAA K−BB% in S) on S+1 RV/100 **and** on xRV/100. CONFIRMED only if both CIs are above 0.
3. **Control+ / Pitching+:** no forecast claim was confirmed on MLB either (§55, §56). They can ship on AAA as descriptive grades only after a separate scoring step and a reliability check. Not part of this read.

**What this test cannot show, stated up front.** These AAA pairs are not fresh. Step 6 (§49) already read Whiff+ against the same outcomes. It found a K/PA gain in every pair and no RV gain. So a K+ pass is expected, and it is weak news: it shows the frozen formula transfers, nothing more. The informative claim is Prevention+, where Whiff+ alone failed on run value at AAA. **Whatever passes ships display-only**, under the "MLB model on AAA data" label, on the MLB scale constants.

**Result (read once, 2026-10-27).** n = 660 / 685 / 707 pitcher-pairs. These are the same pairs as step 6, which is the consistency check.

| claim | pooled Δr [95% CI] | per pair (benchmark → model) | verdict |
|---|---|---|---|
| K+ vs AAA Marcel K% (S+1 K/PA) | **+.069 [+.046, +.091]** | .359→.426, .388→.444, .356→.439 (3/3) | **CONFIRMED** |
| Prevention+ vs AAA K−BB% (S+1 RV/100) | **+.033 [+.007, +.059]** | .171→.207, .149→.182, .112→.141 (3/3) | **CONFIRMED** |
| Prevention+ vs AAA K−BB% (S+1 xRV/100) | **+.034 [+.005, +.062]** | .153→.173, .120→.145, .049→.107 (3/3) | (both needed) **CONFIRMED** |

**Reported, not judged:**
- K+ RMSE beats Marcel in every pair, despite the level offset (.0540→.0533, .0520→.0492, .0498→.0475).
- Promoted pitchers (n 289, AAA only in S, MLB in S+1): Δr K+ +.068, Prevention+ +.084.

**Read:** the frozen MLB projections transfer to AAA. K+ was expected to pass, given step 6. The new information is Prevention+. Whiff+ alone failed on AAA run value (§49). The stack (K+, BB%, GB%, Whiff+) beats K−BB% at forecasting next-season runs at AAA, and does so in every pair.

**Shipped (display-only, "MLB model on AAA data", MLB scale constants):** `aaa_export.py` adds `k_proj`, `k_plus` and `prevention_plus` to `aaa_pitcher_models.json`, covering 4,089 AAA pitcher-seasons with ≥ 50 taken pitches. AAA season means:

| | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|
| K+ | 98.0 | 99.3 | 100.3 | 99.9 |
| Prevention+ | 94.8 | 96.9 | 98.1 | 97.6 |

`web_export.overlay_aaa_p7` passes the three fields. Control+ and Pitching+ stay MLB-only.

## §67 Hitter Marcel projection + measured ranges (D-36, owner: "projection percentiles with visuals"), pre-registered 2026-10-27 before any read

**Design.** Marcel for hitters, three rates: wOBA (Savant scale: Σ woba_value / Σ woba_denom), K/PA and BB/PA. Seasons S, S−1, S−2 are weighted 5/4/3 by PA. Each rate is regressed with 1,200 PA of that season's league rate. No age term, no park term: this is the textbook baseline, built so a range can be drawn around it. `hitter_proj.py`.
- **Pairs:** S → S+1 for every S in the mart with 2 prior seasons available. S−1 and S−2 enter when present.
- **Pair floor:** ≥ 100 PA in S and ≥ 100 PA in S+1. Regular season only.
- **Benchmark:** persistence, his S rate.
- **Bootstrap:** hitter-clustered across pairs (`judge.cluster_w`), 2,000 draws, seed 13.

**Claims (each read once):**
- Marcel beats persistence in Δr on the S+1 rate, separately for wOBA, K/PA and BB/PA.
- A rate is CONFIRMED if the pooled 95% CI lower bound is > 0 **and** Marcel wins in all pairs but at most one.
- Only CONFIRMED rates ship.

**What this cannot show, up front.** Marcel beating persistence is the expected result: regression to the mean nearly always wins. A pass is a sanity gate, not evidence of a skill model. The deliverable is the range. For each shipped rate, take 5-fold hitter-grouped residuals (S+1 actual − Marcel), bin them by PA in S (100–250, 250–400, 400–550, 550+), and use each bin's 10th and 90th percentiles. That gives "80% of past hitters projected from this much playing time landed here". It is the same construction as the pitcher ranges (`proj_bands.py`). Marcel has no fitted parameters, so these residuals are already out of sample. The fold split is only there to keep the procedure identical to the pitcher one.

**Result (read once, 2026-10-27).** n = 353 / 358 / 362 / 353 hitter-pairs (2022→23 … 2025→26; the mart starts in 2020, so 2022 is the first S with two prior seasons).

| rate | pooled Δr Marcel − persistence [95% CI] | pairs won | verdict |
|---|---|---|---|
| wOBA (Savant scale) | **+.053 [+.022, +.081]** | 4/4 | **CONFIRMED** |
| K/PA | **+.020 [+.008, +.033]** | 3/4 | **CONFIRMED** |
| BB/PA | **+.048 [+.031, +.068]** | 4/4 | **CONFIRMED** |

**80% ranges (S+1 actual − Marcel; 10th, 90th percentiles) by PA in S:**
- wOBA: 100–250 PA −.057/+.052; 250–400 −.060/+.032; 400–550 −.059/+.035; 550+ −.040/+.033.
- K/PA: −.051/+.059, −.045/+.064, −.041/+.052, −.038/+.039.
- BB/PA: −.030/+.030, −.029/+.026, −.027/+.023, −.021/+.032.

**Read:** the sanity gate passes, as expected. The wOBA ranges are lopsided: Marcel overshoots more often than it undershoots. It carries no age term, and next season's hitters skew older and include the ones who held their jobs. The ranges keep that asymmetry rather than hiding it. **Shipped:** all three rates, display-only, as "Marcel baseline" with these measured ranges (`hitter_proj.projections`).

## §68 Our own xwOBA (D-01), pre-registered 2026-10-27 before any read

**Model.** Per ball in play, LightGBM multiclass over {out, 1B, 2B, 3B, HR}. Features:
- exit velocity and launch angle;
- spray angle from the side he batted on, so pull is positive;
- the batter's Savant sprint speed that season (league median when missing);
- the batter's stand.

The expected wOBA of a ball is Σ p(class) × that season's Savant wOBA weight for the class, with out = 0. Errors and fielder's choices count as outs, as in Savant's wOBA.

Every estimate is cross-fit: 5 folds grouped by **batter**, so no hitter's own balls train the model that scores him (the Stuff+ memorization lesson, section 17). Seasons 2020–2026 are pooled, with a season indicator as a feature so the run environment can shift. Hitter xwOBA = (Σ BIP estimate + Σ woba_value on non-BIP PA) / Σ woba_denom, the same roll-up as Savant's. `xwoba_model.py`.

**Claim (read once):** our hitter xwOBA in S beats **Savant's** xwOBA in S at predicting wOBA in S+1. The metric is pooled Δr over pairs S → S+1, S = 2020…2025, with ≥ 100 PA in both seasons. The bootstrap is hitter-clustered, 2,000 draws, seed 13. CONFIRMED if the 95% CI lower bound is > 0 **and** ours wins in at least 5 of 6 pairs.

**Reported, not judged:**
- same-season r with wOBA, ours vs Savant's;
- the BIP-level log loss of the cross-fit model;
- the pitcher-side version (xwOBA-against in S vs S+1 wOBA-against, ≥ 100 BF). Pitchers control contact quality weakly, so this side is descriptive only.

**What it means either way.** A pass means spray angle and sprint speed add forecast signal beyond Savant's EV/LA estimate. The site would then show our xwOBA as the headline, with Savant's beside it. A fail means the site keeps Savant's (attributed) and ours is not shipped. Spray-aware expected stats are known to help on pulled fly balls, so a pass is plausible but not given: Savant's estimate is strong, and the S+1 target is noisy.

## §69 Swing decisions: Decision+ / IZA / OZA / dRV per 100 (D-02), pre-registered 2026-10-27 before any read

**Model.** Two LightGBM regressions on `delta_run_exp` (batter-positive): one fit on swings, one on takes. Bunts, pitchouts, intentional balls and HBP are excluded.
- **Features:** plate_x mirrored so + is inside to him; plate_z normalized to his strike zone, (z − sz_bot)/(sz_top − sz_bot); balls; strikes; pitch family (FB/CT/BR/OS); release speed; pfx_x (mirrored); pfx_z.
- **Cross-fit:** 5 folds grouped by **batter**. Every pitch gets E_swing and E_take from models that never saw that batter.
- **Decision value per pitch:** dRV = E[chosen] − E[other]. That is (E_swing − E_take) if he swung, (E_take − E_swing) if he took. It prices the choice at league-average execution, so contact quality is left out by design.

**Per hitter-season:**
- dRV/100 over all pitches.
- IZA: dRV/100 on in-zone pitches (Statcast zones 1–9).
- OZA: the same on out-of-zone pitches.
- Decision+ = 100 + 10 z of dRV/100, over MLB hitter-seasons with ≥ 100 PA. `decision_model.py`.

**Claim (read once).** Decision+ in S beats **−Chase% in S** (O-Swing%, the simple decision stat) at predicting **(BB% − K%) in S+1**. Pooled Δr over pairs S = 2020…2025 with ≥ 100 PA in both seasons. Hitter-clustered bootstrap, 2,000 draws, seed 13. CONFIRMED if the 95% CI lower bound is > 0 **and** Decision+ wins in ≥ 5 of 6 pairs.

**Reported, not judged:**
- split-half reliability (odd/even pitches) of dRV/100, IZA and OZA at the median sample;
- year-to-year r of dRV/100;
- validity against Savant's swing/take run value (`lb_swing_take_*`, 2024+): r with their total runs, which mix decision and execution;
- the swing and take models' cross-fit RMSE against a count-only baseline.

**What it means either way.** A pass ships Decision+, IZA and OZA as forecast-gated hitter stats. A fail ships dRV/100 descriptively only, under the "descriptive, not a forecast" label, or not at all if the split-half reliability is below .3.

## §70 Park factors: component, by hand, EB-shrunk (D-04), pre-registered 2026-10-27 before any read

**Method.** Venues come from the MLB Stats API schedule (game_pk → venue id), so temporary homes count as their own parks: TB at Steinbrenner Field in 2025, ATH in Sacramento from 2025. Components are 1B, 2B, 3B, HR, BB and SO per PA, by batter hand.
- **Raw ratio:** for a team-venue spell, the rate in its home games (both teams' PA) divided by the rate in its road games (both teams' PA), over the same seasons. Team quality appears on both sides and cancels.
- **Window:** seasons S−2..S.
- **EB shrinkage:** the log ratio is shrunk toward 0 with weight τ²/(τ² + v). Here v = 1/home events + 1/road events (Poisson), and τ² is the method-of-moments between-venue variance per component and hand.
- **Display:** PF = 100 × exp(shrunk log ratio): the venue's own effect, not halved. `park_factors.py`.

**Claim, per component, pooled over hands (read once).**
- **Test:** the EB PF from S−2..S beats the raw single-season S ratio at predicting the venue's raw home/road log ratio in S+1.
- **Metric:** pooled Δr over S = 2022…2025, venue-clustered bootstrap, 2,000 draws, seed 13.
- **CONFIRMED** if the CI lower bound is > 0 **and** r(EB PF, S+1) > 0 in every pair.
- Components that pass ship as park factors. Components that fail are not shown.

**Reported, not judged:**
- the r of each PF with S+1, by hand;
- τ per component;
- a cross-check that Coors (COL) and Great American (CIN) rank top-3 in HR and Coors leads 3B. These are the known extremes.

**Result (read once, 2026-10-27): NOT CONFIRMED.** Cross-fit BIP log loss is .4305. The run used 2,054 hitter-pairs.

| | pooled Δr ours − Savant on S+1 wOBA [95% CI] | pairs won | same-season r with wOBA (ours / Savant) |
|---|---|---|---|
| hitters (judged) | **−.027 [−.041, −.012]** | 1/6 | .878 / .826 |
| pitchers (reported) | −.027 [−.041, −.012] | 0/6 | .865 / .811 |

Per pair, hitters, Savant → ours: .429→.418, .482→.483, .510→.475, .492→.445, .503→.488, .403→.348.

**Read:** spray angle and sprint speed make xwOBA **more descriptive and less predictive**. They explain more of the same season's wOBA, but they forecast the next season worse than Savant's EV/LA estimate, on both sides of the ball. That fits a story in which pull-side air contact turns into hits partly through park and placement luck that does not repeat, while EV/LA carries the repeatable part. This is not tested further here. **Decision:** the site keeps Savant's xwOBA (attributed) as the expected stat. Ours is not shipped. D-01 closes on this negative result, and `results/xwoba_own_*.csv` stays for the record.

**Result (read once, 2026-10-27).** Floors were set in code before the read: a window needs ≥ 2,000 home PA (this drops neutral-site one-offs), and S+1 needs ≥ 1,000 home PA.

| component | pooled Δr EB(3-yr) − raw(S) on S+1 [95% CI] | r(EB, S+1) > 0 every pair | r by hand L / R | verdict |
|---|---|---|---|---|
| 1B | +.044 [−.034, +.106] | yes | .35 / .49 | NOT CONFIRMED |
| 2B | **+.173 [+.089, +.245]** | yes | .40 / .41 | **CONFIRMED** |
| 3B | **+.144 [+.051, +.218]** | yes | .48 / .26 | **CONFIRMED** |
| HR | **+.102 [+.012, +.183]** | yes | .38 / .40 | **CONFIRMED** |
| BB | −.039 [−.169, +.104] | no | .07 / −.13 | NOT CONFIRMED |
| SO | **+.059 [+.007, +.110]** | yes | .62 / .53 | **CONFIRMED** |

Between-venue SD of the log ratio (τ), L/R: 1B .03/.06, 2B .10/.09, 3B .38/.28, HR .12/.13, BB .03/.01, SO .06/.06.

**Sanity check, reported honestly: half right.** On triples, the top 3 are AZ, COL and KC (expected). On HR, the top 5 for 2024–26 are LAD, PHI, NYY, CIN and MIL. CIN is 4th, but **COL is not in the top 5**. The pre-registered expectation was stale: recent Statcast-era park factors also put Dodger Stadium first for HR, and Coors' edge is in hits in play, not home runs. The method is not changed after the read.

**Read:** 1B and BB factors are mostly noise year to year; the 3-year EB does not beat a single season reliably. They are not shown. **Shipped:** PF for 2B, 3B, HR and SO, by hand, 2024–26 window, `results/park_factors.json`. They are descriptive venue effects; nothing on the site is park-adjusted with them yet (that is D-04's second half, after this read).

**Result (read once, 2026-10-27): NOT CONFIRMED as a forecast; ships descriptive.** The run used 2,059 hitter-pairs. Automatic balls and strikes (pitch-clock calls) were excluded along with bunts, pitchouts and HBP, as "not a decision" (set in code before the read).

| | value |
|---|---|
| Δr Decision+ − (−Chase%) on S+1 BB% − K% [95% CI] | **−.069 [−.103, −.035]**, 0/6 pairs |
| per pair (−Chase% → Decision+) | .278→.245, .213→.178, .305→.267, .242→.136, .224→.135, .286→.177 |
| split-half r (Spearman-Brown) at ≥ 100 PA, n 3,086 | dRV/100 .69 (.82); IZA .46 (.63); OZA .77 (.87) |
| year-to-year r, dRV/100 | .71 |
| r with Savant swing/take total runs (2024–26, n 900) | .52 |
| cross-fit RMSE, swing / take / count-only | .310 / .042 / .223 |

**Read:** decision value is a stable, measurable trait. Its reliability is high and it holds year to year. It agrees moderately with Savant's swing/take runs, which also price execution. It does **not** forecast next-season BB% − K% better than chase rate alone: BB − K carries contact skill, which the decision metric leaves out by design, and chase rate is the decision component most tied to strikeouts. **Shipped, under the pre-registered fail rule** (reliability ≥ .3): dRV/100, IZA, OZA and Decision+ on hitter rows and profiles, labelled **descriptive, not a forecast**.

## §71 xRV per pitch: xRV/100, xRV+, luck (D-03), pre-registered 2026-10-27 before any read

**Model.** Every pitch's expected run value, pitcher-positive (−`delta_run_exp`), given what the pitch was and where it went, not what the hitter did with it. `xrv_model.py`.
- **Outcome leg:** a LightGBM multiclass over {ball, called strike, whiff, foul, HBP, ball in play}.
- **Contact leg:** a LightGBM regression of the ball in play's xwOBA-valued run value: Savant `estimated_woba_using_speedangle` mapped to runs by the count-specific line used in judge.py, fit on the training folds.
- **Features:** release speed; pfx_z; pfx_x and release_pos_x mirrored so + is arm side; spin rate; extension; release height; plate_x mirrored so + is inside to the batter; plate_z normalized to his zone; balls; strikes; same-hand flag.
- **Run values:** each class's mean −`delta_run_exp` by count, from the training folds.
- **Per pitch:** xRV = Σ p(class) × RV(class, count), with the ball-in-play term taken from the contact leg.
- **Cross-fit:** 5 folds grouped by **pitcher** (the memorization rule). Every pitch is scored by models that never saw its pitcher.

**Per pitcher-season:**
- xRV/100 = 100 × mean xRV.
- xRV+ = 100 + 10 z of xRV/100 among MLB pitcher-seasons with ≥ 100 batters faced.
- Luck = RV/100 − xRV/100.

**Claim (read once).** xRV/100 in S beats **RV/100 in S** at predicting **RV/100 in S+1**. Pooled Δr over pairs S = 2020…2025, ≥ 100 batters faced in both seasons. Pitcher-clustered bootstrap, 2,000 draws, seed 13. CONFIRMED if the 95% CI lower bound is > 0 **and** xRV/100 wins ≥ 5 of 6 pairs.

**Reported, not judged:**
- the same Δr against judge.py's observed xRV/100 (actual outcomes, balls in play valued by xwOBA) as the stronger baseline;
- per-pitch r of xRV with the actual run value (the college bar is .563);
- year-to-year r of xRV/100;
- multiclass log loss against a count-only baseline.

**What it means either way.** A pass ships xRV/100, xRV+ and luck on pitcher rows, docs and percentiles as forecast-gated. A fail ships xRV/100 and luck descriptively under the "descriptive, not a forecast" label, and xRV+ not at all.

**Result (read once, 2026-10-27): NOT CONFIRMED.** Δr (xRV/100 − RV/100, predicting next RV/100) = +.009, 95% CI [−.043, .061]. xRV/100 wins 2 of 6 pairs (2020→21 and 2025→26), n = 1,986 pitcher pairs over 4,518,351 cross-fit pitches.
- Against judge.py's observed xRV (actual outcomes, balls in play valued by xwOBA): −.084 [−.131, −.034], 0 of 6. The pitch-quality model loses to the luck-adjusted record.
- Per-pitch r with actual run value: .200. That is not comparable to the college .563, which was scored on a different target.
- Year-to-year r of xRV/100: .636.
- Multiclass log loss: .990 against 1.489 for count-only.

**Shipped, under the pre-registered fail rule:** xRV/100 and luck (RV/100 − xRV/100) on MLB pitcher rows and profiles, labelled descriptive, not a forecast. No xRV+.

## §72 Park-adjusted wOBA and FIP (D-04 part 2), pre-registered 2026-10-28 before any read

**Method.** Per plate appearance: each confirmed §70 component (2B, 3B, HR, SO) is divided by its venue factor for the batter's hand, using the factor from the window S−2..S of that season. The venue comes from the Stats API game venue. Singles, walks and HBP are not adjusted, because their factors failed §70. Venues below the §70 floor (2,000 home PA in the window) get factor 1. `park_adjust.py`.
- **Adjusted wOBA (hitters, Savant scale):** Σ woba_value/PF over Σ woba_denom.
- **Adjusted FIP (pitchers):** HR/PF_HR and K/PF_SO in the FIP formula, with the same season constant.

**Claim (read once).** Among players who **changed home team** between S and S+1, with ≥ 200 PA (hitters) or ≥ 200 batters faced (pitchers) in both seasons, the year-to-year r of the adjusted stat beats that of the raw stat. Two tests:
- hitters: r(adj wOBA_S, adj wOBA_S+1) − r(wOBA_S, wOBA_S+1);
- pitchers: the same for FIP.

Pooled Δr over pairs S = 2022…2025 (the windows need S−2), player-clustered bootstrap, 2,000 draws, seed 13. A test is CONFIRMED if its 95% CI lower bound is > 0. Judged separately.

**Reported, not judged:** the same Δr among players who stayed with one team (expected ≈ 0); the largest raw-to-adjusted moves (sanity: Coors and Petco hitters).

**What it means either way.** A confirmed stat ships on rows, docs and percentiles as `wobaParkAdj` / `fipParkAdj`. An unconfirmed one is not shown.

**Result (read once, 2026-10-28): NOT CONFIRMED, both.** Among players who changed teams:
- **Hitters** (adjusted wOBA): Δr = +.002, 95% CI [−.016, .022], n = 249.
- **Pitchers** (adjusted FIP): Δr = −.008, [−.028, .013], n = 265.

Stayers, reported: hitters −.003, pitchers −.002, both about 0 as expected. The largest 2025 moves are about .01 of wOBA (PHI and LAD hitters down; AZ and SEA up). Coors does not lead them, because singles, the component Coors inflates most, failed §70 and are not adjusted. With only 2B, 3B, HR and SO factors, the adjustment is too small to sharpen year-to-year signal.

**Shipped:** nothing, per the pre-registration. The venue factors stay on team pages (§70).

## §73 Platoon Whiff+ splits (D-07), pre-registered 2026-10-28 before any read

**Method.** The input is the cross-fit, pitcher-grouped per-pitch Whiff+ prediction (`cache/pred_s4_bb.parquet`), which already comes from separate models per batter hand (`train_mlb.py`). For each pitcher × season × site type × batter hand:
- **Raw split:** the mean prediction, scaled on the type's frozen TRAIN mean and sd (`type_grades.type_table`). Both hands share one scale, so the league platoon edge stays in the number.
- **Shrunk split:** pulled toward the pitcher's own all-hands type prediction, with a weight of 150 pitches (K_SHRINK).
- **CI:** 95% normal interval over this season's pitches (mean ± 1.96·sd/√n).
- **Also:** usage vs each hand. `platoon_splits.py`.

**Claim (read once).** Unit: pitcher × site type, with ≥ 50 swings from each hand in both S and S+1. The predicted gap (Whiff+ vs LHH minus vs RHH, shrunk) in S forecasts the **observed** whiff/swing gap in S+1 better than the observed gap in S does:
- Δr = r(pred gap_S, obs gap_S+1) − r(obs gap_S, obs gap_S+1);
- pairs S = 2021…2025;
- `stack.pooled_dr`, pitcher-clustered, 2,000 draws, seed 13.

CONFIRMED if the 95% CI lower bound is > 0.

**Reported, not judged:**
- r(raw pred gap_S, obs gap_S+1);
- YoY r of the shrunk predicted gap;
- the n.

**What it means either way.** If CONFIRMED, the per-hand grades ship as the better forecast of a pitch's platoon split. If NOT CONFIRMED, they still ship, labelled descriptive (shape-based, this season), because usage by hand and the per-hand grades describe the arsenal either way. Nothing gets coloured as a forecast. Pitching+ by hand is not in scope: its per-pitch cache has no batter-hand column.

**Result (read once, 2026-10-28): NOT CONFIRMED.** Δr = −.058, 95% CI [−.104, −.011], n = 2,035 pitcher × type pairs. The observed whiff gap in S forecasts S+1 better than the shrunk predicted gap in every pair but 2025→26:
- r(obs) ranges .37 to .47;
- r(pred) ranges .34 to .39.

Reported:
- raw predicted gap, Δr = −.050 [−.098, −.002];
- YoY r of the shrunk predicted gap, .84.

The model's gap is a very stable property of shape, but some platoon skill sits outside shape: release angle, deception, sequencing.

**Shipped:** per-hand Whiff+ (raw, shrunk, CI) and usage on profile arsenal rows, labelled descriptive. Not coloured as a forecast (`results/platoon_splits.csv`, `platoon_SEALED.json`).

## §74 Tunnel+ on MLB (D-06), pre-registered 2026-10-28 before any read

**Method.** A port of the college `compute_tunnel_plus.py`: method only, refit on Statcast, with no TrackMan data or coefficients. Script: `tunnel_plus.py`.
- **Unit:** consecutive pitches of different site types in one plate appearance (`game_pk` + `at_bat_number`, `pitch_number` n and n+1, same pitcher).
- **Geometry:**
  - Position from Statcast's nine-parameter fit. x0 and z0 at y = 50 ft are backed out from `plate_x`/`plate_z` at y = 17/12 ft.
  - Commit point at 23.8 ft (Baseball Prospectus, ≈175 ms; the same constant the college uses).
  - Separations at commit and at the plate, in inches.
  - Gate: the reconstruction at `release_pos_y` must match `release_pos_x/z` to a median ≤ 2 in, or nothing is graded.
- **Chase model, per season:** logistic on out-of-zone second pitches (Statcast zone 11–14; swing = the bake's SWING set). Features:
  - stuff of the second pitch: the pitcher-season-type mean of the cross-fit Whiff+ prediction, on the pooled scale (the analog of the college `abs_grade`);
  - velo, velo drop, balls, strikes, platoon, to-type dummies;
  - plate separation;
  - commit separation.

  AUC and incremental AUC are measured on 30% of games held out (crc32).
- **Lift:** predicted chase at the actual commit separation minus predicted chase at the separation implied by the plate separation (a per-season linear fit).
- **Shrinkage:** EB per (pitcher, from → to), with k deconvolved on cells ≥ 15.
- **Pitcher grade:** pairing type removed, then shrunk once with its own k. Scale: 100 + 10 × lift / pairing SD, clipped 70–130.
- **Floors:** the college's own. 3 pairs shown, reliability ≥ .25 ranked, pitcher ranked at ≥ 150 pairs.

**Claim (read once).** Pitchers with ≥ 150 pairs in S and S+1, pairs S = 2021…2025. Let resid = next-season chase rate (all out-of-zone pitches) residualized on this-season chase rate, OLS within each season.
- Δr = r(Tunnel+ lift_S, resid) − r(chase_S, resid).
- `stack.pooled_dr`, pitcher-clustered, 2,000 draws, seed 13.
- CONFIRMED (adds information beyond prior chase) if the 95% CI lower bound is > 0. The college finding was +.016 added R², CI above 0.

**Reported, not judged:**
- head-on Δr = r(Tunnel+_S, chase_S+1) − r(chase_S, chase_S+1);
- pitcher grade YoY vs chase YoY on the same pitchers;
- pairing grade YoY (≥ 15 pairs both seasons);
- per-season AUC, incremental AUC, k, the reconstruction error.

**What it means either way.** Tunnel+ ships descriptive, as the college does: pitcher grade plus a pairing table on profiles and a board. If CONFIRMED, the glossary says it adds information beyond prior chase. If NOT CONFIRMED, it says it does not. Nothing is coloured as a forecast.

**Result (read once, 2026-10-28): CONFIRMED.**
- **Δr = +.091, 95% CI [+.026, +.156], n = 1,311 pitcher pairs.** All 5 pairs were positive: r with the residualized next-season chase .06, .10, .02, .17, .10.
- **Head-on** (reported): −.266 [−.329, −.204]. Prior chase is far the better forecast of chase, the same pattern as college.
- **YoY:**
  - pitcher Tunnel+ .64 vs chase rate .49 on the same pitchers;
  - pairing grade .68 (11,042 pairing pairs at ≥ 15 both seasons). College was .25, because MLB samples are larger.
- **Chase model, per season:**
  - AUC .645–.657, incremental AUC from commit separation +.017 to +.021;
  - k ≈ 11 pairs (pairing) and 40–59 (pitcher);
  - pairing SD 1.6–1.9 chase points.
- **Reconstruction at release:** median 0.03 in for 2020–25. In 2026 it was 0.24 in horizontal and 0.94 in vertical, which is under the 2 in gate; the 2026 `release_pos` values appear to be measured differently.

**Shipped:** `tunnelPlus` on pitcher rows/docs and a `tunnelPairs` table on profiles, labelled descriptive (it does not forecast chase head-on), with the added-information finding stated in the glossary. Artifacts: `results/tunnel_pitchers.csv`, `tunnel_pairs.csv`, `tunnel_SEALED.json`.

## §75 Fielding range, outs and runs above average (D-12), pre-registered 2026-10-28 before any read

**Method.** A port of the college framework (`baseballDefense/DEFENSE_METHODS.md` §3): method only, refit on Statcast. Script: `defense_mlb.py`.
- **Chances:** regular-season balls in play with EV, LA and spray, excluding home runs and bunts.
- **Difficulty:** P(out) by an average defense. LightGBM on:
  - EV, LA, spray angle, `hit_distance_sc` and batter hand;
  - IF/OF alignment;
  - outs, and runners on (force);
  - the batter's Savant sprint speed that season (league median if missing);
  - home park.

  Fit **within each season** (the 2026 coordinate change, kb-session ledger), out-of-fold by 5 game-grouped folds. Out = an out made on the play (field_out, force_out, double/triple plays, fielder's choice out, sac fly). Errors are not converted.
- **Responsibility:** a multiclass model P(position 1–9 | the same ball features), fit on outs (`hit_location`), applied to every chance.
- **Credit:**
  - an out goes to its `hit_location` fielder: +(1 − p);
  - a non-out debits each position k by −p × resp_k.

  Fielders are identified from `fielder_k` on that pitch.
- **Runs:** credit × (mean `delta_run_exp` of non-outs − of outs), per season × ground ball vs air.
- **Reliability:** odd/even game split-half, Spearman-Brown. k = mean chances × (1 − rel)/rel, then shrunk = raw × n/(n + k).

Positions 3–9 are graded; the pitcher and catcher take responsibility mass but are not graded.

**Gates (each judged, read once).** Two groups: IF (3–6) and OF (7–9).
1. **Calibration:** out-of-fold decile gap ≤ .03 in every season.
2. **External validity:** player-season OAA (Σ credit) vs Savant `outs_above_average`, among players on Savant's board in their Savant primary group, seasons 2020–2026. Pass if the 95% CI lower bound of r is > .50, player-clustered bootstrap, 2,000 draws, seed 13.

**Reported, not judged:**
- AUC;
- k;
- YoY r of ours vs Savant OAA's YoY on the same players (≥ Savant qualifier both seasons);
- r with Savant `fielding_runs_prevented`.

**Ships** for a group passing both gates: `oaaOurs`, `fieldRunsOurs` (raw and shrunk) and position breakdowns on MLB hitter rows/docs, labelled as a site model beside Savant's. A failing group does not ship.

## §76 Framing runs and Framing+ (D-13), pre-registered 2026-10-28 before any read

**Method.**
- **Population:** taken pitches (`called_strike` / `ball` / `blocked_ball`) with location.
- **P(called strike):** LightGBM on:
  - plate_x and plate_z normalized to the batter's zone;
  - balls, strikes, batter and pitcher hand;
  - pitch type, velo and movement (pfx_x, pfx_z).

  No catcher, umpire or park. Fit within each season, out-of-fold by 5 catcher-grouped folds (no catcher in its own fit).
- **Runs per pitch:** (strike − p) × (mean `delta_run_exp` of a ball − of a called strike in that count, that season), flipped to fielding-positive. Credited to `fielder_2`.
- **Framing+:** 100 + 10 × z of shrunk runs per 100 taken pitches, among catchers with ≥ 2,000 taken pitches that season. Shrinkage k is measured by odd/even game split-half, as in §75.
- The umpire random effect waits for D-15.

**Gate (judged, read once).** Catcher-season framing runs vs Savant `rv_tot`, catchers on Savant's board, 2020–2026. Pass if the 95% CI lower bound of r is > .80, catcher-clustered bootstrap, 2,000 draws, seed 13.

**Reported, not judged:**
- AUC and calibration;
- k;
- YoY r of ours vs Savant's on the same catchers.

**Ships if it passes:** `framingRunsOurs`, `framingPlus` and reliability on MLB hitter rows/docs, beside Savant's.

## Failure diagnosis of §68, §71, §73 (owner rule 2026-10-28: a failed gate gets a data vs handling vs modeling diagnosis)

These checks are descriptive. None re-reads a sealed claim.
- **§68 (xwOBA), likely our error (handling).**
  - **The input:** spray came from `hc_x/hc_y`, which marks where the ball was **fielded**. On ground balls, outs cluster at fielders' positions and hits at the gaps they got through, so the input partly encodes the outcome.
  - **The signature:** same-season r with wOBA .878 vs Savant's .826, but a worse next-season forecast.
  - **Not the cause:** sprint speed was already a feature.
- **§71 (xRV), partly a data-handling error.**
  - **The data:** in 2026 Statcast changed the zone. Mean `sz_top` was 3.36–3.44 ft for 2020–25 and is 3.215 in 2026 (ABS definition); called-strike z_norm moves .446 → .462.
  - **Our handling:** the pooled model has no season term, so 2026 location inputs are miscalibrated. §69 Decision+ has the same exposure.
  - **The rest** (+.009 overall) looks like a genuine near-tie.
- **§73 (platoon), a modeling mismatch.** The predicted gap came from a **shape-only** Whiff+ model. The observed whiff gap depends heavily on where each hand is attacked, which a shape model cannot see.
  - Ruled out: a rate mismatch. The prediction is whiff per swing (mean .230 on swings, .227 on takes; observed .234).

The three re-tests below reuse season pairs whose v1 results were already seen. Each makes one diagnosis-driven change, fixed here before any read.

## §77 xwOBA v2: no fielded-location spray on ground balls (re-test of §68), pre-registered 2026-10-28

**The change.** Same model, folds and roll-up as §68, except that spray is set to missing when LA < 10° (ground balls, where `hc` is the fielded spot). Air-ball spray stays, since there `hc` is close to the landing spot. Run with `xwoba_model.py --v2`.

**Judged (read once):**
1. **Diagnosis test:** Δr(v2 − v1) on S+1 wOBA, pooled over §68's pairs, hitter-clustered bootstrap, seed 13. The leak hypothesis is CONFIRMED if the CI lower bound is > 0.
2. **Against Savant, as §68:**
   - **headline:** CI lower bound > 0 and v2 wins at least 5 of 6 pairs. Our xwOBA becomes the headline, with Savant's beside it.
   - **non-inferior:** CI lower bound > −.010. Ours ships beside Savant's, labelled as our model.
   - **otherwise:** ours is not shipped.

**Reported:** same-season r (the leak signature should fall toward Savant's), BIP log loss.

## §78 xRV v2: season term for the 2026 zone change (re-test of §71), pre-registered 2026-10-28

**The change.** Same model as §71, plus a `season` feature in both legs. The per-pitch class probabilities are saved to `cache/xrv_v2_pitches.parquet` for §79. Run with `xrv_model.py --v2`.

**Judged (read once):** the §71 claim unchanged (xRV/100 beats RV/100 at forecasting RV/100 in S+1; CI lower bound > 0 and ≥ 5 of 6 pairs).

**Reported:** Δr(v2 − v1), and the 2025→26 pair on its own.

**Ships:** xRV/100 v2 replaces v1 on the site either way, because it is the corrected model. It is labelled forecast-gated only if CONFIRMED.

## §79 Location-aware platoon gap (re-test of §73), pre-registered 2026-10-28

**The change.**
- Predicted whiff per swing for each pitch = p_whiff / (p_whiff + p_foul + p_bip), from the §78 outcome model. That model includes location relative to the hitter, count and same-hand.
- Per pitcher × site type × hand, average it over the pitches thrown, then shrink toward the pitcher's all-hands type mean with k = 150.
- The predicted gap is L minus R. Script: `platoon_splits.py --v2`.

**Judged (read once):** the §73 claim unchanged. Δr = r(pred gap_S, obs gap_S+1) − r(obs gap_S, obs gap_S+1); ≥ 50 swings each hand in both seasons; S = 2021…2025; CI lower bound > 0.

**Ships:** if CONFIRMED, location-aware expected whiff% vs LHH/RHH goes on the arsenal rows as the forecast. Otherwise it ships descriptively beside the shape split.

### §75 / §76 results (read once, 2026-10-28)

**§76 framing: CONFIRMED.**
- r with Savant `rv_tot` = **.950 [.935, .963]**, n = 414 catcher-seasons.
- Model: AUC .981–.991, decile gap ≤ .009 every season.
- Split-half rel .79, k = 1,385 taken pitches.
- YoY: ours .53 vs Savant's .57.

**Ships:** `framingRunsOurs` and `framingPlus`.

**§75 range: NOT CONFIRMED, both groups.**

| | r vs Savant OAA [95% CI] | n | calibration | split-half rel / k | YoY ours / Savant |
|---|---|---|---|---|---|
| IF | .498 [.434, .563] (fails > .50) | 1,138 | fails | .32 / 676 | .37 / .44 |
| OF | .691 [.645, .730] (passes) | 665 | fails | .37 / 442 | .36 / .64 |

AUC .907–.919. Decile gaps .020 / .042 / .034 / .035 / .036 / .041 / .043 (2020–26).

**Failure diagnosis (owner rule):**
- **Calibration, our error (modeling).**
  - A raw LightGBM out-probability is miscalibrated by ~.04 at the tails.
  - The college model hit the same thing and shipped an isotonic recalibration (hit-chance amendment 1, DEFENSE_METHODS "models chosen on calibration"). I did not port that step.
  - Fixable without touching the gate.
- **IF validity, mostly a data limit, partly ours.**
  - Public Statcast has no fielder starting positions or time to ball, and those are the core of Savant's infield OAA. Our credit therefore mixes positioning into skill. That is a real limit of the data, not the thing we are measuring.
  - Our part: responsibility is learned only from outs, and alignment is coarse (Standard / Strategic / Shade).
- **OF YoY .36 vs Savant .64, partly ours.** No hang time is used. Distance + LA + EV stand in for it, and Statcast's catch probability uses hang time and the fielder's distance to the ball.

## §80 Range v2: isotonic recalibration (re-test of §75), pre-registered 2026-10-28

**The change.** Within each season, the out-of-fold P(out) is mapped through an isotonic regression. The map is itself cross-fit: it is fit on the other 4 game folds' OOF predictions and applied to the held-out fold. Credit and runs are recomputed from the recalibrated p. Nothing else changes. Run with `defense_mlb.py --v2`.

**Judged (read once):** the §75 gates unchanged, per group:
- decile gap ≤ .03 in every season;
- r vs Savant OAA, CI lower bound > .50.

**Reported:** Δ YoY vs §75.

**Expected:** calibration should pass. IF validity is likely still near .50, because the limit is mostly the data. If IF fails again, the IF numbers are not shipped, and the OF numbers ship if OF passes.

### §80 result (read once, 2026-10-28)

Calibration now passes every season: decile gaps .0045 / .0016 / .0023 / .0023 / .0035 / .0029 / .0016.

| | r vs Savant OAA [95% CI] | calibration | verdict | split-half rel / k | YoY ours / Savant |
|---|---|---|---|---|---|
| IF | .495 [.429, .560] | pass | **NOT CONFIRMED** | .31 / 683 | .37 / .44 |
| OF | .679 [.632, .719] | pass | **CONFIRMED** | .37 / 458 | .35 / .64 |

**Diagnosis, as expected:** recalibration fixed the part that was our error (calibration). IF validity did not move (.498 → .495), which points to the data limit: public Statcast has no fielder starting positions. That is not a fixable modeling error with these inputs.

**Shipped:** OF range (LF/CF/RF) and framing, in `defense/{id}-{season}.json.gz` and a Defense tab on profiles. IF range is not shipped.

**Still worth a future attempt (not tested here):**
- infield starting-position proxies from `if_fielding_alignment` × batter spray history;
- responsibility learned from all chances, not only outs.

### §77 / §78 / §79 results (read once, 2026-10-28)

- **§77 xwOBA v2 (no ground-ball spray): NOT SHIPPED.**
  - Diagnosis test, hitters: v2 − v1 = +.004 [−.002, +.010], NOT CONFIRMED. Pitchers (reported): +.010 [+.003, +.017].
  - vs Savant: −.022 [−.035, −.009], 0 of 6 pairs.
  - Same-season r .864 (v1 .878, Savant .826).
  - **Diagnosis:** the fielded-location leak was real but explains only a small part of the gap. Spray-aware xwOBA stays more descriptive and less predictive than Savant's EV/LA (+ sprint on weak contact) estimate. The site keeps Savant's xwOBA.
- **§78 xRV v2 (+ season): NOT CONFIRMED.**
  - Δr vs RV/100 = +.008 [−.043, +.061], 2 of 6 pairs.
  - v2 − v1 = −.001 [−.010, +.008], so the 2026 zone change was not the cause.
  - vs observed xRV: −.085.
  - **Diagnosis:** a genuine near-tie with actual run value. The validated forecast of run prevention remains Prevention+ (§52). xRV v2 replaces v1 on the site, labelled descriptive.
- **§79 location-aware platoon gap: NOT CONFIRMED.**
  - Δr = −.105 [−.148, −.061], worse than §73's shape gap (−.058).
  - YoY of the predicted gap .71.
  - **Diagnosis:** at ≥ 50 swings per side, the observed gap is reliable enough (r .37–.47 with next season) that a league-average model, which never sees the pitcher, cannot beat it. The forecast should be an EB blend of the observed gap shrunk toward the model gap, and that is a new claim. The shape split stays on the site as descriptive.

## §81 Range v3: Savant fielder start positions + physics hang time (re-test of §80 IF), pre-registered 2026-10-28 before any read

**Why.** §80 left IF validity at .495 and called the cause a data limit: there are no fielder start positions. Savant publishes each fielder's *average* start position, per season × batter hand × runner on first × shift (`/visuals/position_data`; feet, x < 0 toward third, y = depth from home). Per-play start positions and measured hang time remain private.

**The change** (`defense_mlb.py --v3`; this also implies the §80 recalibration):
- **Start position per play, per fielder 3–9:**
  - the fielder's season average for that batter hand;
  - the runner-on-first subset when r1 = 1;
  - the shifted mean when `ifa` is "Infield shift", backed out as (n_all·m_all − n_std·m_std)/(n_all − n_std).
  - **Fallbacks:** the position's league mean for that hand where the fielder has fewer than 10 plays in the cell.
- **New features:**
  - **OF:** for each of 7/8/9, the distance from that start to the ball's fielded point (fx, fy), and the minimum of the three.
  - **IF:** for each of 3–6, the lateral distance from the start to the ball's path (start distance × |sin(start angle − spray)|), and the minimum of the four.
  - **Hang time** for air balls (la ≥ 10): flight time from a drag-only trajectory. Drag is solved per ball so that the range matches `hit_distance_sc`; NaN for grounders.
  - **Required speed** for OF = min distance / hang time.
- **Nothing else changes:** folds, OUTS, credit, runs, gates.

**Judged (read once), per group, gates as §75/§80:**
- decile gap ≤ .03 in every season;
- r vs Savant OAA, CI lower bound > .50.

**Reported:** Δr vs §80 per group; YoY; split-half k.

**Expected:**
- IF should rise, because positioning was the stated missing piece. If IF stays below the gate with start positions in, the remaining limit is per-play positioning and reaction or route data, which is still not public.
- **Risk:** the averages are fielder-specific, so a fielder who positions well gets less credit for the same play. Savant's OAA conditions on start position too, so this matches the benchmark's definition.
- **Shipping:** OF ships v3 only if it passes and r ≥ the §80 r; otherwise §80 OF stays.

### §81 result (read once, 2026-10-28)

Calibration passes every season (decile gaps ≤ .0043). AUC is .956–.957.

| | r vs Savant OAA [95% CI] | §80 r | verdict | split-half rel / k | YoY ours / Savant |
|---|---|---|---|---|---|
| IF | .580 [.526, .630] | .495 | **CONFIRMED** | .23 / 1026 | .27 / .44 |
| OF | .721 [.678, .757] | .679 | **CONFIRMED** (beats §80) | .40 / 418 | .38 / .64 |

**Diagnosis.**
- The §80 call holds. The IF limit was the missing start positions, which is a data gap and not our modeling: adding Savant's average starts lifted IF r by +.085 and cleared the gate.
- IF reliability and YoY fell (k 683 → 1026; YoY .37 → .27). That is the expected cost of conditioning on a fielder's *own* average positioning: credit for standing in the right place is removed, and what remains is noisier range. Savant does the same; their YoY of .44 comes from per-play starts and measured routes, which are not public.
- Scale against Savant 2025: slope IF .51, OF .61; SD IF 5.6 vs 6.9, OF 6.1 vs 7.4. Elite CFs remain compressed (Crow-Armstrong 2025: 5.3 vs Savant 24).
- **Could this be our error?** Partly. The hang-time proxy is drag-only, so it runs about 1 s short on deep flies. The average start also hides per-play depth. Both understate the hardest catches, which are exactly the elite ones. A measured hang time is not public.
- **Shipped:** IF and OF range from v3 (`defense_chances_v3.parquet`, `defense_v3_SEALED.json`). Framing is unchanged (§76).

## §82 Whiff+ hand-matched grading (bug fix), pre-registered 2026-10-28 before any read

**The bug.** `train_mlb.season_grades` scores each pitch class against the frozen league reference for the batter hand of that class's *first* pitch of the season (`side = c["stand"].iloc[0]`). Every other pitch in the class uses that hand's reference too, whatever hand it was thrown to. The references differ by hand (BB: L .294 / sd .076 vs R .309 / sd .070), so the published grade carries a first-batter accident. Skubal 2025: published 114.0, quirk replica 114.6, hand-matched 110.6.

**The fix** (`whiff_hand.py`): each pitch is scored against its own (class, batter hand) reference, using the same frozen references (TRAIN 2023–24 pitcher means over swings, ≥ 10 swings) and the same cross-fit predictions (`cache/pred_s4_bb.parquet`). Grade = clip(100 + 10 × mean z, 50, 175), with ≥ 5 pitches. A quirk replica uses the identical code with the first-pitch hand. It reproduces the published grades at r .99987 (max gap 1.6), so A vs B isolates the fix.

**Judged (read once):** `judge.py` (GOAT_LO=2020, --skip 2023, as §47), A = quirk replica, B = hand-matched. Non-inferiority: composite Δr CI lower bound > −.010.

**Reported, not judged:** the per-outcome Δr. K+ (§50) and Prevention+ (§52) are re-scored with the fixed Whiff+ as input, as a robustness re-run in the §44-fix pattern: same ridges and sealed split, no choice changes. They must stay above 0 to ship the cascade.

**Shipping:**
- **If non-inferior:** `crossfit_v2_s4_bb_grades.csv` becomes the hand-matched grades (the old file is kept as `_quirk`), `p7_export` is re-run, and the pitcher families are rebaked.
- **If it fails:** the correct grade still ships, because the old one is a bug. The failure is diagnosed in the §82 result.

**Expected:** a near-tie (r between versions ≈ .97), with a small gain for pitchers whose first batter of a class was atypical.

### §82 result (read once, 2026-10-28)

`judge.py` (GOAT_LO=2020, --skip 2023), A = quirk replica, B = hand-matched, 5 pairs (n 558–578):

| outcome | Δr (B − A) [95% CI] |
|---|---|
| K/PA | +.0011 [−.0032, +.0056] |
| (K−BB)/PA | −.0001 [−.0046, +.0047] |
| RV/100 | +.0024 [−.0020, +.0069] |
| xRV/100 | +.0023 [−.0025, +.0071] |
| **composite** | **+.0014 [−.0025, +.0056] → NON-INFERIOR (ships)** |

- **Versions:** they agree at r .994; the mean absolute change is 0.79 points.
- **Cascade (robustness re-run, same ridges and split, no choices):**
  - K+ sealed Δr CI [+.015, +.069] (was [+.014, +.068]);
  - Prevention+ sealed RV [+.041, +.134] (was [+.041, +.131]);
  - Prevention+ sealed xRV [+.037, +.164] (was [+.038, +.163]).
  - All stay confirmed.
- **AAA (`s7_aaa`):** same fix, same rule. The replica matches the published grades at r .99987; mean change 0.86. No new AAA read: the holdout is spent (§49).
- **Shipped:**
  - `train_mlb.season_grades` now scores each pitch against its own hand's reference.
  - `crossfit_v2_{s4_bb,s7_aaa}_grades.csv` are the hand-matched grades (pre-fix copies kept as `_pre82`, replicas as `_quirk`).
  - `p7_export` and `aaa_export` were re-run.
- **Diagnosis:** our handling error, not the model. Predictions and references were right; only the reference lookup was wrong. Skubal 2025: 114.0 → 110.65.

## §83 Do the grades under-credit hard fastballs with steep approach angles? Pre-registered 2026-10-28 before any read

**Owner question.** On the Whiff+ breakdown, a hard four-seamer with a steep approach angle shows a big negative "approach angle & release height" bar next to a big positive velocity bar. Does the model penalize steepness too much when the velocity is elite (an interaction it failed to learn), or is the penalty real? Nothing is added to the site or the card until this is read.

**Scope.** Four-seamers (FF), MLB, regular season, 2023–2025. Sinkers (SI) are run the same way and reported, not judged. Velocity = `release_speed`. Steepness = −`hvaa` (the model's own input: VAA residualized on plate height, so steeper means steeper than his location implies). Both are z-scored within season among FF.

**Bins (display only, never judged).** 1-mph velocity bins (≤ 91, 92 … 99, ≥ 100) × steepness quintiles within season. Each cell shows n, observed, predicted and the gap; cells under 300 swings (T1) or 1,000 pitches (T2) are greyed out. Finer bins than this go below the sample a cell needs. The judged tests below are continuous.

**T1, Whiff+ (per swing).** Outcome: whiff on swing. Prediction: the shipped cross-fit `pred` (`cache/pred_s4_bb.parquet`, out of fold by pitcher). Logistic regression with offset logit(pred) and terms velo_z, steep_z, velo_z × steep_z. The main terms soak up any one-way miscalibration, so only the interaction carries the claim.
- **C1 (claim):** the interaction coefficient is > 0, meaning steepness hurts less at higher velocity than the model thinks. The 95% CI (1,000-rep pitcher-cluster bootstrap) must exclude 0.
- **C2 (materiality):** in the hard-and-steep corner (velo ≥ 97, steepest quintile), observed − predicted whiff/swing ≥ +1.0 pp, with a pitcher-cluster CI excluding 0.
- **CONFIRMED only if C1 and C2 both hold.**
  - C1 without C2: real but too small to act on.
  - The corner gap ≈ 0: the penalty is the data's, not the model's.
- Reported, not judged: the soft-and-flat corner (velo ≤ 93, flattest quintile), and one-way calibration by velocity alone and by steepness alone.

**T2, Pitching+ (per pitch).** Outcome: the `location_plus.target` per-pitch value. Prediction: the cross-fit f from `pitching_plus.py` (P_raw, `cache/pitchval_raw.parquet`). The fit is dev pitchers 2023–24 only; sealed pitchers stay untouched. Linear regression of the residual y − f on velo_z, steep_z and velo_z × steep_z.
- **C1:** the interaction is in the pitcher-favourable direction, CI excluding 0.
- **C2:** the corner residual is ≥ 0.5 runs per 100 pitches in the pitcher's favour, CI excluding 0.
- Same verdict rule as T1.

**T3, Prevention+ (pitcher-season, dev pitchers only).** Population: pitchers with ≥ 200 FF in season S and ≥ 300 pitches in S+1 (pairs 2023→24, 2024→25). Regress next-season RV/100 (pitcher-positive) on Prevention+ in S plus his FF mean velo_z, mean steep_z and their product.
- **C1:** the product's coefficient is > 0, CI excluding 0 (pitcher-cluster bootstrap).
- Next-season xRV/100 is reported alongside, not judged.
- **Expected underpowered:** a few hundred pairs. The minimum detectable effect is reported with the result, and a null here is "not detectable", not "no effect".

**Read once,** after the current MLB/AAA rebake finishes, in one script (`pipeline/fb_steep_interaction.py`), the code written before the read.

**Expected.** A small positive interaction in T1 (C1 plausible); C2 unlikely, because gradient-boosted trees can learn this interaction from about a million FF swings. T2 and T3 are near 0.

**If CONFIRMED:** a separate pre-registration for the fix (an explicit velo × hvaa feature in the FF class, re-gated on the §47 judge), never a hand adjustment.
**If not:** a failure diagnosis (data vs handling vs modeling), then the display-only question (a velocity × approach-angle interaction bar from SHAP interaction values) comes back to the owner.

**§83 amendment (owner, 2026-10-28, still before any read).**
- **Seasons widened to 2021–2025** for T1 and T2, because the cross-fit Whiff+ predictions and the Pitching+ per-pitch values cover 2020–26. 2020 (60 games) and 2026 (partial) stay out.
- **T3 pairs are now 2021→22 through 2024→25**, dev pitchers only; the sealed pitchers stay untouched.
- **A coarse 3×3 display grid** (velocity terciles × steepness terciles within season) is added beside the fine 1-mph grid, as a stability check: a pattern the fine grid shows and the coarse one does not is read as noise.
- **Reported, not judged:** the T1 and T2 verdicts re-run on 2023–25 alone (the original scope), so the widening cannot carry the claim by itself. The judged tests, thresholds and verdict rule are unchanged.

### §83 result (read once, 2026-10-28)

`fb_steep_interaction.py` on 2021–25 MLB (full output in `results/fb_steep_interaction_83.json`). Verdict rule as registered.

| | C1: velo × steepness interaction [95% pitcher-cluster CI] | C2: hard-and-steep corner (≥ 97 mph, steepest quintile), observed − predicted | verdict |
|---|---|---|---|
| **T1 Whiff+**, FF swings (564,884; 1,485 pitchers) | +.0084 [−.0035, +.0215] (logit) | **−0.65 pp [−2.35, +1.13]**, n 5,068 | **NOT CONFIRMED** |
| **T2 Pitching+**, FF pitches, dev pitchers (945,983) | +0.009 [−0.027, +0.046] runs/100 | +0.29 [−0.05, +0.70] runs/100, n 7,328 | **NOT CONFIRMED** |
| **T3 Prevention+**, 911 pitcher-season pairs (448 dev pitchers) | −0.020 [−0.066, +0.039] next RV/100 | — | **NOT CONFIRMED** (MDE 0.075 at 80% power) |
| SI (reported) | T1 +.0147 [−.035, +.043]; T2 −0.039 [−0.085, +0.035] | T1 +0.25 pp; T2 −0.62 | both not confirmed |

The 2023–25-only re-runs agree: not confirmed for T1 and T2, FF and SI. Soft-and-flat corner: T1 +0.20 pp [−1.18, +1.72], T2 +0.06.

**Read.** Steepness costs whiffs at every velocity, and Whiff+ already prices that cost the way the data does. On the fine grid, flattest to steepest four-seamers lose 5.5 points of whiff/swing at 94 mph (22.1 → 16.6) and 1.7 at 98 (24.5 → 22.8). The cost does shrink with velocity, but the predictions shrink with it (21.9 → 17.1 and 24.8 → 22.9). In the hard-and-steep corner the model slightly *over*-predicts whiffs. The negative approach-angle bar on a hard thrower's card is the data's penalty, not a missed interaction.

**Diagnosis (gate-failure rule).**
- Data: the corner holds 5,068 swings, so its CI is about ±1.7 pp. A true 1 pp miss could not have been confirmed there. The point estimate sits on the other side of 0, though, and the interaction test (C1) has full power and its CI spans 0.
- Handling: rows were asserted aligned with the shipped predictions, and the synthetic demo recovers a planted interaction and rejects a null.
- Modeling: not implicated.

**Pitching+ lean, not a finding.** The pitcher-favourable corner residual (+0.29 runs/100, CI touching 0) and the coarse grid's positive top-velocity row (+0.13 to +0.22) hint that hard four-seamers carry a little value Pitching+ misses at every steepness, a velocity effect rather than a steepness one. It is below the registered threshold. A test of it would need its own pre-registration.

**Ships:** nothing. The model is unchanged. The owner's display question (a velocity × approach-angle bar on the Whiff+ card) stays open: the data says the penalty is real, so such a bar would only show a small shared effect.

## §84 Does Pitching+ under-credit hard four-seamers? Pre-registered 2026-10-28 before any read

**Owner question.** §83's Pitching+ lean: in the dev pitchers' data, four-seamers at the top of the velocity range carried a little pitcher-favourable value that Pitching+ did not credit (+0.13 to +0.22 runs/100 in the coarse grid's top-velocity row, at every steepness). Owner said test it. Nothing changes on the site until this is read.

**Data: sealed pitchers only** (`location_plus.sealed`), whose four-seamers no Pitching+ fit or §83 read has touched. FF pitches, MLB regular season 2021–25 (same window as §83; 2020 and partial 2026 stay out). SI is run the same way and reported, not judged. The dev pitchers' numbers are re-printed beside the sealed ones for reference only: the lean was found there, so they can't carry the claim.

**Residual.** As in §83 T2: r = −((y − v) minus its count mean), the count mean taken over all pitch types of the sealed pitchers' rows; y = `location_plus.target` (batter-positive), v = the cross-fit P_raw value (`cache/pitchval_raw.parquet`). Positive r = more pitcher value than Pitching+ credits. Velocity = the model's `velo`, z-scored within season among FF.

- **C1 (claim):** OLS slope of r on velo_z is > 0, with the 95% CI (1,000-rep pitcher-cluster bootstrap, seed 84) excluding 0.
- **C2 (materiality, same bar as §83):** mean r on FF ≥ 97 mph is ≥ +0.5 runs/100 pitches, CI excluding 0.
- **CONFIRMED only if C1 and C2 both hold.** C1 alone: real but immaterial. Neither: not confirmed.
- **Reported, not judged:** the slope with steep_z as a control (velocity, not steepness, should carry it), the 1-mph velocity bins (≤ 91 … ≥ 100; cells under 1,000 pitches greyed), the slope's minimum detectable effect at 80% power, and the ≥ 97 residual per season.

**Expected.** The dev lean (about +0.2 runs/100 at the top) sits below the C2 bar, so CONFIRMED is unlikely; the live question is whether C1 holds (real but immaterial) or the lean was noise. Sealed is about a fifth of the pitchers, so the top-velocity cell's CI will be roughly ±0.4 runs/100.

**Read once** (`pipeline/fb_velo_residual.py`, code written and demo-checked before the read). **If CONFIRMED:** a separate pre-registration for the fix (a velocity feature check in Pitching+'s FF model, re-gated on the §47 judge), never a hand adjustment. **If not:** a data vs handling vs modeling diagnosis; Pitching+ stays as is.

### §84 result (read once, 2026-10-28)

`fb_velo_residual.py` on sealed pitchers' 2021–25 pitches (`results/fb_velo_residual_84.json`). Verdict rule as registered. Residual in runs per 100 pitches, pitcher-favourable positive.

| | C1: slope on velo_z, per SD [95% pitcher-cluster CI] | C2: mean residual, FF ≥ 97 mph | verdict |
|---|---|---|---|
| **Sealed FF** (219,397 pitches; 294 pitchers) | +0.031 [−0.052, +0.111] (MDE 0.117) | +0.35 [+0.14, +0.53], n 28,830 | **NOT CONFIRMED** |
| Sealed SI (reported) | +0.047 [−0.118, +0.169] | +0.05 [−0.33, +0.43] | not confirmed |
| Dev FF (reference, not judged) | +0.065 [+0.015, +0.112] | +0.20 [+0.07, +0.32] | (would read "real but immaterial") |

Steepness-controlled slope on sealed FF: +0.016 [−0.075, +0.103]. ≥ 97 by season, sealed FF: +0.06, +0.43, +0.31, +0.34, +0.49.

**Read.** Pitching+ does not under-credit velocity on the held-out pitchers. The ≥ 97 residual is positive and its CI clears 0, but it is below the 0.5 bar, and the 1-mph bins show why: every velocity bin of sealed four-seamers sits about +0.1 to +0.5 runs/100 (≤ 91: +0.16; 95: +0.35; 97: +0.52; 98: −0.03; ≥ 100: +0.36), with no rise from slow to hard. That is a level offset on these pitchers' four-seamers as a whole, not a velocity effect. The dev slope (+0.065 per SD, CI above 0) did not replicate.

**Diagnosis (gate-failure rule).**
- Data: sealed is a fifth of the pitchers. The slope's MDE (0.117 per SD) is about twice the dev estimate, so a true effect of the dev size could not have been confirmed here. A null on C1 is "not detectable", not "no effect"; even if real, the dev size is ~0.07 runs/100 per SD of velocity, about 1 run a season for a hard thrower.
- Handling: same residual code as §83 T2; the synthetic demo recovers a planted slope and rejects a null.
- Modeling: the FF-wide offset (four-seamers slightly better than Pitching+ says, at every velocity) is the only thing worth a look. It moves FF against other pitch types, not hard against soft FF. Not acted on here; noted for the next Pitching+ calibration check.

**Ships:** nothing. Pitching+ is unchanged.
