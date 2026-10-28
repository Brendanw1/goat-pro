# Web parity matrix — BaseballGOAT web → goat-pro fork

What the existing BaseballGOAT web frontend (`~/Projects/vt_baseball/BaseballGOAT/web`)
reads, field group by field group, and what the goat-pro fork can ship today.
Written from the code (types, lib modules, page imports) and the shipped
`data/export` shapes under `BaseballGOAT/data/export/` (the R2 contract —
`USE_LOCAL_DATA=true` reads exactly that directory, see `web/lib/r2.ts`).

Classification of every field group:

- **HAVE** — goat-pro already produces it: the pitcher-grade export
  (`data/export/mlb_pitcher_grades.json`: per-class and one-scale Stuff+,
  Pitching+, confidence, n), the raw stats the pipeline computes on the way
  (K%, CSW%, velo, batted-ball, arsenals), and the Savant leaderboard families
  already in the mart (`savant_mart/data/leaderboards/`: bat-tracking,
  expected statistics, swing-take, catcher framing/blocking/throwing, OAA,
  FRV, sprint speed, active spin, ABS challenges, baserunning).
- **DERIVABLE-NOW** — a mart query or leaderboard join, no model. The fork
  writes a view/bake; nothing needs training.
- **NEEDS-MODEL** — blocked on a model (retrain, recalibrate, or new build).
  Each maps to a `docs/model-inventory.md` row in §"Needs-model map".
- **EXCLUDED** — college/TrackMan-only by construction; the fork strips it
  (clean-room rule 1: no TrackMan data; inventory §A: PV+/portal not
  translating).

Row counts: **10 HAVE · 34 DERIVABLE-NOW · 31 NEEDS-MODEL · 4 EXCLUDED** (79 groups).

---

## The matrix (page → field groups → class)

### Shared / global

| # | Group | Fields the UI reads | File(s) | Class |
|---|---|---|---|---|
| G1 | Grade percentile chips (nav + boards) | grade → D1 percentile overlays | `stuff_percentiles.json` | **HAVE** (recompute over the MLB export population) |

### /pitchers (leaderboard; `lib/boards/pitchers.ts`, `lib/data.ts`)

| # | Group | Fields | File | Class |
|---|---|---|---|---|
| P1 | Identity/context | id, name, team, throws, year, conference | `pitchers.json` | **DERIVABLE-NOW** (rosters + `pitches`) |
| P2 | Traditional results | IP, RA9/ERA, WHIP, FIP, BF, pitches, H, BB | `pitchers.json` | **DERIVABLE-NOW** |
| P3 | Core rates | K%, BB%, K-BB%, CSW%, Whiff%, GB%, mean velo, mean IVB | `pitchers.json` | **DERIVABLE-NOW** (K%/CSW%/velo already computed in FEATURE_SQL) |
| P4 | Discipline group | Zone%, Chase%, Z-Swg%, Z-Whf%, O-Whf%, Z-Con%, O-Con%, SwStr%, CS%, F-Str%, PutAwy% + `*Shrunk` twins + denominators | `pitchers.json` | **DERIVABLE-NOW** (rates + EB shrinkage; reliability constants re-measured per inventory §A) |
| P5 | Stuff grades | stuffPlus, stuffPlusShrunk, abStuffPlus, abStuffPlusShrunk, confidence | `pitchers.json` / `mlb_pitcher_grades.json` | **HAVE** — descriptive label required (gate_status `descriptive-only`) |
| P6 | Pitching+ | pitchingPlus | same | **HAVE** — descriptive label required |
| P7 | Projection columns | pitchingProj, pitchingGap | `pitchers.json` | **NEEDS-MODEL** (weighted recompute whose components include the location leg → blocked on Loc+) |
| P8 | Loc+ | locPlus | `pitchers.json` | **NEEDS-MODEL** |
| P9 | xRV+ / xRV/100 | xrvPlus, xrvPer100 | `pitchers.json` | **NEEDS-MODEL** |
| P10 | RV/100 (measured) | rvPer100 | `pitchers.json` | **DERIVABLE-NOW** (`delta_run_exp` per 100) |
| P11 | Luck | rvGap = rvPer100 − xrvPer100 | derived in `lib/data.ts` | **NEEDS-MODEL** (blocked on xRV) |
| P12 | Contact suppression | xwOBA_against, xwOBACON_against, contactSuppressionZ | `pitchers.json` | **NEEDS-MODEL** (xwOBA-Against; movement-cluster contact model = new build) |
| P13 | Park-adjusted | parkFactor, adj_era, adj_fip | `pitchers.json` | **NEEDS-MODEL** (§B component park factors; a crude PF is a mart query) |
| P14 | Percentile tables | per-metric p10–p90 (hitters + pitchers + stuff overlay) | `percentiles.json`, `stuff_percentiles.json` | **DERIVABLE-NOW** (population quantiles) |

