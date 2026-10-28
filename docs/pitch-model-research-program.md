# Pitch-model research program: what a top front office would do

2026-10-25. Scope: Stuff+, Pitching+, Loc+, run value, on GOAT-Pro public data
(Statcast 2020–26, AAA Hawk-Eye 2023–26, bat tracking). Inputs: the college
claim ledger (25 failed or shelved claims, `vt_baseball/research/*/RESULTS.md`),
RESULTS-MLB §1–16, and the knowledge base (sources cited inline).

## 1. The college nulls, sorted by why they failed

A college null means one of two things: the idea is wrong, or college data
couldn't test it. Only the second kind is worth re-opening on MLB.

| College claim (result) | Why it failed | Re-open on MLB? |
|---|---|---|
| Axis+ / seam-shifted wake ("do not build": TrackMan axis is movement re-expressed) | **data**: no observed axis | **Yes, first.** Hawk-Eye measures the axis optically. Probe §16: deviation split-half .94–.99, YoY .70–.94; SI −19°, CH −12°, CU 0° |
| Loc+ fails naive (stickiness .35–.40) | data + method: one global target, short seasons | **Yes.** Intent-mixture command (xCTRL, arXiv 2508.19184) at 2–3k pitches/arm; ABS 2026 is a natural experiment for called strikes |
| Deception / Tunnel+ fail naive (per-pitch effect real, AUC +.015–.019) | data: no batter response beyond the outcome | **Yes.** Bat tracking (swing timing, contact point) is a continuous response to deception |
| Arsenal+ dead; sequencing skill null (4 nulls) | sample: ~1k pitches per arm | **Once, pre-registered.** MLB arms throw 2–3k pitches; if it is null again, it stays closed |
| Arm angle no gain (redundant with release) | **data**: college angle was a proxy | **Yes, cheaply.** Savant's arm angle comes from Hawk-Eye pose |
| Park / batter / ump target adjustment worse | data: TrackMan unit noise, small samples | **Yes.** MLB has umpire IDs, catcher framing, batter quality, 30 fixed parks |
| Stuff+ v7 vs naive: CIs span 0 | power | Re-tested here: Stuff+ wins K% alone (results/naive_tests.json); within-season win through ~50 pitches (§9, §15) |
| Count-normalized target no difference; GAM loses; spin_eff redundant; velo×VAA sinker paradox | **idea** | Closed; physics arm also rejected on MLB (§4) |
| Stuff+ → pro K-BB% cancels | idea + selection | Hand to the owner's pro Stuff+ project |

## 2. The rawest material, and what it replaces

| Digested input we use now | Rawer source a top team starts from | Public? |
|---|---|---|
| `pfx_x/z` (movement at 40 ft, gravity removed) | The nine-parameter trajectory: state at the **batter's commit point** (~150–175 ms before the plate), movement **after** commit, approach angles at decision time | Yes (vx0…az) |
| Movement-inferred spin | **Observed spin axis** vs the movement-implied axis = the seam-wake signature (§16) | Yes, 2020+ |
| `description` → CSW, `delta_run_exp` | The outcome chain: swing decision → contact → foul/fair → EV/LA/spray → run value. Each link is a separate, less noisy model | Yes |
| Whiff = binary | **Bat tracking**: bat speed, swing length, attack angle/direction, intercept point (2023+, more in 2025). How badly the hitter was fooled, as a continuous outcome | Yes (Savant bat tracking) |
| Release point + arm angle proxy | Hawk-Eye skeletal pose | No: team-only. Arm-angle leaderboard is public |
| Seam orientation | High-speed video + Hawk-Eye seam data | No: team-only (Driveline: a decade of paired data) |
| CSW with umpire/catcher noise | Called-strike probability from the plate model (and ABS 2026 challenges) | Yes |

The team-only rows go to the owner's pro-tracking project.

## 3. Methods a top team would use that we don't

1. **Decomposed outcome model.** Separate calibrated models for P(swing),
   P(whiff | swing), P(foul | contact), EV/LA | contact, then combine with
   run values. Lower variance per link; it also shows which link a pitch wins.
   This is the PitchingBot / StuffPro structure (BP: best reliability and
   next-season run prevention among public metrics, PECOTA 2025 intro).
2. **Partial pooling instead of hard floors.** A hierarchical model (numpyro or
   brms) with pitcher, batter, catcher, umpire and park effects. Shrinkage then
   sets small-sample behavior, not a 150-pitch rule. The §9 crossover becomes a
   posterior, and the blend becomes principled rather than OLS.
3. **Location handled, not dropped.** Integrate pitch value over the pitcher's
   own location distribution. Or enforce location-invariance with gradient
   reversal (SABR 2026 poster P8, Chambers). Our leak check becomes a training
   constraint.
