# Goat-Pro Hoops: the site plan (2026-10-30)

Phase plan for the basketball site, using everything verified in
`docs/basketball-gap-map.md` and the `hoops_mart`. Same rules as baseball:
public data, pre-registered models, descriptive labels until a gate passes,
sources validated against each other before anything ships.

## Where it lives

A `/hoops` route group inside the existing goat-pro web app, reading from the
`hoops_mart` through R2 — the same pipeline shape as baseball (mart → bake →
R2 → site). One domain, one design system, one deploy; a separate domain can be
split off later if the owner wants it. Data files namespace as `hoops/...` on
R2 so the two sports never collide.

## Verified sources (basketball-gap-map.md)

| source | carries | role |
|---|---|---|
| ESPN public API | scoreboard, game summaries: PBP (487 plays/game, x/y shots), box scores | the feed — built, running (`hoops_mart/ingest_daily.py`) |
| LUMA (CourtShare) MCP | box scores 1997–2027, ARC, xpts_rapm, lineups, on/off, WOWY, 113 channels | validation + long history + model benchmark |
| pbpstats API | possessions (events, start types), shot-level with depth filters, per-game lineups, team possessions per game | RAPM inputs + validation |
| balldontlie | plays, advanced stats incl. tracking (speed/distance/touches), lineups, **contracts** (terms §6: republication allowed) | advanced + tracking + D-44/D-46 unblock — needs the owner's free `BDL_KEY` |
| nba.com hosts | PBP, shot detail, tracking | **blocked from this network**; browser-route test pending |

## The owner's spec

`docs/hoops-spec.md` is the requirements document: all regular + per-36 +
advanced stats per player and team, impact isolation (shot creation,
playmaking, rim penetration; POA vs help defense), rebounding zones with
heatmaps and vs-average, team impact with role decomposition (gravity,
passing, screening), on/off everywhere, then projections/career curves and
Savant-style percentile cards. The phases below are reordered around it:
the statistics foundation and the on/off/lineup pipeline come first because
most of the spec builds on them; projections stay last.

## Phase 1 — the data spine + first surfaces (DONE locally 2026-10-29)

1. **ESPN backfill**: 830+ summaries (2024-25 in progress via the schedule
   sweep + 2026-27 to date), resumable receipts; continues daily.
2. **hoops mart tables** (vt_baseball/hoops_mart `build_mart.py`): `games`,
   `team_game`, `player_game`, `pbp` (the possession spine; possessions are
   DERIVED later with the pre-registered RAPM build), `shots` (x/y normalized
   to the attacking half, FTs flagged). Internal audits close player points to
   team points everywhere; ESPN noise floors recorded (running-score drift
   8/831, PBP-vs-box FGA ±1-2 on ~6% of team-games — boxes canonical for
   aggregates, plays/shots for locations).
3. **Validation gate PASSED** (hoops_mart `luma_check.py`): 688/688 exact game
   scores 2024-25, 52/52 to date 2026-27, 324 player-game boxes with every stat
   100% exact except assists (scorer judgment); LUMA credited in the bake's
   meta.json. LUMA home-flag defect recorded (5 games, both rows false).
4. **First surfaces** (descriptive, baked by `pipeline/hoops_export.py` to
   `hoops/...` keys, `--check` no-op verified, `next build` gated, verified in
   the browser against the local bake):
   - `/hoops` landing (validation note + recent games + season links)
   - `/hoops/games` finder (season/type/paged, query-string state)
   - `/hoops/games/[id]` — game report: boxes, team lines, x/y shot chart
     (filters + hover), full play feed
   - `/hoops/teams` + `/hoops/teams/[abbr]` — standings and club pages
   - `/hoops/players` + `/hoops/players/[id]` — leaderboard and game logs
   Ship step when the owner wants it live: `r2_sync.py --path hoops` (data
   files stay local until then, per the local-first call).

## Phase 2 — derived models (each pre-registered before the first fit)

- **RAPM** from ESPN PBP stints (+ pbpstats possessions as the segmentation
  check), benchmarked against LUMA's `xpts_rapm`.
- **Shot quality / xPTS** from the x/y shots, benchmarked against LUMA channels.
- **Lineup grades** (from ESPN-derived lineups), checked against LUMA's
  `lineups`/`onoff`.
- **Tracking-adjacent stats** once `BDL_KEY` lands (speed/distance/touches).

## Phase 3 — the deep surfaces

Player profiles with ARC-style rating decomposition (ours), lineup explorer,
WOWY, the matchup surface — each modeled on its baseball counterpart and
gated the same way.

## What's still open

- `BDL_KEY` (owner registers at balldontlie.io) — unlocks contracts
  (D-44/D-46 basketball-side) and tracking stats.
- nba.com direct (tracking raw): browser-route test, or the owner's
  impersonation call — not needed for Phases 1–2.
- LUMA cross-feed reconciliation at scale (the paged `box_game` pull).