### /hitters (leaderboard + `?view=skill`; `lib/boards/hitters.ts`, `lib/boards/hitter-skill.ts`)

| # | Group | Fields | File | Class |
|---|---|---|---|---|
| H1 | Identity + slash | id, name, team, bats, year, PA, AVG, OBP, SLG, wOBA | `hitters.json` | **DERIVABLE-NOW** |
| H2 | Expected wOBA | xwoba, true_xwoba | `hitters.json` | **NEEDS-MODEL** (xwOBACON retrain + xwOBA recalibrate; inventory §A. Interim: Savant `est_woba` ships descriptively with attribution) |
| H3 | Batted-ball quality | ev90, maxEv, barrelPct, hardHitPct | `hitters.json` | **DERIVABLE-NOW** |
| H4 | Discipline group | swing/z-swing/contact/z-contact/o-contact/whiff/swStr/first-pitch/2K-chase/zone-seen + shrunk twins | `hitters.json` | **DERIVABLE-NOW** |
| H5 | Decision grades | decisionPlus, ozaPlus, izaPlus (+ reliabilities) | `hitters.json` | **NEEDS-MODEL** |
| H6 | xwOBACON | xwobacon | `hitters.json` | **NEEDS-MODEL** |
| H7 | Catcher grades | framingPlus, throwingPlus | `hitters.json` | **NEEDS-MODEL** |
| H8 | Park-adjusted | parkFactor, adj_woba, adj_slg | `hitters.json` | **NEEDS-MODEL** (PF dependency) |
| H9 | Skill board | power/contact/eye percentiles + 20-80 grades, approach dial, hitter type | `hitter_skill_index.json` | **DERIVABLE-NOW** (descriptive estimates + percentile ranks; constants refit only) |
| H10 | Scouting card | zone-cell swing/whiff/hard-hit maps, by hand, count rows, proc | `hitter_scouting/{id}.json.gz` | **DERIVABLE-NOW** (per-hitter bake over `pitches`) |
| H11 | Model bands + benchmarks | k-range bands, split benchmarks (per-cell league quantiles) | `hitter_models.json`, `benchmarks/hitter-splits.json` | **DERIVABLE-NOW** |

### /arsenal (cards, mix, slot, per-pitch pages)

| # | Group | Fields | File | Class |
|---|---|---|---|---|
| A1 | Pitch-class cards | avgVelo, avgWhiff, avgIvb, top-10 by Stuff+ per class | `arsenal_cards.json`, `arsenal/{class}.json` | **HAVE** (grade ranking + mart aggregates) |
| A2 | Mix board | n, nTypes, effTypes, separation, repeatSd, veloSpread + percentiles | `arsenal.json` | **DERIVABLE-NOW** (descriptive panel by design) |
| A3 | Slot board — release | arm°, relH, relS, ext, primary FB, slot-expected shapes (ΔIVB/ΔHB, spin±slot), whiff±slot | `slot_board.json`, `slot/{id}.json`, `expected_shapes.json` (slot source) | **DERIVABLE-NOW** (Statcast release + slot-conditional means) |
| A4 | Slot board — grades | Stuff+/ABStuff+/Pitch+ + slot-band percentiles | `slot_board.json` + grades | **HAVE** |
| A5 | Slot board — xRV | xrv per class, xrvGrade | `pitch_rv` cells | **NEEDS-MODEL** |
| A6 | Class-page raw rows | usage, velo, ivb, hb, spin, vaa, ext, zonePct, whiffPct, cswPct, woba-against, discipline per class | `arsenal/{class}.json` | **DERIVABLE-NOW** |
| A7 | Class-page stuff grades | stuffPlus(+shrunk, CI lo/hi), abStuffPlus(+shrunk, CI, vs LHH/RHH), n_pitches, confidence | `arsenal/{class}.json` + `pitch_grades/{id}` | **HAVE** |
| A8 | Class-page model columns | locPlus, pitchingPlus-per-type, xrvGrade, runValue, contactSuppressionZ, conferenceRelativeZ | `arsenal/{class}.json` | **NEEDS-MODEL** (pitchingPlus-per-class itself is HAVE; loc/xRV/CS-z are not) |
| A9 | VAA breakpoints | per class × zone-cell league VAA | `vaa_zone_pct.json` | **DERIVABLE-NOW** |

