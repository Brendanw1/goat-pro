# Pitching+ v6: pre-registration (MLB design lab, stage 1 of 2)

Written 2026-11-04, before any outcome in this study was computed. Committed before `baselines.py` or `ladder.py`
reads a target. Public MLB Statcast only. Every try is logged in `EXPERIMENTS.md`.

## Question

Which **single-model** Pitching+ (one trained artifact; no averaging or stacking of separately trained grades) best
beats a Stuff+ + Command+ blend on MLB? The design is frozen here, then carried to college (stage 2).

"One model" means one fitted object maps a pitch's features to its value. A softmax booster whose classes are pitch
outcomes, combined with fixed run-value constants, is one model (one booster, trained jointly on one loss). A shared-
trunk neural net with several heads trained on a summed loss is one model. Two boosters trained separately and
multiplied together is NOT one model under this rule and is not a candidate.

## Data and splits

- Dev: MLB Statcast regular season 2021-2026 (savant_mart `pitches_all`, the full-season parquets listed in
  `savant_mart/mart.py FULL_SEASONS` plus day-files). 2020 is not used (60 games, spent).
- These seasons are SPENT for pitch-level claims (`docs/ml-hardening-plan.md` §2). A new random pitcher split is a weak
  seal: those pitchers' seasons were read in aggregate by earlier studies. Stage-1 numbers are design evidence, not
  confirmation.
- **Lockbox**: 30% of pitchers, `zlib.crc32(("ppv6-lockbox:" + str(mlbam)).encode()) % 10 < 3`. Never in any fit,
  tuning, scale or constant until the read. Read once, after FROZEN.md is committed.
- **Dev folds**: the other 70%, pitcher-grouped 5 folds, `zlib.crc32(("ppv6-fold:" + str(mlbam)).encode()) % 5`.
  Every graded pitch is scored by the fold model that never saw its pitcher. Tuning (step e) is nested: inner
  pitcher-grouped splits inside each outer training fold only.
- **Sealed bank** `cache/sealed/statcast` (2015-2019): opened only after the design is frozen AND the lockbox is
  read, as the single confirming read, under SEAL.json rules (no outcome column computed until a frozen model has
  scored it). Era drift (TrackMan tracking, ball changes) noted in advance; a frozen feature-only harmonization recipe
  must exist before the read.
- Feature harmonization (no outcomes): the documented Hawk-Eye boundaries (2022|2023: IVB, extension; 2025|2026:
  release height) are corrected by the within-pitcher, within-pitch-type mean shift at that boundary minus the median
  shift at the other adjacent-season boundaries (aging baseline). The 2026 ABS zone is carried by an `abs26` flag.

## Units and windows

- Per-pitch value v = model prediction minus its mean in the same (season, balls, strikes) cell over training
  pitches (count-normalized). Pitcher-season grade = mean v x 100 (runs per 100 pitches, pitcher-positive), then
  100 + 10 z on the training pitcher-season distribution for display. Scopes: pitcher, pitch type
  (Statcast `pitch_type`), pitch type x batter hand.
- Predictive windows (pooled): (1) next season, pairs 2021->22 ... 2025->26, >= 200 pitches in each; (2) within
  season, grade on the pitcher's first-half games, outcome on the second half, >= 150 pitches in each half.
- Outcomes: RV/100 = -sum(delta_run_exp)/pitches x 100; K-BB% per batter faced; RA9 (runs charged while he was on
  the mound, per 27 outs) and FIP (season constant) for next season only, >= 40 IP-equivalent (120 outs) in S+1.
- Descriptive: same-season r with RV/100 and with RA9; split-half (odd/even games) reliability with the pitch
  count where Spearman-Brown r reaches .50; calibration slope (outcome RV/100 on grade RV/100); SHAP credit by group
  (shape, location, count, platoon, context); r by season.

## Baselines (step 1)

- B1 Stuff+: the goat-pro cross-fit Whiff+ per pitch (`cache/pitch_models.parquet`, 4 pitcher folds, trained 2023-24).
- B2 Command+ analogue: per pitch, distance from the pitcher's own mean location for (pitch type, batter hand) in the
  same season, leave-one-game-out; grade = minus the mean, z-scored within pitch type. No outcome.
- B3 Blend: ridge of the outcome on [B1, B2] z-grades, weights fit on the training folds only and applied to the held
  fold (separately per outcome).
- B4 FanGraphs Stuff+ / Location+ / Pitching+ (`sp_*`) and PitchingBot (`pb_*`) season leaderboards, as an external
  sanity check only. They are in-sample (FanGraphs trains on these seasons), so a FanGraphs edge is a ceiling, not a
  bar. If our best design cannot approach FanGraphs Pitching+ on next-season RA9, the cause is diagnosed before the
  ladder goes on.

