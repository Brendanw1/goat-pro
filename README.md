# GOAT-Pro

An open baseball research project: pitch, pitcher and hitter models built on
public MLB and AAA tracking data, each one tested before it is shown. The
results are published as a website.

- Site: https://project-p0q8t.vercel.app
- Data: Baseball Savant (Statcast), the MLB Stats API, the Chadwick register
  and FanGraphs Guts constants. All of it is public, and no proprietary or
  college data is used.

## What's here

| Path | Contents |
|------|----------|
| `pipeline/` | Python model code, feature builds and the web bake (`web_export.py`) |
| `pipeline/RESULTS-MLB.md` | Every model test, each with its pre-registered claim and verdict, including the failures |
| `pipeline/results/` | Out-of-fold predictions and test outputs behind those verdicts |
| `docs/` | Model inventory, research program, formulas and the deliverables list |
| `web/` | Next.js site: leaderboards, player profiles, arsenal, team pages and the glossary |

## How models are judged

A model reaches a public board only after it passes a forecast gate. Season N
has to beat season N's own naive baseline at predicting season N+1, using
pitcher-grouped folds and a clustered bootstrap. A model that fails the gate
either ships with the label "descriptive, not a forecast" or does not ship.
`pipeline/RESULTS-MLB.md` records each test before its result is read.

## Running it

```bash
python pipeline/web_export.py --only pitchers   # bake one family to data/export/web/
cd web && USE_LOCAL_DATA=true npm run dev       # site against the local bake
```

The bake reads a local Statcast mart (DuckDB over Parquet). `pipeline/paths.py`
finds it at `~/Projects/vt_baseball/savant_mart` by default; set `SAVANT_MART`
(or `VT_ROOT`) to point at your own.

## License

Code: MIT (see `LICENSE`). The Statcast and MLB data remain subject to MLB
Advanced Media's terms.
Team logos are trademarks of their clubs.
