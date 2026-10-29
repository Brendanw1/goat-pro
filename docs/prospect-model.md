# Prospect model: research round (v0)

Owner ask, 2026-10-29 (queue item 0 in `docs/model-inventory.md`): our own combined prospect ranking, built to find
sleepers, as a hierarchical Bayesian model. This round covers research, a data audit and early tests. Nothing ships
from it. Pre-registration and results: `pipeline/RESULTS-MLB.md` §97. Code: `pipeline/prospect_model.py`.

## 1. Research: what transfers

### Knowledge base (kb, searched 2026-10-29, ten phrasings)
| source | path | date | what we take |
|---|---|---|---|
| KATOH: Forecasting MLB hitting with MiLB stats (Mitchell, THT) | `sources/baseball/tht-fangraphs-com-8fc3519a9c.md` | 2014-12-30 | Probit per level on league-adjusted age, K%, ISO, BABIP, BB% (BB% only matters at AA/AAA), SB rate, plus a Top-100 flag. P(reach MLB), then P(≥ k WAR) thresholds, then expected WAR through age 28. Stats say very little below A ball. Power predicts, and walks mostly ride along with it. |
| Using Rookie League Stats to Predict Future Performance (Mitchell) | `sources/baseball/community-fangraphs-com-549de4683e.md` | 2014-08-02 | Same frame, with stats normalized to each league and year. Reaching MLB stands in for success. |
| A Primer on a New and Improved KATOH | `sources/baseball/blogs-fangraphs-com-fd26ad1d1c.md` | 2015-11-25 | A ladder of benchmark probabilities gives an expected value. The stated use is to find players the consensus overlooks. |
| DTs vs. MLEs: a validation study (Davenport, BP) | `sources/baseball/baseballprospectus-com-42e6d90937.md` | 1998-01-30 | Translations describe the past, they are not forecasts. The test is against the next MLB season. |
| Hierarchical Bayesian modeling of hitting performance (Jensen, McShane, Wyner) | `sources/baseball/arxiv-org-0e80b933a6.md` | kb date 2004-03-10 (arXiv 0902.1360) | Career trajectories with age and position covariates. A mixture of elite and non-elite players stops elite players from being shrunk too hard. That matters here, because prospect value is a skewed, two-population outcome. |
| BP DRC+ summary (Judge) | `inbox/baseball-prospectus-drc-judge-mixed-model-hitter-metric-summ.md` | 2021 | Mixed model with context terms. Moved from lme4 to Stan with priors taken from league rates. The VT note in it says crossed effects hurt when samples per cell are thin. |
| Counterfactual xG, hierarchical Bayes (hockey) | `sources/hockey/arxiv-org-e247d402d4.md` | 2025-10-23 | Scout ratings used as informed prior means, with partial pooling toward them. This is the direct template for treating Pipeline rank as a prior. |
| Modeling player performance in basketball (review) | `sources/basketball/arxiv-org-a1bbd62fda.md` | 2019-07-23 | Efron–Morris shrinkage. Bayesian development curves (Vaci et al.): pre-peak growth separate from aging. |
| @ARKNDJL eFV model thread | `sources/x-bookmarks/thread-2077512582231920825.md` | 2026-07-15 | A public model scored against FanGraphs and Pipeline using Spearman and AUC. That is the same comparison as our gate (a). |
| PECOTA (Wikipedia) | `sources/baseball/en-wikipedia-org-016f81525e.md` | 2006 | Comps drawn from translated minor league seasons. UPSIDE counts above-average outcomes only. |

The kb holds no user synthesis notes on prospects (a `synthesis` search returned nothing). It also holds no
prospect hit-rate study beyond our own `/draft` hit-rate join.

### portal-scout Translation_Score (vt_baseball `PortalEval.R`, removed in e9fac4f; the logic survives in portal-scout's export)
A hand-weighted composite of percentile ranks: 0.30 discipline, 0.25 contact, 0.25 impact, 0.20 shape. It was never
validated against an outcome. **What transfers:** splitting performance into skill components and ranking each one
within its peer group, which becomes our level × season z-scores. **What does not:** the fixed weights. Here the
weights are fit to MLB arrival. Its inputs are college TrackMan, so none of its data can be used.

