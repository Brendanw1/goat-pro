# Catcher defense: plan (owner ask 2026-10-30; defense depth approved 2026-10-28)

What a catcher does on defense, shown so a coach can act on it: **framing** (strikes he wins or loses),
**blocking** (pitches in the dirt kept in front), **throwing / the running game** (attempts, outs, how fast,
and who on the staff gives runners a head start). Public MLB data only: the Statcast pitch mart and Baseball
Savant's public leaderboards and their drill-down rows. No TrackMan, no college data.

## Data on hand (inventory, checked 2026-10-30)

| Need | Source | Status |
|---|---|---|
| Called pitches with location, catcher, pitcher, count, hands, pitch type | `pitches_all` (savant_mart, 2020-26) | in hand |
| Per-pitch called-strike probability | §76 framing model, `cache/framing_pitches.parquet` (catcher-grouped OOF, 2.36M pitches) | in hand; rows align 1:1 with §76's `FRAME_SQL` order, so pitcher / pitch type / hands join back without a refit |
| Framing+ board + 5x5 grids | `framing_plus.py` → `framing_plus.json` (PREREG, gates passed) | live at /framing |
| Season pop time, exchange, arm, CS above average, Savant xCS | `lb_catcher_throwing_{2019-26}` | in hand |
| Season blocks above average, xPBWP | `lb_catcher_blocking_{2021-26}` | in hand |
| **Every SB attempt** (SB, CS, held throw) with runner, pitcher, sprint speed, lead, pop time, exchange, arm, flight, accuracy, Savant exp_cs, **play_id** | Savant `leaderboard/services/catcher-throwing/{id}` (the leaderboard's own drill-down JSON) | **fetched** by `pipeline/catcher_fetch.py` → `cache/catcher/throwing_{season}.parquet` (2020-26) |
| **Every pitch with a runner on** (the blocking opportunity set): location, pitch type, ground flag, Savant xPBWP, WP/PB outcome, play_id | Savant `leaderboard/services/catcher-blocking/{id}` | **fetched** → `cache/catcher/blocking_{season}.parquet` (2021-26) |
| Pitcher leads allowed, pitcher CS above average, pickoffs | `leaderboard/pitcher-running-game` CSV (probed live; not yet in the mart) | available; per-attempt lead is already on each throw row |
| Runner sprint speed | `lb_sprint_speed` + `seasonal_sprint_speed` on each throw row | in hand |
| Video | Savant `sporty-videos?playId=` on each row's play_id | link only, never embedded or re-hosted |

Terms: Savant's public pages and CSV/JSON endpoints, fetched one request at a time 1.5 s apart, cached, receipts
so re-runs skip done work (same pattern as `savant_play_ids.py`). Catchers fetched = every `fielder_2` with 300+
pitches that season, so backups are covered, not just the qualified board.

## Gaps

- **Pitcher time to plate is not public.** Savant does not publish delivery time per pitcher or per pitch. The
  pitcher's share of the running game is shown through what is public: the lead runners take off him
  (`r_primary_lead` per attempt), attempts per opportunity, and his CS above average. Stated on the page.
- Pickoffs, balks and pickoff throws are on the pitcher-running-game CSV, not on catcher rows; the catcher view
  shows SB/CS only.
- Pre-2020: the pitch mart starts 2020, throws 2020, blocking 2021. 2026 is ABS-era (challenge system): framing
  splits for 2026 are labelled.
- No per-pitch catcher setup / glove target (not public).

## Views (Phase 1: descriptive or already validated)

All live in a **Catcher** section of the profile's Defense tab (mounted under the existing §76 framing card) and on
a **/defense/catchers** board. Every block carries a "what this tells you" caption, an n, percentile among that
season's catchers where a rank is honest, and signed colours (green = good for the catcher).

1. **Framing splits** (validated model, §76): strikes per 100 taken vs expected by pitcher hand, batter hand and
   pitch family; by edge region (top, bottom, glove side, arm side, four corners — the shadow band where framing
   lives); season trend (runs and Framing+ by year). The existing 0.25 ft grid stays; a home plate is drawn beneath
   in the catcher's view, matching the scouting card's zone.
2. **Blocking** (descriptive, with Savant's xPBWP labelled as theirs): opportunities, dirt pitches, WP+PB, rate per
   100 dirt pitches, PB+WP vs Savant expected, a dirt-pitch location map (blocked vs got by), per-pitcher table.
3. **Running game** (descriptive): attempts, SB, CS, CS%, attempts per 100 opportunities (runner on 1B/2B with the
   next base open), pop time / exchange / arm (Savant), and Savant's CS above expected labelled as theirs.
   **By pitcher**: attempts, SB, CS, mean lead allowed, mean runner speed. **Every attempt**: date, runner, pitcher,
   base, lead, runner speed, pop, result, and a **Watch** link to Savant's video page for that play.
4. **Board** /defense/catchers: per season, every catcher with framing runs (§76), blocking (WP+PB vs expected),
   throwing (CS vs expected), attempts and pop time, sortable, linking to the profile Defense tab.

## Models (Phase 2: pre-registered before any read, RESULTS-MLB)

- **xCS%** — P(CS | attempt) from runner sprint speed, lead, base, pitcher hand, pitchout/delayed flags, season.
  Deliberately **without** the catcher's own pop/arm/exchange: the catcher's credit is CS above this expectation,
  and pop/exchange/arm then explain that credit descriptively. The pitcher's part is the lead he allows (time to
  plate is not public). Catcher-grouped CV + a held-out season; baselines: league CS rate, catcher-only rate,
  Savant's exp_cs (reference). Ships only if it passes its gates.
- **Expected WP+PB (blocking)** — P(WP/PB | pitch, runner on) from location, pitch type, ground flag, pitcher hand,
  batter side, season. Same validation design; reference Savant's xPBWP and blocks above average.
- If a model fails, the views stay descriptive and say so.

**Read 2026-10-30 (RESULTS-MLB §108):** expected WP+PB passed every gate and now prices blocking on the site (Savant's
beside it). xCS% passed agreement, stickiness and the pop-time sanity check but failed calibration (G2, top decile
overconfident), so throwing stays descriptive with Savant's expected CS until a pre-registered re-test (§108a-v2:
isotonic recalibration or shallower trees).

## Out of scope here

Embedding video, pitch-clock / disengagement modelling, and catcher game-calling (sequencing credit) — the last one
has no clean public attribution.
