# GOAT-Pro model inventory — retrain, adapt, and new

Every model the public site needs: the college lineage to retrain, and the
models MLB data makes possible that college never could. Gate standard for
all of them: season-N grade must beat the pitcher/hitter's own season-N
baseline at predicting N+1 (paired pitcher bootstrap vs naive persistence),
or ship labeled **descriptive**. Terminology follows
`research/stuff-model/RESULTS.md`. Dispositions: **retrain** (same design, new
data), **recalibrate** (weights/lookup only), **recompute** (derived from an
upstream model), **build** (new), **ingest-validate** (public reference data,
not rebuilt).

## Status, 2026-10-29

Where each model stands today (sections are `pipeline/RESULTS-MLB.md`). The
tables below are the original plan and are kept as written.

| Model | Outcome | Where |
|---|---|---|
| Stuff+ → **Whiff+** (whiff per swing, double ML, cross-fit) | shipped, forecast gate passed; hand-matched grading fix | §34, §82 |
| **K+**, **Prevention+** | shipped, confirmed | §50, §52 |
| Stuff+ (RV shape grade) | failed, not shipped | §51 |
| Location+ / **Control+** | Location+ not confirmed; shipped as Control+ (BB projection not confirmed) | §53, §55 |
| **Pitching+** | shipped; ties SIERA, not confirmed | §56 |
| Sequencing | sticky, not forecast-useful; not shipped | §57 |
| P7 family on AAA | confirmed, on /minors | §66 |
| Hitter Marcel projection | display-only baseline | §67 |
| xwOBA (ours) | failed twice (ground-ball spray leak, then v2); Savant's xwOBA is shown | §68, §77 |
| **Decision+** / IZA / OZA | shipped descriptive (stable, loses to chase rate as a forecast) | §69 |
| Park factors | 2B/3B/HR/SO by hand shipped descriptive; park-adjusted wOBA/FIP not shipped | §70, §72 |
| xRV / xRV+ | failed twice, not shipped | §71, §78 |
| Platoon Whiff+ | shipped descriptive; location-aware gap failed | §73, §79 |
| **Tunnel+** | shipped descriptive | §74 |
| **Range** (IF/OF) | v1 and v2 failed; v3 (Savant start positions + hang time) shipped | §75, §80, §81 |
| **Framing+** | confirmed against Savant, shipped | §76, `PREREG-framing-plus.md` |
| **Deception+** | passed its gates, shipped | `PREREG-deception-plus.md` |
| Topo Level-1 class as the grading key | failed on K% and RV (wins on CSW% and stability); not adopted | §40 |
| Velocity/steepness under-credit checks | not confirmed; models unchanged | §83, §84 |
| **WAR** | shipped (r .92 / .81 vs bWAR, team wins r .91) | §85 |
| Pitch decay / buyback, usage optimizer, count policy, predictability | research only: decay confirmed, the rest no edge | §59–§63 |

In progress (owner, 2026-10-29): MiLB → MLB translation (§88), role conversion
(§87), would-it-dong across 30 parks (§86), postseason + matchup view, and the
MLB-unique stats audit for college (`docs/college-port-audit.md`).

Queued for later, in order:
1. Pre-2020 MLB backfill, using the college TrackMan-era methods.
2. State-space player projections.
3. Surplus value: projected WAR against salary and control years.
4. Injury risk.
5. Market models.
6. Housekeeping: finish the Savant play-id fetch, then rerun `defense_export.py`
   and `r2_sync --path defense`. Clearing the npm cache (3.3 GB) is waiting on the owner's OK.

## A. The college lineage

| Model | Disposition | Data | Notes |
|---|---|---|---|
| RV tables / run environment | recalibrate ✅ | `delta_run_exp` | MLB run values are per-pitch in the schema; done in v1 pipeline |
| **Stuff+** (v8 lineage) | retrain — **in progress** (target bake-off running) | Statcast 2023–25 | era audit applied; spin_axis excluded pending physics features |
| **Pitching+** (v4 lineage) | retrain — in progress | same + location/count | |
| Loc+ | retrain | same | descriptive label expected (college: beat naive on nothing) |
| xRV v3.1 | retrain | 6-class softmax + contact leg | college per-pitch r .563 is the bar |
| xwOBACON | retrain | launch_speed/angle, hc_x/y | college KNN k=100; MLB has EV/LA/direction |
| xwOBA (hitters) | recalibrate | K%, BB% + xwOBACON | the one college hitter metric that cleared the gate — preserve its methodology exactly |
| xwOBA-Against | recalibrate | K%, BB% + xwOBAcon surface | |
| Decision+ (p_swing, p_called_strike, RV swing/take) | build on MLB directly | swing decisions | the decision-plus-scope metrics (xDRV, xChase%, xWhiff%, pred_xwobacon) build here, not ported |
| Framing+ | retrain | shadow-zone residuals | validate vs public CSAA; umpire random effects per the defense scope |
| Tunnel+ | retrain (low priority) | ordered pitch pairs | descriptive by the college study's own finding |
| Outing+/Outlook+ | recompute | composer on Stuff+ game cells | after game-cell bake exists |
| Pitch Plan (sequence transformer) | retrain (heavy) | plate appearances | sequencing ecology differs at the pro level |
| Topo tagger | **port at full depth — Level 1 AND Level 2** | Statcast shape features | Not just a 3-class fold: rebuild the frozen landscape on MLB pitch shapes, keep Level 1 (FB/BB/CH) as the *grading key* (the college gate evidence), and revive the Level-2 naming layer (Sweeper/Slider-split/splitter-vs-changeup-by-spin) as the display and crosswalk layer against Statcast pitch_type. Then re-run the GATE.md key comparison on MLB — three classes vs Statcast types vs Level-2 names, paired bootstrap; MLB data is 3× the college sample, so a finer key may pass here where it failed on D1. Owner direction: recover all or most pitch types. |
| Deception | recompute | (observed whiff − Stuff+ predicted) × 100 | derived |
| Isotonic calibration / reliability constants | refit per league | — | the DISCIPLINE_HALF_* pattern re-measured on MLB |
| PV+/prospect value | **not translating** | — | level translation fails (college research); MLB-side projection is a new build |