### MLB_Draft_Model (vt_baseball/MLB_Draft_Model README)
- **Prior offset (Tier 3).** Model the deviation from a strong slot baseline. Elastic Net on the offset beat XGBoost
  on the absolute probability by 0.05 to 0.08 AUC. → Our B1 prior plus performance terms, judged against the prior.
- **Hurdle (Tier 5).** P(value > 0) × E[value | > 0]. → Our P(MLB) × E[playing time | MLB].
- **Tier 5 failure lesson.** It had one usable class, right-censored careers, and inputs that encode slot, so the AUC
  was "mostly the round prior". → We judge against B1 (Pipeline plus draft), not against a naive baseline, and we use
  only matured lists.
- **Comps (Tier 4, 10-dim nearest neighbour).** Deferred to the full build: comps need the same EB features.
- **Platt calibration.** Report calibration for P(MLB) before showing any probability.

### MLB_Draft_Model code review (§99, 2026-10-29; methods only, its NCAA data is not used)
I read the training scripts in `vt_baseball/MLB_Draft_Model/scripts` and ran none of them.

| tier | code | what it does | what we reuse |
|---|---|---|---|
| 2 Platt | `train_tier2_full.py` | `CalibratedClassifierCV(XGB, sigmoid, cv=5)` fit on all rows. The internal CV is stratified, not grouped by player. Calibrated output is never scored on held-out data, and the year-out check is a stub. | The GBM plus sigmoid recipe, with Platt fit on out-of-fold predictions from time-ordered, player-grouped folds, and Brier plus reliability reported. |
| 3 prior offset | `train_tier3_mlb_arrival.py` | Elastic-net logistic. The round prior is an ordinary feature, not an offset. It is computed on all rows, so it includes each player's own label. The neighbour rate leaks across folds. Inputs are unscaled. 2024+ draftees are labelled 0 although they are censored. | The idea: model the deviation from a strong prior. We pass the prior as a true offset (or recompute it per fold), scale inputs, and use censoring-aware labels. |
| 4 comps | `export_frontend_data.py` (comp section) | Equal-weight Euclidean distance on z-scores. Correlated rate stats are counted several times, volume stats are included, missing values are set to 0, and there is no context adjustment. | A display layer only: level- and age-adjusted skill z, no volume dimensions, Mahalanobis or PCA distance. |
| 5 hurdle + value | `train_tier5_hurdle.py`, `train_tier5_value.py` | Hurdle on WAR > 2 (33 positives); value is a random forest on signed log WAR. The two are never combined, and the held-out 2022–23 WAR is censored. | The hurdle shape P(reach) × E[value \| reach], and the "beat the median baseline" kill gate. |
| backtest | `backtest_tier5.py` | Claims a 2015–20 cohort but reads the censored 2023 class. Missing WAR is turned into 0. The hurdle is thresholded at a different label than it was trained on, and errors are swallowed. | Nothing as code. |

**Lessons carried into §99:**
- Priors and neighbour features are rebuilt inside each fold.
- Labels carry censoring flags.
- Calibration is judged out of fold on a future cohort.
- Volume never enters a similarity metric.

