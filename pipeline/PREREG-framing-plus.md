# Pre-registration: Framing+ (D-13 leg 1) — our called-strike model

Written 2026-10-28, BEFORE any model was read or scored. Owner directed web-fork-agent
to build the queued model request (COLLABORATION.md, request 1); the model lane has
not claimed it.

## Question

How many strikes (and runs) does each catcher steal on called pitches, holding pitch
location, count, handedness and pitch characteristics fixed — measured by a model that
never saw that catcher's own pitches.

## Population

Regular-season taken pitches (description = called_strike or ball), Statcast 2020-26
(~2.26M). Catcher = `fielder_2`. All catchers with >= 2,500 taken pitches in a season
are scored for that season (Savant's framing board lists ~60-80/season; we do not trim
to their list for scoring, only for the gate comparisons).

## Features (no catcher, no umpire — both are the effects being measured)

- Location: `plate_x`, `plate_z`, and zone-normalised forms — `z_h` = height in zone
  half-heights off the batter's own `sz_top`/`sz_bot` midpoint, `x_w` = plate_x in
  half-widths (fixed plate width).
- Count: balls, strikes.
- Context: batter stand, pitcher throws, pitch family (site codes), release_speed,
  pfx_x, pfx_z.
- Era: season as categorical (absorbs the 2026 ABS zone-convention break the same way
  §78's season term does; 2020-22 | 2023-25 | 2026 remain different measurement eras
  and the season term does not claim to bridge them).

## Model

LightGBM binary (the pipeline's booster discipline), 5-fold GroupKFold grouped by
CATCHER: an out-of-fold prediction never comes from a fold that saw that catcher —
the memorization rule that governs every pitcher model on this site, applied to the
player being credited. Single fixed seed; determinism required.

## Scoring

Per taken pitch: residual = is_called_strike − p_hat(strike). Per catcher-season:
strikes above expectation = Σ residual; Framing+ runs = Σ residual × rv_gap(count,
season), where rv_gap is the empirical mean run-value difference between a called
strike and a ball in that count, computed per season from `delta_run_exp` on the same
taken pitches. Positive = strikes stolen. Framing+ display = 100 + 10 × z among that
season's 2,500+ catchers (the site scale), only if gates pass.

## Gates (pass/fail decided by these numbers alone)

1. **Agreement with the referee**: per-season Pearson r of our catcher-season runs vs
   Baseball Savant's `lb_catcher_framing` rv_tot, 2021-26, on their listed catchers
   (>= 2,500 taken pitches ours). PASS if mean r >= 0.85 and no season < 0.70.
   KILL if mean < 0.80 or any season < 0.60.
2. **Year-to-year stickiness, non-inferior**: ours vs Savant's own YTY r
   (consecutive seasons, >= 2,500 pitches both). PASS if our r >= 0.75 × theirs.
   KILL if ours < 0.45 outright.
3. **Location dominance** (sanity, not a pass gate): plate_x/plate_z must be the top
   two LightGBM gains. If any context feature outweighs location, the model is
   reading the catcher through the pitcher — diagnosed, not shipped.

Reported whatever the outcome: OOF AUC + Brier overall and per season, per-zone
agreement spot checks, and the full gate table in `results/framing_plus.json`.

## Kill outcome

If gates fail: no Framing+ grade ships; the site keeps Savant's framing runs as the
reference (they are already wired), and the failure is documented here and in the
ledger. Partial passes (e.g. runs agree, stickiness doesn't) ship the descriptive
strikes-above-expectation WITHOUT the 100/10 grade, labelled.


## Addendum (2026-10-28, after the first read, before the gate decision)

First run's gate1 read r = -.946 against `lb_catcher_framing` rv_tot while every
other diagnostic agreed (AUC .986, location-dominant gains, YTY .602 vs their
.600). Diagnosis, not score-shopping: the rv_gap valuation was built on batting-
team `delta_run_exp`, making OUR runs negative-good, while the referee's rv_tot is
positive-good (confirmed by correlating their board with our sign-unambiguous
strikes-above-expectation, which ranks with it at +.94). The fix normalizes OUR
scale to catcher-positive (gap = mean RV(ball) - mean RV(strike)); |r| is unchanged
by construction, only its orientation. Gates below are then decided on the aligned
scales exactly as pre-registered above.
