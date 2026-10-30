> **Moved 2026-10-29:** the basketball program lives in its own repo now —
> `~/Projects/goat-hoops` (surfaces + bake) beside `~/Projects/vt_baseball/hoops_mart`
> (feed + mart + LUMA gate). This file stays as the source investigation record.
> The former `docs/hoops-spec.md` and `docs/basketball-site-plan.md` moved with it.

# Basketball gap map (2026-10-30, day 1)

The NBA counterpart of `savant-gap-map.md`: what's reachable, what it carries, what's
missing, and the plan. Probed live today, keyless/keyed as noted, ~20 polite requests.

## What's REACHABLE from this environment

### LUMA Basketball Research (court-share.com) — the primary reachable source

The `luma` MCP server (registered 2026-10-25; key in the KB `.env` as `LUMA_KEY`,
never committed). ZCode doesn't mount it as tools, but it's a plain HTTP MCP endpoint —
initialize → notifications/initialized → tools/call with `Accept: application/json,
text/event-stream` and the `Mcp-Session-Id` header works first try. House rules: call
`start_here` first, `describe` before interpreting a metric, credit
"LUMA Basketball Research, <model>". Read-only; data version `v2-20261027`.

Warehouse views (DuckDB dialect over the `sql` tool, 15 views):

| view | rows | seasons | what it is |
|---|---|---|---|
| `box_game` | 787,949 | 1997–2027 | player-game box scores: min, FGM/A, 3P, FT, REB (o/d), AST, STL, BLK, TOV, PF, PTS, +/- |
| `box_season` | 24,766 | 1997–2027 | player-season-team totals |
| `games` | 76,078 | 1997–2027 | team-games: score, opponent, home, WL (regular + playoffs) |
| `players` / `player_seasons` | — / 15,338 | — / 1997–2027 | bios: listed position, height, weight, age per season |
| `arc_season` | 66,986 | 1998–2027 | LUMA's ARC rating (pts/100 vs league average): net/O/D + shooting, playmaking, ball-security, rebounding splits, 1–5-season windows |
| `xpts_rapm` | — | — | **RAPM, done by them**: net/pure RAPM + xPTS offensive/defensive decomposition + possessions per player-season |
| `lineups`, `onoff_season`, `wowy` | — | — | unit and on/off tables (their computation) |
| `skills_season`, `pac_season`, `channels` | — | — | 113 metric channels (skill decomposition; pace), availability by season |
| `loki`, `loki_release` | — | — | LOKI (their second model) |

**Covers from the checklist: box score ✓ (1997–2027), advanced ✓ (ARC/on-off/WOWY/
lineups/skills), RAPM ✓ as a reference (xpts_rapm — theirs, proprietary internals;
ours would be a separate build). NOT carried: play-by-play, shot-level data, tracking
rows — no such views.** Their house rules also forbid re-implementing ARC/LOKI
internals; our models get tested against theirs, same role Savant plays for baseball.

### Blocked from this environment (probed, all failed)

| host | result |
|---|---|
| `stats.nba.com` | bare UA → connection dropped; browser headers → 500 (stale season) then 403. Akamai-fronted. |
| `cdn.nba.com` (liveData: scoreboard/boxscore/playbyplay) | **403 Access Denied** on every path, curl and urllib — edge-level (IP or TLS) block |
| `data.nba.net` | dead: invalid certificate + 400 Invalid URL |

The nba.com edge blocks this network's plain fetchers entirely. The blocked hosts are
exactly where **play-by-play (`liveData/playbyplay`), shot-level (`shotdetail`),
tracking (Second-Spectrum aggregations)** live — so those three checklist items are
blocked *as endpoints from here*, not confirmed absent.

### ESPN's public API — verified reachable 2026-10-30, the PBP/shot route

`site.api.espn.com` (200s, no bot friction, plain curl): scoreboard (by date), and the
game `summary` carries **possession-level play-by-play — 487 plays for last night's
game, 175 shooting plays, each with x/y `coordinate`, `participants`, period, clock and
score state** — plus full `boxscore` (players → lineups derivable from substitution
events). That covers play-by-play ✓, shot data ✓ (charts are built from these), and
makes **our own RAPM possible** (stints + points from PBP). Etiquette: undocumented
public endpoints, same treatment as nba.com — low rate, honest UA, receipts.