## 2. Data audit (goat-pro public data)
| input | coverage | notes |
|---|---|---|
| Pipeline lists (`data/milb/prospects.json`, `prospects_fetch.py`) | 2011–26 | Top 100 (2011 is top 50) plus org lists: top 10 per org in 2011, top 20 in 2012–14, top 30 from 2015. The `age` field is the player's age today, so age is recomputed from birth date. Scouting grades are null on old lists. 2,989 players across 2011–19. |
| MiLB season lines | site file `hitters/pitchers.parquet` 2021–26 only | **Gap.** The matured lists need 2010–19 lines, so they were fetched with `milb_lines.fetch` into `data/milb/hist_{hitters,pitchers}.parquet` (zstd, about 1.4 MB each). That covers sportIds 11–16, including short-season A (15), which ended in 2020. The site files are untouched. |
| MLB season lines | site file 2020–26 | `hist_mlb_*.parquet` holds 2011–25 for the playing-time outcome. |
| §88 MLEs | AAA/AA, 2021+ | Not usable on 2011–19 because AAA park factors need the 2023+ mart. v0 uses its own level × season z-scores in their place. The full build should reuse §88's tested pieces (AAA K%/BB%/ISO, AA BB%) on modern cohorts. |
| AAA Statcast grades | 2023–26 | No matured cohort exists yet. These are an add-on for the full build, to be tested on a short horizon (reached MLB within 2 years on the 2023–24 lists). |
| Draft (`draft.json`, `amateur_fetch.py`) | picks 2011–26; **bonus only 2017+** | Players drafted before 2011 have no slot, so the 2011–13 lists are mostly unslotted (0.3%, 17%, 38% with a pick). IFAs never have one. There is a flag for this. |
| Debut (`people.parquet`) | every ranked player | Debut date gives Y1. |
| §85 WAR (`war_index.json`) | 2020–26 | Used only as Y3, reported for the 2015–19 lists. B-Ref WAR was not touched. |

**Outcomes.**
- Y1: debut by the end of list year + 4.
- Y2: MLB playing time over list year..+4, as full-season equivalents (PA/600, BF/700).
- Y3: Σ §85 WAR 2020–26.

**Survivorship and censoring.**
- The lists select on scouting, so every test measures the increment over a scouted population.
- Debut is partly a club decision.
- Playing time is a stand-in for value.
- The 2019 window holds the 2020 short season.
- Y3 is censored: it covers 2020+ only, and the window length differs by list.
- The 2020 MiLB season was cancelled, which affects 2021-list inputs. Those lists are outside this backtest.

## 3. Model design (v0, and the full build)
**v0 (this round). Empirical Bayes in two stages plus a variational-Bayes mixed GLM.**
1. **Partial pooling of performance.** For each stat and each level × season, take the PA-weighted mean, a
   between-player SD and k = within/between variance ratio (method of moments). Each line's z-score is shrunk by
   n/(n + k), then PA-weighted across the player's levels. Hitters: K%, BB%, ISO, BABIP, SB rate. Pitchers: K%, BB%,
   HR/BF, GB share. Also: highest level, age minus the level's mean age, log PA. A player with no line shrinks fully
   to the prior.
2. **Prior.** Pipeline Top-100 rank, org rank / list length, log draft pick (with a flag), age.
3. **Outcome hurdle.** P(MLB) from `BinomialBayesMixedGLM`, with random intercepts for org and list year. E[playing
   time | MLB] from a ridge on log1p. EV = P × E.

PyMC and NumPyro are not installed and were not pip-installed. jax 0.9.1 is present, so NumPyro is one `pip install
numpyro` away.

**Full build (the Bayesian upgrade).** One joint NumPyro model.
- **Latent true talent** θ_i per skill (contact, power, discipline; for pitchers K, BB, contact), with a development
  curve over age.
- **Observations.** Each MiLB line is binomial on θ_i plus a level × season effect plus an org effect, with hierarchical
  level-gap priors (the MLE).
- **Prior mean of θ** is set by Pipeline rank and draft slot, the informative prior (the scout-ratings-as-prior
  template).
- **Outcome.** A hurdle: P(MLB) and value (§85 WAR once enough 2020+ seasons exist, playing time before that), with an
  elite / non-elite mixture following Jensen et al.
- **ETA and quality are separate outputs.** ETA comes from level and age. Quality comes from θ.

## 4. Early results (§97)
Leave one list year out, with all of a test player's rows removed from training (pre-registered, §97).

