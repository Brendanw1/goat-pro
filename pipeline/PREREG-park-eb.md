# Park factor as one empirical-Bayes model (results shrunk toward a carry + wall physics prior): pre-registration

Owner approved 2026-11-19. Written before any MLB fit or read below. Public data only: Statcast (mart 2020-26 and the
sealed 2015-19 bank), the MLB Stats API schedule, Savant's park-factor leaderboard, `data/park_dims.csv`. No college
data, weights or names; the college method is ported as code and constants only.

## What is being confirmed

A park factor per **venue x season x batter hand**, for balls-in-play results (wOBAcon, HR/BIP, XBH/BIP):
- **results part:** r = the cell's mean residual of the outcome against A, a launch-only model (EV, LA, spray, hand;
  no park), centred per season;
- **physics prior:** g = the cell's mean per-ball carry + wall effect, G(actual park) - G(neutral park, carry
  removed). G is a flight model (EV, LA, spray, hand, distance, P(clears), wall - landing distance). P(clears) uses
  `dong.py`'s drag flight (C_D solved so the ball lands at `hit_distance_sc` in the venue's air) against
  `park_dims.csv` + `park_offsets.csv`, softness 5 ft. Carry = the venue-season mean of log(distance / D-hat(EV, LA,
  spray, hand)) over **visiting** batters' carry balls (fly/line, LA 15-50, EV >= 80), centred per season, shrunk
  with K, batter-fold cross-fit. Neutral park = the per-angle median distance and height of the 30 parks. Removing
  carry = scaling the flight horizontally by exp(-c) (first-order, as college G4);
- **one Fay-Herriot model per stat x hand:** r = theta + e (Var s2/n), theta = beta g + u (Var tau2);
  theta_hat = beta g + n/(n + s2/tau2) (r - beta g). beta by WLS, tau2 by moments. One prior, one fit; not two grades
  averaged;
- **forecast:** gamma x theta_hat, with theta_hat from the predictor seasons t-3..t-1 pooled (same venue configuration
  as t; g against the current walls), beta/tau2 fit on predictor cells only.

This is the college method frozen in `vt_baseball/research/park-dimensions/METHOD-G5.md`, spec sha256
`4bb36b5fb4387c6beac98b39c9caaa80fe5621ee7694336f55ea41b51c6ef201` (g5.py + g5_frozen.json). Port differences, fixed
now: MLB has no full trajectory, so clearing uses dong's drag flight; MLB walls come from `park_dims.csv`; spray comes
from hc_x/hc_y; the predictor window is the prior three seasons (college used the other seasons, both directions).
College dev result (development only): within a season the physics prior describes park totals better than shrinking
toward zero; as a next-season forecast G5 beats zero but ties the regressed results factors, and the hand split cost
accuracy at college sample sizes.

Code: `pipeline/park_eb.py` (`demo`, `savant`, `dev`, `freeze`, `sealed`).

## Data

- **Balls:** regular season, `type = 'X'`, events mapped to out/1B/2B/3B/HR (errors, FC, sac flies = out; sac bunts,
  catcher interference and any `des` containing "bunt" dropped), EV, LA and hc_x/hc_y present, venue from the Stats
  API schedule (game_pk -> venue_id).
- **Era rule (AGENTS 6):** every model (A, D-hat, G, the FH hyperparameters) is fit inside one era. Hawk-Eye dev =
  2020-26 from the mart; the sealed read = 2015-19 from `cache/sealed/statcast` (TrackMan era). Nothing is pooled
  across eras. The only constants carried from dev to the sealed read are the forecast slopes, the Savant form
  choice and the carry K (below).
- **Venue configurations (fixed now, before any read).** A venue-season has physics and a cell only if
  `park_dims.csv` holds for it. First valid season: Camden 2025, Comerica 2023, Rogers 2023, Kauffman 2026, Sutter
  Health 2025 (dong.CONFIG_FROM); and, pre-2020, loanDepot 2020, Oracle 2020, Dodger Stadium 2020 (2020 renovation,
  excluded as uncertain), Daikin/Minute Maid 2017. Venues with no dims (Turner Field, Globe Life Park, the Coliseum,
  neutral sites) have no cell. Sealed cells therefore come from about 21 venues.

## Seal

- **Sealed slice:** MLB Statcast 2015-2019 regular season, `cache/sealed/statcast/{2015..2019}.parquet`,
  SEAL.json sha256 356fa922... (ml-hardening-plan §2: "SEALED, UNSPENT"; park-factor row: "gate on 2015-19 S+1").
