# Swing program: bat tracking × batted ball (owner, 2026-10-29)

Seven pieces built on Statcast per-swing bat tracking (`bat_speed`, `swing_length`,
`attack_angle`, `attack_direction`, `swing_path_tilt`, `intercept_ball_minus_batter_pos_{x,y}_inches`)
joined with pitch and batted-ball data. MLB only: TrackMan bat tracking stays in the college explorer
(owner rule), so none of this ports to college as-is.

## First look (2024–26 regular season, 979k tracked swings; exploratory, not a claim)

- Coverage: 93–97% of swings 2024–26, 42% in 2023 (tracking began mid-season). 2023 is out of every YoY test.
- All six swing traits are stable hitter traits: YoY r .84–.94 (580 hitters, 300+ swings both years).
- Contact depth is mostly swing-to-swing: within-hitter SD 11.0 in. vs between-hitter SD 3.8 in.
- Between hitters, mean depth says nothing about xwOBA on contact (r .03; college .04).
- Within a hitter, depth is an inverted U: xwOBA .32 when 8+ in. deeper than his own mean, peak .42 at
  4–8 in. in front, back to .33 when 8+ in. out front. Pull angle rises steadily with depth (−18° to +23°).
- Depth tracks pitch velocity (r −.41 on balls in play) and attack angle (r .59).
- A crude collision efficiency (EV / (1.23·bat speed + 0.2·pitch speed)) correlates .40 with xwOBA per ball.
- Unresolved: attack direction vs pull read −.05. That is almost certainly a sign or handedness
  convention error on our side. Verify it before any use.

## Shared rules (every piece)

- **Competitive swings**: Savant's definition. Drop bunts, and drop swings that are in the slowest 10% of a
  hitter's swings and also under 90 mph EV. Our counts must reproduce Savant's `competitive_swings` on the
  bat-tracking leaderboard (gate 0 for every piece).
- **Depth frame**: `intercept_ball_minus_batter_pos_y_inches` is measured from the batter, not the plate,
  so stance differences pollute between-hitter reads. Default to within-hitter-season centring and say so
  on every visual.
- **Misses**: verify what intercept values on whiffs mean (projected crossing point?) before pooling them
  with contact. Until then, contact-only for depth-vs-damage.
- **Handedness**: pull/oppo and attack direction are mirrored for LHB. One shared helper, unit-tested on
  known pull HRs.
- **Seasons**: 2024–25 for development, 2025 → 2026 and in-season 2026 halves as the holdout. Read once
  per pre-registered claim, after its §-section is written.
- **Validation house rules**: pre-register in RESULTS-MLB.md before any outcome read; hitter-grouped folds;
  clustered bootstrap by hitter; a naive baseline every claim must beat; failure gets a data vs handling
  vs modeling diagnosis; failed pieces ship labelled descriptive or not at all.
- **No batter id** (or a proxy for one) as a model feature. See the Stuff+ memorization finding.

## The pieces

| # | Piece | Kind | § | Status |
|---|---|---|---|---|
| 1 | Contact-depth explorer (MLB) + in-season and pitch-type trends | display + reliability gate on the per-hitter window | §89 | shipped: window gate failed (SB .21), league curve shown; /depth + Swing tab |
| 2 | Swing plane match (attack angle vs pitch VAA) | research, within-hitter test | §90, §90b | §90 failed (sign reversed); §90b 4/4 claims confirmed on 2026 (launch band, timing forgiveness, hitter cell-plane contact trait); shipped: /plane, Swing-tab plane map, /matchup Plane column (descriptive, contact read) |
| 3 | Swing quality model (xDamage per swing, swing vs result split) | ML, forecast gate | §91 | validation and baselines first |
| 4 | Timing residual (depth vs expected depth) + early/late by pitch type | model + scouting read | §92 | shipped descriptive: biases reliable (SB .70–.84), spread does not forecast |
| 5 | Two-strike adaptation | descriptive, stability gate | §93 | shipped descriptive: YoY .64; adapters strike out less (1.1 pp/SD) |
| 6 | Swing archetypes + comps + aging by type | unsupervised, stability gate | §94 | shipped descriptive: k-means k = 2 stable (bootstrap ARI .85, YoY same 83% vs 50%); no outcome info beyond bat speed; /archetypes + Swing-tab chip with comps |
| 7 | Bat speed drift as a fatigue/injury flag | change detection, validated against IL stints | §95 | failed: alerts precede IL no more than shuffled dates (lift 1.14–1.21, p .07–.24); no site surface |