| out of fold | B0 Pipeline ordinal | B1 Pipeline + draft + age | M hierarchical |
|---|---|---|---|
| AUC reached MLB | 0.679 | 0.784 | **0.810** |
| Spearman EV vs playing time | 0.388 | 0.508 | **0.568** |
| Spearman vs §85 WAR (2015–19 lists) | **0.235** | 0.203 | 0.215 |

- **(a) passes.** ΔAUC vs B1 +0.026 [+0.019, +0.034] and ΔSpearman +0.059 [+0.046, +0.073]. M wins 9 of 9 years.
  Hitters gain more than pitchers (AUC 0.830 vs 0.784).
- **(b) passes.** 980 sleeper rows (797 players) reach MLB at 0.815, which is +32 pp [+29, +36] over their Pipeline
  decile peers. Fallers come in at −31 pp.
- **The pass is narrower than it looks (exploratory).**
  - Most of M's gain is proximity: level, age vs level and PA. With no rate stats the model already gets AUC 0.799.
  - The rate stats add ΔAUC +0.011 [+0.006, +0.015] and ΔSpearman +0.024 [+0.016, +0.032].
  - The pre-registered sleepers are older (+2.1 years) and higher-level (+1.6) depth players, for example Torreyes,
    I. Vargas and Valera.
  - Measured against B1 peers they do carry more value: +0.33 full seasons and +0.56 §85 WAR [+0.22, +0.92].
  - On overall WAR ordering, Pipeline rank still wins.
- **Calibration.** The two lowest deciles under-predict (0.12 vs 0.21 observed, 0.28 vs 0.39). Recalibrate first.
- **Thin samples.** The Y3 numbers rest on five list years with censored WAR. Treat them as exploratory.

## 5. Recommendation
1. **Build the full model, but change the target and the sleeper definition.**
   - Sleeper = model quality rank (θ-based EV of §85 WAR / playing time) well above **B1**, not above raw Pipeline
     rank.
   - ETA is shown separately.
   - Pre-register Y3-style value gates on the 2015–19 lists, plus a 2021–23 forward test once 2027 adds seasons.
2. **Install NumPyro** (owner approval needed) for the joint latent-talent model described above. Keep v0 as the
   baseline it must beat.
3. **Add the modern inputs only where a matured or short-horizon test exists:** §88 tested MLE stats, and AAA Statcast
   grades tested on reached-MLB-within-2-years.
4. **Calibrate P(MLB)** (Platt or isotonic, out of fold) before any probability is displayed.

**Site sketch (not built).** A "Sleepers" tab on `/prospects`, mirrored on the team Farm tab.
- Columns: player (MLBAM id + DOB match evidence), org, Pipeline rank, model rank, gap, ETA band, P(MLB), EV, and the
  skill z-scores (power / contact / discipline) with n.
- A sorted list per org.
- The label "descriptive, not a forecast" stays on until the value gate in (1) passes. The v0 gates passed only on
  arrival, which is the weaker question.

## 6. Critique and roadmap (for the future build; owner ask 2026-10-29)

v0 passes both pre-registered gates, but read honestly it is a **good arrival model and not yet a talent model**.
This section is what an MLB R&D group would push on, and how to build it out with the data we hold.

### 6.1 What a sabermetrician in an R&D department would challenge

1. **"Reached MLB" rewards proximity and opportunity, not talent.**
   - Most of the gain comes from level, age-vs-level and PA (AUC .799 without any rate stat). The sleepers are
     older AAA depth arms and utility men who debut because a 40-man needed a body.
   - Arrival is partly an org decision: roster need, 40-man protection, Rule 5 timing. So it is confounded with org depth.
   - Fix: the headline target becomes value (playing time and WAR above replacement). ETA is reported separately,
     and the sleeper is defined against B1 on quality.
2. **The universe is selected.**
   - Only players on Pipeline lists are scored, so a true sleeper off every list is invisible by construction.
   - Fix: score every MiLB player-season and treat list inclusion as an informative signal, not a filter. This also
     gives a much larger training set with honest base rates.
