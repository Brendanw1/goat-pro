# GOAT-Pro (MLB) model experiments: everything tried, and what is still untried

As of 2026-11-20. Every experiment ran on public MLB data (Statcast via the `savant_mart`, plus AAA
Hawk-Eye, Stats API lines, and public Savant leaderboards). Details live in `pipeline/RESULTS-MLB.md` (section numbers
below as §n; a few numbers were reused there, so §97, §103 and §104 each name two experiments); pass rules were
written in `COLLABORATION.md` before each run; raw numbers are in `pipeline/results/`. Coverage: §1–§110.

**How to read the results.**

- **Honest harness:** pitcher-grouped cross-fit. Pitchers are split into 4 folds by `crc32(pitcher) % 4`,
  and no pitcher is graded by a model that trained on him.
- **Baseline:** Stuff+ v2 on the honest harness.
  - Per-pitch fit .058 / .061 (2025 / 2026).
  - Year-to-year stability (YoY) .79 / .82 / .82.
  - Plate-height leak .233.
- **"Next r":** the correlation of the grade with the next season's outcome.
- **"Significant" / `*`:** the paired-pitcher bootstrap's 95% interval excludes zero.
- **Later sections (§41 on) use other harnesses, stated in each entry.**
  - **Composite / `judge.py`:** the mean pooled Δr over K/PA, (K−BB)/PA, RV/100 and xRV/100 across season pairs, with
    one paired bootstrap. From §54 the bootstrap is **pitcher-clustered** (one draw shared by all pairs); earlier
    intervals were too narrow, and no verdict flipped. K% from §44 on means K/PA.
  - **MDE:** the minimum detectable effect at 80% power; a result below it reads "not detectable", not "no effect".
  - **Sealed:** a holdout read once on a frozen spec (a season, or a random 20% of pitchers). Spent seals are named.
  - **Hitters and prospects:** hitter-grouped (or player-grouped) cross-fit, hitter-clustered bootstrap.
  - **"Descriptive":** failed its forecast gate but shipped as a labelled description. **"Shipped"** means a site
    decision, not a model that beat its incumbent.

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

## E3. Tuning, target study and the P7 family (§41–§57, 2026-10-26)

These sections use a second harness, described in "How to read" above: pitcher-level judges (`judge.py`, with a
composite of pooled Δr) and, from §50, a **sealed 20% pitcher split** read once.

40. **T1: tune on a pitcher-level objective** (§41): **FAILED** the overall rule, helped 6 of 8 pitch types
    - **Why:** #26 showed tuning on per-pitch fit rewards location; tune on next-season pitcher-type outcomes instead.
    - **Strategy:** inner pitcher CV on train only, per class.
    - **Result:**
      - Ceiling: fastball capacity is exhausted (+.005); breaking balls +.060 and changeups +.110 (best-of-60
        selection inflates both).
      - Gate: K% passes, CSW% up in every pair, RV/100 ≥ 0 in only 1 of 3 selection pairs (confirmation mean −.012),
        leaks above base. Sinkers HURT (−.027 / −.079\*), so per-type routing is barred.
41. **T1b: tune breaking balls and changeups only** (§42): **FAILED** on RV/100 and the leak gate
    - **Result:** K% passes in all six pairs including the sealed 2020→21 pair (+.018); per type, no type HURT;
      RV/100 fails (two −.003 pairs); leak z +.064 over base. **2020 is now spent.**
42. **T1b audit** (§43, post-hoc, descriptive): the tuned gain is **stuff, not location** at the season-grade level
    - Whiff/swing next season +.021 [+.004, +.039]; survives partialling out the pitcher's own location habits;
      lives in out-of-zone whiffs (+.045) and does not convert to run value (−.010, CI crosses 0).
    - The §41–§42 leak rise is a per-pitch effect that does not reach the season grade.
43. **P0 power audit and AAA plate convention** (§44)
    - **Power:** the pooled judge has a minimum detectable effect (MDE) of about .013 composite for near-identical grades
      (single pair about .05, which is why 2-of-3 sign rules were coin flips). For a target change the MDE is about .033 (§45).
    - **Definition change:** from here "K%" is K/PA (r .948 with the old strikeouts per non-BIP pitch).
    - **AAA 2026 plate convention** matches AAA 2024–25; AAA has always matched the MLB 2026 (ABS) convention.
      Frozen AAA recipe: the #4 adjustments plus the MLB 2026 plate-z map.
44. **P0 step 2, target study** (§45): **wps (whiff per swing) wins**
    - vs csw_norm: composite +.043 [+.020, +.066]; vs the shipped grade +.051. Positive in all five pairs.
    - Run-value targets lose even on run value (rv −.023). Location-partialled wps gives the gain back (+.006).
    - Per type: FF / SI / CT improve; CB, CH, FS trend negative inside noise.
