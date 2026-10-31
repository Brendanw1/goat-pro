# ML hardening plan: every model, attacked the way §108 attacked xCS

Written 2026-10-30. A **plan only**: nothing here was fitted, and no held-out data or outcome on an unseen season was
read to write it. Inputs: `docs/model-inventory.md` (status table), `pipeline/RESULTS-MLB.md` (§ cited per row), the
bake/model code those sections name, and a file-level check of which seasons exist on disk. The exemplar is xCS:
§108 (fail G2, diagnosed) → §108a-v2 (leak check on `time_to_target`, dead `N_prior_pickoffs` column found and
re-fetched, shallower trees + OOF isotonic, LOSO, read once, ship "unconfirmed until 2027") → §108c (another agent;
catcher files are theirs, not touched here).

## 1. The shared template (every attack runs these steps, in order)

| # | Step | What it means here | Done when |
|---|---|---|---|
| 1 | **Seal** | Pick the confirm set from the bank (§2) **before** anything else; write it to `results/<model>_seal.json` (ids/seasons only). Feature-only harmonization (distribution matching of inputs) does not spend a seal; any outcome read does. | Seal file committed before code |
| 2 | **Leak audit** | Per feature: is it measured after the outcome or by the same clock (xCS `time_to_target`)? Dead/NaN columns (xCS pickoffs)? Mid-window coverage (source starts mid-season, Savant board 2021+)? Outcome-conditioned rows (§88 call-up pairs, §99h split drop)? Fielded-location inputs (§68 `hc_x/y`)? Pitcher/hitter memorization (§17: cross-fit by player is mandatory)? Outcome-dependent missingness (§91 bat tracking BIP 92% vs 94%)? | Table of features × verdict in the prereg |
| 3 | **Baselines + ablations** | Naive persistence, Marcel-regressed version of the same stat, the public benchmark (Savant/FIP/SIERA), and the strongest shipped site grade. Leave-one-family-out ablation. | All baselines on the same rows |
| 4 | **Model** | Smallest class that can win; nested CV grouped by player; tuned only inside inner folds. | Frozen spec file |
| 5 | **OOF calibration** | Isotonic/Platt fitted on inner OOF only (§108a-v2 pattern); max decile gap reported; probability floor note before display. | Gap ≤ prereg bar |
| 6 | **Credit split** | Random effects (or EB) for catcher / pitcher / umpire / park / batter so the number credits only the player it names. | Variance shares reported |
| 7 | **Runs** | Convert to runs with the count/base-out run values of that season (judge.py lines); state the RPW path if it feeds WAR. | Runs column + sanity sums |
| 8 | **Error analysis** | Worst slices (decile tails, top-velo, Coors, rookies, 2026 ABS zone, held throws): residual by slice, written before the read. | Slice table in dev |
| 9 | **Read once** | One script, one read, sealed JSON; failed gate → data / handling / modeling diagnosis (owner rule). | RESULTS § + bank row marked spent |

Standing gates every model inherits: player-clustered bootstrap across pairs (§54 fix), pitcher-/hitter-grouped
cross-fit (§17), season term or per-season fit across the 2026 ABS zone change (§78 diagnosis), and the §34 location
leak check for any shape grade.

## 2. Sealed data bank

Rule: **one outcome read spends a row** for every claim that reads it. A re-test on read rows is "provisional" (the
§88 v2 convention). Mark the row here in the same commit as the RESULTS section.