### /tunneling

| # | Group | Fields | File | Class |
|---|---|---|---|---|
| T1 | Pitcher Tunnel+ board | tunnelPlus, nPairs, reliability, confidence (+ grade refs) | `tunneling_pitchers.json` | **NEEDS-MODEL** (descriptive label per the college study) |
| T2 | Pairing table | from/to, commitSepIn, plateSepIn, chaseLiftPts, n | `tunneling.json`, profile `tunnelPairs` | **NEEDS-MODEL** |

### /player/[id] — pitcher view (`profile-view.tsx` + loaders)

| # | Group | Fields | File | Class |
|---|---|---|---|---|
| PP1 | Header/summary | identity, IP/ERA/FIP/K%/BB%, ABStuff+ headline (+shrunk, CI), confidence | `players/{id}.json` + grades | **HAVE** (grades) + P1/P2 raws |
| PP2 | Arsenal rows — raw | per class: n, usage, velo, ivb, hb, spin, strike%, vaa, ext, relH/relS, loc tails, woba, swing/contact/whiff splits, counts (nZone/nOoz/nFirstPitch/nTwoStrike…) | `players/{id}.json` | **DERIVABLE-NOW** |
| PP3 | Arsenal rows — stuff grades | stuffPlus/abStuffPlus (+shrunk, CI, platoon splits, stuffGradeFrom, predictedCswPct, nStuffPitches) | `players/{id}.json` + `pitch_grades/{id}.json.gz` | **HAVE** |
| PP4 | Arsenal rows — value | locPlus(+CI, reliability), xrvPlus/xrvPer100, rvPer100, rvGap, contactSuppressionZ | `players/{id}.json` | **NEEDS-MODEL** (rvPer100 measured is DERIVABLE-NOW) |
| PP5 | Auto-tagger rows | pitchesAuto (same shape, keyed by topo class) | `players/{id}.json` | **NEEDS-MODEL** (inventory §A topo tagger full-depth port — ledger row in progress) |
| PP6 | Batted-ball against | per class: GB/FB/LD/PU%, avgEV, avgLA, HardHit%, n BIP | `players/{id}.json` `battedBall` | **DERIVABLE-NOW** |
| PP7 | Movement + release | movementProfile (IVB×HB), release (relHeight/relSide/extension ±SD) | `players/{id}.json` | **DERIVABLE-NOW** |
| PP8 | VAA panels | vaaByZone, vaaByPitch (+ league breakpoints, A9) | `players/{id}.json` | **DERIVABLE-NOW** |
| PP9 | Per-pitch RV card | cells: rv_per100, xrv_per100, xrv_grade, overperformance, confidence; floors + per-class quantiles | `pitch_rv/{id}.json` | **NEEDS-MODEL** (xRV leg; measured half derivable) |
| PP10 | Tunnels | tunnelPairs, tunnelPlus, reliability | `players/{id}.json` | **NEEDS-MODEL** |
| PP11 | Arsenal overview | n, nTypes, effTypes, separation, repeatSd, veloSpread + pct | `arsenal.json` | **DERIVABLE-NOW** |
| PP12 | SHAP panel | per-pitch feature attributions for Stuff+/Pitching+ | `stuff_shap/{id}.json` | **DERIVABLE-NOW** (recompute over the frozen MLB models; script, not a view) |
| PP13 | Arm-slot file | per-class slot/shape rows for the 3D scene | `slot/{id}.json` | **DERIVABLE-NOW** |
| PP14 | Expected shapes | per-class expected IVB/HB rings (best/fastball/slot sources) | `expected_shapes.json` | **NEEDS-MODEL** (topo port first, then a slot-conditional recompute) |
| PP15 | Game plan | count/state mix, fade lines, stuff cloud, loc percentiles, hitter blocks | `game_plan/{id}.json.gz`, `coach/*` | **NEEDS-MODEL** (composer blocked on pitch-RV cells + Loc+; the mix/VAA halves are DERIVABLE-NOW) |
| PP16 | Pitch plan | per-count expected pitch + CSW/RV model outputs, shrinkage | `pitch_plan/{id}.json.gz`, `pitch_plan/hitter_types.json` | **NEEDS-MODEL** (inventory §A, M5, heavy) |
| PP17 | Pitcher-catchers | per-catcher framing/blocking runs behind him | `defense/pitchers/{key}.json` | **NEEDS-MODEL** (Framing+) |
| PP18 | Projections | ProjRow: rv100, woba, xwoba, k, bb, kbb, ra9, fip, cra9, aera + intervals | `pitcher_forecast.json` | **NEEDS-MODEL** (§B state-space projections, M5) |
| PP19 | Situational runs | leverage splits (runs/100 by base-out state) + purity meta | `situational_runs.json` | **DERIVABLE-NOW** (descriptive; purity re-measured) |
| PP20 | Zone mix | rv/100 by zone × family cells (heart/shadow/chase) + reliability | `zone_mix.json` | **DERIVABLE-NOW** on measured RV; the xRV variant is NEEDS-MODEL |

