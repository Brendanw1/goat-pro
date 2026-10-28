# Savant gap map — what to ingest, the exact recipes, and one critical alert

Live-verified 2026-10-25 by research agent (all endpoints are auth-free GETs;
etiquette = the mart's 1.5 s pause + receipts). Full details in the agent
report; this is the operative version.

## CRITICAL: 2026 location convention change

Per the Savant csv-docs, the 2026 CSV changed conventions: `plate_x/plate_z`
are now measured from **middle-of-plate** and `sz_top/sz_bot` are
**ABS-defined**. Every location-using model (Pitching+ plate features, hvaa
residualization, Loc+, Framing+) treats 2020–25 vs 2026 as DIFFERENT MEASUREMENT
ERAS until a conversion is validated. This extends the 2023 Hawk-Eye era audit:
**the model era boundaries are 2020–22 | 2023–25 | 2026**. Action: re-audit
plate_x/z distributions 2025 vs 2026 in the mart (a one-query check), convert
or re-reference, and re-gate. Until then, 2026 grades carry the partial-season
caveat AND a potential convention break.

## Also for the mart (cheap, immediate)

- **Postseason backfill**: 2025 + 2026 postseason missing. Fix verified:
  `statcast_search/csv` with `hfGT=PO%7C` (day-by-day, as ingest_daily).
- Bat-tracking per-pitch data is **2023+ locally** (not 2024+ as assumed) —
  the swing models' training window is bigger than planned.

## The fetch list (leaderboard CSVs, `csv=true`)

| Family | Recipe (verified) | Seasons | For |
|---|---|---|---|
| Fielding Run Value | `/leaderboard/fielding-run-value?csv=true&seasonStart=Y&seasonEnd=Y` | 2025 | defense (M6) |
| OAA + directional | `/leaderboard/outs_above_average?type=Fielder&year=Y&csv=true` | 2016+ | defense |
| Catcher framing | `/leaderboard/catcher-framing?csv=true&seasonStart=Y&seasonEnd=Y` | ~2019+ | Framing+ validate (M4) |
| Catcher blocking | `/leaderboard/catcher-blocking?season_start=Y&season_end=Y&csv=true` | 2025 | catcher family |
| Catcher throwing | `/leaderboard/catcher-throwing?game_type=Regular&season_start=Y&season_end=Y&type=Cat&with_team_only=1&csv=true` | 2019+ | catcher SB models |
| Baserunning RV | `/leaderboard/baserunning-run-value?season_start=Y&season_end=Y&csv=true` | 2019+ | baserunning (M6) |
| Basestealing RV | `/leaderboard/basestealing-run-value?season_start=Y&season_end=Y&csv=true` | 2025 | same |
| Extra bases taken | `/leaderboard/baserunning?game_type=Regular&season_start=Y&season_end=Y&type=Cat&with_team_only=1&csv=true` | 2025 | same |
| Sprint speed | `/leaderboard/sprint_speed?year=Y&csv=true` | 2015+ | same |
| Bat tracking (agg + swords) | `/leaderboard/bat-tracking?csv=true&seasonStart=Y&seasonEnd=Y&type=batter` | **2023+** | swing models backfill (M4) |
| Swing/Take run values | `/leaderboard/swing-take?year=Y&csv=true` | 2024+ | Decision+ (M4) |
| Active spin % | `/leaderboard/active-spin?year=Y&csv=true` | 2025 | Stuff+ spin physics |
| ABS challenges | `/leaderboard/abs-challenges?csv=true` | 2026 only | ABS modeling |
| Expected stats | `/leaderboard/expected_statistics?type=batter&year=Y&csv=true` | — | validation only |

Derivable locally (do NOT download): per-type arsenals/movement history,
arm-angle/extension aggregates, pitcher run values, expected stats.
Skip: movers/monthly/rolling/tempo/percentile-rank leaderboards.

## The param traps (verified)

- **camelCase family** (`seasonStart/seasonEnd`): bat-tracking, framing,
  fielding-run-value — `?year=` is SILENTLY IGNORED (returns current season).
- **snake family** (`season_start/season_end`): blocking, throwing, baserunning.
- **`?year=` honored**: OAA, sprint_speed, swing-take, pitch-movement,
  arsenals, arm-angles, active-spin, expected statistics.
Test every new endpoint with a known-old season before trusting it.

## Gamefeed extras (per-game JSON, for ABS + framing)

`statsapi.mlb.com/api/v1.1/game/{gamePk}/feed/live` adds per-pitch
`strikeZoneWidth/Depth`, `plateTime`, `endSpeed`, `typeConfidence`,
`breaks.breakY/breakVerticalInduced`, and the 2026 ABS state
(`gameData.absChallenges`, per-play `about.hasReview`).

## Minor-league Statcast (probed 2026-10-25)

Endpoint: `statcast-search-minors/csv?all=true&type=details&player_type=pitcher&minors=true&hfLevel=<LVL>%7C&hfSea=<YYYY>%7C&game_date_gt=<D>&game_date_lt=<D>`
— same 119-column schema as the MLB CSV (nine parameters, `delta_run_exp`, extension, spin).

| Level | Coverage (one-day probe) |
|---|---|
| AAA | every park, ~4,400–4,800 pitches/day, 99.7% tracked; 2023 and 2025 both full |
| AA, A+ | nothing (0 rows) |
| A | Florida State League parks only (BRD, DBT, FTM, PMB, SLU), 83% tracked |

84 of 129 AAA pitchers on 2025-05-06 also pitched in MLB in 2025, which makes AAA
the follow-up population for MLB demotions (small-sample survivorship, RESULTS-MLB §9, §15).
In the mart since 2026-10-25 (view `pitches_aaa`, 2023–26). Comparability audit: RESULTS-MLB §14.