- **This read opens it once, for this park-factor claim.** `park_eb.py sealed` refuses to run twice
  (`results/park_eb_SEALED.json` is written before the pull) and refuses a changed script (sha256 vs the freeze).
  After the read the §2 row is marked **spent for park factors**. The read touches outcome columns of every hitter
  and pitcher (events, hit_distance_sc, hc_x/hc_y), so later hitter or pitcher claims that use 2015-19 must count
  it as read in aggregate (a weak seal for them), as the P7/§101 rows do.
- **Savant park factors** (3-year rolling, by hand, 2015-2025) are fetched by `park_eb.py savant` with counts printed
  only. The sealed read uses Savant years 2015-18 as predictors.

## Development (2020-26, spent; nothing here is a claim)

`park_eb.py dev WORK` runs the whole recipe on 2020-26 and every read below with targets 2021-26. Set on dev, then
frozen: each arm's slope onto each target (gamma for G5), the Savant wOBAcon form (index_wobacon vs
index_wobacon - index_xwobacon, lower dev RMSE), carry K (outcome-free game-half rule over {25, ..., 800}). Handling
bugs found on dev are fixed before the freeze and logged under Results. `park_eb.py freeze` writes
`results/park_eb_FROZEN.json` with those constants and the sha256 of `park_eb.py`, this file, `dong.py`,
`park_factors.py`, `park_dims.csv`, `park_offsets.csv`, the dev results and the Savant files. The hash is recorded
below before the sealed pull.

## Reads and gates (sealed 2015-19; targets 2016-19)

Cells: venue x hand. Predictor = seasons t-3..t-1 within the bank, 500+ pooled balls; target season t, 300+ balls.
Every arm is the arm's predictor times its frozen dev slope. Target-n-weighted RMSE; venue-clustered bootstrap, 2,000
draws, seed 13.

- **T2 (gated): next season's launch-frame park residual**, the cell's mean outcome minus A, centred per season.
- **T1 (reported): the conventional home/road log ratio** in t (§70 `ratios`, HR, and a 1B/2B/3B/HR wOBA-weighted
  composite).
- **Arms:** zero; **G5**; EB toward zero (FH with g = 0); prior only; G5 without the hand split (diagnostic);
  **Savant** (year t-1, 3-yr rolling, by hand: index/100 - 1, frozen form); **§70 regressed results** (EB home/road
  log ratio over t-3..t-1, by hand: HR, and the wOBA-weighted 1B/2B/3B/HR composite); §70 raw single season
  (reported).

| Gate | Read | Pass if |
|---|---|---|
| **M1 park HR totals** | game-half cross-fit within season (theta_hat from the other half): HR z SD across venues (2,000+ balls) under A + theta_hat vs A, venue bootstrap | CI upper < 0 |
| **M2a/b vs zero** | T2 RMSE(zero) - RMSE(G5), wOBAcon and HR/BIP | CI lower > 0, each |
| **M2c/d vs Savant** | T2 RMSE(Savant) - RMSE(G5), wOBAcon and HR/BIP | CI lower > 0, each |
| **M2e/f vs §70** | T2 RMSE(§70 EB) - RMSE(G5), wOBAcon and HR/BIP | CI lower > 0, each |
| **M3 hitter skill** | home -> road and season s -> s+1 road; r(adjusted) - r(raw) for wOBAcon, HR, XBH; adjustment = each ball's cell theta_hat with the hitter's own balls left out; 100+ PA, 30+ BIP home and road; batter bootstrap 1,000 | all six CI lower > -.01 |
| **M4 pitcher movers** | pitchers whose home venue changed s -> s+1 (30+ home BIP, 100+ BF both seasons): r(home_s, home_s+1) both adjusted minus both raw, wOBAcon/HR/XBH allowed; pitcher bootstrap 1,000 | all three CI lower > -.01 |

Reported, not gated: wOBAcon totals; prior-only and EB-toward-zero beside G5 (totals and forecast); G5 without the
hand split; every arm on T1; FH beta/tau per stat x hand; carry K curve, SD and year-to-year r; pitcher home -> road
(the college G4.5 read) and stayers beside movers; savant coverage (missing cells score as 0).

## Decision rule

- **Method confirmed on MLB** if M1, M2a/b, M3 and M4 pass: the EB factor (physics prior + results) is a valid
  descriptive park factor that does not eat hitter skill, and the pitcher question is answered.
  - **Beats the baselines as a forecast** only if M2c-f also pass. If they fail, the regressed results factor (or
    Savant) stays the forecast and the physics prior is the explanatory layer and the thin-park prior only.