### /player/[id] — hitter view (`hitter-profile.tsx`)

| # | Group | Fields | File | Class |
|---|---|---|---|---|
| PH1 | Decision block | Decision+/IZA+/OZA+, drvPer100, per-pitch decision replay (pSwing, rvSwing/rvTake, drv) | `splits/decisions.json`, `decisions/{id}.json.gz` | **NEEDS-MODEL** |
| PH2 | Splits | vs RHP/LHP, vs FB/BR/OS/CT, velo bands, IVB bands | `splits/hitters.json` | **DERIVABLE-NOW** |
| PH3 | Spray explorer | per-BIP balls (EV/LA/dir/result/tags), league pull/straight/oppo refs; per-ball xwOBA overlay | `spray/{id}.json.gz`, `spray.json`, `spray_points.json` | **DERIVABLE-NOW** raw (Statcast `hc_x/hc_y`); the xwOBA overlay is NEEDS-MODEL (xwOBACON) |
| PH4 | 3D swings | trajectories + per-swing bat speed/attack angle (bat tracking per-pitch, 2023+ local) | `pitches3d/batter/{id}.json` | **DERIVABLE-NOW** (partial; aggregates HAVE in `lb_bat_tracking`) |
| PH5 | Location surfaces | client-side kernel surfaces over plate locations; value overlays (xwOBA) | `surface/[role]/[id]` route over `pitches3d/*` | **DERIVABLE-NOW** raw location; value overlay NEEDS-MODEL |

### /scouting/defense (`lib/defense/*`)

| # | Group | Fields | File | Class |
|---|---|---|---|---|
| D1 | Team/league totals | runs, ranks by team/if/of/c, positions, spots, depth | `defense/teams/*`, `defense/league.json` | **NEEDS-MODEL** (chances model; rebuild = §B ingest-validate) |
| D2 | Player cards | total/skill/tool/happened/context metrics + intervals + percentiles, chances, shadow cells | `defense/players/{id}.json` | **NEEDS-MODEL** |
| D3 | Game files | per-chance points (p, credit, runs, stars) | `defense/games/{gid}.json` | **NEEDS-MODEL** |
| D4 | Catcher deep | framing/blocking row archives, per-game receiving | `defense/catchers/{key}.json.gz` | **NEEDS-MODEL** |
| D5 | Savant reference boards | OAA (2016+), FRV, sprint speed, catcher throwing/blocking aggregates | `lb_outs_above_average_*`, `lb_fielding_run_value_*`, `lb_sprint_speed_*`, `lb_catcher_*` | **HAVE** (ingest-validated; ship with attribution + descriptive label) |

### /scouting/umpires

| # | Group | Fields | File | Class |
|---|---|---|---|---|
| U1 | Umpire index + called zones | per-ump accuracy, contours, zones | `umpires/index.json`, `umpires/zones/{slug}.json.gz` | **NEEDS-MODEL** (college box-score identities cannot ship; rebuild path = inventory §B umpire context, descriptive Statcast called-pitch board derivable) |

### /reports

