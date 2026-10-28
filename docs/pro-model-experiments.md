# GOAT-Pro (MLB) model experiments: everything tried, and what is still untried

As of 2026-10-26. Every experiment ran on public MLB data (Statcast via the `savant_mart`, plus AAA
Hawk-Eye). Details live in `pipeline/RESULTS-MLB.md` (section numbers below as §n); pass rules were
written in `COLLABORATION.md` before each run; raw numbers are in `pipeline/results/`.

**How to read the results.**

- **Honest harness:** pitcher-grouped cross-fit. Pitchers are split into 4 folds by `crc32(pitcher) % 4`,
  and no pitcher is graded by a model that trained on him.
- **Baseline:** Stuff+ v2 on the honest harness.
  - Per-pitch fit .058 / .061 (2025 / 2026).
  - Year-to-year stability (YoY) .79 / .82 / .82.
  - Plate-height leak .233.
- **"Next r":** the correlation of the grade with the next season's outcome.
- **"Significant" / `*`:** the paired-pitcher bootstrap's 95% interval excludes zero.

---

## A. Foundations: data and harness

1. **Feature and booster caching** (`train_mlb.py`)
   - **Why:** tests were slow.
   - **Strategy:** a parquet cache of the feature frame, keyed on the data plus the code; a cache of
     trained boosters.
   - **Result:** 70 s → 22 s per test, with identical output. Kept.
2. **Full 2026 season** (`pitches_all`)
   - **Why:** the old view stopped on 2026-08-07.
   - **Data:** day-files after that date.
   - **Result:** +202k regular-season pitches; 2026 grades r .98 vs the truncated run. Kept (owner decision).
3. **2026 plate-convention re-referencing** (§10, other agent)
   - **Why:** 2026 Savant changed the plate convention (ABS zone, 13% shorter).
   - **Strategy:** quantile-map 2026 plate_z onto 2025.
   - **Result:** 2026 grades move about 1 point on average. Applied in the export.
4. **AAA backfill and AAA vs MLB audit** (§14–15)
   - **Data:** 800 AAA days, 2023–26, via the Savant minors endpoint.
   - **Strategy:** compare the same pitchers at both levels.
   - **Result:**
     - Tracking offsets: extension +0.10 ft, release height −0.06 ft.
     - The fastball-ride gap is altitude; five PCL parks are excluded.
     - CSW% level gap: −1.8 points.
5. **Memorization check** (§17): the most important finding.
   - **Model:** v2 LightGBM.
   - **Strategy:** compare per-pitch fit on pitchers the model trained on vs held-out pitchers, in the same
     seasons.
   - **Result:** seen .38 vs unseen .055. The model fingerprints pitchers through release point and the
     fastball-relative inputs. Game folds and season holdouts cannot detect this.
   - **Fix:** the export switched to pitcher cross-fit (owner approved).

## B. Target and model bake-offs (earlier work, other agent)

6. **Target bake-off** (§4)
   - **Models:** LightGBM on four targets (CSW-normalized, run value and others).
   - **Result:** `csw_norm` won.
   - **Caveat:** it ran on the memorizing harness, so it is stale. Replaced by #27.
7. **Physics bundle** (§3)
   - **Features:** drag, Magnus-implied ride and run, total Magnus break, active spin.
   - **Result:** rejected as a bundle, also on the old harness. Active spin was later adopted alone.
8. **Mechanism study** (`MECHANISM-MLB.md`)
   - **Method:** descriptive Hawk-Eye analysis.
   - **Result:**
     - Active spin helps fastballs (+1.9) and hurts sliders (−2.2, the gyro effect).
     - Velocity and shape multiply rather than add.
9. **Stuff+ v2** (shipped)
   - **Design:** v1 plus `spin_eff` (monotone per class) plus velo × ivb.
   - **Gates:** passed the location check against v1 (§11).