45. **P0 step 3, input batch on wps** (§46): **no input change helps**
    - Tested: −hvaa, −raw spin, −(spin_eff, velo × ivb), +arm angle, acceleration, primary-fastball anchor, +non-Magnus
      acceleration.
    - Only raw spin matters when removed (−.008; weakened to [−.018, +.002] by the §54 bootstrap fix, K/PA still
      −.014\*). hvaa adds no forecast but removing it doubles the location leak (.132 → .271).
    - Neither "unique inputs are wrong" nor "consensus inputs help" is supported: the unique inputs are redundant.
46. **P0 step 4, breaking-ball / changeup re-tune under wps** (§47): breaking-ball re-tune **adopted**
    - BB re-tune +.008 [+.004, +.013] (all of K/PA, K−BB, RV/100, xRV/100 positive\*); CH re-tune +.001, not adopted.
    - Model "s4_bb" vs the shipped grade: +.059 [+.035, +.083], the first run-value CI above 0 in the program. In-sample
      on MLB; AAA is the holdout.
47. **P0 step 5, reliability per type and gyro sliders** (§48)
    - Grade split-half ≥ .85 by 25 pitches for every type, but the whiff outcome needs 100–200+ swings (and shape
      reliability is near-automatic, so this is reliability, not validity). Display minimums stay set by validity.
    - **Gyro-slider label (SL gyro share ≥ .75) passes** its pre-registered rule; ship on the pooled scale.
48. **P0 step 6, AAA final check** (§49): **NOT CONFIRMED**, seal opened once
    - Sealed AAA 2025→26 composite −.003. K/PA gain replicates in all three AAA pairs (+.065 sealed; pooled +.088
      [+.049, +.128]); RV/100 does not (−.076 sealed).
    - Read: whiff-per-swing is a better strikeout forecaster, not a better run-prevention forecaster. AAA no longer
      has a clean holdout.
49. **K+ projection** (§50): **CONFIRMED**
    - Ridge on Marcel K%, K%, SwStr%, the Whiff+ grade and log PA → next-season K/PA.
    - Sealed Δr vs Marcel +.040 [+.010, +.072] (later +.014 to +.068 after §54), 6 of 6 pairs; RMSE also lower.
    - Whiff+ carries the second-largest weight. Caveat: steps 2–6 had read the sealed pitchers' outcomes when choosing
      the Whiff+ model itself.
50. **Stuff+ (RV), a run-value shape grade** (§51): **FAILED**
    - Targets xrv and rv on the s4_bb inputs. Sealed RV/100 −.037 vs shipped, and it never beats Whiff+ on run value.
    - Batted-ball run value is not forecastable from pitch shape alone at the pitcher level. No "traditional" Stuff+ ships.
51. **Run-prevention stack, "Prevention+"** (§52): **CONFIRMED**
    - Ridge on Whiff+, K+, BB%, GB% → next-season RV/100 and xRV/100 vs K−BB%, FIP and xFIP.
    - Sealed Δr vs K−BB% +.086 [+.042, +.130] (RV) and +.098 (xRV), 6 of 6 pairs. First run-value result that holds on
      held-out pitchers.
    - Diagnostic: removing Whiff+ costs .014; most of the lead is strikeout history, walks and ground balls. A
      Marcel-regressed K−BB% benchmark was not pre-registered and would close part of the gap.
52. **Location+** (§53): **NOT CONFIRMED** (narrow miss)
    - Per-pitch umpire-neutral run value, shape-controlled. Sealed RV/100 +.0385 [−.0006, +.0767], 5 of 6 pairs; adds
      nothing to Prevention+.
    - A stable trait (YoY .68, reliable at ~400 pitches) driven by avoiding non-competitive pitches (waste % r −.56).
53. **Bootstrap correction and Location+ critique** (§54): every pooled CI since §44 resampled pitchers independently
    within each pair, although one pitcher is in up to six pairs
    - Fixed with one pitcher-clustered multinomial draw shared across pairs. Point estimates unchanged; no verdict flipped.
    - Location+ is mostly a control grade (r −.59 with BB%) that credits strike-throwing, not command quality. The
      shape controls included hvaa against the row's "no hvaa" (disclosed, no re-fit).
54. **BB+ projection** (§55): **NOT CONFIRMED**; Location+ renamed **Control+**, descriptive only
    - Sealed Δr +.016 [−.004, +.038] (4 of 6 pairs); RMSE falls but r's CI crosses 0.
55. **Pitching+** (§56): **NOT CONFIRMED** (ties SIERA)
    - Umpire- and catcher-neutral per-pitch value model. Sealed Δr vs SIERA −.027 [−.109, +.057]; adds nothing to
      Prevention+ (+.004). The batter adjustment does not help. Stable (YoY .74) and about equally stuff and command.
    - Read: pitch-level models add beyond outcomes in strikeouts, not runs. RA9 is noisy, so power is low.
56. **Sequencing** (§57): detectable, sticky, **not forecast-useful**
    - Real but tiny (0.12% of per-pitch MSE net of a shuffled placebo); trait YoY .59; sealed add to Prevention+
      +.009 [−.009, +.025]. Stickiness likely reflects arsenal structure (which pairs a pitcher owns), not a sequencing skill.