| # | Group | Fields | File | Class |
|---|---|---|---|---|
| R1 | Team table | pitcher board subset by team | `pitchers.json` | **HAVE** (with P5/P6 + raw views) |
| R2 | Game reports | per-game lines, hitter PA tables, BatPitch rows | `games/{gid}.json` | **DERIVABLE-NOW** (game-log bake over `pitches`) |
| R3 | Projections page | pitcher_forecast table | `pitcher_forecast.json` | **NEEDS-MODEL** |
| R4 | PV+ / portal | draft value, transfer portal vs WAR | `pv_plus.json`, `portal.json` | **EXCLUDED** (inventory §A: not translating) |
| R5 | Outing+/Outlook+ | per-outing composite scores + league scales | `outing_plus.json`, `outlook_plus.json`, `game_lines_league.json` | **DERIVABLE-NOW** (recompute per §A after game cells; no new model) |
| R6 | Ticker | grade gainers, recent outings | `ticker.json` | **DERIVABLE-NOW** (recompute) |

### Internal TrackMan surfaces (strip, not port)

| # | Group | Why | Class |
|---|---|---|---|
| I1 | `/live` console + `lib/live/*` | TrackMan live feed ingest | **EXCLUDED** (clean-room rule 1) |
| I2 | `/fall` + `lib/fall/*` | TrackMan fall-ball ingest/grades | **EXCLUDED** |
| I3 | `/reports/live`, `/reports/practice`, `lib/practice/*` | TrackMan session/practice reports | **EXCLUDED** |

### Global rebuilds

| # | Group | Fields | File | Class |
|---|---|---|---|---|
| X1 | Glossary claims | measured constants quoted in copy | `claims.json`, `measured-2026.json` | **DERIVABLE-NOW** (re-measure scripts on MLB) |
| X2 | Indexes/meta | player index, search index, export meta | `player_index.json`, `meta.json` | **DERIVABLE-NOW** |

---

## Needs-model map (row → inventory row → external validation already in the mart)

| NEEDS-MODEL rows | Inventory row (`docs/model-inventory.md`) | Disposition / phase | Validation in the mart |
|---|---|---|---|
| P8 Loc+, P7 pitchingProj, PP15 (loc leg) | §A **Loc+** — retrain | M4; descriptive label expected (college beat naive on nothing) | RESULTS-MLB §10 plate re-referencing + §11 location check are the on-MLB evidence base; no CSV needed |
| P9, P11, A5, A8, PP4, PP9, PP15 (RV leg), PP20 (xRV variant) | §A **xRV v3.1** — retrain (6-class softmax + contact leg) | M4; college per-pitch r .563 is the bar | `lb_expected_statistics_pitcher_*` (est_woba, xera) + pitcher run values derivable locally |
| H2, H6, P12/H8 (xwOBA family) | §A **xwOBACON** retrain; **xwOBA** / **xwOBA-Against** recalibrate | M2–M3 | `lb_expected_statistics_batter_*` (`est_woba`, `est_slg`, `est_ba`) |
| H5, PH1 Decision+ | §A **Decision+** — build on MLB directly (p_swing, p_called_strike, RV swing/take) | M4 | `lb_swing_take_*` (`runs_heart/shadow/chase/waste`, 2024+) |
| H7, D4, PP17 Framing+/catcher | §A **Framing+** — retrain (shadow-zone residuals) | M4; validate vs public CSAA | `lb_catcher_framing_*` (2019–2026, per-zone rv/pct), `lb_catcher_blocking_*`, `lb_catcher_throwing_*` |
| T1, T2, PP10 Tunnel+ | §A **Tunnel+** — retrain, low priority | M5; descriptive by the college study's own finding | — (descriptive label) |
| D1–D4 defense internals | §B **Defense / OAA family** — ingest-validate Savant public data | M6 | `lb_outs_above_average_*` (2016+), `lb_fielding_run_value_*` already fetched |
| PP16 Pitch Plan | §A **Pitch Plan** — retrain (heavy) | M5 | — |
| PP18, R3 projections | §B **State-space projections** | M5 | multi-season mart history |
| P13, H8 park factors | §B **Component park factors** (hierarchical EB) | M4 | 30 fixed parks |
| PP5, PP14 auto-tagger/expected shapes | §A **Topo tagger** — port at full depth (L1 + L2) | now (ledger row in progress) | class key vs Statcast `pitch_type` crosswalk |
| P12 contactSuppressionZ | new build (movement-cluster contact quality) — inventory §A/§B gap; enter phasing when the xwOBACON leg exists | M4+ | `lb_expected_statistics_pitcher_*` contact-quality columns |
| U1 umpires | §B **Umpire context** (framing covariate first) | M6 | Statcast called pitches (mart, descriptive board possible without a model) |

---

## MVP fork surface (HAVE only)