### 1. Contact-depth explorer
Purpose: show where a hitter meets the ball, how his damage changes with where he meets it, and how
pitches move his contact point. Panels: contact cloud (depth × lateral, coloured by EV), his depth-vs-damage
curve against the league's (within-hitter centred), depth by pitch type × velocity band, the in-season depth
trend (rolling, with a band), and a league page (depth vs velocity, the inverted U). Gate §89: re-test
college's failed "personal damage window" with MLB samples (split-half reliability of each hitter's optimum
location; pass bar set in §89). If it fails, the curve shows the league shape only.

### 2. Swing plane match
Hypothesis: contact is squarer when the attack angle mirrors the pitch's vertical approach angle
(|AA − (−VAA)| small). Test within hitter (hitter-season fixed effects) on squared-up rate, EV and xwOBA,
with pitch type and location controls. Naive baseline: attack angle alone. If confirmed: per-hitter plane-match
reads, and a pitcher-vs-lineup plane column in /matchup.

### 3. Swing quality model
Per-swing model: inputs are swing traits, pitch (velo, movement, VAA, location, count), and outcomes on contact
(EV, LA distribution, then xwOBA). Per hitter: swing quality vs results = buy/sell lists, plus SHAP coaching
reads. Before training anything heavy:
(a) the baselines: last season xwOBAcon, bat speed alone, and Savant's squared-up/blast rates;
(b) the leakage audit: no batter id, no same-swing outcome leaks;
(c) the measurement checks above;
(d) the holdout plan.
Gate: it must beat (a) at predicting next-season xwOBAcon and wOBA, with hitter-grouped folds on 2024 → 2025,
then read once on 2025 → 2026.

### 4. Timing residual
Predict each swing's depth from pitch velo, type, location, count and the hitter's mean. The residual is
timing error. Per hitter: early or late by pitch type, and timing consistency. It is the hitter-side mirror
of Deception+ and a feature for 3. Gate: split-half reliability, and whether it adds to 3.

### 5. Two-strike adaptation
Change in bat speed, length and depth with two strikes vs other counts. What it buys in K% and costs in
damage. Gate: YoY stability of the adaptation itself.

### 6. Swing archetypes
GMM on the six traits, hitter-season level, plus nearest-neighbour comps and aging by archetype.
Gate: cluster stability across seasons and bootstrap resamples. Display only.

### 7. Bat speed drift
Within-season bat speed against his own baseline (CUSUM or a Bayesian change point). Validate against
IL placements from the transactions feed: lead time, precision and recall vs chance. Feeds the injury-risk
queue item.

## Gate 0 / measurement checks (2026-10-29)

Shared helpers live in `pipeline/swing_common.py`; `python pipeline/swing_common.py` reruns every
check below against the mart and the Savant bat-tracking leaderboard CSVs (650 qualified hitter-seasons,
2024–26 regular season). Measurement validation only, no outcome claims.

