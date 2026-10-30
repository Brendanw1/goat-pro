# GOAT-Pro

An open baseball research project: pitch, pitcher, hitter, fielder and team
models built on public MLB and AAA tracking data, each one tested before it is
shown. The results are published as a website.

- **Site:** https://goatpro.dev
- **Seasons:** MLB 2020–2026 (the Hawk-Eye era; 2020 was the 60-game season),
  AAA 2023–2026. Bat tracking starts in 2023.
- **Data:** Baseball Savant (Statcast and its public leaderboards), the MLB Stats
  API, MLB Pipeline prospect lists, the Chadwick register and FanGraphs Guts
  constants. All of it is public; no proprietary or college data is used.

## What's on the site

| Section | What it shows |
|---|---|
| Pitchers / Hitters | Sortable leaderboards with the site's models beside the measured stats. Every column, and every stat with a profile percentile, can be filtered by range |
| Player profiles | Percentile panels, arsenal and pitch grades, movement and location visuals, swing (bat tracking), defense field drill with Savant clips, aging track, WAR and WPA lines, game logs, splits, printable sheet, and an MLB/AAA level toggle for players with seasons at both |
| Minors | AAA boards, with the MLB-trained models scored on AAA pitches (display only), and MLB-equivalent lines (MLEs) for AAA and AA |
| Prospects | MLB Pipeline lists 2011–2026 with debut tags, draft hit rates, and farm-system output by year with risers and fallers |
| Trades | Every MLB-to-MLB trade 2020–26, grouped into deals, with the run value each club got back |
| Postseason / Matchup | Each October 2020–26 as a bracket with series results, game reports with starting lineups, and postseason WPA and run-value leaders (`postseason.py`, bake family `postseason`); a descriptive pitcher-vs-lineup scouting view from the arsenal, hand/family splits and movement buckets |
| Would it dong | Every MLB batted ball 2020–26 flown through the 30 current parks: X/30, xHR, no-doubters / doubters, would-be HRs elsewhere, best and worst park per hitter (RESULTS-MLB §86) |
| Contact depth | Where hitters meet the ball (Statcast intercept, 2024–26): the inverted U of damage vs depth, depth by velocity and pitch type, the in-season trend, who's late on 95+; per hitter a to-scale contact cloud, his damage curve over the league's, small multiples by pitch type, a rolling trend (RESULTS-MLB §89) |
| Swing plane | Does the bat's path match the pitch's (attack angle + VAA)? League: sweet-spot rate peaks at a matched plane, and a matched plane forgives timing error; per hitter a plane map by pitch group × height with the contact it implies (Swing tab) and a Plane column on /matchup (RESULTS-MLB §90b) |
| Timing + two-strike | Swing tab: each contact's depth vs the depth the pitch, count and his own mean predict, as early/late by pitch group and on 95+ (RESULTS-MLB §92); how much bat speed, length, depth and contact he trades with two strikes, plus a ΔBS 2K column on /hitters (§93) |
| Swing Quality | A 100-scale grade of the contact quality a hitter's swings should produce (bat tracking + pitch + contact point), split into bat speed / plane / contact point / pitch diet, with results vs swing; Swing tab panel and an SQ column on /hitters; descriptive (RESULTS-MLB §98) |
| Archetypes | Two broad swing shapes from six bat-tracking traits (k-means, stable year to year), a PCA map, profiles, aging by type, and each hitter's five closest swings on the Swing tab; descriptive (RESULTS-MLB §94) |
| Roles | Role conversion (RESULTS-MLB §87): 2026 relievers who could start and starters who play up in a short burst, from real MLB role changes; descriptive (both gates failed) |
| Teams | Club pages: both sides' boards cut to one team, and team aggregates ranked against the league, with park factors |
| Defense / Framing | Our range runs and Framing+ beside Savant's OAA and framing runs |
| WPA, Aging, Fatigue, ABS, Tunneling, Arsenal, Buckets, Mechanism | Win probability, age curves, times-through-order and rest, 2026 ABS challenges, pitch tunnels, league arsenal cards, movement buckets, and the physics study behind Whiff+ |
| Savant boards | Savant's own leaderboards, re-published with attribution |
| Glossary | Every stat and model: definition, method, validation and limits |

## The models and their status

Every model has a test in `pipeline/RESULTS-MLB.md` (section numbers below),
written before the result was read. Forecast models must beat a naive baseline
at predicting next season (player-grouped folds, clustered bootstrap); value and
fielding models must match an outside reference. A model that fails ships
labelled **descriptive, not a forecast**, or does not ship.