3. **Point-in-time leakage.**
   - Lists are published at set dates, and features must be as-of that date (stats through the list date, age on
     that date).
   - An R&D group would require a point-in-time snapshot per list date and test that no feature changes when
     future rows are deleted.
4. **Censoring and survivorship.**
   - WAR is right-censored for later lists, and players leave by release, retirement or injury.
   - Fix: survival or competing-risks models for time-to-debut and time-to-exit, and a censored value model
     (Tobit-style, or a hurdle with exposure), not "WAR so far".
5. **The scouting prior is used as a raw covariate.**
   - A rank is a noisy, ordinal measurement of latent talent with its own error that shrinks as players near MLB.
   - Model it as a measurement, e.g. a Thurstonian or rank-ordered logit on θ whose noise varies by level and age.
     Our data and the scouts' then combine by their measured reliability, which is what an R&D blend does.
6. **No skill decomposition.**
   - A front office wants the 55-grade bat with a 40 glove, not one EV number. Value per skill means latent
     contact, power, discipline, speed and defense for hitters; stuff, command and durability for pitchers.
   - Each skill gets its own development curve and its own translation across levels.
7. **Environment.**
   - League and park run environments (PCL vs International League, hitter-friendly parks, the ABS and
     automated-zone experiments at AAA, ball changes) need level × league × season × park effects estimated
     inside the model, not as pre-computed MLE factors applied blind.
8. **Value is a distribution.**
   - Decision makers ask about ceiling, floor and risk: P(average regular), P(≥ 2 WAR seasons), quantiles of
     career WAR through the control years.
   - Then convert to **surplus value**: WAR × $/WAR minus salary over the six control years. That is the FV
     currency trades are made in. It links to /trades and the queued surplus value item.
9. **Positional and defensive value.** A 45-bat catcher or shortstop is worth more than a 50-bat first baseman. The
   positional adjustment, the defense prior (our range and framing, Savant OAA where it exists) and the chance he
   stays at the position belong in value.
10. **Health.** IL history from the transactions feed (pitcher elbow history, missed time) as hazard covariates. The
    swing-program §95 failure is a reminder to validate any health signal against a permutation null.

### 6.2 How data analysts and ML engineers would improve and optimise it

- **Validation design.**
  - Forward-chaining (train on lists ≤ Y−1, test on Y) as the headline, plus leave-one-year-out as the robustness
    check. Keep the player-grouped removal v0 already does.
  - Nested CV for every tuned choice (the shrinkage k, the regularisation).
- **Metrics that match the use.**
  - Brier score and log loss with reliability diagrams for P(MLB). Value-weighted ranking (NDCG on WAR) for the
    board. Precision@k and lift for the sleeper list.
  - AUC alone flatters proximity models.
- **Calibration before display.** Out-of-fold isotonic or Platt, refit per pitcher/hitter group. Conformal
  prediction intervals for value, so every number on the site carries an honest range.
- **Model zoo, then stack.**
  - The joint NumPyro latent-talent model (6.3) against a gradient-boosted hurdle (LightGBM with monotone
    constraints on rank and level) and the v0 empirical-Bayes model.
  - Stack on out-of-fold predictions, and keep the simplest model that ties.
- **Features worth testing, each behind its own gate:**
  - AAA and Single-A Statcast quality (EV90, max EV, LA spread, chase and zone-contact; Whiff+ and Stuff-family
    grades on AAA pitches, already baked);
  - age-relative-to-level curves;
  - promotion speed (days per level);
  - the §88 tested MLE components;
  - draft bonus vs slot value (signability over talent);
  - comps from the draft model's nearest-neighbour tier.
- **Engineering.**
  - A point-in-time feature store (parquet snapshots keyed by as-of date).
  - Deterministic seeds and a model registry: version, data hash, gates, verdict.
  - SVI for fast iteration and NUTS for the shipped posterior. About 3k listed players, or ~50k MiLB
    player-seasons if the universe is widened, fits on this Mac at nice +10.
