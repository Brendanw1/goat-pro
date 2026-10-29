# GOAT-Pro

Public MLB analytics site: BaseballGOAT's models and pages, rebuilt on public
data only, deployed for anyone to read.

Read before any work: `docs/multi-sport-quantitative-analytics-master-blueprint.md`
(the program blueprint), `~/Documents/BaseballGOAT-scopes/mlb-conversion-scope.md`
(the conversion scope), and `~/Projects/vt_baseball/savant_mart/README.md` (the
data layer).

## Clean-room rules (hard)

1. Everything shipped — data, baked JSON, trained model artifacts — derives from
   public sources only: Baseball Savant, MLB Stats API, Chadwick register,
   FanGraphs Guts. No TrackMan data, no college-trained model weights, no
   college names or college-derived grades.
2. Keys live in `.env` (gitignored) or Vercel environment variables. Never in
   the repo, never in client code.
3. No model is public without a test pre-registered in `pipeline/RESULTS-MLB.md`
   (or a `pipeline/PREREG-*.md`) before its result is read. Forecast models must
   pass an MLB forecast gate (season N beats season N's own baseline at
   predicting N+1); value and fielding models (WAR, range, framing) must match
   an outside reference. Anything else ships with an explicit "descriptive, not
   a forecast" label or not at all. A failed gate gets a data vs handling vs
   modeling diagnosis. The status of every model is in `README.md` and
   `docs/model-inventory.md`.
4. Player identity is the MLBAM id via the Chadwick register. Any comp view
   shows its match evidence (name, DOB, register key), never a bare name.
5. The site reads baked JSON from R2 only. It never queries the mart, the
   knowledge base, or any local store at runtime.
6. Measurement systems are not interchangeable: MLB data is Hawk-Eye optical
   (5-cam 2020–2022, extended 12-cam 2023+). Never pool eras in a model without
   the audit in `mlb-conversion-scope.md` §5.

## Working rules

- **Shared tree.** More than one agent works here. Claim work and log what
  shipped in `COLLABORATION.md`; run `git status` before a bake and commit only
  your own hunks.
- **Bake, check, publish.** `pipeline/web_export.py --check --write` (it holds
  `data/export/web/BAKE_LOCK`; one bake at a time), then
  `pipeline/r2_sync.py --dry-run` and `pipeline/r2_sync.py`. Pushing `main`
  deploys the site.
- **Docs travel with the change.** A new stat, model or page updates the
  glossary (`web/app/(dashboard)/glossary/page.tsx`), `docs/formulas.md` where
  there is a formula, and the README's model table in the same commit.
- **Seasons.** MLB 2020–2026, AAA 2023–2026; bat tracking 2023 on.

