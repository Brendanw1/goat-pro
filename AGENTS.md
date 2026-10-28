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
3. No leaderboard is public without a passed MLB forecast gate (season N beats
   season N's own baseline at predicting N+1), or an explicit "descriptive, not
   a forecast" label. The gate standard and the model inventory are in the
   conversion scope.
4. Player identity is the MLBAM id via the Chadwick register. Any comp view
   shows its match evidence (name, DOB, register key), never a bare name.
5. The site reads baked JSON from R2 only. It never queries the mart, the
   knowledge base, or any local store at runtime.
6. Measurement systems are not interchangeable: MLB data is Hawk-Eye optical
   (5-cam 2020–2022, extended 12-cam 2023+). Never pool eras in a model without
   the audit in `mlb-conversion-scope.md` §5.