- **Ready for the college site** needs the confirmed method; whether it should replace the site's 0.45-pooled factor
  as the forecast also needs M2c-f (the college dev tie says it probably will not).
- Every failed gate gets a data / handling / modeling diagnosis, flagged if it could be our error. No site, bake or
  model change in any case; no 2027 data.

## Dev read (2020-26, spent; development, slopes fit in-sample on these pairs)

776,635 balls, 225,793 physics rows, 89% of balls at a valid configuration. Carry K 25 (curve monotone, as college);
venue-season carry SD .012 log (about 4.5 ft at 380 ft), year-to-year r .90 (146 pairs; college .67). Coors +.044.
FH: wOBAcon beta 1.09 / 1.02 (RHH/LHH), tau .009 / .012, k 1,424 / 940 balls; HR beta .74 / .67, k 927 / 996.
Forecast: 313 venue x hand cells, 29 venues, targets 2021-26. Savant form chosen: index_wobacon - index_xwobacon.

| T2 RMSE gain | wOBAcon | HR/BIP |
|---|---|---|
| zero -> G5 | +.0039 [+.0010, +.0070] | +.0015 [+.0007, +.0024] |
| Savant -> G5 | +.0009 [+.0001, +.0018] | +.0005 [+.0003, +.0008] |
| §70 EB -> G5 | +.0019 [+.0007, +.0031] | +.0009 [+.0005, +.0013] |
| EB toward zero -> G5 | +.0003 [+.0001, +.0005] | +.0000 [-.0001, +.0001] |
| G5 no hand split -> G5 | -.0001 [-.0004, +.0002] | +.0000 [-.0001, +.0002] |

Totals (30 venues): HR z SD 5.95 -> 2.05 under A + G5 (-3.90 [-4.93, -2.57]); wOBAcon 5.18 -> 2.05.
Hitters (2,974 home->road, 2,040 next-road): every r(adj) - r(raw) >= +.0025; lowest CI bound -.0027.
Pitcher movers (587; stayers 1,337): wOBAcon +.016 [-.002, +.034], HR +.024 [+.007, +.041], XBH +.005 [-.014,
+.025]; stayers -.027 / -.031 / -.016. M4 fails on dev on width (XBH lower -.014); pass line kept as registered.

**Handling bug found and fixed on dev (before the freeze).** The per-ball effect columns were written under the
outcome names `hr` / `xbh`, overwriting the HR and XBH outcomes (residuals were computed before, so the forecast
was unaffected; totals and the skill reads were not). Effects renamed `e_*`; the cached dev frame was migrated
(outcomes rebuilt from y; residual check exact) and every read re-run. A second fix: `eb70` skips a §70 window with
no venue over the §70 2,000-PA floor (2020-only windows crashed `shrink`).

## Freeze (before the sealed pull)

2026-11-19, `park_eb.py freeze`: `results/park_eb_FROZEN.json` sha256
**04c24a7e5a73aa990e1fe7a77f3ab94a167ab9096046ecbe88912401bc7d3ee7**. It holds the dev slopes (gamma: T2 wOBAcon .810,
HR .798), the Savant form, carry K 25, VALID_FROM, the floors, 22 Savant files' sha256, and sha256[:16] of
park_eb.py e1179303..., this file (as of the dev section) 7b9b3abe..., dong.py cc4f8fee..., park_factors.py
a93b030c..., park_dims.csv c1056725..., park_offsets.csv d78e2b06..., park_eb_dev.json 692edc98..., SEAL.json
356fa922.... `park_eb.py sealed` checks the script hash and refuses a second run.

## Results: sealed read (opened once 2026-11-19; the 2015-19 bank is now SPENT for park factors)

`park_eb.py sealed` -> `results/park_eb_SEALED.json` (frozen sha 04c24a7e... checked). 599,676 balls 2015-19, 67% at
a valid configuration (21 venues), 126,219 physics rows. Forecast: 160 venue x hand cells, targets 2016-19, 316,725
target balls. FH: wOBAcon beta 1.21 / .91 (RHH/LHH), HR .70 / .68.