The pages/fields shippable from what goat-pro produces today:

1. **/pitchers** — identity + raw-rate columns (P1–P3 as already computed by
   FEATURE_SQL: K%, CSW%, velo, plus IP/BF re-emitted) + **Stuff+, ABStuff+
   (one-scale), Stuff+ˢ, Pitching+, confidence** (P5, P6), league-median row.
   Every grade column carries the **descriptive label**: model card
   `gate_status: descriptive-only` (RESULTS-MLB: no target beats naive
   persistence on clean-pair CSW%/K-PA) — so the board header reads
   "descriptive, not a forecast", per AGENTS.md rule 3.
2. **/player/[id] pitcher profile** — summary header (PP1), arsenal table with
   raw rows (PP2) and per-class stuff/pitching grades (PP3), batted-ball
   against (PP6), movement + release (PP7), VAA (PP8). Grade cells keep the
   descriptive label; Loc+/xRV/RV/CS-z cells are stripped, not stubbed.
3. **/arsenal** — class cards (A1), class pages with raw rows (A6) + stuff
   grades (A7), slot board with release + grade columns (A3, A4). Mix board
   (A2) is one view away — wave 2.
4. **Savant reference boards** (D5): bat-tracking, expected statistics,
   swing-take, OAA/FRV, sprint speed, catcher trio — shipped as *attributed
   Savant data*, descriptive; the catcher-framing family is labeled
   validation-reference, not our Framing+.
5. **/hitters (raw only)** — wave 2 in practice: H1/H3/H4 need the hitter-side
   mart views (DERIVABLE-NOW), so strict-HAVE MVP launches without a hitter
   leaderboard; the Savant bat-tracking + expected-stats boards carry the
   hitter side in the meantime.
6. **Home + glossary skeleton** — static copy; claims refilled as re-measures
   land (X1).

Not in MVP: everything NEEDS-MODEL (stripped at the column/panel level) and
everything EXCLUDED (deleted with their routes: /live, /fall, /reports/live,
/reports/practice, /reports/pv, portal, /scouting/umpires).

## Fork checklist order

1. **Fork** — copy the web app; keep `USE_LOCAL_DATA` + R2 client, auth policy,
   table/board infrastructure (boards/shared, filters, sort), design system.
   No clean-room issue: this is BaseballGOAT's own code moving with the
   program; the clean-room rule binds the *data*, not the UI.
2. **Strip** — remove EXCLUDED routes and libs (`lib/live`, `lib/fall`,
   `lib/practice`, portal/PV+ pages, umpires page); remove NEEDS-MODEL columns
   and panels from boards/profiles (delete the column entries, not blank
   cells — a missing field must never render); drop college-only fields
   (conference), glossary claims fall back to "untested" until re-measured.
3. **MVP data producer list** — exporter additions in goat-pro (regenerate,
   never hand-edit):
   - `pitchers.json` (subset: identity, raw rates, P5/P6 grades + confidence)
   - `players/{id}.json` (subset: PP1–PP3, PP6–PP8, PP13)
   - `arsenal/{class}.json` + `arsenal_cards.json` (A1, A6, A7; classes =
     model-card `class_key`, Statcast pitch types)
   - `stuff_percentiles.json` / `percentiles.json` (G1, P14)
   - `scales.json` (grades section), `player_index.json`, `meta.json`
   - Savant board bakes from `lb_*` tables (D5)
4. **R2 schema** — the fork reads baked JSON from R2 only (AGENTS.md rule 5);
   the path layout above IS the schema (same keys the web app already asks
   for, minus stripped files); `meta.json` carries export version + model card
   fingerprints; re-bakes overwrite whole keys.

## DERIVABLE-NOW: what is one command

Of the 34 DERIVABLE-NOW groups, **22 are single SQL views** over `pitches` /
`lb_*` in `mart.connect()` (P1–P4, P10, P14, H1, H3, H4, A2, A3, A6, A9, PP2,
PP6–PP8, PP11, PP13, PP19, PP20, PH2 — each a CREATE VIEW + a small bake
step in one script). The remaining 12 are short bakes rather than one command:
H9–H11 (skill card, scouting card, benchmarks — need the reliability-constant
refit + per-hitter iteration), PP12 (SHAP over the frozen models), PH3–PH5
(spray per-ball files, 3D/surface exporters), R2 (game-log bake), R5–R6
(outing/outlook + ticker composers), X1–X2 (re-measure + index bakes).
