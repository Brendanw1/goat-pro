# Service time and team control: the D-44 v1 estimator

**Unofficial estimates from MLB Stats API transactions; not contract data.** Shown on `/rosters`
as "Service (est.)" and "Control thru (est.)", and as context text on the trade-candidates rows
(it does not enter that rule). Code: `pipeline/service_time.py` (`--fetch`, `--demo`).
Output: `data/service/service_est.parquet` (one row per player with MLB-roster time 2010+).

## Source and etiquette

Only the public MLB Stats API (`statsapi.mlb.com`), individual non-commercial use, attributed per
its copyright notice ("Copyright MLB Advanced Media, L.P. Use of any content on this page
acknowledges agreement to the terms posted here http://gdx.mlb.com/components/copyright.txt").
Three endpoints, cached under `cache/service/` (gitignored), 1 s pause, one User-Agent naming the
project, backoff on 429/5xx:

- `seasons/{y}?sportId=1` — regular-season start and end;
- `teams/{id}/roster?rosterType=40Man&date={opening day}` — the seed, 30 clubs × 2010–2026;
- `transactions?sportId=1&startDate&endDate` — one month per call.

Incremental: closed months and past seeds are pulled once; the two latest months re-pull.
Never scraped or copied: Baseball-Reference / Sports Reference, Spotrac, Cot's, FanGraphs
RosterResource, USA Today. Spotrac and Cot's are linked for salaries, options and no-trade clauses.

## Method

1. **Seed** each season from the opening-day 40-man: status A = active, D7/D10/D15/D60 (and
   paternity / bereavement) = injured list, RM/MIN = optioned, anything else = off. Re-seeding every
   season means a parse miss cannot carry across a winter.
2. **Walk** that season's transactions in date order (the logged `date`; `effectiveDate` is
   sometimes stamped with the next move's date). Only moves made by an MLB
   club count (affiliates keep their own injured lists):
   selected / recalled / purchased-from-affiliate / activated / reinstated → **active**;
   placed on or transferred to the IL, paternity, bereavement → **IL (still service)**;
   optioned, or reassigned to the minor leagues → **optioned**;
   designated for assignment → **DFA (service until resolved)**;
   outrighted, released, Rule 5 returned, restricted list, suspended, retired → **off**;
   waiver claim by an MLB club → active unless an option follows; trades carry the state over.
3. **Service days** = championship-season days active, on the IL or in DFA limbo, capped at 172 per
   season. 2020 is prorated to 172 (60-game season). A Rookie of the Year (2022+) is credited a full
   year for his rookie season (the CBA's prospect-promotion incentive; top-100 status assumed).
   Players missing from a seed but up at the end of the prior season with no release/option since
   carry over as active (the feed's 40-man omits a few, e.g. Valdez in 2022–23).
   Displayed as years.days (172 days = 1 year).
4. **Option years used** = seasons with ≥ 20 optioned days (shown in the data as `opt_years`; not on
   the page — options remaining depend on rules the API does not carry, e.g. the fourth option).
5. **Arbitration clock**, applied winter by winter from 2010: 3.000–5.171 is arbitration-eligible;
   **Super Two** = the top 22% by total service among players with 2.000–2.171 and ≥ 86 days in the
   season just ended. A former Super Two therefore reaches arb-4. Status after the last season:
   pre-arb, arb-1..3, arb-4+ (a Super Two or slow accruer), 6+ (pre-MLB for 40-man players with no service).
6. **Control through** = the last season before 6.000 assuming a full year from here
   (`last season + ceil((1032 − days) / 172)`). Players at 6+ read "contract": their control is
   whatever their contract says. Debuts before 2010 are reported 6+ without a walk.
7. **Uncertain** (`~` on the page): the walk hit ≥ 2 contradictions (e.g. recalled while already up,
   optioned while not on the roster), or the estimate is within 15 days of a boundary (2.000, 3.000,
   6.000 or the Super Two cut).

## Error sources

- **Missing or late transactions.** The feed occasionally omits a recall or logs it on the next
  day; each miss shifts days until the next logged move. Shuttle players (many option/recall
  cycles) accumulate these errors; that is what the contradiction flag catches.
- **Logged vs effective dates; retroactive IL placements.** The logged date is used; IL backdating
  does not change service (IL counts) but option backdating can.
- **Short options.** Options under 20 days are not credited here; if MLB credits some, shuttle
  players are undercounted.
- **Day-of-move conventions.** The day of an option counts as off here; MLB's counting can differ
  by one day per move.
- **Grievances, settlements, the 2022 lockout credit, PPI service beyond Rookie-of-the-Year winners (e.g. top-3 MVP) and
  manual adjustments** are invisible to the feed.
- **Super Two cut** is computed from our own estimates of everyone else, so error in the class
  moves the cut.
- **Contracts override control.** Extensions, club options and opt-outs change the real free-agent
  year; that is why the page says "control thru (est.)" and links Spotrac / Cot's.

## Validation (2026-10-30)

**Spot check: 15 of 16 hits** on the season after which each player reaches 6.000 (his service-time
free-agency year), against free-agency years in MLB.com reporting / public record. Players whose
FA year was set by an extension were not used (Blake Snell was dropped from the first list for that
reason: his 2019 extension, not service, made him a free agent after 2023).

| player | debut | est. FA after | public | |
|---|---|---|---|---|
| Shohei Ohtani | 2018 | 2023 | 2023 | hit |
| Willy Adames | 2018 | 2024 | 2024 | hit |
| Juan Soto | 2018 | 2024 | 2024 | hit |
| Pete Alonso | 2019 | 2024 | 2024 | hit |
| Corbin Burnes | 2018 | 2024 | 2024 | hit |
| Max Fried | 2017 | 2024 | 2024 | hit |
| Bo Bichette | 2019 | 2025 | 2025 | hit |
| Kyle Tucker | 2018 | 2025 | 2025 | hit |
| **Framber Valdez** | 2018 | **2024** | 2025 | **miss** (2018–19 shuttle years overcounted) |
| Dylan Cease | 2019 | 2025 | 2025 | hit |
| Tarik Skubal | 2020 | 2026 | 2026 | hit (2020 proration) |
| Jazz Chisholm Jr. | 2020 | 2026 | 2026 | hit |
| George Kirby | 2022 | 2028 | 2028 | hit |
| Elly De La Cruz | 2023 | 2029 | 2029 | hit |
| Paul Skenes | 2024 | 2029 | 2029 | hit (ROY full-year credit) |
| Wyatt Langford | 2024 | 2029 | 2029 | hit |

**Honest caveat: three rules were set while looking at this list**, so 15/16 is partly in-sample.
(1) The logged `date` replaced `effectiveDate` after Burnes' 2018 selection read "effective
2019-04-19"; (2) the Rookie-of-the-Year full-year credit was added for Skenes; (3) a credit for
options under 20 days was tried and dropped — it overcounted Fried and Valdez (14/16 with it). A
fourth fix was a parse bug (activation *from* the restricted list read as a placement; Cease 2022).
A fresh set of players is the right next check.

**Out-of-sample day check (2026):** the walk's active+IL days from 2026-08-08 to season end vs the
mart's daily 40-man snapshots (51 days, 1,353 players): **mean absolute error 1.09 days, 86.9%
exact, 95.6% within 3 days, bias +0.12 days.**

**Status shares, 40-man rosters as of 2026-10-29 (1,310 players):** pre-arb 51.5%, arb-1 9.7%,
arb-2 8.5%, arb-3 5.5%, arb-4+ 2.2%, 6+ 21.1%, pre-MLB 1.5%; 102 estimated Super Twos; **35.0% flagged
uncertain** — mostly full-season players sitting exactly on a year boundary (3.000, 6.000) or near
a Super Two cut, where a single missed day changes the class.

## Contracts CSV (schema stub, no data)

If the owner later adds hand-sourced contract rows, they go in `data/contracts/contracts.csv`,
one row per player-season, every row with its own public source URL:

| column | type | meaning |
|---|---|---|
| `mlbam_id` | int | Stats API person id |
| `season` | int | contract season |
| `club` | str | site abbreviation (NYY, SEA, ...) |
| `base_salary` | int | USD |
| `signing_bonus_prorated` | int | USD share in this season |
| `option_type` | str | `club` / `player` / `mutual` / `vesting` / empty |
| `option_value` | int | USD, if an option year |
| `buyout` | int | USD, if any |
| `no_trade` | str | `full` / `partial` / empty |
| `source_url` | str | the public page the row was read from (required) |
| `retrieved` | date | when it was read |

Nothing in the pipeline reads this file yet.
