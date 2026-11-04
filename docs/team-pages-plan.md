# Team pages: six tabs with the full organization (plan, owner go 2026-11-04)

Owner ask (2026-11-04): put every minor-league level on the team pages with the stats and models we have — top
prospects by team, org leaderboards (e.g. top Whiff+ in the org), depth by position across all levels, affiliate
stats like the MLB ones. All six tabs, fully integrated, Rookie and complex levels included. This builds model
inventory item 0b's site half (Overview / Roster / Identity / Farm / Draft / Trades). R1 (prospect skill layer) waits
until this ships.

## Resume protocol (read first if picking this up mid-way)

1. `git log --oneline -15` and the checklist below: every finished step is ticked with its commit.
2. `git status` before any bake; commit only this plan's files (shared tree, other agents).
3. The COLLABORATION.md row "Team pages: six tabs" holds the claim; update it when a phase lands.
4. Each phase ends with the bake checked locally and the page verified in the browser before the next starts.
5. Publish (R2 sync + Vercel deploy) only at the end of a phase whose checks pass (owner-authorized flow:
   `web_export.py --check --write`, `r2_sync`, deploy).

## Rules that bind every tab

- Public data only (Stats API lines, fielding, transactions, draft; Savant AAA mart; Pipeline lists quoted).
- AGENTS rule 1: no college names. The Draft tab shows `school_class` (HS / 4-year / junior college) as a category
  and never the `school` field.
- AGENTS rule 3: every model number carries its status. MLB-trained models scored on AAA keep their existing
  "display only" tip; Stats API rates are "descriptive". No new model ships here except through a pre-registered read
  (Identity's test, below).
- No ABStuff+ anywhere (owner rule). Whiff+ is the shape grade shown.
- MiLB consumers apply the F3 exclusions where play-by-play is used: no Mexican League (unaffiliated; it rides
  sportId 11), no non-PA plays. The season lines used here already carry affiliated leagues only; check this in the
  bake (league_name != MEX).
- Every count shown with its n; small samples flagged by the site's existing floors.
- Docs travel with the change: glossary entries, `docs/formulas.md` for any new formula, README model table if a
  model's status changes.

## Data (all on disk)

| piece | source | notes |
|---|---|---|
| affiliate → org | `data/milb/team_orgs.parquet` (season, team_id, org_id, league_id, venue_id; 2010–26) | org_id → site abbr via the existing team map in `web_export.py` |
| season lines, all levels | `data/milb/hist_hitters/hist_pitchers` (2010–19) + `hitters/pitchers` (2021–26) | sportId 11 AAA, 12 AA, 13 High-A (A+), 14 Single-A (A), 16 Rookie (ACL, FCL, DSL) |
| positions | `data/milb/fielding.parquet` (player, season, team, pos, G, inn) | depth by games/innings at each position |
| AAA Statcast models | the AAA bake (`getPitchers("aaa")`, `getHitters("aaa")`), 2023+ | Whiff+, K+, Prevention+, CSW, xwOBA, EV90, barrel% |
| MLEs | `translation/*.json` (§88), AAA + AA | MLB-equivalent K%, BB%, FIP, ISO, wOBA |
| Pipeline ranks | `prospects/{year}.json`, `prospects/farm.json`, `prospects/value.json` | quoted with source |
| MLB club | existing team-page data (pitchers, hitters, parks, games, coaches) | becomes the Overview tab unchanged |
| 40-man, service, moves | `rosters40/teams.json`, `rosters40/moves.json` | Roster tab |
| transactions | `data/milb/transactions_full.parquet` (F4, 2011–26, all levels) | IL stints, promotions, Trades tab context |
| trades | `trades/{season}.json` (`pipeline/trades.py`) | Trades tab |
| draft | `data/milb/draft_full.parquet` (id, year, pick, round, school_class, bonus, slot, birth_country) + draft hit rates | Draft tab |
| WAR | §85 own WAR and `line_war.parquet` | trade and draft value, labelled descriptive |

## Bake design

One new bake family `orgs` in `pipeline/web_export.py`, its code in a new `pipeline/org_export.py` (the
`minors_export.py` pattern) so web_export grows by a call, not by hundreds of lines. Keys, per club and season:

- `orgs/index.json` — clubs, seasons, affiliates per season (level, team, league), counts.
- `orgs/{abbr}/{season}/farm.json` — affiliates with team lines + level ranks; org leaderboards; top prospects.
- `orgs/{abbr}/{season}/depth.json` — position × level grid.
- `orgs/{abbr}/draft.json` — every class 2011–26 for the club.
- `orgs/{abbr}/identity.json` — the descriptive profile (and, after its read, the test result).
- Roster and Trades read the existing `rosters40/*` and `trades/*` keys, filtered by club on the page; no new keys
  unless a phase finds one is needed (then it is added here first).

Web: `web/lib/data.ts` loaders for the new keys; the team page gets a tab bar, tab state in the query string
(`?tab=farm&season=2026`) so the existing ISR rewrite (`web/proxy.ts`) caches each tab; `teams/[abbr]/view.tsx` keeps
the Overview content and each tab is its own component file in `teams/[abbr]/`.

## The six tabs

### 1. Overview (the current page)
Everything shown today, unchanged: staff and lineup aggregates with the 30-team dot strips, rotation vs bullpen,
pitcher and hitter boards, park factors, recent games, coaches. Add one strip at the top: the club's affiliates this
season with a one-line record of each (level, team, W-L if the lines carry it, else team K-BB% and OPS ranks), linking
to the Farm tab.

### 2. Roster
- The 40-man from `rosters40/teams.json` (service time, options, control — already estimated by D-44, labelled as an
  estimate), grouped by role.
- Where each 40-man player played this season by level (games at MLB / AAA / AA / ...).
- Injured list now and this season's IL stints (from `transactions_full`).
- Offseason moves for the club (`rosters40/moves.json`).

### 3. Identity
- Stage A (descriptive, ships): the org's profile as z-scores against the league, with n: MLB hitters (K%, BB%,
  ISO, GB/FB, pull%, chase, contact, EV), MLB pitchers (arsenal mix, velo, Whiff+, zone%, GB%), the farm (age for
  level, K%, BB%, ISO by level), the draft (share HS / 4-year / JC, rounds, bonus vs slot). Each block is a dot strip
  against the 30 clubs. Labelled "descriptive".