10. **Game-fold out-of-fold check** (§13)
    - **Result:** YoY unchanged, so stickiness looked real. This check cannot see memorization (#5).

## C. Studies on the honest harness

11. **Small-sample regime** (§9, §18)
    - **Question:** first-N-pitch Stuff+ vs CSW% predicting rest of season.
    - **Result:**
      - Stuff+ alone beats results only through about 25–50 pitches.
      - A Stuff+ + results blend is best at every N.
12. **Survivorship with demoted arms** (§15)
    - **Strategy:** fill the rest of season with AAA, minus the level gap.
    - **Result:** the pooled claim holds; the demoted subset is inconsistent (n about 60).
13. **tjStuff+ head-to-head** (§19)
    - **Model:** tjStuff+ LightGBM, rebuilt from its model file (r .966 to published).
    - **Result:** ours wins next CSW% 3/3 and K% 1/3; tjStuff+ is stickier. Neither beats naive.
14. **Spin-axis deviation** (§16, §20)
    - **Feature:** observed minus movement-implied axis, the seam-shifted-wake angle.
    - **Result:** passed on the old harness, failed on the honest one (YoY −.012 to −.016). Rejected.
15. **Bat-tracking swing disruption** (§21)
    - **Data:** 2024–26 bat speed, swing length, contact depth, each relative to the batter's own norm.
    - **Result:** timing disruption is a persistent pitcher trait and adds +.006 / +.009 on CSW% after a
      pitch-mix control. Contact depth alone is pitch mix.
16. **Reliever leverage next season** (§23)
    - **Method:** empirical gmLI, the leverage teams actually give a reliever.
    - **Result:** Stuff+ adds +.029 / +.024 / +.002 beyond leverage and results. Teams act on stuff.
17. **Measured arm angle** (§24)
    - **Feature:** Hawk-Eye pose arm angle.
    - **Result:** next CSW% better 3/3, significant 2/3. Pass; proposed for v3.
    - **Variant:** arm angle in place of release height and side fails, but cuts the leak by .026.
18. **Empirical-Bayes blend** (§25)
    - **Model:** one frozen shrinkage rule for blending first-N-pitch CSW% with Stuff+.
    - **Result:** broke on the 2026 level shift. Rejected.
19. **Pitchability residual** (§26)
    - **Question:** is CSW% above Stuff+'s expectation persistent?
    - **Result:** YoY about .50, and it survives a pitch-mix control. Chase rate and first-pitch strikes
      explain a slice.
20. **AAA → MLB translation** (§27)
    - **Model:** AAA pitches graded by the export fold models.
    - **Result:** for prospects with no MLB time that season, AAA Stuff+ beats their AAA K% for next MLB K%:
      r .26 vs .18 (n 169). Both together is best.

## D. Feature selection and importance (§28–29)

21. **Feature importance** (`feature_importance.py`)
    - **Methods:** gain, mean |SHAP|, and permutation loss on seen vs unseen pitchers, overall and by pitch
      type.
    - **Result:**
      - Gain overstates raw spin and release side; their value is pitcher fingerprinting.
      - The true per-pitch signal is hvaa, release height and ride.
22. **Ablations** (9 cross-fit runs plus bootstrap)
    - **Keep:**
      - Release point.
      - Fastball-relative inputs.
      - Extension, which carries next-season K%.
      - hvaa, which costs fit if removed (but see #25).
    - **Removable:** raw spin. Removing it costs no fit and nudges K% up.
    - **Removable by the rule:** active spin + velo × ivb, though K% leans keep.
    - **Rejected:**
      - Drag: YoY −.02, leak +.010.
      - A stripped-down 7-input model: less fit, no gain.
23. **Separate models per Statcast pitch type** (8 types × batter side)
    - **Result:** fit .050 vs .058–.061; next CSW% −.027 / −.044\* / −.039\*. Rejected.
    - Per-type grades should come from the class models.
24. **Non-Magnus movement** (inches; measured minus Magnus-implied break)
    - **Result:** +.008 fit, the best honest per-pitch gain, with no location channel. YoY −.012 / −.018.
    - Rejected for Stuff+; useful for pitch design.
25. **Horizontal approach angle** (residualized on plate_x)
    - **Result:** fit .137 (doubled) because it rebuilds plate_x (R² .91–.999). Rejected.
    - **Also found:** the same geometry means hvaa rebuilds fastball plate height (R² .86).
    - **Also found:** the plate_z-only leak gate missed this, so a plate_x leak gate was added.

## E. Model-structure program (§30, owner approved)

26. **Settings tuned on unseen pitchers** (`tune_lgbm.py`)
    - **Grid:** num_leaves {7, 15, 31, 63} × min_child_samples {100, 1000, 5000}, early stopping on fold 0.
    - **Winner:** 15 leaves, 1,000 rows per leaf, 71 trees.
    - **Result:**
      - Fit rose (.064 / .067).
      - YoY fell to .72–.74.
      - Plate-height leak rose to .346.
      - Next-season bootstrap all inside noise.
    - **Fails.** Lesson: tuning on per-pitch fit rewards location; tune on next-season pitcher outcomes
      instead.
27. **Target comparison** (same features and harness; bootstrap vs the CSW target)

    | Target | Next K% | Next RV/100 | Next CSW% | YoY | Leak z / x |
    |---|---|---|---|---|---|
    | Whiff per swing | +.070\* / +.092\* / +.044 | −.017 / +.087\* / −.005 | −.038 / −.038 / −.082\* | .82 / .86 / .80 | .161 / .125 |
    | Swinging strikes per pitch | +.059 / +.072\* / +.028 | −.029 / +.067 / −.019 | −.033 / −.054 / −.083\* | .81 / .86 / .81 | .139 / .116 |
    | Raw run value | −.047 / −.029 / −.073\* | −.055\* / −.024 / −.059\* | −.061\* / −.072\* / −.081\* | .84 / .87 / .87 | .014 / .046 |
    | Run value minus count + location | −.029 / −.007 / −.044 | −.023 / +.009 / −.041 | −.048 / −.043 / −.083\* | .83 / .85 / .86 | .014 / .027 |

    - **By the pre-registered rule, no target replaces CSW,** because CSW% gets worse.
    - **Read:** whiff per swing is the best strikeout and run-value target, and it leans less on location.
      CSW loses because called strikes are location.
    - A Stuff+ (whiff) + Location+ (called strikes) split needs its own pre-registered test.
28. **Additive model** (boosted stumps, max_depth 1; a GAM/EBM-style model with no interactions)
    - **Result:** ties LightGBM on every outcome (all intervals cross zero) and is stickier (.82 / .84 / .82).
    - The algorithm is not the bottleneck.
29. **Production-style decomposed model, v0** (`stuff_decomp.py`)
    - **Design:** PitchingBot-style LightGBM sub-models per class × batter side:
      - swing
      - whiff given a swing
      - foul given contact
      - called strike given a take
      - run value in play
    - **Inputs:** shape + location + count.
    - **Grades:** Stuff+ = expected run value at the league location and count mix (one random draw per
      pitch). Pitching+ = expected run value at the actual context. Location+ = the difference.
    - **Result:**
      - Leak gone (.006 / .014).
      - Stuff YoY .63–.68.
      - Next K% −.07\* and CSW% −.08\* in 2025→26.
      - Pitching version: next RV/100 +.101\* in 2024→25.
    - **Fails as built.**
30. **Decomposed model v1** (§30)
    - **Changes from v0:**
      - The in-play target is a count-specific linear map of Statcast xwOBA onto run value (removes
        runners, defense and luck).
      - Stuff+ averages 24 shared contexts per pitch (common random numbers) on at most 250 pitches per
        pitcher-season-cell.
    - **Result:**
      - Stuff YoY .83 / .86 / .87, the stickiest Stuff+ built; the noise fix worked.
      - Next K% −.070\* / +.028 / −.115\*; RV/100 −.009 / +.089\* / −.061; CSW% −.098\* / +.015 / −.093\*.
      - Pitching version: next RV/100 +.133\* in 2024→25, the best RV gain recorded.
      - Leak z .121 with no location input: this is the floor from shape–location coupling (pitchers with
        ride throw up). About half of the baseline's .233 is true leakage.
    - **Fails the rule** on K% and CSW%: it optimizes run value, not strikeouts.
31. **Swing-side Stuff+** (§31): **FAILED** (K% −.014 / +.024 / −.075\*; leak x .151)
    - **Design:** value given a swing (whiff / foul / contact branches of the v1 models), context-averaged.
      Called strikes are left to Location+.
    - **Rule:** replaces the CSW Stuff+ only if K% and RV/100 are at least as good (2 of 3 pairs, none
      significantly worse), YoY within .02, and leaks no higher.


## E2. Since §31 (2026-10-26; details in RESULTS-MLB)

32. **Double ML on CSW** (§32): FAILED (K% −.035 in all three pairs; leaks .010 / .037).
33. **Whiff per swing + double ML, "v3"** (§34): passed on 2023–26, then **not confirmed on the untouched
    2021–22 holdout** (§37: K% mean −.006). It is stickier (+.03 to +.05) and location-free at equal forecast power. On hold.
34. **Feature engineering on v3** (§33): perceived velocity, plate speed, usage anchor, v3 set. All failed.
35. **Arsenal / tunneling** (§35): pitcher-level ridge on top of v3. Failed. Lead: arsenal helps next CSW%.
36. **Called-strike Location+ v2** (§36): failed. Additive Stuff + Location cannot rebuild CSW%, because the signal
    is shape × location.
37. **Per-pitch program** (§39): fixed effects, slot-relative movement, acceleration, direction vs arm,
    swing run value, FC routing. All 7 failed. New standard gate: the **change test**.
38. **Per-type grades** (§38): no better a forecast than the class grade; shipped by owner choice (shrunk, k = 150).
39. **Topo L1 class key** (§40): failed on K% / RV. Lead: CSW% +.019 / +.006 / +.036\*, stickier, change test up.

---

## F. Not tried yet (ranked by expected gain per day)

*Status 2026-10-26:* tried since this list was written: 1 (§36), 2 (§32/§34), 4 (§33), 7 (§35), 15 (§40).
Still open: 3, 5, 6, 8–14, 16, 17.

1. **Called-strike Location+** to pair with the swing-side Stuff+ (#31, running).
2. **Double machine learning.**
   - **What:** cross-fit residualize the target AND every shape input on location and count, then fit
     residual on residual.
   - **Why:** removes hidden location channels (hvaa, HAA) without dropping the inputs.
3. **Tuning on the right objective.** Choose settings by next-season pitcher-level r on held-out pitchers,
   not per-pitch fit (#26).
4. **v3 inputs on the winning structure:** drop raw spin and hvaa, add arm angle; judge with both leak
   gates.
5. **Pitcher grades with intervals.** Hierarchical Bayesian aggregation; gives the site its missing
   standard errors.
6. **Location+ and command.** From the decomposed models; command = best E[RV] location vs actual.
   Cf. xCTRL.
7. **Arsenal and tunneling.**
   - Distance between consecutive pitches at the decision point (about 24 ft).
   - Pitch-type predictability by count.
   - Mix+ / Match+.
   - Tested against the persistent residual (#19).
8. **Late break:** movement after the decision point, from the 9-parameter trajectory.
9. **Swing-response targets.** Bat speed loss, contact depth and miss distance as multi-task targets beside
   whiff (follows #15).
10. **Aggregated targets.** Pitch-type season whiff rate from average shape (a cleaner target).
11. **Adversarial neural encoder.** A gradient-reversal location head; only if double ML falls short.
12. **Monotone-constraint ablation.** The constraints have never been priced.
13. **Primary-fastball anchor by usage, using only past pitches.** Removes in-season future leakage.
14. **Rolling retrain.** Add 2025 to training; drift monitors on each new season.
15. **Topo tagger key on MLB.** Requested from the other agent; test it as a display layer or as an input,
    not as cells (#23).
16. **Transfer to college.** MLB-trained, fine-tuned on D1 TrackMan with measured offsets.
17. **Sequence transformer with player embeddings.** Low priority: high memorization risk, and the college
    study failed.

---

## G. Queued by the owner (2026-10-26), with hypotheses and how each would be validated

Every item uses the standard protocol:
- pre-register in the ledger;
- pitcher-fold cross-fit with `GOAT_LO=2021` (selection 2023–26, confirmation 2021–23);
- change test;
- 2020 is the last sealed season, opened once for a final confirmation.

Sources:
- the knowledge base;
- the R&D status report (owner's file `MLB R&D Status Report & Production Specification: Counterfactual
  Stuff+ Pipeline and Tracking Reconciliation`, 2026-10-26). It is an LLM synthesis written before §31–§40, so
  some claims are superseded: it treats whiff-per-swing and swing-side Stuff+ as winners.

### G1. Non-Magnus (seam-shifted wake) movement, deeper

- **Known.** Per-pitch non-Magnus inches gave the largest honest per-pitch gain (+.008) but cost YoY −.012 to
  −.018 (§29). The spin-axis deviation probe was weak (§16, §20).
- **Hypothesis.** SSW matters for sinkers, changeups and splitters, and is noise for the rest. Sources:
  - Niesen, "Magnus Mirroring", 2026-10-13: "most sinkers are just a four-seam with more seam-shifted wake";
  - Driveline on changeup "non-Magnus maximizing" orientation, 2026-10-15.

  Pooling it into all cells adds noise where it means nothing.
- **Tests:**
  - (a) nm_ivb / nm_hb as type-gated inputs (SI, CH, FS only; NaN elsewhere);
  - (b) the pitcher-season-type *mean* non-Magnus (the repeatable part) in place of the per-pitch value;
  - (c) "Magnus mirroring" as an arsenal term (an SI's SSW gap vs the same pitcher's FF).
- **Pass.** Standard rule, plus change-test r up on SI / CH.
- **Fail.** YoY drops again with no forecast gain.

### G2. A model family beyond gradient boosting

Evidence so far says capacity is not the bottleneck:
- boosted stumps (a GAM) tie the full ensemble (§30);
- tuning on per-pitch loss hurts (§30 #26).

So the case for a new family is **validity** (smooth prices, the change test, uncertainty), not raw forecast.
Candidates, cheapest first:
- **Explainable boosting / spline GAM** (InterpretML EBM, pyGAM). Smooth shape functions with pairwise
  interactions. Expect a forecast tie, with a better change-test slope.
- **Physics-parametric surface** (Resnick, Pitcher Greeks): about 8 parameters per release cluster, so it cannot
  memorize. Expect a lower level r, with a change-test slope near 1.
- **Multi-task MLP on the hurdle branches** (swing, whiff | swing, foul | contact, contact value), with a shared
  embedding, monotone constraints by construction (lattice or monotone layers) and calibrated heads.
- **Adversarial encoder** (SABR 2026 poster, gradient reversal on location; add a pitcher-ID adversary).
  Double ML already covers location, so only the pitcher-ID head is new.
- **Distributional / Bayesian** (NGBoost; hierarchical pitcher pooling, §F5): gives the standard errors the site lacks.

**Pass.** Forecast within the CI of v2 *and* change test better in at least 2 of 3 classes, confirmed on 2021–23.

### G3. More training seasons and 5-fold pitcher CV

- **Today.** Train 2023–24, 4 pitcher folds.
- **Proposal.** Train 2021–25 pooled, GroupKFold(5) by pitcher, plus rolling-origin evaluation (train ≤ t,
  score t + 1), which is what production does.
- **Costs:**
  - pre-2023 Hawk-Eye offsets (FF IVB −0.45 in, ext +0.12 ft) need a per-season affine correction before
    pooling (the AAA recipe, §14);
  - pooling 2021–22 into training uses up the confirmation set, so 2020 becomes the only holdout.
- **Hypothesis.** More arms in training (about 2,000 vs 1,400) help the rare cells (CH vs LHH, sweepers).
  Expect a small gain on BB / CH and none on FB.

### G4. Hyperparameters: how far can boosting be pushed?

- **Hypothesis: the ceiling is near.** XGBoost and LightGBM are the same family (expect a difference ≈ 0).
  The GAM tie says interactions add little. Tuning on per-pitch fit selected location leakage.
- **Right test.** Optuna (about 50 trials) on a pitcher-level objective with nested CV:
  - the inner pitcher folds choose the settings;
  - the outer folds and 2021–23 judge them;
  - the objective is the report's J(θ) = r(next K%) + 0.5 r(next RV/100) − 2·max(0, leak_z − .13) −
    2·max(0, leak_x − .05).
- **Prediction.** Under .02 r of gain, flattening within about 20 trials. If the outer gain is under the inner
  gain by more than half, that is selection inflation (Resnick §5.1, "fifty coin flippers").

### G5. Feature engineering per individual pitch type

Inputs are gated by type inside the class models (NaN outside the type). Separate cells were rejected in §29.

| Type | Inputs |
|---|---|
| FF | ride vs slot (§39 C2a, per type only); counterfactual VAA at fixed plate heights (the report's VAA^(k): the approach angle a pitch *would* have at 1.5 / 2.5 / 3.5 ft, carrying no actual location); extension |
| SI | arm-side run and sink vs slot; non-Magnus (G1) |
| CT | cut and velo gap vs the pitcher's FF; FC-vs-SL shape distance |
| SL / ST | gyro share (1 − spin_eff); sweep per mph; depth vs FF; velo gap |
| CB | depth vs FF; spin rate; vz0 "hump" sign; velo gap |
| CH / FS | velo gap; dive (IVB diff vs FB); fade; spin (low = splitter); SSW axis deviation |

**Judged on** the per-type forecast (`type_grades.py`) and the per-type change test, with the standard rule overall.

### G6. Other items from the R&D report, to test (not adopt)

- **Counterfactual approach angles** (recompute VAA / HAA at each context grid point). This is the principled
  fix for the hvaa leak.
- **Trailing 30-day primary-fastball anchor.** No in-season future leakage (§F13).
- **Isotonic calibration** of hurdle branches (calibration error ≤ .008).
- **Split-half reliability N\*.**
- **RK4 trajectories vs the 9-parameter fit.** The report puts VAA error at 0.08–0.18°. Low priority: it is
  likely below the noise floor, so check that first.
- **Out of scope here (clean room).** The report's TrackMan harmonization belongs in vt_baseball, not goat-pro.

### G7. Infrastructure: GPU rental (owner note)

Thunder Compute (cloud GPU rental) for the neural families (G2) and large tuning runs (G4):
- keys in `.env` only;
- only public Statcast data leaves the machine (clean room);
- budget and timing to be estimated before first use.

Not set up yet.