| Source | Seasons / levels on disk | Status | Notes |
|---|---|---|---|
| MLB Statcast per pitch (mart `pitches`) | 2020–2026 | **SPENT** for every pitch-level model: 2023–26 selection pairs (§4, §30–§47), 2021–22 confirm (§37), 2020 (§42 "no untouched season remains"), 2026 read by §68–§108 | `savant_mart/mart.py FULL_SEASONS` starts at 2020 |
| **MLB Statcast per pitch 2015–2019** | `cache/sealed/statcast/{2015..2019}.parquet` (fetched 2026-10-30, regular season, mart 2020 schema, zstd; `SEAL.json` + handling `checks.json`) | **SEALED, UNSPENT: fetched, never opened** — no outcome column computed or printed. `pipeline/statcast_sealed_fetch.py`; `savant_mart/mart.py` refuses seasons < 2020 or sealed paths | TrackMan era, not Hawk-Eye: needs a frozen feature-only harmonization recipe (like §44 for AAA) before any read. Rows 702k/716k/725k/724k/735k, 0 dup keys; SEAL.json sha256 356fa922…. TrackMan-era input gaps: `spin_axis` absent 2015 (served 2016+), `arm_angle` and bat tracking absent all years, `sv_id` (PITCHf/x id string 2015–16) nulled by the mart schema cast, spin rate null 7–8% 2015–16 vs 2–3% 2017–19, tracking nulls ~0.1% 2015 vs ~0.9% 2017–19. 2015 EV coverage weak; 2017–19 cleanest. No bat tracking. 2019→20 pair is 60 games. 4 clean pairs (2015→16 … 2018→19) |
| MLB 2027 (forward) | — | **UNSPENT**; already promised to: xCS v2 confirm (§108a-v2), §88 provisional stats, SQ (§91b/§98a), §99g/§99h (2024 list), Deception+ | Plan every 2027 claim now so it is read once, together |
| Pitcher-hash seals | P7 `crc32("p7:"+id)%5==0`; §101 `rng(101)` 20% | **SPENT** (§50–§57, §82 cascade, §83–§84 sealed FF; §101) | A new random pitcher split is a **weak seal**: those pitchers' seasons were read in aggregate |
| AAA Statcast (mart `pitches_aaa`) | 2023–2026 | **SPENT for pitcher grades** (§27, §44–§49 seal opened, §64, §66). **Unread for hitter-side / xRV / xwOBA / Decision+ models** (their code never loads `pitches_aaa`; `hitter_proj.py`, `hitter_depth.py` display AAA lines — verify no target was inspected) | Transfer holdout for hitter models. `bat_speed` column present in AAA schema; coverage unknown — verify |
| AAA pre-2023 / Single-A FSL Hawk-Eye | not on disk | unknown — verify availability on Savant minors search | Would add pitcher-grade transfer pairs |
| MiLB Stats API lines | `data/milb/hist_*` (pre-2021) + 2021–26 | §88 MLE gate read 2023–25 level seasons (fit 2021–25). Pre-2020 level→MLB pairs **unread by the MLE gate** (used as prospect-model features) — verify years | 2020 has no MiLB season |
| Savant leaderboards 2015–2019 | sprint 2015–19, OAA 2016–19, catch prob 2016–19, jump 2016–19, framing/catcher-throwing 2019 (`savant_mart/data/leaderboards`) | fetched; no RESULTS § gates on them — verify | External references for a pre-2020 range/framing read |
| Savant catcher drill-downs, pitcher running board | throwing 2016–26, blocking 2018–19 + 2021–26, running/pickoffs 2016–26 (none served 2015) | **SPENT**: 2020–26 by §108/§108a-v2/§108c LOSO; 2016–19 sealed then opened once by §108c H-pre (cf29858, 2026-10-30); blocking 2018–19 fetched, unread | Pre-2020 deterrence needs a pre-2020 pitch mart |
| Prospect lists | 2011–2026 | arrival 2022–23 **spent**, value 2016–17 **spent** (§99f); 2024 list reserved for §99g/§99h after 2027 | 2018–21 value lists: maturity unknown — verify |
| Bat tracking | 2024–26 (2023 partial) | **SPENT** (§91 dev 24→25, §91b 25→26, §98a both) | Next clean: 2026→2027 |

**Headline:** every MLB season on disk is spent for pitch-level models; the only clean banks are **MLB 2015–2019
(sealed, never opened)**, **2027**, **AAA for hitter-side models**, and **pre-2020 MiLB→MLB pairs** for translations.

## 3. TOP 8 attack order

Weights: user-facing importance on the site, size of the known gap, clean holdout available.