| Gate | Read (sealed) | Pass line | Result |
|---|---|---|---|
| M1 park HR totals | HR z SD 6.72 -> 1.67 under A + G5, **-5.05 [-6.42, -3.21]** (21 venues) | CI upper < 0 | **PASS** |
| M2a wOBAcon vs zero | T2 RMSE .01743 -> .01157, **+.0059 [+.0005, +.0115]** | CI lower > 0 | **PASS** |
| M2b HR vs zero | .00644 -> .00415, **+.0023 [+.0011, +.0035]** | CI lower > 0 | **PASS** |
| M2c wOBAcon vs Savant | +.0036 [+.0003, +.0074] | CI lower > 0 | **PASS as registered, compromised** (below) |
| M2d HR vs Savant | .00533 -> .00415, **+.0012 [+.0004, +.0020]** | CI lower > 0 | **PASS** |
| M2e wOBAcon vs §70 EB | .01575 -> .01157, **+.0042 [+.0020, +.0066]** | CI lower > 0 | **PASS** |
| M2f HR vs §70 EB | .00568 -> .00415, **+.0015 [+.0006, +.0025]** | CI lower > 0 | **PASS** |
| M3 hitter skill | 2,133 home->road, 1,354 next-road: wOBAcon +.005 [-.001, +.011] / +.003 [-.002, +.007]; HR +.004 [-.001, +.008] / +.002 [-.001, +.005]; XBH +.007 [+.001, +.013] / +.001 [-.004, +.006] | all six CI lower > -.01 | **PASS** |
| M4 pitcher movers | 393 movers: wOBAcon **+.022 [+.003, +.040]**, HR **+.024 [+.008, +.040]**, XBH +.010 [-.011, +.034] | all three CI lower > -.01 | **FAIL** (XBH lower -.0112) |

Reported:
- **Physics prior vs results-only EB.** Forecast: G5 vs EB toward zero, wOBAcon +.0002 [-.0001, +.0005], HR -.0000
  [-.0001, +.0001]: a tie, as in college. Totals: HR z SD 1.67 (G5) vs 1.98 (EB toward zero) vs 4.25 (prior only).
  The forecast gain over Savant and §70 comes from the EB results part in the launch frame, not from physics.
- **Hand split:** G5 without it, T2 wOBAcon -.0003 [-.0007, +.0000], HR -.0000; on T1 wOBAcon the pooled-hand form is
  better, -.0018 [-.0035, -.0004]. The split does not pay on MLB either.
- **T1, the conventional home/road log ratio:** G5 vs zero wOBA +.012 [-.002, +.030], HR +.015 [+.000, +.031]; vs
  Savant wOBA +.005 [-.003, +.016], **HR -.012 [-.025, +.001]** (Savant's HR index is better at the point); vs §70
  wOBA -.002 [-.008, +.003], HR +.000 [-.009, +.011]. On the conventional target G5 does not beat either baseline.
- **Pitchers home->road** (the college G4.5 read): every CI lower bound >= -.013; points -.005 to +.006. Stayers:
  -.026 / -.017 / -.024 (the shared-park artefact, as expected).

### Failure diagnoses

- **M2c (data, plus our handling; flagged as ours).** Savant serves no xwOBAcon index for 2015-16, so the frozen
  form (index_wobacon - index_xwobacon, chosen on 2020-26 where it is always present) is missing in 80 of 160
  cells (targets 2016-17), which then score as 0. The dev freeze did not check pre-2017 coverage: our error. Read as
  diagnosis, not a re-read: on the 80 cells where that form exists, G5 vs Savant is +.0011 [-.0003, +.0024] (tie);
  against Savant's other form (index_wobacon, present in every cell) +.0030 [+.0011, +.0052]. So **G5 beats Savant
  on HR; on wOBAcon the win is not clean.**
- **M4 (power, data).** Every point estimate is positive (the adjustment raises movers' home-to-new-home stability),
  wOBAcon and HR CIs exclude 0, and XBH misses the -.01 line by .0012 on CI width at 393 movers. This answers the
  college G4.5 question in direction (between-team confounding, not skill eaten), but the gate as registered fails.
  Not a handling error found: stayers drop as the design predicts.

### Verdict

- **Confirmed on unseen MLB seasons:** the EB park factor describes park totals (M1), forecasts the next season's
  launch-frame park residual far better than nothing (M2a/b), beats §70's regressed results factor and Savant's HR
  index on that target (M2d-f), and does not eat hitter skill (M3).
- **Not fully confirmed:** M4 fails on width; M2c is compromised by Savant coverage. On the conventional home/road
  target (T1) G5 ties the baselines, and Savant's HR index is ahead at the point.
- **Physics is the explanatory layer and the thin-park prior, not a forecast gain** (ties EB toward zero on both
  eras and in college). The hand split does not pay.
- No site, bake or model change. The 2015-19 bank is spent for park factors (ml-hardening-plan §2 updated).