## E4. Within-pitcher check, usage research and AAA (§58–§66, 2026-10-26 to 2026-10-27)

57. **Whiff+ within-pitcher location check** (§58)
    - No single input carries location (each within r ≤ .21), but small pitch-to-pitch shape changes move with
      location. Negligible for breaking balls and changeups; about 24% of grade SD for fastballs (the rest of r +.36 with
      mean height is the between-pitcher ride-and-elevate coupling). Not a blocker; a within-pitcher leak gate is added
      to the next fastball refit.
58. **Buyback / decay** (§59): **decay confirmed, buyback not**
    - Within a game, repeated looks at the same pitch type cost the pitcher about 0.002 runs per pitch per earlier look
      (selection 2023–26 and confirmation 2021–22; strict version 0.0014 / 0.0011). All decay, no cross-type buyback;
      saturates after 2–3 looks; location is not the mediator.
    - A future-exposure placebo was withdrawn (it measures the pitcher reacting to the current pitch).
59. **Decay-aware usage optimizer** (§60): gaps persist, **realized edge not confirmed**
    - Paper edge about 1.2 runs/season (SP), 0.4 (RP). Type-value gaps persist at about 60% of the shrunk prediction,
      but pitchers close only about 10% of a gap a year.
    - Intent-to-treat gain slope 2.3 in selection, 1.3 [−0.2, 2.9] in confirmation. Decay-aware calibration is no
      better than static. The naive design is invalid (usage reacts to in-season performance, slope +4.3).
60. **Per-count minimax** (§61): usage is **equilibrium-consistent**
    - More-used types have higher realized value within a count node (+1.17 / +0.87 runs/100 per unit share); the
      "season optimizer edge" is mostly equilibrium behavior. The fastball-vs-breaking-ball gap is not explained by
      strike-burden (the small Kovash–Levitt anomaly remains, about 1 run per SP-season per 10-point shift).
61. **Pitch predictability** (§62): **not priced**
    - β +.003 [−.004, +.009] / +.000 [−.009, +.009]; placebos null. **Method lesson:** a leave-one-game-out expected
      mix gave a spurious −.026 because pitchers throw more of what is working that day; the shuffled placebo caught it.