- **Interpretability.** Per-player posterior decompositions (how much of his EV comes from the scouting prior vs
  his stats vs his age-at-level), so a scout can see why the model disagrees with the list.

### 6.3 The full model, sketched

- **Latent skills.** θ_{i,s,t} for player i, skill s, season t, with a development curve f_s(age) and a
  player-specific random slope (some players improve faster). It is a state-space model: θ_t = θ_{t−1} + g_s(age) + η.
- **Observations.** Each MiLB or MLB line is binomial or Poisson on θ plus a level × league × season × park effect.
  The level gaps are learned jointly, which makes the MLE an output, not an input.
- **The scouting measurement.** Pipeline rank is an ordinal readout of a weighted θ, with noise σ(level, age).
- **Outcome.** A competing-risks time-to-debut model, then a value model with censoring and an elite/non-elite
  mixture, then quantiles, then surplus $.
- **Org effects** on development slopes: the farm-system "development skill" that feeds the queued team-identity
  work.

### 6.4 A self-improving loop: is it possible with our data?

Yes, as a disciplined retrain, evaluate and promote loop. It is not a model that rewrites itself, and its
bottleneck is **outcome lag**: true value takes 3–6 years to mature.

1. **Ingest.** The daily Statcast mart, the MiLB lines, transactions, and the Pipeline lists as they publish.
2. **Refresh** the point-in-time features for every open list date.
3. **Retrain** the champion and any queued challengers. Challengers can be proposed by an analyst or by an LLM
   agent drafting a hypothesis plus a pre-registration, as this project already does by hand.
4. **Evaluate** on frozen forward holdouts with pre-registered gates. Promote a challenger only when its gain's CI
   excludes 0. Log every run, failures included, to RESULTS-MLB.
5. **Monitor** calibration decay and feature drift (level environments shift; ABS, ball and rule changes). An alert
   triggers a recalibration, not an automatic re-specification.

**Shortening the feedback loop:**
- Use validated short-horizon surrogate endpoints: next-level performance, promotion within a year, AAA Statcast
  quality, first-year MLB playing time.
- Each surrogate must first be shown, on matured cohorts, to carry the long-run signal (the clinical-trials
  standard). Then the loop learns yearly instead of every half-decade.

**Guardrails.** Without these the loop overfits itself:
- **Holdout budget.** Sealed seasons are spent once, as with the AAA seal, and an automated search over specs
  counts every spec as a comparison (Holm or a held-out confirmation).
- **No silent publishing.** Promotion to the site stays an owner-approved step.
- **Reproducibility.** Each promoted version is frozen with its data hash, and its predictions are archived at
  the list date, so the model can be graded honestly years later. That archive of dated, frozen predictions is
  the single most valuable asset the loop creates.

### 6.5 Order of work for the deep dive

1. Widen the universe to all MiLB players, build the point-in-time snapshots, and calibrate v0.
2. Re-target to value with censoring, keeping ETA separate. Re-run §97-style gates as a new pre-registration.
3. The NumPyro latent-skill model (needs a `pip install numpyro`, owner OK), benchmarked against v0 and a GBM hurdle.
4. Skill decomposition, then FV and surplus value, joined with the WAR projection deep dive (our own WAR forecast
   plus a descriptive layer).
5. Org development effects, handed to team identities.
6. The retrain/promote loop with surrogate endpoints, plus a dated-prediction archive from day one.

**Owner notes for the full build (2026-10-29).**
- NumPyro is approved. It is installed in `~/.venvs/goat-bayes`, not the anaconda base.
- Start wide: every legitimate factor goes in the dev model (level/age/league/park, rate and Statcast-quality stats, promotion
  speed, draft slot and bonus, Pipeline grades, health, org). Feature selection and engineering happen after, and only inside
  nested time-forward, player-grouped CV, with a feature-family ablation table. The holdout is read once on the frozen spec.
- v0 drew on the draft model's README only. The full build reviews `vt_baseball/MLB_Draft_Model` code itself (the five-tier
  Draft Intelligence project, not the older Streamlit dashboard in `mlb-draft-model-main/`): Tier 2 Platt calibration, the
  Tier 3 prior-offset Elastic Net, the Tier 4 comps, and the Tier 5 hurdle and its backtest.