## Ladder (one change at a time, in this order)

Start M0: one LightGBM regressor over all pitch classes and both hands, features = shape (velo, IVB, arm-side HB,
spin, extension, release height, arm-side release side, velo/IVB/HB differential to the pitcher-season fastball,
hvaa, spin_eff), location (arm-side plate x, plate z), count (balls, strikes), platoon (same-hand flag), pitch type
code, abs26. Target T0 = realized run value (-delta_run_exp), count-normalized. Fixed parameters for steps a-d
(learning rate .05, 63 leaves, min child 500, feature/bagging .8, grouped early stopping on an inner pitcher split, up
to 1,500 rounds); training rows subsampled to 40% of pitches per training fold for steps a-d (stated: §30/G4 show
capacity is not the bottleneck; scored on 100% of held-out pitches).

- (a) Target. T1: balls in play valued at E[run value | Savant xwOBA (EV/LA), count] (per-count linear map fit on
  training pitches). T2: T1 plus called pitches valued umpire-neutral, p(called strike | location, count, hand, abs26)
  x strike value + (1 - p) x ball value. Each count-normalized.
- (b) Structure. M1: one softmax booster over 8 terminal outcomes {ball/HBP, called strike, whiff, foul, BIP in four
  xwOBA bins}, value = sum of p x fixed per-(season, count) mean run value of that outcome (from training pitches).
  Equivalently a jointly trained multi-head model of swing, whiff|swing, called strike|take, foul|contact and BIP
  value (the heads are ratios of the class probabilities). Thunder (not run here): shared-trunk MLP with heads for the
  same decomposition, one summed loss (THUNDER_RUN.md).
- (c) Location: c1 zone-edge-relative (plate z scaled by sz_top/sz_bot, signed distance to the nearest zone edge);
  c2 distance from own target (leave-one-game-out mean by pitch type x hand); c3 count-aware intent (own target by
  pitch type x hand x count state ahead/even/behind, leave-one-game-out).
- (d) Shape: d1 relative physics (IVB, HB, VAA residual vs expected given velo, release, extension, arm angle and
  plate height, fit on training pitchers' features only); d2 extra fastball differentials (spin, release); d3 arm angle.
- (e) Hyperparameters: Optuna (TPE) over a wide space nested inside each outer fold, grouped early stopping, objective
  = inner pitcher-level r of grade (odd games) with RV/100 (even games); Huber vs L2 for regressors; monotone
  velocity (+1, fastballs) where physics justifies it.
- (f) Roll-up: empirical-Bayes shrinkage of pitcher, pitch-type and type x hand means toward the scope mean,
  k = within-pitcher per-pitch variance / between-pitcher variance, fit on training pitchers only.

Decision rule for each rung: J = mean of the pooled-window delta r on next RV/100 and on next K-BB% (candidate minus
current best), 2,000 bootstrap draws resampling pitchers once across all pairs (`judge.cluster_w` rule). Keep the
change only if the 95% CI of J excludes 0 on the positive side. Ties keep the simpler design.

## Lockbox read (step 4) and decision

Candidates tested at the lockbox: the frozen design (and the Thunder net if it ran and was frozen beside it). Holm
correction over candidates x {next RV/100, next K-BB%}. PASS if, vs the blend B3: delta r on next RV/100 > 0 (Holm
one-sided p < .05), and delta r on next K-BB% has 95% CI lower bound > -.03 (non-inferiority). Whiff% is reported,
not a gate. Also reported vs Stuff+ alone. Then, and only then, the sealed 2015-19 bank may be read once.

## Amendment 1 (2026-11-04, after rungs a-b were read, before rung f was run)

- Ladder rungs run on 100% of training-fold pitches, not 40%: a full fit takes about 2 minutes, so the subsample was
  not needed. The 40% runs of M0/T1/T2/M1 stay in EXPERIMENTS.md as tries.
- Added rung **f2, location-shrunk scoring** (exploratory; it was not in the original ladder, so it is labelled
  post-hoc in every table): the same trained model is scored with plate location moved toward the pitcher's own
  leave-one-game-out target for that pitch type and hand, loc = target + lambda x (actual - target), lambda in
  {0, .25, .5, .75, 1}. One artifact; only the scoring input changes. lambda is chosen on dev folds by J and the
  choice counts as five tries. It is kept only under the same J rule, and the lockbox read would test it as its own
  Holm candidate.