62. **Count-state usage policy, off-policy evaluation** (§63): **no edge**
    - Tilt policies +0.008–0.021 runs/100 but fail the placebo rule in confirmation; net of usage response ≤ 0.25 runs
      per SP season. Raw doubly-robust estimator was biased (−.02); the identity-policy contrast fixed it.
    - Program conclusion (#58–#62): MLB usage is near-equilibrium.
63. **Whiff+ on AAA for the site** (§64, display only): the MLB s4_bb recipe applied to AAA out of fold
    - MLB rows reproduce shipped grades at r .983; AAA same-season r with whiff/swing .422 (MLB .482); pitchers at both
      levels r .817, AAA reads +1.4 higher.
64. **Display floors for Whiff+** (§65)
    - Split-half reliability of the per-type mean is ≥ .70 at 10 pitches for every type, so type and class grades now
      show from 10 pitches (was 50); overall from 10 graded pitches. Scale unchanged (existing grades byte-identical);
      Pitching+ by class stays at 50.
65. **P7 family on AAA** (§66): frozen MLB ridges applied unchanged, **CONFIRMED** for K+ and Prevention+
    - K+ vs AAA Marcel K% +.069 [+.046, +.091], 3 of 3 pairs. Prevention+ vs AAA K−BB% on RV/100 +.033 [+.007, +.059]
      and xRV/100 +.034 [+.005, +.062], 3 of 3.
    - The informative claim is Prevention+ (Whiff+ alone failed on AAA run value, #48). Control+ and Pitching+ stay
      MLB-only. These pairs are not fresh (step 6 already read the same rows).

## E5. Hitters and park (§67–§72, §77–§79, 2026-10-27 to 2026-10-28)

66. **Hitter Marcel projection with measured ranges** (§67): **CONFIRMED** as a sanity gate
    - Marcel (5/4/3 weights, 1,200 PA regression) beats persistence for wOBA (+.053), K/PA (+.020) and BB/PA (+.048).
      Shipped display-only with 80% ranges binned by PA; the wOBA ranges are lopsided (Marcel overshoots; no age term).
67. **Our own xwOBA** (§68): **NOT CONFIRMED**
    - LightGBM multiclass over EV, LA, spray angle, sprint speed, batter-grouped cross-fit. Forecast Δr vs Savant's
      xwOBA −.027 [−.041, −.012], 1 of 6 pairs; more descriptive (same-season r .878 vs .826), less predictive.
    - Diagnosis: spray came from `hc_x/hc_y`, the fielded spot, so on ground balls it partly encodes the outcome.
68. **xwOBA v2, no ground-ball spray** (§77): **NOT SHIPPED**
    - Removing the leak gives +.004 [−.002, +.010] over v1 and still −.022 vs Savant. The leak was real but small;
      spray-aware xwOBA stays more descriptive and less predictive. The site keeps Savant's.
69. **Decision+ / IZA / OZA / dRV per 100** (§69): shipped **descriptive**, loses as a forecast
    - Two batter-grouped LightGBM models (swing, take) price each choice at league-average execution. Reliable (split-half
      .69 / .46 / .77 for dRV, IZA, OZA; YoY .71) but Δr vs −Chase% on next BB%−K% −.069 [−.103, −.035], 0 of 6.
    - BB−K carries contact skill that the decision metric leaves out by design.
70. **Park factors, component, EB-shrunk** (§70): **2B, 3B, HR and SO confirmed; 1B and BB not**
    - 3-year EB beats a single season at forecasting next season's home/road ratio: 2B +.173, 3B +.144, HR +.102,
      SO +.059; 1B +.044 and BB −.039 are noise.
    - Sanity check half right: triples lead at AZ, COL, KC, but COL is not top-5 for HR (recent factors put LAD first;
      Coors' edge is in hits in play). Method not changed after the read.
71. **Park-adjusted wOBA and FIP** (§72): **NOT CONFIRMED**
    - Among players who changed team, year-to-year r: hitters +.002 [−.016, +.022], pitchers −.008. With only
      2B/3B/HR/SO factors the adjustment is too small (about .01 wOBA).
72. **xRV per pitch** (§71, then v2 §78): **NOT CONFIRMED** twice, shipped descriptive
    - Pitcher-grouped multiclass plus a contact leg. xRV/100 vs RV/100 at forecasting next RV/100 +.009 [−.043, +.061],
      2 of 6; loses to judge.py's observed xRV (−.084).
    - Diagnosis: the 2026 zone change (sz_top 3.4 → 3.2 ft) was suspected; v2 adds a season term and moves nothing
      (−.001 vs v1). A genuine near-tie. Prevention+ stays the validated run forecast.
73. **Platoon Whiff+ splits** (§73, then location-aware §79): **NOT CONFIRMED** twice, shipped descriptive
    - Predicted gap vs next season's observed gap: shape-only −.058 [−.104, −.011]; location-aware −.105 [−.148, −.061].
    - At 50+ swings per side the observed gap is reliable (r .37–.47), so a league-average model that never sees the
      pitcher cannot beat it. Untried: an EB blend of observed gap shrunk toward the model gap (a new claim).
74. **Tunnel+ on MLB** (§74): **CONFIRMED** as adding information beyond prior chase, shipped descriptive
    - Refit on Statcast: commit point 23.8 ft, chase model per season, shrunk per pitcher and pairing.
    - Δr +.091 [+.026, +.156], all 5 pairs positive; head-on it loses to prior chase (−.266). Pitcher grade YoY .64 vs
      chase .49; pairing grade YoY .68 (MLB samples are larger).
    - 2026 `release_pos` appears to be measured differently (0.94 in vertical gap at release), under the 2 in gate.

## E6. Defense and catchers (§75–§76, §80–§81, §96–§97, §100, §108)

75. **Framing runs and Framing+** (§76): **CONFIRMED**
    - P(called strike) model without catcher or umpire; r with Savant `rv_tot` .950 [.935, .963], n 414.
76. **Fielding range v1 → v3** (§75, §80, §81): **v3 shipped**
    - v1 failed (IF r .498, OF .691; calibration off by ~.04 at the tails; no recalibration step).
    - v2 isotonic recalibration fixed calibration only; IF validity did not move (.495). OF confirmed (.679).
    - **v3 added Savant's average fielder start positions plus a drag-only hang time:** IF .580 [.526, .630],
      OF .721 [.678, .757], both confirmed. IF's limit was missing start positions (a data gap), not modeling.
    - Costs: IF reliability and YoY fell (YoY .27 vs Savant .44), and elite range stays compressed.
77. **Range v4, the responsible fielder's own speed** (§96): valid but **does not ship**
    - IF .572, OF .650 (OF −.071 vs v3). Shipping rule (r ≥ v3) failed. Decomposition: 67% of OF chances are within
      the fielder's speed reach; speed-tool plays are real but rare (~7%).
78. **Range v5, lift-corrected hang time** (§97, range): valid but **does not ship**
    - Adding backspin lift (C_L .24) lifted deep-fly hang +0.9–1.5 s but r barely moved (IF .581, OF .717; flat in
      C_L from .15 to .30). The proxy error was monotone and rank-preserving, so the compression is attributed to
      per-play positioning and routes, which are not public. p is declared at its public-data ceiling.
79. **Is our range residual skill?** (§100, descriptive): **no**
    - Ours − Savant OAA correlates negatively with burst (−.247) and bootup (−.218), and about 0 with routing; after
      controlling for Savant OAA, all ≈ 0. Show Savant's Jump components beside our runs; never present the residual as skill.
80. **Catcher blocking, expected WP+PB** (§108b): **SHIPPED**
    - 2026 holdout log loss .0333 vs league .0480 (−31%); blocks above expected vs Savant r .915; YoY ratio .94.
81. **Catcher throwing, xCS%** (§108a, v2): v1 **descriptive** (calibration gate G2 .043 > .03); **v2 ships on leave-one-season-out**
    - v2 (shallower trees, isotonic on out-of-fold predictions, pickoff count, pitcher lead gained): G1–G6 all pass
      (decile gap .013, CS above xCS vs Savant r .947, pitcher credit YoY .612 on 49 pairs). 2026 had already been read,
      so there is no clean holdout; a leakage check excluded `time_to_target` (it times the same race as the label).
82. **Catcher judging, sealed pre-2020 holdout and three upgrades** (§108c)
    - **v2 xCS on 2016–19: NOT CONFIRMED on G2** (decile gap .058); ranking holds (G1 −13%, G3 r .962). Diagnosis: era
      shift (observed − predicted +.037 pooled), not modeling. A probability floor [.005, .995] now applies everywhere.
    - **Joint catcher/pitcher/runner random-effects model: FAILED** (J1 .404 vs .469; J2 .083), though it beats v2 on
      log loss; what the pitcher adds is already in lead gained and in whether runners go.
    - **Deterrence** (P(attempt | opportunity)): passes on LOSO only (D1 .318); pre-2020 read blocked (no pitch-level mart).
      In runs it is almost nothing (sd 0.21 vs 2.04 for CS above xCS).
    - **Throwing runs:** pass (r .911 vs Savant runs; 2019 .965).

## E7. Fixes, re-reads and value stats (§82–§88, §102, §105–§107, §109–§110)

83. **Whiff+ hand-matched grading** (§82, bug fix): **NON-INFERIOR, shipped**
    - The season grade scored every pitch against the reference for the batter hand of the class's first pitch. Fix:
      each pitch against its own hand's reference. Versions agree at r .994; composite +.0014 [−.0025, +.0056]; K+ and
      Prevention+ stay confirmed. Our handling error, not the model.
84. **Do grades under-credit hard, steep fastballs?** (§83): **NOT CONFIRMED** (Whiff+, Pitching+, Prevention+)
    - Velocity × steepness interaction +.0084 [−.0035, +.0215] (logit); hard-and-steep corner −0.65 pp [−2.35, +1.13].
      The steepness cost shrinks with velocity, and so do the predictions. Prevention+ test underpowered (MDE 0.075).
85. **Does Pitching+ under-credit hard four-seamers?** (§84): **NOT CONFIRMED**, on sealed pitchers
    - Slope +0.031 [−0.052, +0.111] (MDE 0.117); ≥ 97 mph residual +0.35 runs/100, under the 0.5 bar. Every velocity bin
      sits about +0.1 to +0.5: an FF-wide level offset, not a velocity effect. Noted for the next calibration check.
86. **Our own WAR** (§85): **all four gates PASS, shipped**
    - Position players r .920 vs bWAR, pitchers (FIP-based) .814, team wins r .913 (bWAR's own .931), accounting within
      0.04%. Batting runs r .982 with B-Ref; fielding + positional only .764 (elite range under-rated).
    - Known limits: 2020 baserunning is 0 (no Savant board); pitchers are FIP-based (YoY .419 vs bWAR .194).
87. **Would it dong (HR in how many of 30 parks)** (§86): **both gates PASS**
    - 2-D drag + lift flight model with per-ball drag solved to match the actual distance, published fence geometry.
      Own park accuracy .965 (recall .912, precision .921; distance-only .930); xHR r .990 with Savant's; no-doubters .960.
    - Found at the read: Savant's three buckets count all batted balls, not only HR. Weakest parks are those with
      irregular walls.
88. **Role conversion** (§87): **FAILED** both gates, shipped descriptive
    - 58 reliever-to-starter converters, 86 the other way. Traits worsen the forecast (A1 MSE .00115 vs .00096);
      first-through-the-order line no better than the full line. Velocity bump on moving to relief +0.9 mph (a floor).
    - Diagnosis: power (n 58), not a bug. A one- or two-trait re-test (K+, Control+) is the logical follow-up.
89. **Minor-league translations (MLEs)** (§88, v1 then v2): partly confirmed
    - v1 beat the raw line almost everywhere but lost to the league mean on a level offset (pitcher FIP +0.77); the
      factor population (same-season call-ups) differed from the forecast population.
    - v2 fit factors on the forecast population. **Pass:** AAA hitter K%, BB%, ISO; AA hitter K%, BB%; AAA pitcher K%.
      Fail: BABIP and wOBA (one minor-league season of balls in play is too noisy), pitcher BB/HR/FIP.
    - Labels: "tested" (v1 pass: AAA hitter K%/BB%/ISO, AA hitter BB%), "provisional" (v2 only: AA hitter K%, AAA pitcher K%),
      the rest descriptive.
90. **Baserunning, extra bases taken** (§102): **NOT CONFIRMED**, not shipped
    - Reconstruction from pitch rows dropped 42.4% of runner opportunities (target under 5%) because the batter's own
      extra base on a throw makes the base-occupancy diff unsolvable. r .120 [−.008, .241]. A v2 would enumerate the
      batter's destination jointly (new pre-registration); the SB/CS leg needs play-by-play.
91. **40-man removal at the tender deadline** (§105): descriptive, clears the tracker bar
    - Cross-fit AUC .871; held-out 2025 cycle .805. Top features: age, tenure among our snapshots, workload, K%, RV/100.
      Options and service class are unseen. Ships as a context column.
92. **Prospect value, top-100 rank to WAR** (§106): the table ships
    - Medians are zero at every tier. Top-10 batters are the only reliably valuable slot (1.22 WAR over three seasons,
      85% reach MLB); top-10 pitchers return no more than ranks 26–50 (0.53 vs 0.54 WAR over three seasons).
93. **Fringe trades** (§107, descriptive): traded fringe players do slightly worse than matched retained players next
    season (0.39 vs 0.47 WAR); the 52 traded top-100 alumni averaged 1.23.
94. **Model grades on Arizona Fall League pitches** (§109, inference only): **scale offset NOT MATERIAL**
    - The AAA path scores 76,894 AFL pitches; reproduction gate exact. Paired AFL − regular gaps: extension −0.06 ft,
      release height −0.01 ft, Whiff+ +0.08 [−1.22, +1.49] (only 48 pitcher-seasons qualify).
95. **wRAA / wRC / wRC+** (§110): shipped as a value stat; **projected wRC+ not proven**
    - Park-adjusted wRAA vs B-Ref batting runs r .982. wRC+ predicts next wOBA as well as wOBA (+.0007).
    - Marcel-projected wRC+ is under-powered / fails decile calibration (level −2.7 to −9.4: Marcel overshoots). Not shipped.

## E8. Swing program, bat tracking 2024–26 (§89–§95, §98, §90b, §91b)

96. **Contact-depth explorer and the personal damage window** (§89): **window FAILS** both gates
    - Split-half .213, loses to the league curve (ΔMSE −.00061). Per-ball noise swamps a small true spread. "Late on 95+" is reliable (split-half .61, YoY .58) and ships as a style board. League curve peaks +6 in.
      out front; fastballs sit 3.3 in. deeper than normal, breaking +5.1.
97. **Swing plane match** (§90): **FAILED, sign backwards**; refined as **§90b, all four claims pass on a 2026 read**
    - Pooled |attack angle + VAA| mismatch *raises* squared-up (+2.8 pp per IQR) because it rewards steep, high-EV contact.
      Exploration found why: attack angle at the intercept is mostly timing (r .81 with depth) and on whiffs it is a
      projected, steeper value.
    - §90b (claims frozen before the 2026 read): sweet-spot rate peaks at a matched plane (+4.1 pp min); xwOBAcon falls off
      faster with timing error when mismatched (−.017 per 5 in.); a hitter's prior-season cell plane predicts next-season
      contact (−2.0 pp per 5.4° steeper); trait split-half .85. The scope is narrower: a contact trait, descriptive.
98. **Swing quality model (SQ)** (§91): **FAILED** as a forecast
    - Hurdle model of expected damage from swing and pitch, hitter-grouped cross-fit; no memorization signal. SQcon .681
      vs Marcel .744 at predicting xwOBAcon; blast rate carries signal, squared-up rate is negatively related to next-season damage.
    - SQ is reliable (SB .75 at 25 balls in play) largely because bat speed is (r .70).
99. **SQ as an add-on to Marcel** (§91b): **FAILED** (+.026 [−.002, +.054])
100. **SQ re-attack for small samples** (§98, §98a): dev holds, **frozen claim fails on power**
    - Dev (first 25 balls in play): SQcon adds +.042 to +.066 wR² to in-season Marcel; a smooth additive spline head beats
      boosted trees at the hitter level; "wide" per-swing features add nothing, and six swing-trait means carry almost all of
      it. Holdout (114 below-floor hitter-seasons): +.091 [−.048, +.214], season halves disagree in sign.
    - Ships descriptive with an exact additive coach decomposition.
101. **Timing residual** (§92): five of seven traits reliable (fastball bias SB .84, spread .83); **does not forecast**
    next-season K% or xwOBAcon (ΔwR² ≈ 0). A depth-spread failure elsewhere looks like sample size, not a non-trait.
102. **Two-strike adaptation** (§93): **both gates pass**
    - Bat-speed slowdown with two strikes (pitch-adjusted −0.86 mph) is stable (YoY .644); bigger slowdowns go with
      about 1.14 pp lower K% per SD beyond early-count whiff and swing rates. Same-season association, not causal.
103. **Swing archetypes, comps and aging** (§94): stability passes (k-means only) but **types add nothing beyond bat speed**
    - BIC picks k = 2; archetype beyond bat speed −.0001. The other five continuous traits beyond bat speed add +.132,
      so cutting them into two types discards information.
104. **Bat-speed drift as an injury flag** (§95): **FAILED**
    - CUSUM / online change-point detectors vs 404 IL stints: lift 1.14 / 1.21 (bar 1.5). The faint signal sits in the last
      1–3 days (already hurt, playing through).

## E9. Per-type Prevention+, shape-target and state-space tests, and the prospect program (§97, §99, §101, §103, §104)

105. **Per-pitch-type Prevention+** (§101): **CONFIRMED** as a forecast on a sealed random 20% of pitchers
    - Ridge on process stats (swing-miss, location, contact, context), family-forward selection inside nested CV.
      Sealed ΔR² vs last RV/100 +.066 [+.030, +.101], vs Whiff+ +.059, vs xRV/100 +.070. R² is small (.08) because
      next-season RV/100 on 150+ pitches is mostly noise. Last-season RV/100 was never selected.
106. **Stuff v4, swing-conditional run-value target** (§103): **FAILED**, v3 stays
    - Whiff, foul and contact valued at run constants. Composite −.064 [−.091, −.039]; K/PA −.106. As sticky as v3: the
      loss is signal. The continuous contact term re-imports the noise the binary whiff target avoided.
107. **VectorSSM, bivariate Kalman projection** (§104): **FAILED** on both legs
    - Kalman RV projection vs Prevention+ −.157 [−.208, −.106]; K projection vs K+ −.043. Insensitive to the one free
      dial (Q ×0.5 / ×2). With 3–6 noisy seasons a local-level Kalman is a weighted average; the ridge uses more information.
108. **Prospect model v0** (§97): both gates passed, **later withdrawn as not forward-valid** (§104)
    - Empirical Bayes plus mixed GLM on Pipeline lists 2011–19; ΔAUC +.026, 980 sleeper rows +32 pp. The split trained on
      future list years and removed test players, so the lifts are not cited. Y1 rewards being close to the majors (an
      older AAA player debuts), which is not the sleeper meant.
109. **Prospect full build** (§99): wide universe (238,718 snapshot rows, 97 features in 10 families), point-in-time
    store with a leakage test, and a pre-registered backtest
    - **Holdout (§99f):** value ranking passed (NPY ΔNDCG@100 +.076) but arrival (LGB ΔBrier +.0023, ECE .062) and sleepers
      (+5.0 pp [−2, +13]) failed.
    - **Diagnosis (§99h):** the arrival miss was our handling, not era drift: the split removed test-list players from
      training (training base rate .101 vs .115), draft coverage started in 2011, and calibration was fitted on one inner
      year. A discrete-time hazard model on person-seasons (H_fix) cuts dev Brier to .0621 vs LGB .0695.
    - The era-aware recalibration (§99g) and H_fix reads are registered for after the 2024 list's window closes.
110. **Fixed splits and the 2018 value read** (§104): **gate (b) FAILS**, no value ranking ships
    - NumPyro latent-skill model fit by NUTS on a rented GPU (public data only); centred skill after an identification fix
      (amendment A), probe-abort rule and one-rerun rule (amendment B). NPY ΔNDCG@100 −.016 [−.103, +.081] vs B1.
    - Every model beats the draft/rank baseline on sleeper p@50 by 24–30 pp and on Spearman, but none on top-100 NDCG;
      the read could not detect a dev-sized NDCG gain (inconclusive, not no gain). §99f withdrawn.
111. **Prospect program R0, re-baseline on WAR labels** (dev, spent lists): a plain logistic on age, level, draft and three
     rate stats adds about twice what any §104 model adds over consensus (−.0088 vs about −.004 log loss). The hurdle EV
     throws away stats signal. Stars cannot be tested on spent data (82 stars). Arrival subgroup calibration fails where
     overall ECE passes (org-listed ECE .112), so a per-list-state bar is added.
112. **Prospect program R1, skill layer from MiLB plate appearances** (draft, not registered): crossed-effects penalized
     logistic per outcome (batter, pitcher, park, league) from 10.7M PAs; gate is a forecast of next-season K, BB and HR
     against beta-binomial EB. No fit has been run.

---

## F. Not tried yet (ranked by expected gain per day)

*Status 2026-11-20.* The list keeps its original numbering. Tried since it was written: 1 (§36), 2 (§32/§34),
3 (§41, §47: tuned on pitcher-level outcomes; nested Optuna-style tuning is still open, see G4), 4 (§33, §46),
6 (§53–§55: Location+ became Control+, descriptive), 7 (§35, §74), 13 (§46: a primary-fastball anchor changed
nothing; the past-pitches-only trailing variant is still open, see G6), 15 (§40). Partly tried: 9 (bat-tracking traits
as *features* in §91–§98, never as multi-task targets), 12 (a monotone head was tested for hitters only, §98).
Still open: 5, 8, 9 (as targets), 10, 11, 12 (pitcher models), 14, 16, 17.

1. ~~**Called-strike Location+**~~ tried (§36).
2. ~~**Double machine learning.**~~ tried (§32, §34).
3. ~~**Tuning on the right objective.**~~ tried (§41, §47).
4. ~~**v3 inputs on the winning structure.**~~ tried (§33, §46).
5. **Pitcher grades with intervals.** Hierarchical Bayesian aggregation; gives the site its missing standard errors.
   (The prospect program's NumPyro model, §99–§104, is the only hierarchical fit so far.)
6. ~~**Location+ and command.**~~ tried (§53–§55). An xCTRL-style intent-versus-execution model is still untried.
7. ~~**Arsenal and tunneling.**~~ tried (§35, §74); Mix+ / Match+ not built.
8. **Late break:** movement after the decision point, from the 9-parameter trajectory.
9. **Swing-response targets.** Bat speed loss, contact depth and miss distance as multi-task targets beside whiff.
10. **Aggregated targets.** Pitch-type season whiff rate from average shape (a cleaner target).
11. **Adversarial neural encoder.** A gradient-reversal location head; only if double ML falls short.
12. **Monotone-constraint ablation on the pitcher models.** The constraints have never been priced there.
13. ~~**Primary-fastball anchor.**~~ tried (§46).
14. **Rolling retrain.** Add 2025 to training; drift monitors on each new season.
15. ~~**Topo tagger key on MLB.**~~ tried (§40).
16. **Transfer to college.** MLB-trained, fine-tuned on D1 TrackMan with measured offsets.
17. **Sequence transformer with player embeddings.** Low priority: high memorization risk, and the college
    study failed.

### F2. Open items added from the model inventory and the §41–§110 results

Where the source is `docs/model-inventory.md` it is named; otherwise the section whose result left the follow-up open.

**Pitchers**
18. **Marcel-regressed K−BB% benchmark** for Prevention+ (§52 calls it a fair critique that was not pre-registered).
19. **Location-residualized fastball inputs and a within-pitcher leak gate** (|r| ≤ .20) at the next fastball refit (§58).
20. **Pitching+ four-seamer calibration check** (four-seamers sit about +0.1 to +0.5 runs/100 above the model at every
    velocity, §84).
21. **Role-conversion re-test with one or two traits** (K+, Control+), once more converters exist (§87).
22. **Platoon gap as an EB blend** of the observed gap shrunk toward the model gap (§79's diagnosis).
23. **Per-outing sequences or role changes** as new information for a projection (§104: a smoother over the same six
    numbers cannot beat the ridge).

**Hitters, defense and baserunning**
24. **Hitter forecast with an age term** (Marcel overshoots in every pair, §67, §110); projected wRC+ stays unshipped
    until it calibrates.
25. **Swing Quality for part-timers** on a fresh season (§98a failed on power, not on signal).
26. **Baserunning v2:** enumerate the batter's destination jointly with the runners' fates, plus a play-by-play stolen-base
    leg (§102).
27. **Infield range with per-play positioning proxies** (alignment × spray history); §97 says the rest needs non-public
    data (§80).
28. **Catcher deterrence before 2020,** blocked until a pitch-level mart backfill (§108c).
29. **Pre-2020 MLB backfill** (model-inventory queue item 1).

**Projection, prospects and organizations**
30. **Prospect program R1–R5:** the MiLB plate-appearance skill layer (R1, drafted, no fit run), then the remaining steps
    in `docs/prospect-program.md`. The value ranking and arrival probabilities do not ship (§104, §99f). The arrival
    hazard model (§99h, H_fix) and the era-aware recalibration (§99g) are registered but not yet read.
31. **Own WAR projection model and a descriptive WAR layer,** plus prospect future value (model-inventory queue item 0a).
32. **State-space projections beyond the retired pitcher Kalman** (§104); hitters and other state spaces are untried
    (queue item 2).
33. **Surplus value:** projected WAR against salary and control years (queue item 3).
34. **Injury risk** from IL history (queue item 4; the bat-speed drift flag failed, §95).
35. **Market models** (queue item 5).
36. **Team identities and org fingerprints:** clustering on team-level deviations for hitters, pitchers, farm systems and
    draft tendencies, with a "guess the team" classifier against chance as the identity test (queue item 0b).
37. **Distributional projections** (full outcome distributions, not point estimates) and **RE24 / WPA play-level value
    grids** (model-inventory section C).

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

- **Today.** Train 2023–24, 4 pitcher folds (unchanged through §110).
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

Thunder Compute (cloud GPU rental) for the neural families (G2) and large tuning runs (G4). It has since been used for
the prospect model's NUTS fits (§104, amendments A and B; public data only, jax 0.4.38 / numpyro 0.16.1), not yet for G2 or G4:
- keys in `.env` only;
- only public Statcast data leaves the machine (clean room);
- budget and timing to be estimated before first use.

Set up and used once (prospect fits); the pitcher families above have not used it.
