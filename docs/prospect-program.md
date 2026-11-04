# Prospect program v2: the working plan (2026-11-03)

This is the one plan for prospect work from here on. It replaces the order of work in `docs/prospect-model.md` §6.5.
Results stay in `pipeline/RESULTS-MLB.md`; this file holds the goal, the rules, and the tracked steps.

## Goal

For every minor leaguer at a list date, say what our public-data model adds over the public prospect lists:

1. **P(MLB debut within k seasons)**, as a calibrated probability (arrival).
2. **E[WAR over the control years | debut]**, with an interval, plus star odds: at least two seasons of 4+ WAR in control
   (value). The outcome matches FanGraphs' prospect valuation study (Clemens, 2026-07-02), so our numbers can be compared
   with theirs.
3. **Sleeper watch**: players outside an org's top 20 whom the model rates far above the lists.

What counts as "right" is set in advance (see "Evidence the model is right"). A site feature ships only after it passes
its pre-registered gate.

## Where we are (committed, researched, decided)

**Committed (goat-pro `main`, local; not pushed):**

| commit | what |
|---|---|
| 6189d03 | NUTS handling: SVI starts, post-warm-up probe abort; GPU run 2 post-mortem (`pipeline/GPU_RUN.md`) |
| ea051ef | §104 amendment B: centred hitters in all folds, one new-seed rerun rule, read guard |
| 6efa304 | §104 value read (list 2018, once): **gate (b) fails**, NPY vs B1 NDCG@100 −.016 [−.103, +.081] |
| ccc1b59 | sleeper pre-checks (post-hoc 2015–18) and power (`pipeline/prospect_sleeper_check.py`) |

**Researched (results in RESULTS-MLB.md):**
- §97/§99: research round, feature store (`pipeline/prospect_snapshots.py`), five-tier draft model review.
- §99f: the first holdout read. Arrival failed and the value pass was withdrawn, both because of the split-drop bias (§99h, §104).
- §99h: the discrete-time arrival hazard. On dev: Brier .062 against LGB .070 and B1 .083, AUC .90, ECE .021. **Its read is still owed.**
- §104: fixed splits. NPY, v0u and LGB tie on value, within .003 NDCG of each other. B1 wins the top-100 on 2018.
- Sleeper pre-checks:
  - Sleeper p@50 across 2015–18 for the plain baselines:

    | B1 | youth for level | LR on age, level and draft | LR + 3 rate stats |
    |---|---|---|---|
    | .10 | .075 | .095 | .15 |

  - The models score .25 to .29. Against LR + rates that is +13 to +14 pp, with a CI that excludes 0.
  - Power: one class can detect a gain of ΔNDCG ≥ .10. Four pooled classes can detect ΔNDCG ≥ .05 and Δp@50 ≥ .11.

**Decided (owner rules that bind this plan):**
- Public data only. ABStuff+ is never shown on goat-pro. Commits carry no Claude co-author trailer. Every read happens once and is pre-registered.
- No more data is coming, so the plan never waits on future seasons. Holdouts come from data we already have.
- Wide-then-select: every legitimate factor goes in first. Selection happens only inside nested, time-forward, player-grouped CV.
- Heavy jobs run at nice +10. Disk is tight (about 21 GB free), so raw downloads are never kept.

## Lessons that become rules

1. **Power before pre-registration.** Every gate states its minimum detectable effect (2.8 × the bootstrap SE on dev). It
   is written only if the expected effect clears that bar. Otherwise the data stays sealed.
2. **Proper scoring rules are the main score:** log loss or Brier for probabilities, CRPS for WAR. Ranking metrics are
   reported but never the gate.
3. **Every gate is incremental over the consensus list.** Compare outcome ~ consensus (rank + draft) with outcome ~
   consensus + model. The gain is the paired Δ log loss across classes.
4. **Baseline ladder in every table:** base rate → consensus → LR on age, level and draft → LR + rates → model.
5. **Cheap fit first.** A Bayesian model starts with SVI or Laplace. Full NUTS runs only after the cheap fit ranks
   differently from it on dev.
6. **Handling settles on a dev pilot before the spec freezes.** No amendments after registration, apart from recorded
   failures.

## Foundation (missing; must exist before new research or tests)