| Model | Status | Test |
|---|---|---|
| Whiff+ (pitch shape, whiff per swing) | forecast gate passed | §34, §82 |
| K+ (strikeout projection) | forecast gate passed | §50 |
| Prevention+ (run-prevention stack) | forecast gate passed | §52 |
| Prevention+ per pitch type (Prev+ on the arsenal table) | forecast gate passed | §101 |
| Control+ | shown; its walk projection is not confirmed | §55 |
| Pitching+ | shown; ties SIERA, not confirmed | §56 |
| P7 family on AAA | confirmed | §66 |
| Deception+ (bat-tracking swing disruption) | passed its pre-registered gates | `pipeline/PREREG-deception-plus.md` |
| Framing+ | confirmed against Savant (r .89–.97) | §76, `pipeline/PREREG-framing-plus.md` |
| Range runs (infield and outfield) | shipped on v3 after two failed attempts | §75, §80, §81 |
| WAR (position players and pitchers) | r .92 / .81 with Baseball-Reference WAR; team totals track wins at r .91 | §85 |
| Would it dong (X/30 parks) | own-park HR call 96.5% on held-out seasons; xHR r .99 with Savant's Home Run Tracker | §86 |
| Contact depth: personal damage window | failed (split-half SB .21; loses to the league curve on held-out balls): panel shows the league curve; late-on-95+ read stable (SB .61, YoY .58), descriptive | §89 |
| Swing plane match (launch band, timing forgiveness, hitter cell-plane contact trait) | confirmed on 2026, 4/4 pre-registered claims (§90 failed first); descriptive, the hitter read is a contact read, not damage | §90, §90b |
| Timing residual (early/late by pitch group, 95+) | reliable (split-half SB .70–.84; sub-92 failed at .45); timing spread does not forecast K% or xwOBAcon; descriptive | §92 |
| Two-strike adaptation (ΔBS 2K) | stable (YoY r .64); bigger adapters strike out less than their whiff rate says (1.1 pp K% per SD); descriptive | §93 |
| Swing Quality (spline SQcon, small-sample add-on to Marcel) | dev 2024–25 in-season +.066 wR² at 25 BIP [+.040, +.094]; the one clean holdout (114 part-time hitter-seasons) +.091 [−.048, +.214], not confirmed; descriptive | §91, §98 |
| Swing archetypes (k-means, k = 2 by BIC) | stable (bootstrap ARI .85, 83% keep their type 2024 → 25 vs 50% chance); the type adds nothing to next-season xwOBAcon beyond bat speed (ΔwR² −.000); descriptive | §94 |
| Bat speed drift as an IL flag (CUSUM, Bayesian change point) | failed: lift 1.14–1.21 vs a shuffled-date null, not significant; not shown | §95 |
| Decision+ | descriptive: stable, but does not beat chase rate as a forecast | §69 |
| Tunnel+, platoon Whiff+ | descriptive | §73, §74 |
| Park factors (2B, 3B, HR, SO by hand) | descriptive | §70, §72 |
| Hitter Marcel projection | display-only baseline with measured ranges | §67 |
| Minor-league translations (MLEs, AAA/AA → MLB) | tested for AAA hitter K%, BB%, ISO and AA hitter BB%; provisional for AA hitter K% and AAA pitcher K%; the rest descriptive | §88 |
| Prospect model (point-in-time snapshots, LightGBM + hierarchical Bayes in NumPyro) | value ranking passed its one holdout (NDCG@100 +.076 [+.027, +.121] vs a draft/rank baseline), but a later audit found its training split biased, so that pass is withdrawn and the row stays under review until the §104 re-read (fixed splits, NUTS fit on a cloud GPU, list 2018); debut probability and the sleeper board failed (post-2020 drift; power); not shown; era recalibration pre-registered for the 2024 list after 2027 | §97, §99f, §99g, §104 |
| Our own xwOBA and xRV | not shipped (failed, diagnosed, re-tests failed) | §68, §71, §77, §78 |

`docs/model-inventory.md` has the full list, including what was tried and
dropped.

## Repository layout

| Path | Contents |
|------|----------|
| `pipeline/web_export.py` | The bake: every site family to `data/export/web/`. `--check --write` runs it twice and diffs before writing |
| `pipeline/r2_sync.py` | Uploads the bake to Cloudflare R2 (md5 diff, verifies every key) |
| `pipeline/*.py` | Model and feature builds that feed the bake (`war.py`, `trades.py`, `defense_export.py`, `framing_plus.py`, `park_factors.py`, …) |
| `pipeline/RESULTS-MLB.md` | Every model test with its pre-registered claim and verdict, failures included |
| `pipeline/PREREG-*.md`, `pipeline/results/` | Pre-registrations and the outputs behind the verdicts |
| `docs/` | Model inventory, formulas, research program, deliverables ledger |
| `web/` | Next.js site (App Router). It reads baked JSON from R2 at runtime |
| `COLLABORATION.md` | Work ledger shared by everyone working on the repo |

## Running it

```bash
# bake one family, or everything (checked twice, then written)
python pipeline/web_export.py --only pitchers
python pipeline/web_export.py --check --write

# the site against the local bake
cd web && npm install && USE_LOCAL_DATA=true npm run dev

# publish the bake (R2 keys in .env)
python pipeline/r2_sync.py --dry-run
python pipeline/r2_sync.py
```

The bake reads a local Statcast mart (DuckDB over Parquet). `pipeline/paths.py`
finds it at `~/Projects/vt_baseball/savant_mart` by default; set `SAVANT_MART`
(or `VT_ROOT`) to point at your own. Pushing `main` deploys the site on Vercel.

## License

Code: MIT (see `LICENSE`). The Statcast and MLB data — and the player headshots hot-linked from
MLB's official photo CDN (`img.mlbstatic.com`, mirrored to this bucket (mlb-headshots/, outside the bake-sync scope) as insurance by
`pipeline/headshots.py`) — remain subject to MLB Advanced Media's terms. Team logos are trademarks of their clubs.
