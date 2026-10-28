# College → GOAT-Pro port: deliverables (2026-10-27)

The working list for finishing the BaseballGOAT (college) → goat-pro port at full depth, and
for deepening the parts of pro that are still MVP. It supersedes the classification tables in
`parity-matrix.md` (written 2026-10-25, before waves 2–10) as the to-do list; the matrix
stays as the field-group reference.

**How to use it.** Claim an item with a COLLABORATION.md row (`in-progress — D-xx`), and close it
with a row that names the commit. Each item lists its **lane**:

- **M**: model or pipeline (goat-helper / P7).
- **W**: web + `web_export.py` (ZCode web agent).
- **M→W**: M lands the artifact, then W wires it.

Every item ends with a bake, `--check`, `r2_sync`, and a live check. Data goes live on sync,
because the site reads R2 uncached. Code needs a Vercel deploy.

**Rules that bind every item** (AGENTS.md):
- Public data only.
- Any grade that has not passed its gate ships with the descriptive label.
- ABStuff+ stays off the site (owner call, `29cbc23`).
- Glossary and docs change in the same commit as the feature.
- No hand-edited JSON.

**How the gap was measured.**
- Route list, college vs pro.
- `components/ui` inventory.
- Profile panel imports.
- Field keys of the largest `players/*.json` and of `pitchers.json` / `hitters.json` in both exports.
- `RESULTS-MLB.md` §1–65 for what the pro models already settled.

## Where pro stands

Live and at college depth or better:
- /pitchers and /hitters boards. They now carry PA and age; age is a filter.
- Pitcher and hitter profiles:
  - P7 family: Whiff+ (by type/class, display from 10 pitches), K+, K proj, Prevention+,
    Control+, Pitching+.
  - Arsenal rows: raw, plus shrunk discipline.
  - Movement, VAA, situational runs, zone mix, measured RV/100, mix board.
  - Arm slot with percentiles.
  - Visuals tab.
  - Game logs with per-PA pitch tables.
  - Scouting card, skill card (H9), split benchmarks (H11).
  - Spray chart, redesigned 2026-10-27.
  - Team theme.
- /arsenal class pages.
- /games reports.
- /minors: AAA lines, Statcast board, AAA Whiff+.
- /teams.
- Savant reference boards.
- Ticker.

**Missing (college has it, pro does not):**
- Tunneling.
- Defense: team, player, leaders, catcher deep.
- Umpires.
- Decision+ / IZA+ / OZA+.
- xwOBA family: xwOBA, xwOBACON, xwOBA-against, contact suppression.
- xRV / Loc+ / luck columns.
- Framing / throwing grades.
- Park factors.
- Projections page.
- Outing+ / Outlook+.
- Game plan, pitch plan, sheet, report card.
- SHAP / stuff breakdown.
- Release tells, shape twins, expected shapes.
- Auto-tagger rows (`pitchesAuto`).
- Platoon grade splits and CIs.
- 3D pitches / swings and location surfaces.
- Movement explorer, decision replay.
- Coach guide.
- Glossary depth: 140 lines vs 1,608.

**Still MVP on the pro side:**
- /scouting/savant: plain tables, no player links, no percentiles.
- /teams/[abbr]: roster lists, no team-level models.
- Home page.
- Glossary.
- AAA: Whiff+ only.

---

## Tier 1: models that unlock the most surfaces