- [x] **F1. Label source: our line WAR** (`pipeline/line_war.py`, 2026-11-03).
  - B-Ref WAR is a validation reference only (a project rule, `docs/service-time-method.md`), and our §85 WAR starts
    in 2020. So the label is §85 accounting on public Stats API season lines, 2011–26: linear-weight batting, SB/CS,
    the listed-position adjustment and FIP for pitchers. It has no range, framing, park or leverage terms.
  - Checks (`results/line_war_check.json`): season totals hit 1,000 WAR.
    - Against §85, 2021–26: hitters r .911, pitchers .988.
    - Against B-Ref (validation only): per season, hitters .842 and pitchers .795. On the label shape (first 6 MLB
      seasons summed, debuts 2012–20), hitters **.927** and pitchers **.935**.
  - Known cost: elite defenders are under-rated, because there is no fielding term.
- [x] **F2. Label table** `data/milb/prospect_labels.parquet` (`pipeline/prospect_labels.py`).
  - Columns: `war6` (WAR over the debut season + 5, when the debut is within 4 seasons), `star` (2+ control seasons of
    4+ WAR), `war2` (the early label) and maturity flags.
  - Spent lists 2011–18 are fully matured: 3.3–3.9% reach war6 ≥ 1, and 0.2–0.3% are stars.
  - Sealed lists are never summarized by the script.
  - Ponytail: the control window is 6 seasons, not service days. Refine if the label moves.
- [x] **F3. Event store: minor-league play-by-play 2010–2026** (`pipeline/milb_pbp.py`, started 2026-11-03, three connections at ≤ 3 req/s since that evening; ~140k games, ~1 GB sent; spent seasons 2010–17 first; `men_on_end` is the base state after the PA, not before) (Stats API `game/{pk}/playByPlay`, sportId 11–14, 16; no 2020 season). **Done 2026-11-04 08:48:** 140,602 final games, 10,694,702 PAs (75–78 per game every season), no duplicate (game, at-bat) rows, 4 games with no plays; 109 MB in `data/milb/pbp/`. 2020 has no season. **Check passed** (`results/milb_pbp_check.json`): PA, K, BB and HR match the season lines within 1% on 99.8–99.9% of 59,945 player-season-levels (totals within 0.1%; every season ≥ 99.2%), after two exclusions every consumer must also make: (1) non-PA plays (caught stealing, pickoffs, WP/PB/balk that end an inning: 42,708 rows); (2) the Mexican League, which rides sportId 11 with unaffiliated teams and uneven line coverage (no 2018 lines; partial 2014/2017 play-by-play): 674,058 PA rows in games involving its 18 team ids. First run without (2) failed 2014/2017/2018 at 92–97%.
  - Probed 2026-11-03: PA outcomes and spray coordinates exist at every level from 2011. Pitch sequences are partial
    below AA before 2019. Velocity and EV are AAA-only from 2023 (Savant, already in `savant_mart/data/aaa`).
  - Fetcher: resumable, 1 s pause per the service-time etiquette, keeps only extracted PA rows in zstd Parquet. About
    130k games at AAA through A, so about 36 h in the background. Rookie ball goes second.
  - Checks: season totals (PA, K, BB, HR) match `hist_hitters` / `hitters` within 1% per player-season; no duplicate
    games; the game-count gap per level and year is written down.
- [x] **F4. Transactions 2011–2018 backfill.** Have 2019+; the API returns earlier minor-league transactions (probed).
  This gives injuries and promotion dates for all list years, so health stops being missing before 2019. **Done 2026-11-04** (`pipeline/milb_transactions.py` → `data/milb/transactions_full.parquet`): 448,701 rows, 35,946 players, 2011–26, MLB + AAA..Single-A, full months. Injured/disabled-list rows 3,261 (2011) to 6,452 (2026). Holds 100% of the old `transactions.parquet` rows; that file (2019+, MLB + AAA, months cut at the 28th, ~4.5% of rows lost) stays for its current readers, and new prospect work reads the full file.
- [x] **F5. Holdout ledger** `docs/prospect-holdouts.md` (2026-11-03).
  - Covers every list × task with dev, spent or sealed status and its caveats.
  - Summaries of sealed cells count as reads. A power-check table is attached.
  - Sealed: value 2019–22; arrival 2024 and 2025.