## B. New models MLB data enables (impossible in college)

| Model | New data it needs | Why now |
|---|---|---|
| **Bat-tracking swing models** (bat speed, swing length, attack angle, squared-up/blast rates, swing tilt) | Hawk-Eye bat tracking, 2024+ | never existed in college; new hitter swing-quality family + swing-decision vs swing-quality decomposition |
| **Component park factors** (hierarchical empirical-Bayes, per §1.4.3 of the blueprint) | 30 fixed parks, deep history | college venue noise made this impossible; the blueprint specifies the estimator |
| **State-space projections** (latent AR(1) form, per §1.4 of the blueprint) | long MLB histories (Lahman 1871+, Statcast 2020+) | the Marcel→Steamer lineage the blueprint scopes; first true *projection* system in the program |
| **MiLB translation matrices** (§1.4.4) | TJStats cross-level pitch data (AAA/AA/Hi-A, already local) | prospect → MLB translation without the college level-translation trap |
| **Surplus valuation / dollar-per-WAR** (§1.4.5) | Lahman salaries, free-agency markets | the valuation layer the blueprint scopes |
| **ABS zone modeling** (§1.1) | 2026 robot-umpire park trials | new rule regime; the coordinate-shift work is scoped in the blueprint |
| **Baserunning** (sprint speed, leads, burst) | Savant leaderboards | ingest-validate first |
| **Defense / OAA family** | Savant public fielding data | ingest-validate; college build blocked on fielder tracking — MLB unblocks it via public data |
| **Catcher throwing / SB models** | pop-time, SB/CS data | |
| **Umpire context** | public scorecard data | framing covariate, not a standalone model initially |
| **Injury/IL risk** | daily roster snapshots + transactions (our feed) | accumulates IL history the longer it runs |
| **Market-vs-model** | The Odds API (bake-time) | only after grades pass gates; a market benchmark, not a feature |

Which of these MLB-only stats could go back to the college TrackMan site, ranked by value per effort: `docs/college-port-audit.md`.

## C. Research-sourced candidates (from the KB corpus)

The knowledge base now carries the blueprint's ~150 sources plus the baseball
literature; these are methodologies in the corpus that map to buildable models,
each anchored to retrievable docs:

| Candidate | Source in the KB |
|---|---|
| **xCTRL** — pitcher intent/execution via Gaussian mixture on location | blueprint §1.3, arXiv 2508.19184 |
| **E-RAPM** — synergy-augmented RAPM for lineup management | blueprint §2.2, ResearchGate 345490672 |
| **Box-Prior IPM / Dummy RAPM** — prior-informed shrinkage designs | blueprint §2.2, closingfive.com/methodology |
| **Distributional projections** — full outcome distributions, not point estimates | @diegosborn thread, Steamer/ZiPS essays (B10–B23) |
| **Bayesian player-projection engines** — full posterior per player | @cjhanalytics CBB posterior projections (adaptable pattern) |
| **RE24 / WPA play-level value grids** | beisbol-analitica repo, Statcast RE |
| **DRAFT surplus curves** — Fitzgerald-Spielberger vs legacy charts (MLB analog: Marginal Wins curves) | blueprint §4.2, Wharton curves |
| **xG-style contact-quality modeling** — spatio-temporal EV/LA/direction expectation | blueprint §3–4 methods, PMC11524524 |
| **Serverless lakehouse analytics** (DuckLake + R2 + DuckDB-Wasm) — the serving substrate | blueprint §5, A60–A80 |

These are candidates, not commitments: each enters the phasing table only when
its data dependency exists and a gate can be defined for it.

## Phasing (original plan, 2026-10-24)

| Phase | Models |
|---|---|
| M2–M3 (now) | RV layer ✅, Stuff+ bake-off, Pitching+, xwOBACON, xwOBA |
| M4 | Loc+, xRV, Decision+ family, Framing+, bat-tracking v1, park factors |
| M5 | Pitch Plan, Tunnel+, projections (§1.4), MiLB translation, surplus value |
| M6+ | defense ingest-validate, baserunning, injury, market models |

Every artifact ships with the college verification pattern: manifest
fingerprints, population checks, sign checks, and the gate table above —
no public ranking without a passed gate or the descriptive label.