- Stage B (research, its own pre-registered read in RESULTS-MLB before anything about "identity" is claimed): do orgs
  have a stable tell? Test: a classifier that guesses the club from a player's profile, against permuted-label
  chance, with season-to-season stability. Until the read lands the tab says "identity test pending" under the
  profile. This is the one model work item in the plan.

### 4. Farm
- Affiliates table: each level's club with team K%, BB%, K-BB%, ERA/FIP (pitching) and OPS, ISO, K%, BB% (hitting),
  ranked against the other clubs at that level (dot strips like the MLB section).
- Org totals across all affiliates, ranked 1–30.
- Top prospects: the club's Pipeline-ranked players (rank, FV-free, quoted), each with current level, age vs the
  level's median, the season line, MLE where AAA/AA, AAA Statcast grades where they apply, and the IL flag.
- Org leaderboards across levels, filterable by level: hitters (OPS, ISO, K%, BB%, age-adjusted context), pitchers
  (K-BB%, FIP, K%), and AAA-only Statcast boards (Whiff+, K+, Prevention+, xwOBA, EV90, barrel%) marked AAA only.
- Link every player to `/minors/player/[id]` (or the MLB profile).

#### 4b. Farm → Depth view (a sub-view inside Farm, so the tab bar stays at the owner's six)
- Grid: rows C, 1B, 2B, 3B, SS, LF, CF, RF, DH, SP, RP; columns MLB, AAA, AA, A+, A, Rookie (ACL / FCL / DSL listed
  separately inside Rookie).
- Each cell: players by games (pitchers: SP by GS, RP by relief G) at that spot that season, with age, games, and one
  key stat (OPS or K-BB%), Pipeline rank badge if ranked.
- A player in several cells (multi-position, promoted mid-season) shows in each with his games there; a filter for
  "primary position only".
- Season selector; the current season as of the last line date.

### 5. Draft
- Every class 2011–26: pick, round, player, school_class, bonus vs slot, and outcome so far: highest level reached,
  MLB debut (yes/year), WAR to date (§85, descriptive), current status (active org / traded / released).
- Summary vs league: share reaching AA / AAA / MLB by round band against all clubs (the draft hit-rate table, by
  club), bonus spent vs pool share.
- Trades out: drafted players later traded, linked to the Trades tab.

### 6. Trades
- The club's trades by season from `trades/{season}.json`: who left, who arrived, with the level they were at and
  WAR since (§85, descriptive), plus prospects moved with their Pipeline rank at the time.
- Deadline window highlight (the trades page already computes it).


## Checklist (tick with the commit hash)

Phase 0 — groundwork
- [ ] P0.1 Claim in COLLABORATION.md; this plan committed.
- [ ] P0.2 `org_export.py`: affiliate → org map per season (incl. Rookie ACL/FCL/DSL), checks: every affiliated team
  in the lines maps to exactly one org per season; 30 orgs × levels counts written to `orgs/index.json`.
- [ ] P0.3 Tab bar + query-string tab state on `/teams/[abbr]`; Overview = today's page, unchanged; build passes.

Phase 1 — Farm + Depth (the owner's first ask)
- [ ] P1.1 Bake `orgs/{abbr}/{season}/farm.json` (affiliates + ranks, org totals, top prospects, leaderboards).
- [ ] P1.2 Farm tab UI; browser-verified on 3 clubs (one deep farm, one thin, one with a DSL-heavy roster).
- [ ] P1.3 Bake `depth.json`; Depth UI; browser-verified; spot-check 5 players' games vs the fielding table.
- [ ] P1.4 Overview affiliates strip.
- [ ] P1.5 Glossary + docs; publish phase 1.

Phase 2 — Roster + Trades
- [ ] P2.1 Roster tab from `rosters40` + levels played + IL from `transactions_full`.
- [ ] P2.2 Trades tab from `trades/*` filtered by club, WAR since, ranks at the time.
- [ ] P2.3 Docs; publish phase 2.

Phase 3 — Draft
- [ ] P3.1 Bake `orgs/{abbr}/draft.json` (classes, outcomes, hit rates by club vs league).
- [ ] P3.2 Draft tab UI; rule-1 check (no `school` field anywhere in the bake output).
- [ ] P3.3 Docs; publish phase 3.

Phase 4 — Identity
- [ ] P4.1 Stage A profile bake + tab (descriptive).
- [ ] P4.2 Stage B pre-registration in RESULTS-MLB (owner OK before any fit).
- [ ] P4.3 Stage B read once; result on the tab with its verdict; docs; publish.

Phase 5 — close
- [ ] P5.1 Top nav: decide with the owner whether /prospects, /trades, /rosters stay as league-wide pages (they keep
  their league views; the team tabs are the per-club views).
- [ ] P5.2 model-inventory 0b updated (site half done; Identity research status); COLLABORATION row closed.

## Open questions for the owner (asked as they come up, defaults in brackets)

- Depth as its own tab instead of a Farm sub-view [no: six tabs as asked].
- Identity Stage B: run in this program [yes, after Phase 3], or leave as research for later.
- Top nav: keep the league-wide /prospects, /trades, /rosters pages [yes].