| Rank | Model | Why now | Clean holdout |
|---|---|---|---|
| 1 | **xwOBA (ours)** | Headline hitter stat; failed twice (§68 −.027, §77 −.022 vs Savant); diagnosis says spray adds description, not forecast | 2015–19 Statcast (Savant's xwOBA exists there as the bar) + AAA + 2027 |
| 2 | **Pitching+** | Headline pitcher grade, shipped yet tied SIERA (§56 sealed −.027, n≈82/pair); no credit split beyond neutral-izing | 2015–19 (power ×4) + 2027 |
| 3 | **Whiff+ → K+ → Prevention+ confirm** | The shipped forecast core; its seal was read during Whiff+ selection (§50 caveat) and the Marcel K−BB% baseline was never run (§52 critique) | 2015–19 frozen transfer; one read confirms all three |
| 4 | **xRV / xRV+** | Shown on rows (descriptive); failed twice, near-tie (§71/§78 +.008), loses to observed xRV by .085 | 2015–19 + AAA |
| 5 | **Control+ (BB+)** | Shipped descriptive; BB+ missed only on power (§55 r CI [−.004,+.038]); known definitional bugs (§54) | 2015–19 |
| 6 | **Hitter projection (Marcel → Statcast-informed)** | Projections page runs on a no-age, no-park Marcel (§67); biggest hitter forecast gap that is cheap to test | 2015–19 lines + Statcast, 2027 |
| 7 | **MiLB translations (§88)** | Prospect-facing; two stats "provisional"; pitcher FIP offset +0.43; HR% loses rank | pre-2020 MiLB→MLB pairs + 2026→2027 |
| 8 | **Decision+** | On hitter rows; loses to chase rate by −.069 (§69); 2026 zone exposure untreated | AAA + 2015–19 + 2027 |

Next after the 8: park factors (cheap, decades of event data), platoon EB blend, Deception+ confirm, range, framing umpire split.

## 4. Per-model blocks

Legend: **CV** current validation · **Spent** · **Unseen** · **Risks** · **Missing** · **Ideas** (ranked, with gate) · **Effort/priority**.

### Whiff+ (shape, wps DML, cross-fit) — shipped, forecast-gated (§34, §82)
- **CV:** trained MLB 2023–24, 4 pitcher folds (§17); selection on 23→24/24→25/25→26 (§30–§47); 2021–23 confirm (§37, failed for v3, later used as the selection set again §41); 2020 sealed pair spent (§42); AAA 25→26 seal spent (§49: K gain replicates, RV not).
- **Spent:** MLB 2020–26 all; AAA 2023–26.
- **Unseen:** MLB 2015–19 (frozen transfer, TrackMan recipe); 2027.
- **Risks:** pitcher memorization fixed by cross-fit; §82 hand bug fixed; `hvaa` location leak bug (§1) fixed; spin_axis excluded; 2026 plate re-reference (§10). Pre-2020: release/extension measurement offsets.
- **Missing:** calibration of per-pitch p(whiff|swing) never reported by decile; umpire n/a; no run-value conversion (by design, K+ carries it).
- **Ideas:** (1) Read once on 2016→17…2018→19 under the frozen §44-style recipe; gate = §34 rule (K% Δr ≥ 0 vs csw_norm v2, CI) — confirms the §34 claim on truly unseen pitchers. (2) Decile calibration of OOF p by pitch class; gate ≤ .01.
- **Effort/priority:** M (fetch + harmonize) / high, shared with K+, Prevention+.

### K+ — shipped, confirmed (§50, §82 cascade)
- **CV:** ridge, 5-fold pitcher-grouped dev 80%; sealed 20% pitcher hash read once; pairs 2020→26.
- **Spent:** P7 seal; MLB 2020–26. Caveat (§50): steps 2–6 read sealed pitchers' outcomes when choosing Whiff+.
- **Unseen:** 2015–19, 2027.
- **Risks:** Marcel uses S−2 history (needs pre-2020 lines for a 2016 read: fine via Stats API).
- **Missing:** Marcel SwStr%-only and Steamer-style public benchmark; calibration of K/PA level (RMSE reported only).
- **Ideas:** (1) Confirm on 2015–19 (Δr vs Marcel CI > 0, ≥ 3/4 pairs). (2) Add age and role-change terms; gate ΔRMSE CI > 0 on 2027.
- **Effort/priority:** S after Whiff+ fetch / high.

### Prevention+ (pitcher) — shipped, confirmed (§52)
- **CV:** ridge on Whiff+, K+ (OOF), BB%, GB%; P7 seal read once.
- **Spent / Unseen:** as K+.
- **Risks:** benchmark weakness: one-season K−BB% vs a stack that sees Marcel history (§52 critique, not pre-registered).
- **Missing:** **Marcel-regressed K−BB%, SIERA and xFIP baselines**; park/defense credit split of next RV (target RV/100 includes fielders and park); catcher framing in target.
- **Ideas:** (1) Re-gate vs Marcel K−BB% and Marcel SIERA on 2015–19; gate Δr CI > 0. (2) Target = park- and defense-neutral RV (subtract §81 range runs and §70 PF per PA); gate same, reported both. (3) Credit split ridge → mixed model with catcher/park REs.
- **Effort/priority:** S–M / high (rank 3 bundle).

### Prevention+ per pitch type — shipped, confirmed (§101)
- **CV:** nested pitcher-grouped CV on dev 80%; rng(101) 20% seal read once (ΔR² +.06–.07).
- **Spent:** §101 seal; seasons 2020–26.
- **Unseen:** 2027; 2015–19 (pitch types differ: no ST/SV before 2023 — verify mapping).
- **Risks:** `hard_hit%`, `xwOBAcon` inputs in S are fine (prior season); pitch-type reclassification across seasons (sweeper relabel 2023) changes the unit.
- **Missing:** calibration of RV level by type; per-hand gate (only descriptive).
- **Ideas:** (1) 2027 confirm (no change). (2) Per-hand forecast gate on 2027. 
- **Effort/priority:** S / medium.

### Stuff+ (RV shape grade) — failed, retired (§51); Stuff v4 (§103) failed
- **CV / Spent:** P7 seal; 2020–26. **Unseen:** 2015–19.
- **Ideas:** none as a standalone grade (§51/§103 diagnosis: BIP run value not forecastable from shape). Use only as an internal component in Pitching+ (rank 2). Effort — / none.

### Pitching+ — shipped descriptive, NOT confirmed (§56)
- **CV:** per-pitch f(shape, location, count) − E[y|count], pitcher-fold cross-fit on dev pitchers' 2023–24; judged r(grade, −RA9 S+1) vs SIERA; P7 seal (~82 per pair) read once: −.027 [−.109, +.057].
- **Spent:** P7 seal; 2020–26; §84 sealed FF slice.
- **Unseen:** 2015–19 (≈4× the sealed n), 2027, AAA (never scored for Pitching+: §66 kept it MLB-only).
- **Risks:** target RA9 (≥ 20 IP) includes defense, park, sequencing, catcher; HBP mask also catches CS/pickoff PAs (§54); P_adj batter wOBA uses prior season only (fine). Swings valued at xrv inherits Savant xwOBA.
- **Missing:** Marcel SIERA baseline; multi-season (2-yr) target to cut noise; umpire RE (called-pitch value is umpire-neutral by p(cs) but not umpire-specific); catcher framing RE; park RE; calibration of per-pitch value by count.
- **Ideas:** (1) Change the judged target to next-season xRV/100 + RA9 composite (less noise), registered before read; gate Δr vs Marcel SIERA CI > 0 on 2015–19. (2) Mixed model per pitch with catcher/umpire/park/batter REs, Pitching+ = pitcher RE; gate same. (3) Error analysis on worst slices (soft-tossers with elite command, §54 Mikolas/Paddack).
- **Effort/priority:** L / **rank 2**.

### Control+ (ex Location+) and BB+ — Control+ shipped descriptive; Location+ and BB+ NOT confirmed (§53–§55)
- **CV:** L_ctrl cross-fit dev 2023–24; P7 seal read once (RV/100 CI [−.0001, +.078]; BB+ r CI [−.004, +.038]).
- **Spent:** P7 seal; 2020–26. **Unseen:** 2015–19, 2027.
- **Risks:** shape controls include `hvaa` against the prereg (§54, conservative); HBP mask bug; "heart %" mislabel; credits strike-throwing with hittable arsenals.
- **Missing:** umpire RE on called-strike probability; catcher framing split; BB-level calibration; power analysis (MDE) before read.
- **Ideas:** (1) Fix §54 items (HBP via `description`, Meatball/Mistake components), re-gate BB+ vs Marcel BB% on 2015–19 (n ×4 lifts power); gate r and RMSE CI > 0. (2) xCTRL-style intent mixture (inventory §C) as a component; gate added Δr on 2027. (3) Umpire + catcher REs on p(called strike).
- **Effort/priority:** M / **rank 5**.

### Sequencing — not shipped (§57)
- Sticky (.59), not forecast-useful; placebo shows it is arsenal structure. **Ideas:** none; keep as Tunnel+ pairs. Effort — / none.

### xRV / xRV+ (per pitch) — failed twice; xRV/100 + luck shown descriptive (§71, §78)
- **CV:** 5-fold pitcher-grouped cross-fit over 2020–26 pooled; read on pairs 2020→26 (+.009, +.008).
- **Spent:** 2020–26. **Unseen:** 2015–19, AAA (xRV never scored there), 2027.
- **Risks:** contact leg trained on Savant xwOBA (inherits its estimand); pooled run values by count across the 2026 zone (fixed v2, no effect); league-average by design so pitcher skill outside shape+location is missing (§79 diag).
- **Missing:** pitcher random effect/EB blend; per-class calibration (log loss only); Prevention+-per-pitch as baseline; split of luck into defense/park/catcher.
- **Ideas:** (1) EB blend: shrunk observed xRV toward model xRV with k by dev CV; gate vs observed xRV (the −.085 bar) on 2015–19. (2) Rebuild xRV per pitch as the §101 feature stack at pitch level; gate vs RV/100 on AAA (transfer). (3) Luck = RV − xRV split into defense (§81) / park / sequencing; descriptive.
- **Effort/priority:** M / **rank 4**.

### xwOBA (ours) — failed twice; Savant's shown (§68, §77)
- **CV:** LightGBM multiclass per BIP, 5 batter-grouped folds, 2020–26 pooled with season feature; read on pairs 2020→26.
- **Spent:** 2020–26 hitter and pitcher sides. **Unseen:** 2015–19 (Savant `estimated_woba_using_speedangle` exists there), AAA (never scored), 2027.
- **Risks:** `hc_x/hc_y` is fielded location (leak on GB; §77 fixed GB, gap remains); spray on air balls is park- and placement-dependent; sprint speed is a same-season board (mid-season coverage; fine as S input).
- **Missing:** **Savant-parity replica** (EV/LA + sprint on weak contact) to prove the pipeline matches before adding anything; hitter RE / EB blend with actual wOBAcon; park geometry (dong §86 fences) for pulled flies; calibration by EV×LA bin.
- **Ideas:** (1) Parity replica first: gate r ≥ .98 with Savant per hitter-season (handling, no outcome claim). (2) "Predictive xwOBA": out-of-fold EB blend of actual wOBAcon toward model xwOBAcon, weights by BIP; gate vs Savant on S+1 wOBA, CI > 0 and ≥ 3/4 pairs on 2015–19. (3) Air-ball spray only through park-cleared count (§86) — the repeatable part of pull power; gate same. (4) Bat-tracking add-on (2024+) only on 2027.
- **Effort/priority:** M / **rank 1**.

### Decision+ / IZA / OZA — shipped descriptive (§69)
- **CV:** swing/take LightGBMs, 5 batter folds, 2020–26; read on pairs 2020→26 (−.069 vs −Chase%).
- **Spent:** 2020–26. **Unseen:** AAA (never scored), 2015–19 (sz_top/bot exist), 2027.
- **Risks:** no season term across the 2026 zone change (§71 diag says same exposure); z-norm relies on Hawk-Eye sz (TrackMan-era sz is operator-set: verify before pre-2020 use); automatic calls excluded.
- **Missing:** target mismatch (BB−K includes contact skill); baselines Marcel chase, Z-swing; credit split for umpire (take values depend on the zone called).
- **Ideas:** (1) Add season term + umpire RE on take values (handling fix). (2) Re-target to next-season BB% and chase-driven K% separately; gate vs Marcel chase on AAA→AAA pairs and 2027. (3) Enter as a component in the hitter projection (rank 6) rather than standalone.
- **Effort/priority:** M / **rank 8**.

### Hitter Marcel projection + ranges — shipped as baseline (§67)
- **CV:** no fitted params; pairs 2022→26 read; ranges from residuals.
- **Spent:** 2020–26. **Unseen:** 2015–19 lines (and decades of Stats API/Lahman lines), 2027.
- **Risks:** no age term (ranges lopsided); survivorship (S+1 ≥ 100 PA).
- **Missing:** age curve, park (runs PF), Statcast inputs (Savant xwOBA, bat speed, Decision+), ZiPS/Steamer-style public baseline unavailable.
- **Ideas:** (1) Ridge on Marcel + xwOBA + age + park; gate ΔRMSE and Δr vs Marcel CI > 0 on 2015–19 (no bat speed) and 2027 (with). (2) Quantile ranges conditioned on age band; gate coverage 78–82% on unseen seasons.
- **Effort/priority:** M / **rank 6**.

### Swing Quality (SQcon/SQswing), timing, two-strike, archetypes, bat-speed drift — descriptive (§91, §91b, §92–§95, §98a)
- **CV:** hitter-grouped cross-fit; dev 24→25, final 25→26 (§91b, FAIL +.026), §98a part-timers FAIL (+.091, underpowered).
- **Spent:** bat tracking 2024–26. **Unseen:** 2027; AAA bat tracking if coverage exists — verify.
- **Risks:** outcome-dependent tracking missingness (§91); SQ ≈ bat speed (r .70).
- **Ideas:** (1) Pool both near-misses into one 2027 read with power stated (n ≈ 310 + part-timers). (2) Drift: no further work (§95 data limit).
- **Effort/priority:** S / low (waits for 2027).

### Platoon Whiff+ — shipped descriptive (§73, §79)
- **CV:** pairs 2021→26 read twice. **Spent:** 2020–26. **Unseen:** 2015–19, 2027.
- **Missing:** EB blend of observed gap toward model gap (§79 diagnosis, never registered).
- **Ideas:** (1) EB blend, k by dev CV; gate vs observed gap Δr CI > 0 on 2015–19. 
- **Effort/priority:** S / medium.

### Tunnel+ — shipped descriptive, added info confirmed (§74)
- **CV:** league chase logistic; 30% crc32 **game** holdout for AUC; claim pairs 2021→26 read once (+.091).
- **Spent:** 2020–26. **Unseen:** 2015–19, 2027.
- **Risks:** game (not pitcher) split for AUC; 2026 `release_pos` measured differently (0.94 in vertical).
- **Ideas:** (1) Pitcher-grouped re-check of incremental AUC (handling, no outcome claim). (2) Confirm on 2015–19.
- **Effort/priority:** S / low.

### Deception+ — shipped (PREREG-deception-plus.md)
- **CV:** 5-fold pitcher-grouped CV over pairs 2023→26 (781 pairs); no seal; ΔR² bar .005.
- **Spent:** all bat-tracking pairs. **Unseen:** 2027 only.
- **Risks:** batter norms computed on the same season, including swings against this pitcher (mild leak); CSW% target mixes called strikes; baseline `stuff_plus_abs` should be checked to be Whiff+, not ABStuff+ (owner rule).
- **Ideas:** (1) Leave-pitcher-out batter norms; (2) one-read confirm on 2026→2027 vs Whiff+ baseline.
- **Effort/priority:** S / medium.

### Park factors (2B/3B/HR/SO) and park-adjusted wOBA/FIP — partly shipped (§70, §72)
- **CV:** EB 3-yr vs raw; pairs 2022→26 read. **Spent:** 2020–26 events. **Unseen:** pre-2020 game events (Stats API play-by-play / Retrosheet, decades; not fetched — verify).
- **Missing:** covariates (fence geometry from `park_dims.csv`, elevation, roof) in a hierarchical model; 1B/BB components; WAR uses a fixed-50% runs PF (§85 ponytail).
- **Ideas:** (1) Hierarchical EB with geometry covariates; gate vs §70 EB on 2015–19 S+1 ratios. (2) Replace WAR's runs PF with it; gate G2 r vs bWAR unchanged or better.
- **Effort/priority:** M / medium (next after the 8).

### Range (IF/OF, v3) — shipped (§75, §80, §81; v4/v5 §96/§97 no gain; §100)
- **CV:** within-season OOF game folds + cross-fit isotonic; external gate vs Savant OAA 2020–26.
- **Spent:** 2020–26. **Unseen:** 2016–19 (Savant OAA boards on disk, per-pitch not fetched; start positions pre-2020 unknown — verify).
- **Risks:** fielder-specific average start positions; drag-only hang time.
- **Ideas:** inventory states p at public-data ceiling; only a 2016–19 external-validity read (no model change). Effort M / low.

### Framing+ — shipped, confirmed (§76)
- **CV:** catcher-grouped OOF per season; r .950 vs Savant. **Unseen:** 2015–19 (framing boards 2019 on disk).
- **Missing:** umpire RE (D-15), pitcher RE (pitchers who hit the glove), credit split catcher/pitcher/umpire.
- **Ideas:** (1) Mixed model p(cs) with catcher + pitcher + umpire REs; gate YoY ≥ Savant's .57 on 2016–19. Effort M / low-medium.

### Catcher xCS% and expected WP+PB — §108 / §108a-v2 / §108c (another agent owns these files)
- WP+PB: 2026 holdout read once, shipped. xCS v2: LOSO ship; §108c H-pre 2016–19 read once: ranking confirmed, calibration level failed (era, −.037). Joint RE credit failed; deterrence + throwing runs pass on LOSO. **Unseen:** 2027 only (frozen v2 hash + per-catcher forecast committed); blocking 2018–19 unread (WP+PB pre-2020 holdout available).

### WAR — shipped (§85)
- **CV:** nothing fitted; external gates vs bWAR (r .92/.81). Components inherit their own status.
- **Missing:** own baserunning (§102 failed), runs PF ponytail, FIP-only pitchers (RA9/FIP blend).
- **Ideas:** (1) Swap park + baserunning legs as they pass; gate G2–G4 unchanged. (2) RA9–FIP blend weighted by Pitching+; gate YoY and team-win r. Effort S per leg / low.

### Baserunning XBT (§102) — failed reconstruction (42% dropped)
- **Ideas:** joint enumeration of batter destination (§102 diagnosis), or Stats API play-by-play runner movement (D-40a). Gate: drop rate < 5% then r vs Savant `runner_runs_XB` ≥ .80. Effort M / low.

### MiLB translations (MLEs) — partly shipped, two provisional (§88 v1/v2)
- **CV:** 5 player folds; level seasons 2023–25 → MLB S+1 read twice (v2 provisional on read rows).
- **Spent:** level 2021–25 pairs. **Unseen:** level 2011–19 → MLB pairs (MiLB `hist_*`), AAA/AA 2026 → MLB 2027.
- **Risks:** outcome-conditioned factor population (fixed v2: "if he holds a role"); pitcher FIP offset +0.43; HR% park/league step loses rank.
- **Missing:** age-relative-to-level term; Statcast-based AAA inputs (Whiff+ K+ already on AAA) as a hybrid MLE.
- **Ideas:** (1) Read v2 frozen on 2011–19 pairs (era note: pre-contraction leagues) → converts provisional labels; gate as §88. (2) Hybrid AAA pitcher K% = MLE + K+ (AAA); gate on 2026→2027. (3) No league step for HR%; gate rank r on 2011–19.
- **Effort/priority:** M / **rank 7**.

### Role conversion (§87) — failed on power (n 58 / 86)
- **Unseen:** 2015–19 converters (Savant xwOBA exists; Stats API GS/G), 2027.
- **Ideas:** (1) Pre-registered 1–2 trait model (K+, Control+) per §87 diagnosis; gate GA on 2015–19 converters (n roughly doubles). Effort S / low.

### Prospect model (§97, §99f–h, §104)
- **CV:** forward-chained list years; value holdout 2016–17 spent (NPY passed NDCG); arrival 2022–23 spent (failed, handling: split bias found §99h); §104 fixed splits dev only.
- **Unseen:** 2024 list (reserved for §99g/§99h, read after 2027); 2018–21 value lists — verify maturity.
- **Risks:** found already: split drop bias, left-truncated draft coverage, `debut_k4` censoring artifact (use hazard form).
- **Ideas:** (1) Keep the reserved reads; no new reads before 2027. (2) Value gate re-registered on §104 fixed splits for the next matured list. Effort — / waits.

### Removal model (§105) — descriptive column, held-out 2025 AUC .805
- Missing options/service class features (D-44 estimator now exists). **Idea:** add service status; gate AUC on the 2026 cycle (unread). Effort S / low.

### Would it dong (§86) — physics, gates passed
- Descriptive geometry; error slices already known (Fenway, Yankee, CBP). No ML attack. Effort — / none.

### Research-only (decay/buyback, usage optimizer, count policy, predictability, §59–§63; Topo key §40; §83–§84 checks)
- Closed with recorded verdicts; reopen only with a new hypothesis. 2015–19 could re-test §59 decay at MLB scale. Effort — / none.

## 5. One fetch unlocks most of this

Ranks 1–5 and 8 all need the same thing: **MLB Statcast 2015–2019 per pitch, fetched once, harmonized on features
only, sealed.** Order: (a) fetch to `savant_mart` as a separate `pitches_pre2020` view, never unioned into `pitches`;
(b) write the frozen TrackMan→Hawk-Eye feature recipe from feature distributions of pitchers present in 2019 and 2020
(no outcome columns touched); (c) pre-register every claim that will read it (ranks 1–5, 8) in one batch, then read
each once. Disk: check `df` first (owner note: space is tight).
