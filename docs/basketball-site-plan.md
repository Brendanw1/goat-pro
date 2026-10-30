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

## Phase 1 — the data spine + first surfaces (current)

1. **ESPN backfill**: the 2025-26 season, day by day (running). ~1,300 games of
   PBP + box scores. Current season continues daily.
2. **hoops mart tables**: `games` (from summaries: teams, scores, PBP counts),
   `players` (box-score lines per game), `possessions` (from plays: start type,
   events, score state), `shots` (the x/y coordinate rows).
3. **First surfaces** (descriptive, from box scores only):
   - `/hoops` landing (scores ticker, yesterday's games)
   - `/hoops/games/[id]` — the game report: box scores, PBP, shot chart from
     the x/y coordinates
   - `/hoops/teams/[abbr]` — team game list and stat aggregation
   - `/hoops/players/[id]` — game log and per-season averages
4. **Validation**: every box-score total cross-checked against LUMA's
   `box_game` for the same games (the two-source rule); LUMA credited.

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
