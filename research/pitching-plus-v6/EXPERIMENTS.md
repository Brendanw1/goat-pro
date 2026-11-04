# Pitching+ v6: experiment log (every try counts)

Dev = 70% of MLB pitchers 2021-26 (1,270 pitchers, 2.92M graded pitches); lockbox 30% (549 pitchers) unread.
Pitcher-scope rows: pooled next-season (>= 200 pitches each) + within-season second half (>= 150 each), 3,872
rows / 886 pitchers. J = mean of delta r on next RV/100 and next K-BB% vs the reference; [95% CI], 2,000 pitcher-
cluster bootstrap draws. Levels are r with next RV/100 / next K-BB%. Raw output: `results/results.json`.

| # | Experiment | vs | J [CI] | dRV / dKBB | levels RV / KBB | next RA9 / FIP r | split-half (n50) | kept |
|---|---|---|---|---|---|---|---|---|
| 0 | B1 Stuff+ (Whiff+ cross-fit) | - | - | - | .255 / .348 | .172 / .299 (FG sample) | - | baseline |
| 0 | B2 Command+ analogue | - | - | - | .055 / .134 | .046 / .010 | - | baseline |
| 0 | B3 blend (dev OOF weights) | Stuff+ | +.020 [+.006, +.036] | +.005 / +.036 | .259 / .384 | .167 / .282 | - | baseline |
| 0 | Pitching+ v5 (shipped, §56) | - | - | - | .259 / .340 | .190 / .316 | - | reference |
| 1 | M0_T0 (40% rows) | Stuff+ | -.020 [-.069, +.027] | -.010 / -.031 | .244 / .317 | .202 / .261 | .60 (219) | start |
| 2 | M0_T1 (40%) | M0_T0 | +.013 [-.001, +.029] | +.007 / +.019 | .252 / .336 | .199 / .283 | .62 (208) | no |
| 3 | M0_T2 (40%) | M0_T0 | +.015 [-.004, +.035] | +.005 / +.024 | .250 / .341 | .197 / .303 | .61 (213) | no |
| 4 | M1_mc softmax (40%) | M0_T0 | +.011 [-.011, +.034] | -.001 / +.023 | .243 / .340 | .204 / .279 | .56 (263) | no |
| 5 | M0_T0 (100%) | Stuff+ | -.001 [-.042, +.042] | +.004 / -.006 | .259 / .342 | .218 / .302 | .61 (212) | new base |
| 6 | M0_T1 (100%) | M0_T0 | +.002 [-.010, +.015] | -.001 / +.006 | .258 / .347 | .210 / .305 | .61 (215) | no |
| 7 | M0_T2 (100%) | M0_T0 | +.006 [-.006, +.019] | +.002 / +.011 | .261 / .353 | .211 / .313 | .61 (211) | no |
| 8 | M1_mc softmax (100%) | M0_T0 | +.000 [-.013, +.014] | -.006 / +.007 | .253 / .348 | - | - | no |
| 9 | NN_mh shared-trunk net, 5 heads, one loss (256x3, CPU) | M0_T0 | -.030 [-.049, -.013] | -.041 / -.019 | .217 / .323 | .185 / .252 | .55 (274) | no |
| 10 | M0_T0 + c1 zone-edge-relative | M0_T0 | -.004 [-.011, +.003] | -.000 / -.007 | .259 / .335 | .212 / .295 | .58 (240) | no |
| 11 | M0_T0 + c2 own target (LOGO) | M0_T0 | -.002 [-.013, +.009] | +.002 / -.005 | .260 / .337 | .215 / .294 | .71 (134) | no |
| 12 | M0_T0 + c3 count-aware own target | M0_T0 | +.010 [-.001, +.022] | +.012 / +.008 | .271 / .349 | .214 / .282 | .76 (104) | no (borderline) |
| 13 | M0_T0 + d1 relative physics (Shape+ v2) | M0_T0 | -.004 [-.010, +.004] | +.001 / -.008 | .260 / .333 | .194 / .287 | .60 (220) | no |
| 14 | M0_T0 + d2 spin/release FB differentials | M0_T0 | -.003 [-.013, +.007] | +.001 / -.006 | .259 / .336 | .212 / .301 | .62 (204) | no |
| 15 | M0_T0 + d3 arm angle | M0_T0 | -.001 [-.008, +.007] | +.004 / -.005 | .263 / .336 | .206 / .296 | .61 (211) | no |
| D | M0_T0 in-sample (diagnosis, not a candidate) | - | - | - | - | .246 / .342 (FG sample) | - | - |

FanGraphs sanity check (step 1, NS window, dev pitchers with FG rows and >= 120 outs next season, n 1,117 / 490
pitchers; FG grades are fit in-sample on these seasons): r with -RA9 next season: FG Pitching+ .233, FG Stuff+ .209,
PitchingBot overall .209, our Stuff+ .172, blend .167, v5 .190, K-BB% .248, xFIP .228, SIERA .186. With -FIP next:
FG Stuff+ .416, FG Pitching+ .387, our Stuff+ .299, K-BB% .332. FG Pitching+ minus blend on RA9: +.066 [+.010, +.124].

Same-season (descriptive) r with RV/100: M0_T0 .404, c2 .438, c3 .473, NN .380, M1 ~.40 (Stuff+ lower; see
results.json). The own-target location features (c2, c3) are the only change that moves reliability and description
a lot (split-half .61 -> .76, floor 212 -> 104 pitches) but they do not move the forecast J past the rule.

## Status at the pause (2026-11-04, owner moved focus to college)

- Done: data build, baselines, FanGraphs check (FG_GAP.md), rungs a, b (GBM softmax + CPU net), c, d.
- **No rung has passed the J rule.** Current best design = M0_T0 (one LightGBM regressor, realized RV,
  count-normalized, 100% of training-fold pitches). Versus Stuff+: J -.001 [-.042, +.042]; versus the blend:
  J -.021 [-.056, +.012] (ties on next RV/100, -.042 on next K-BB%).
- **Resume at rung e** (`tune.py M0_T0@full --trials 25`, nested Optuna; or the 200-trial version on Thunder,
  THUNDER_RUN.md), then f/f2 (`rollup.py`), then step 3 (`report.py --credit`), FROZEN.md, the lockbox read.
  Candidates worth carrying into e: M0_T0 and M0_T0+c3 (borderline, best descriptive).
- Lockbox (30% of pitchers): **unread**. Sealed 2015-19 bank: **unopened**.