## 7. Full build, phase 1 (§99, 2026-10-29): data and design, no model scored

Pre-registration, catalog and smoke test: `pipeline/RESULTS-MLB.md` §99.
- **Feature store.** `pipeline/prospect_snapshots.py` writes `data/milb/prospect_snapshots.parquet`: 238,718 player × as-of rows,
  36,975 players, 97 feature columns plus targets. Rebuild time is about 1.5 min.
  - It covers every affiliated MiLB player 2010–26, listed or not.
  - `--fetch` adds Stats API team→org/league/venue (`team_orgs.parquet`) and MiLB fielding (`fielding.parquet`).
- **Leakage test.** `pipeline/test_prospect_snapshots.py` drops, then scrambles, every row after the as-of date. The features
  must not change. It passes on four dates.
- **NumPyro.** `pipeline/prospect_bayes.py --smoke` (run with `~/.venvs/goat-bayes/bin/python`) is the latent-skill
  state-space model, smoke-tested with SVI.
- **Known gaps.**
  - No MiLB season in 2020.
  - Short-season A ends in 2019.
  - The Mexican League is dropped.
  - No park factors (they need home/road splits).
  - Bonus starts in 2017, picks in 2011.
  - Transactions (health) start in 2019 and look partial.
  - Pipeline grades are sparse and maybe not archival.
  - AAA Statcast covers 2023+ only.
  - The §88 factors must be refit per fold.

### Phase 2 (needs the compute lock released)
1. Fix the identification issues the smoke test found (anchor λ, org slopes on drift only). Add the pitcher block.
2. Fit the baselines on the §99d folds: v0 on the corrected lines, B1, and the LightGBM hurdle.
3. Run the feature-family ablation.
4. Fit NumPyro on the dev folds and freeze the spec.
5. Read the holdout once.

**Compute estimate.**
- LightGBM hurdle: nested folds × 7 dev years at about 140k rows, roughly 10–20 min at 2 threads.
- NumPyro SVI: about 15k hitters plus 15k pitchers per fold, roughly 5–10 min per fold, so 1–2 h for the dev folds.
- NUTS on the frozen spec: one fit, several hours at nice +10. A subsample check runs first.
- Memory stays under 4 GB if lines are padded per fold.

## 8. Full build, phase 2 (§99f, 2026-10-29): dev, frozen spec, holdout read once

Code: `pipeline/prospect_backtest.py` (`--dev`, `--summary`, `--holdout`) and `pipeline/prospect_bayes.py` (`--folds`,
`--prior-check`, `--nuts`). Results: `pipeline/results/prospect_99_{dev,holdout,frozen,nuts,prior_check}.json`.

**Holdout read once (§99f):**
- **Value ranking: PASS.** The joint NumPyro model (latent K/BB/HR skills, plus GB for pitchers; Pipeline as an ordinal
  measurement; a hurdle on debut and control-years playing time). NDCG@100 .505 vs B1 .430, +.076 [+.027, +.121].
- **Arrival probability: FAIL.** The frozen choice, LightGBM, ranks best (AUC .911) but is miscalibrated after the 2020 break:
  Brier .0740 vs B1 .0717, ECE .062.
- **Sleeper board: FAIL.** +5 pp [−2, +13], short on power.

**Data fix found in phase 2.** The pre-2011 MLB lines were missing, so 2011 veterans counted as prospects. Fixed before dev.

**NumPyro.** The SVI posterior is the fit. NUTS on a subsample is clean (0 divergences, R̂ ≤ 1.004 on coefficients), but the
full-scale NUTS fit is estimated at over 6 hours.

**Next.**
1. Pre-register an era-aware recalibration of arrival.
2. Fit a low-rank guide for the globals.
3. Re-read sleepers when more matured years exist.

Nothing is displayed until the owner reviews it.