- **Competitive swings.** Savant's text is "the fastest 90% of a player's swings, plus any 60+ mph swings
  with a 90+ mph EV", with bunts dropped. Implemented as: drop bunts (bunt descriptions, or in play with
  "bunt" in the play text), keep swings at or above the hitter-season 10th percentile of non-bunt bat speed,
  rescue swings of 60+ mph with 90+ EV. Mean bat speed passes: 97.8% of hitters within 0.1 mph (MAE 0.028),
  swing length MAE 0.003 ft. The **count does not pass** the ±2 target: 15% exact, 58.5% within 2, 87% within 5,
  mean −1.8 swings (2024 −3.75, 2025 −1.1, 2026 −0.56). About 40 handling variants (percentile method,
  ties, `<` vs `<=`, EV `>=` vs `>`, rank-based 90%, bunts in or out of the percentile base, career or
  split cutoffs, rescue on balls in play only, postseason in) all did as well or worse. Diagnosis: **data**, most likely.
  Savant's total tracked swings (competitive / pct competitive) matches our non-bunt tracked count exactly for
  only 84% of hitters; in the other 16% the mart holds 1–7 more swings. The public per-pitch bat speed is
  rounded to 0.1 mph, which moves ties at the cut. The 2024 skew fits a reprocessing of 2024 tracking after
  the per-pitch file was pulled. This is not proven; Savant's per-swing flags are not public. Use it this way: our
  rule for per-swing filtering (it is off by about 0.2% of swings), and Savant's own `swings_competitive` wherever a count is shown.
- **Whiff / contact sets.** Savant counts foul tips as whiffs, and its bat contact is foul + in play
  (our contact count is within 1.3 per hitter).
- **Squared-up and blast reproduce.** Efficiency = EV / (1.23·bat speed + 0.23·pitch speed *at the plate*, from the
  9-parameter fit). Squared-up = ball in play with efficiency ≥ 0.80 (fouls never count); blast = squared-up and
  100·efficiency + bat speed ≥ 164. Per hitter vs the leaderboard: squared-up/contact MAE 0.11 pp, blast/contact
  MAE 0.14 pp. With release speed or q = 0.20 the error is 0.5–4 pp. A data-derived q (upper-quantile
  regression of EV on bat and pitch speed) is not stable: slopes 0.53–0.97 on bat speed with an intercept, so
  we use Savant's constants. `collision_efficiency()` replaces the first look's crude 1.23·bs + 0.2·release.
- **Attack direction sign: resolved.** Savant's `attack_direction` is already batter-relative, with
  **negative = pull for both hands**. Pulled HRs have a median of −8.7° (RHB) and −7.9° (LHB), and the leaderboard means
  are negative. `attack_dir_pull = −attack_direction`, with no LHB mirror. Against the hand-aware spray angle
  (`pull_angle`, + = pull, 81% of HRs > 0) it reads r +.30 (RHB .32, LHB .28). Mirroring attack direction for LHB a
  second time gives |r| .05, which is the first look's −.05. That was our handling error.
- **Contact depth.** `intercept_ball_minus_batter_pos_y_inches`: larger = met further out in front (centred depth
  vs pull r +.39 on balls in play, both hands). `_x_inches`: larger = further from the batter's body. It is already
  hand-normalised (r with plate_x +.91 RHB, −.88 LHB). On whiffs the value exists but is a projected crossing
  point, not contact. Compared with contact (foul + in play), whiffs sit 4 in. further out front (33.2 vs 29.2), are
  1.7× as spread (SD 16.1 vs 9.5), and are more tied to swing geometry (r with attack angle .87 vs .72; with velo
  −.64 vs −.46). **Do not pool misses with contact.** `depth_centered()` is contact-only, centred within
  hitter × season × batting side, so a switch hitter's two stances get separate centres. Savant's swing-path leaderboard depth
  (`avg_intercept_y_vs_batter`) averages all competitive swings, whiffs included: we reproduce it to 0.24 in.
  from that set but not from contact (1.3 in. off). So our contact depth is not the same number as Savant's.
- **VAA.** `vaa()` uses train_mlb.py's plate-crossing solve (y = 17/12 ft). The 2025 four-seam mean is −4.70°, inside the
  published −4.5° to −5° range.