- [x] **F6. Evaluation harness** `pipeline/prospect_eval.py` (2026-11-03).
  - Contents: log loss, Brier and CRPS; ECE and calibration by subgroup; a player-clustered bootstrap with the MDE on
    every Δ; `incremental()`, the gate shape: out-of-time LR(y ~ consensus) against LR(y ~ consensus + score), paired;
    a `SEALED` guard that refuses sealed lists without a named read.
  - The `--demo` self-check passes: real signal gives a CI below 0, noise gives none, calibration holds, the guard blocks.
  - Smoke on spent lists 2015–18 (y = war6 ≥ 1, n 34,922): age_rel over consensus gives Δ log loss −.0032
    [−.0040, −.0023] with MDE .0013. The proper-score test is far better powered than top-k ranking.
  - Ponytail: `prospect_sleeper_check.py` stays as the §104 record; new tables use this harness.
- [x] **F7. KB.** Add the prospect valuation sources and a synthesis of this plan (done 2026-11-03).

## Research and tests (in order, each a RESULTS-MLB section)

- [x] **R0. Re-baseline on the new label** (2026-11-03, RESULTS-MLB "Prospect program R0").
  - A plain LR on age/level/draft + 3 rates adds −.0088 log loss over consensus. That is about 2× any §104 model's EV,
    old label or new.
  - Stars cannot be tested on spent data (82 events).
  - Arrival H_fix wins clearly, but is miscalibrated within org-listed players (ECE .11): add a per-list-state bar to G2.
  - Consequence for R3: model the outcome directly (a classifier or distribution per target). Don't use the hurdle EV.
  - Re-score B1, v0u, LGB and the §99h hazard on F2 labels through F6, on spent classes only.
  - This tells us whether the playing-time label hid or inflated anything. No sealed data is touched.
- [ ] **R1. Skill layer.** A hierarchical PA-level model per player-season: K, BB, contact, power, BABIP, GB/FB and
  spray.
  - Adjusts for opponent, park, league, level and age relative to level. Mixed-effects first pass, then NumPyro SVI.
  - Checks: split-half reliability, and whether next-season rates are predicted better than by raw rates or
    `hist_*` lines.
- [ ] **R2. Translation layer.** MiLB → MLB rate translation corrected for promotion selection: an inverse-probability
  weight on promotion, or a joint model. Lucky AAA hitters get promoted (Davenport, 2025-09-02).
  - Gate: predicts promoted players' MLB rates better than §88 MLEs on spent seasons.
- [ ] **R3. Outcome layer.** A multi-state discrete-time model on person-seasons (minors → released / debuted), with
  value given debut.
  - Consensus rank goes in as a feature. This extends §99h. LightGBM on person-seasons with monotone age-for-level is the challenger.
  - SHAP family ablation: the gain must vanish when the R1/R2 skill features are dropped.
- [ ] **R4. Gates on sealed data, each with an MDE attached before any read:**
  - **G1 sleeper watch.** Lists 2019–22 pooled, early label = WAR in the first 2 control seasons.
    - First validate the early label on 2015–18: at least 70% of early hits are full-label hits, and the model order is preserved.
    - Gate: Δ p@50 and Δ log loss vs LR + rates, CI excluding 0.
  - **G2 arrival.** The §99h hazard (or its R3 successor) on the 2024 list, scored on debut within 2 seasons (k ≤ 2,
    matured by 2026). The full k = 4 window cannot close. **Owner decision pending** (recommended 2026-11-03).
  - **G3 value.** Only if R0 to R3 dev shows a gain over consensus above the four-class MDE. Otherwise the value ranking stays research.
- [ ] **R5. Ship** what passes, with owner review: sleeper watch, arrival probabilities, value. Label each one with its gate.

## Evidence the model is right (all of these, not one)

- Paired proper-score gain over consensus, pooled across classes, from a test whose power check said it could detect it.
- Calibration within ±2 pp per decile in each subgroup.
- The ablation shows the gain comes from skill features, not from re-reading the list rank.
- Posterior predictive checks and simulation-based calibration (ArviZ) for any Bayesian layer. R-hat is necessary but not sufficient.
- Rank stability: year-to-year rank changes track new performance.
- Case review: the 2015–18 sleepers the model liked are named, and a scout reading the list nods.

## Not doing

- No more GPU or NUTS runs for this program unless rule 5 triggers.
- No gate on NDCG or p@50 alone.
- No grouped-split stand-in for a time-forward read.
- No new data sources beyond public MLB Stats API, Savant, B-Ref and list snapshots.