| ID | Item | Lane | What "done" means | Depends on | Size |
|---|---|---|---|---|---|
| D-01 | **xwOBACON + xwOBA (hitters) + xwOBA-against.** H2, H6, P12, PH3 overlay. | M→W | **Model:** retrain xwOBACON on EV/LA/spray angle (+ sprint speed for weak contact). Recalibrate college xwOBA with its method preserved exactly (the one college hitter metric that cleared the gate). **Gates:** gated vs Savant `est_woba` (`lb_expected_statistics_*`) and vs naive persistence on N→N+1 wOBA, pitcher/hitter-grouped bootstrap. **Artifacts:** `xwoba`, `xwobacon` on hitter rows/docs; `xwOBA_against`, `xwOBACON_against` on pitcher rows/docs; per-ball `xw` in `spray/*` (the chart colours by it). **Glossary:** entry plus gate result. | — | L |
| D-02 | **Decision+ / IZA+ / OZA+ / dRV per 100.** H5, PH1. | M→W | **Model:** build on MLB: p_swing model, then RV(swing) − RV(take) per pitch from `delta_run_exp` with a count/base-out baseline. **Reliability:** split-half reliability and shrunk twins like the discipline constants. **Validation:** vs Savant `lb_swing_take_*` runs by zone region (2024+). **Artifacts:** `decisionPlus`, `izaPlus`, `ozaPlus`, `drvPer100(+Shrunk)`, `decisionReliability/Confidence` on hitter rows. **Profile:** per-hitter `decisions/{id}-{season}.json.gz` for the decision-replay panel. §22 (decision-*point* timing) is a different thing and stays dead. | — | L |
| D-03 | **xRV per pitch (v3.1 lineage) → xRV+, xRV/100, luck (rvGap), per-pitch RV card xRV half.** P9, P11, A5, A8, PP4, PP9, PP20. | M→W | **Model:** 6-class outcome softmax + contact leg (uses D-01's xwOBACON). The bar is college per-pitch r .563. **Gates:** pitcher-grouped cross-fit (memorization rule). **Artifacts:** `xrvPer100`, `xrvPlus` on boards/docs; `rvPerPitch` cells with `xrv_per100`, `xrv_grade`, `overperformance`, `confidence`; xRV zone-mix variant. | D-01 | L |
| D-04 | **Park factors (component, hierarchical EB).** P13, H8. | M→W | **Model:** per-park, per-component factors (1B/2B/3B/HR/BB/K, by hand), 3+ seasons, EB-shrunk. **Validation:** against Savant park factors. **Artifacts:** `parkFactor`, `adj_era`, `adj_fip`, `adj_woba`, `adj_slg`, `adj_iso`, `adj_xwoba_against` on rows; a park table page under /teams. | — | M |
| D-05 | **P7 family on AAA** (open owner ask, ledger row 151). | M→W | **Before reading any data:** pre-register the holdout design. The AAA 2026 seal is spent, so use a pitcher-grouped AAA→MLB-call-up design or 2027. **Run:** K+ / Prevention+ / Control+ / Pitching+ on AAA under the §44 frozen recipe. **Ship:** only what passes, display-only, through `overlay_aaa_p7`. | — | M |

## Tier 2: arsenal and tunnelling at college depth

| ID | Item | Lane | What "done" means | Depends on | Size |
|---|---|---|---|---|---|
| D-06 | **Tunnel+ and pairings.** T1, T2, PP10, /tunneling. | M→W | **Inputs:** Statcast 9-parameter trajectories (release + vx0..az0) give commit-point separation (≈23.8 ft from the plate, the college definition) and plate separation per ordered pair (consecutive pitches, same PA). Chase lift is measured. **Label:** descriptive (§35: tunnelling adds nothing to the v3 forecast; §57: sequencing is sticky but not forecast-useful). **Artifacts:** `tunneling_pitchers.json` (tunnelPlus, nPairs, reliability, confidence); `tunneling.json` pair table; `tunnelPairs` / `tunnelPlus` on player docs. **Web:** port the `/tunneling` page and `tunnel-plus-panel`. | — | M |
| D-07 | **Platoon grade splits + CIs + shrunk grades.** PP3 depth. | M→W | **Per type:** Whiff+/Pitching+ vs LHH/RHH (`*VsLHH/RHH`, `*Sides`), bootstrap CIs (`*CI_lo/hi`), shrunk grades (`*Shrunk`), `usageVsLHH/RHH`, `predictedCswPct`, `stuffSmall` flag. **Display:** the split columns and CI whiskers in the arsenal table. | — | M |
| D-08 | **Auto-tagger (Topo L1 + L2) rows.** PP5, PP14. | M→W | **Model:** port Topo at full depth on MLB shapes: L1 FB/BB/CH as the grading key, L2 names as the display layer. **Artifacts:** `pitchesAuto` / `rvPerPitchAuto` on docs; `expected_shapes.json` (slot-conditional expected IVB/HB rings). **Web:** tag-mode toggle (Statcast vs Auto) on profile and arsenal. §40 already settled that L1 is not a better grading key on K%, so this ships as display and crosswalk. | — | L |
| D-09 | **Stuff breakdown (SHAP).** PP12. | M→W | **Bake:** `stuff_shap/{id}.json` over the frozen cross-fit Whiff+/P7 models: per-type feature attributions (velo, IVB, HB, spin, ext, slot, VAA, diffs vs FB). **Web:** port the `stuff-breakdown` panel. | — | M |
| D-10 | **Release tells + shape twins + movement explorer.** | W | Port `release-tells-panel` (release-point separation by type: rel_x, rel_z, ext SD and overlap, from `release_pos_*` / `release_extension`), `shape-twin-note` (nearest MLB pitch by shape within type), `movement-explorer` (interactive multi-season movement with league density). All descriptive. | — | M |
| D-11 | **Pitch-usage back-to-back + pitch rank.** | W | Port `pitch-usage-back-to-back` (sequence transition matrix per pitcher; the §57 data) and `pitch-rank` (league rank per type metric). | — | S |

## Tier 3: defense (adapted, not copied)

College ran on fielder tracking. Public MLB data has no fielder start positions, but each pitch row
carries hit coordinates (`hc_x/hc_y`), EV/LA, `fielder_2..9` ids, `if/of_fielding_alignment`, and
the Savant OAA/FRV/catcher boards. So the pro defense model is a **chances model on public inputs,
validated against OAA**, not a copy of the college one.

| ID | Item | Lane | What "done" means | Depends on | Size |
|---|---|---|---|---|---|
| D-12 | **Out-probability chances model (range/skill).** D1, D2, D3. | M→W | **Model:** P(out) per BIP from EV, LA, spray, park, alignment and batter sprint speed, cross-fit by season. **Credit:** responsible fielder by zone and batted-ball type (position from `fielder_n`). Runs = (out − p) × run value of the hit avoided. **Gates:** player-season runs vs Savant OAA/FRV (r, by position), year-to-year stickiness vs OAA's. **Artifacts:** `defense/players/{id}.json` (total/skill/context metrics + intervals + percentiles, chance list, shadow cells); `defense/teams/*` (team/IF/OF/C runs, ranks, by position); `defense/games/{gid}.json` per-chance points. | D-04 park | L |
| D-13 | **Catcher: Framing+ / blocking / throwing.** H7, D4, PP17. | M→W | **Framing:** called-strike model (location, count, pitch type, handedness, + umpire random effect once D-15 exists), validated vs `lb_catcher_framing_*` (2019–26, per-zone). **Blocking:** WP/PB opportunities from pitch location. **Throwing:** SB/CS + pop time from `lb_catcher_throwing_*`. **Artifacts:** `framingPlus`, `throwingPlus` + reliability on hitter rows; `defense/catchers/{key}.json.gz`; pitcher-catcher pairs (runs behind each pitcher). **Web:** port `catcher-defense-panel`. | — | L |
| D-14 | **Defense pages.** /scouting/defense, /[team], /leaders. | W | Port the college pages and `components/defense/*` onto D-12/D-13 artifacts. Savant OAA/FRV sit beside ours as reference columns, labelled. | D-12, D-13 | M |
| D-15 | **Umpires.** U1. | M→W | Statcast `umpire` is empty (2025: 0 of 742k), so home-plate umpire ids come from the MLB Stats API game feed (officials) into the mart. **Then:** per-umpire called-zone accuracy, contours, zone size; counts vs ABS 2026 challenges. **Web:** port `/scouting/umpires`. Feeds D-13 as a random effect. | mart ingest | M |
| D-16 | **Baserunning + arm.** | M→W | Ingest-validate `lb_baserunning*`, `lb_basestealing_run_value_*` and sprint speed onto hitter docs. OF arm from Savant arm strength if fetched. Descriptive. | — | S |

## Tier 4: projections, game tools, reports

| ID | Item | Lane | What "done" means | Depends on | Size |
|---|---|---|---|---|---|
| D-17 | **Season projections page.** PP18, R3. | M→W | **Method:** port the college pitcher-forecast method (frozen + blind-tested) to MLB; the K proj (§50) and Prevention+ stack (§52) are the confirmed legs. **Rows:** rv100, woba, xwoba, k, bb, kbb, ra9, fip with intervals, plus the survivorship caveat ("if he holds a role"). **Hitter side:** after D-01. **Web:** `/reports/projections` + `ProjectionCard` on profiles. | D-01 | L |
| D-18 | **Outing+ / Outlook+.** R5. | M→W | Recompute the composers on per-game P7 cells (`pitching_plus_games`, `stuff_games`, `xrv_games`) and league scales; game-log rows get Outing+. | D-03 for the xRV leg | M |
| D-19 | **Game plan** (`/player/[id]/game-plan`). PP15. | M→W | **Pitcher side:** count/state mix, fade lines, stuff cloud, location percentiles, zone mix, hitter blocks (vs the opposing lineup's scouting cards). **Hitter side:** attack plan. Mix/VAA halves can ship now; the RV halves wait for D-03. | D-03 | L |
| D-20 | **Pitch plan.** PP16. | M | Per-count expected pitch + CSW/RV. §61–63 found MLB usage near equilibrium (no OPE edge), so ship it **descriptively**, as "what he throws and how it plays per count", not as a recommendation. | — | M |
| D-21 | **Player sheet + report card + per-game player report.** `/player/[id]/sheet`, `/report`, `/report/[gameId]`. | W | Port the printable one-page sheet and report card on pro fields, plus a per-game report that joins `games/{gid}` and `pa_log`. | — | M |
| D-22 | **Team game reports + team hitters.** `/reports/game/[gid]/hitters`, team table. | W | Extend `/games/[gid]` with the college team-game hitter tables and BatPitch rows. | — | S |

## Tier 5: deepen the MVP surfaces

| ID | Item | Lane | What "done" means | Size |
|---|---|---|---|---|
| D-23 | **Glossary to college depth.** | W (+M for claims) | Port the college structure (1,608 lines): every metric with definition, scale, reliability, gate status and measured MLB constants (X1 re-measure, `claims.json`). Add the **coach guide** (`/glossary/coach-guide`). Every model item above adds its entry. | M |
| D-24 | **Savant boards upgrade.** | W | Player links, season filters, percentile chips, joins to our grades (e.g. OAA next to D-12 runs, est_woba next to D-01), CSV export. | S |
| D-25 | **Team pages with substance.** | W | Team pitching/hitting aggregates (P7 means, xwOBA, defense runs, park factor), depth by role, team percentile bars, links to /games. | M |
| D-26 | **Home page.** | W | Leaders by model, ticker, recent game reports, "what's new" from the ledger. | S |
| D-27 | **Hitter models panel + batted-ball panel + spray explorer.** | W | Port `hitter-models-panel` (k-range bands, `hitter_models.json`), `batted-ball-panel` and `spray-explorer` (per-ball xwOBA overlay after D-01). | M |
| D-28 | **3D pitches/swings + location surfaces.** PH4, PH5. | M→W | **Bake:** `pitches3d/{role}/{id}.json` from the 9-parameter trajectories plus bat tracking per swing (2023+); client kernel surfaces; value overlay after D-01/D-03. **Web:** port the three.js scene. | L |
| D-29 | **Query builder + percentile-scope toggle.** | W | Port `query-builder` (filter any board by any field) and the season/pooled percentile-scope toggle. | S |
| D-30 | **Minors depth.** | M→W | AA/A+ lines where TJStats covers them; MiLB translation matrices (inventory §B) as a descriptive "MLB-equivalent" line; AAA defense/xwOBA after D-01/D-12. | L |

## Added 2026-10-27 (owner)

| ID | Item | Lane | What "done" means | Size |
|---|---|---|---|---|
| D-31 | **Comprehensive stats: Savant + FanGraphs into models and profiles.** | M→W | The owner will supply FanGraphs exports. Steps:<br>1. Ingest them into the mart beside the `lb_*` Savant tables.<br>2. Crosswalk ids (Chadwick `register`: key_fangraphs ↔ key_mlbam).<br>3. **Profiles:** standard and advanced lines (WAR, wRC+, SIERA, xFIP, Stuff+/Location+ as published, plate discipline, batted ball, splits) beside ours, with attribution.<br>4. **Models:** test the new fields as features or benchmarks under the usual gates (e.g. SIERA is already the Pitching+ benchmark, §56; wRC+ / xwOBA benchmarks for D-01).<br>FanGraphs terms restrict republication, so confirm before any FanGraphs number is shown publicly; Savant data ships with attribution as today. | L |
| D-32 | **Player headshots, high quality.** | W | Use the MLB official headshot CDN (`img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_426,q_auto:best/v1/people/{id}/headshot/67/current`; there is also a silo / action variant). Put it in the profile header, with `next/image`, a 2× srcset, a fallback silhouette, the team-colour backdrop and lazy loading on boards (optional thumbnails). Minors use the same CDN (ids are shared). Check usage terms before going public. | S |
| D-33 | **ERA / runs correctness** (found 2026-10-27, goat-helper). | M | The runs CTE read the fielding side's score, so every site ERA and the FIP constant were wrong (Wheeler 2024 showed 5.31; official 2.57). **Fix:** runs while he pitched = `post_bat_score − bat_score` per pitch; ERA = official ER / outs from the Stats API season lines (`milb_lines.py --mlb`), with RA9 as the fallback; FIP constant = official league ERA − raw FIP. | S |
| D-34 | **Hitter depth.** | M→W | **Done 2026-10-27** (`d342146`). `pipeline/hitter_depth.py` provides Savant expected stats, batted-ball direction, bat tracking, sprint speed and batting RV/100 on boards, profiles and percentiles. Checked against the Savant boards. | M |
| D-35 | **Pitcher contact-against + season trends.** | M→W | **Done 2026-10-27** (`38ad78e`). `pitcher_depth`: xwOBA/xBA/xSLG/xwOBACON, EV, hard-hit, barrel and sweet-spot against, plus bat tracking against and RV/100 by family. `trends`: per-game rows behind TrendPanel (rolling wOBA vs xwOBA, cumulative RV) on both profiles. | M |
| D-36 | **Projection percentiles with visuals.** | M→W | **Done 2026-10-27** (`8d54c23`, `75648bf`). Pitchers: K% and Prevention+ (shown as next-season RV/100) ranges from out-of-fold misses (`proj_bands.py`, 3,275 pairs, binned by BF). Hitters: Marcel wOBA/K%/BB% passed §67 vs persistence (all 3), with measured ranges (`hitter_proj.py`, MLB only). ProjectionBand over the league's middle 80% plus percentile, on both profiles. | M |
| D-37 | **Expected-stat and run-value graphs, league view.** | W | **Done 2026-10-27** (`8d54c23`, `65fbf4e`). LeagueScatter (xwOBA vs wOBA, Savant scale, `/api/data/league-scatter`), RvFamilyBars (hitters; pitchers have it as a percentile group), percentile card PNG (`/api/card/[id]`). | S–M |

## Not porting

- /live, /fall, /reports/live, /reports/practice: TrackMan only (clean-room rule 1).
- PV+ / portal: level translation fails.
- ABStuff+: owner removed it.
- `conference` field: no MLB meaning; /teams covers league/division.

## Suggested order

1. **M lane:** D-05 (open owner ask) → D-01 → D-02 → D-03 → D-06 → D-12/D-13 → D-04 → D-17.
2. **W lane, can start now with no model dependency:** D-10, D-11, D-21, D-22, D-23 (structure), D-24, D-25, D-26, D-29, then D-07/D-09 wiring as the M artifacts land.
