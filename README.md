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
| Player profiles | Percentile panels, arsenal and pitch grades, movement and location visuals, swing (bat tracking), defense field drill with Savant clips, aging track, WAR and WPA lines, game logs, splits, printable sheet |
| Minors | AAA boards, with the MLB-trained models scored on AAA pitches (display only) |
| Prospects | MLB Pipeline lists 2011–2026 with debut tags, draft hit rates, and farm-system output by year with risers and fallers |
| Trades | Every MLB-to-MLB trade 2020–26, grouped into deals, with the run value each club got back |
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
| Control+ | shown; its walk projection is not confirmed | §55 |
| Pitching+ | shown; ties SIERA, not confirmed | §56 |
| P7 family on AAA | confirmed | §66 |
| Deception+ (bat-tracking swing disruption) | passed its pre-registered gates | `pipeline/PREREG-deception-plus.md` |
| Framing+ | confirmed against Savant (r .89–.97) | §76, `pipeline/PREREG-framing-plus.md` |
| Range runs (infield and outfield) | shipped on v3 after two failed attempts | §75, §80, §81 |
| WAR (position players and pitchers) | r .92 / .81 with Baseball-Reference WAR; team totals track wins at r .91 | §85 |
| Decision+ | descriptive: stable, but does not beat chase rate as a forecast | §69 |
| Tunnel+, platoon Whiff+ | descriptive | §73, §74 |
| Park factors (2B, 3B, HR, SO by hand) | descriptive | §70, §72 |
| Hitter Marcel projection | display-only baseline with measured ranges | §67 |
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

Code: MIT (see `LICENSE`). The Statcast and MLB data remain subject to MLB
Advanced Media's terms. Team logos are trademarks of their clubs.