4. **Command as intent vs execution.** A per-pitcher Bayesian mixture over
   targets (xCTRL). Validated in the paper against FIP and innings pitched;
   Location+ was not significant for innings pitched there.
5. **Derivatives, not just levels.** "Pitcher Greeks" (Resnick, 2026-08-28):
   gradients of the grade with respect to shape give pitch-design advice. Also
   a test: does a real shape change move the outcome the way the gradient says?
6. **Pre-registration and kill criteria** (the college practice), plus conformal
   intervals on every published grade.

## 4. Who besides us and the model says it's right

| Referee | Test |
|---|---|
| **The future** (done) | N → N+1 and first-N → rest-of-season vs naive, OOF folds still open |
| **Public competitors** | Head-to-head vs FanGraphs Stuff+/Location+/Pitching+, BP StuffPro/PitchPro, TJStuff+ (`lb_tjstuff_2026` already in the mart), PitchingBot: same targets, same holdout, same reliability curve. FanGraphs' bar: Stuff+ reliable at ~80 pitches, Location+ at ~400 |
| **30 front offices' revealed preference** | Does the grade predict what teams do with private data? High-leverage usage, call-ups and demotions (we have rosters and transactions), 40-man adds, contract $ |
| **Teams' pitch-design choices** | When a pitcher changes a shape between seasons, does it move along our gradient (§3.5)? Agreement with 30 pitching labs is strong external evidence |
| **Natural experiments** | Mid-season shape changes and new pitches: a within-pitcher test, so pitcher talent can't confound it. ABS 2026: a zone shock that Loc+/Pitching+ must absorb predictably |
| **Scouts** | FanGraphs/BA 20–80 pitch grades for AAA arms vs our AAA Stuff+ |
| **Physics** | Alan Nathan's trajectory calculator to check our decision-point derivations; lab SSW work (Driveline, Trajekt) to check the sign of the axis-deviation effect |
| **Peers** | Preprint plus reproducible package (SABR, Saberseminar, arXiv) |

## 5. Queue (each pre-registered with a kill criterion)

1. **Axis-deviation (SSW) feature**, SI/CH/FF first. Kill if Stuff+ with
   deviation doesn't beat v1 on the §8 gates and the per-pitch whiff residual
   at p<.05 in 2025 and 2026. Watch the gyro confound on SL (§16).
2. **Competitor benchmark**: v1 vs TJStuff+ 2026 now; FanGraphs/BP when pulled.
   Kill condition for our own Stuff+: losing to a public model on every gate.
3. **Decision-point features** from the nine parameters (commit-point state,
   post-commit movement). Kill: no gain over v1 on any §8 gate.
4. **Decomposed outcome chain** with a bat-tracking "fooled" link. Kill: no
   reliability or forecast gain over csw_norm.
5. **Hierarchical blend** for the small-sample product (§9/§15). Success: the
   demoted-pitcher subset stops flipping sign across seasons.
6. **Revealed-preference referee**: grade → next-month leverage index and
   call-up probability, holding results so far constant.
7. **Intent-mixture command** (Loc+ rebuild). Kill: still fails naive at ≥400
   pitches.
8. **Arsenal / sequencing, one pre-registered MLB attempt**, then closed for good.

## 6. Status (2026-10-26)

| # | Item | Result |
|---|---|---|
| — | Pitcher memorization (found while testing item 1) | **Fixed.** v2 recognized pitchers (seen .38 vs unseen .055 per-pitch r); export now cross-fitted; pitcher-grouped holdout is a standing gate (RESULTS-MLB §17) |
| 1 | Seam-wake axis deviation | Rejected under the honest harness: small fit gain, costs stability (§20) |
| 2 | Competitor benchmark | Honest Stuff+ beats TJStuff+ on next CSW% 3/3, K% 1/3; TJ stickier; neither beats naive (§19) |
| 3 | Decision-point features | Closed for public data: the nine-parameter fit has no late-break information (§22) |
| 4 | Decomposed outcome chain | First slice: timing disruption from bat tracking survives a pitch-mix control on CSW% (small); contact depth was pitch mix (§21) |
| 5 | Empirical-Bayes blend | Rejected: frozen prior level broke on the 2026 zone; re-centred prior is next (§25) |
| 6 | Revealed preference | Teams give more leverage to high-Stuff+ relievers beyond results, 2 of 3 pairs (§23) |
| — | Measured arm angle | Adds: CSW% prediction up in 3/3 pairs, significant out of time; proposed for v3 (§24) |
| 7, 8 | Intent-mixture command; arsenal/sequencing | Not started |
| new | AAA → MLB translation; residual persistence (results above stuff) | Running |