## The checklist, answered (updated: ESPN closes PBP + shots)

| ask | verdict | source |
|---|---|---|
| Box score | **YES** | LUMA `box_game`/`box_season`/`games`, 1997–2027 |
| Advanced | **YES** | LUMA ARC/on-off/WOWY/lineups/skills/channels + our own derivations from box |
| RAPM | **YES as reference; ours later** | LUMA `xpts_rapm`; our own RAPM needs possession/lineup data first |
| Play-by-play | **YES** | ESPN game summaries (verified live); nba.com liveData when reachable |
| Shot data | **YES** | ESPN shot plays with x/y coordinates (verified live); nba.com shotdetail when reachable |
| Player tracking | **BLOCKED from here** | nba.com tracking endpoints only (Second Spectrum aggregates); LUMA's channels may carry tracking-derived aggregates (unverified) — the one checklist item still blocked |

## Open routes for the blocked three (in order of etiquette)

1. **Browser-context fetch**: the block is on non-browser clients; ZCode's Browser Use
   (a real browser) may pass Akamai where urllib/curl fail. If it does, the mart's
   fetcher drives a browser session for PBP/shot pages — slower but legitimate traffic.
2. **Different network**: the block may be IP-range based (datacenter/VPN ranges);
   a residential-network fetch test would confirm.
3. **curl-impersonate** (TLS fingerprint spoofing): technically possible, but
   deliberately defeating a bot block is against the house etiquette — needs an owner
   call before any use.

### balldontlie.io — verified spec 2026-10-30 (owner to register the key)

The OpenAPI spec (`balldontlie.io/openapi/nba.yml`, v1.0.0, ApiKeyAuth — free
registration) carries endpoints that overlap our gaps **and** a clean license:

- `/nba/v1/plays` — play-by-play per game (chronological, clock + score + team).
- `/nba/v2/stats/advanced` — per-player advanced incl. **player tracking (speed,
  distance, touches)**, hustle stats, defensive matchups, usage. The tracking gap.
- `/nba/v1/lineups` — starters/bench per game, 2025 season on.
- `/nba/v1/box_scores` (+ live), `stats`, `season_averages`, `standings`, `leaders`,
  `player_injuries`, `teams/players`.
- **`/nba/v1/contracts/players` / `contracts/teams` / `contracts/players/aggregate`**
  — contract data. **Their terms §6 ("Permitted Use of Data; No Approval Required")
  explicitly allows copying, storing, publishing, displaying and distributing** lawfully
  retrieved data — the clean license Cot's/Spotrac lack, which unblocks the D-44/D-46
  display question via this source.
- Paid tiers (GOAT/ALL-ACCESS): `shot_charts` (x/y per FGA — we have ESPN's free
  coordinates anyway), team season averages, odds, DFS.

Tiers: Free 5 req/min · Extended 60 · Full 600 · GOAT 600 (the pricing page's
endpoint-tier mapping needs the dashboard to verify which tier carries contracts and
v2 advanced). Owner action: register (free) and put the key in the KB `.env` as
`BDL_KEY`; the mart then probes payloads and rate ceilings live.

Also assessed: `swar/nba_api` — a wrapper over the same stats.nba.com/cdn.nba.com
endpoints the gap map already recorded as blocked from this network. Useful as
endpoint/parameter reference code when the block is solved; it does not change
reachability.

## The mart plan (mirroring savant_mart)

`hoops` mart beside `savant_mart`: `ingest_daily` (LUMA pulls: box scores via `sql`,
keyed by game_id; ratings via views), receipts + resumability + the same pause
etiquette; LUMA credit recorded on every table. First build: 2020–2026 box scores +
games, then ARC/xpts_rapm snapshots for validation anchors. Our own derivations
(movement-adjusted plus/minus style ratings, lineup nets from LUMA lineups,
hit-rate studies) follow the usual pre-registration discipline, tested against LUMA
as the external benchmark.
EOF
git add docs/basketball-gap-map.md && git commit -m "docs: basketball gap map day 1 — LUMA verified reachable (box/advanced/RAPM 1997-2027), nba.com endpoints blocked from this network, PBP/shots/tracking are the open gap" 2>&1 | tail -1 && git push 2>&1 | tail -1