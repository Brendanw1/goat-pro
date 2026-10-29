# College port audit: MLB-only advanced stats → BaseballGOAT (TrackMan)

Written 2026-10-29. Owner-queued audit (the "MLB-unique stats audit for college" after
the teams/trades work). It lists the advanced stats goat-pro has because of Statcast and
the Savant leaderboards, says which are worth having, and judges which could be rebuilt
on college TrackMan data for the college site (`~/Projects/vt_baseball/BaseballGOAT`).
This is a desk audit: nothing was run, nothing in vt_baseball was changed.

## Sources and what was checked

- **Evidence of value.** Our own verdicts in `pipeline/RESULTS-MLB.md` (cited as §N),
  `pipeline/PREREG-*.md` with `pipeline/results/*.json`, and `docs/model-inventory.md`.
  Where we have no test, the public literature is named (Savant/MLBAM methodology
  pages, Nathan, Tango, FanGraphs).
- **College inputs.** The canonical column list the brief points to,
  `vt_baseball/.claude/skills/senior-baseball-analyst/SKILL.md`, **no longer exists**
  (`.claude/skills/` holds only the R/Shiny skills). The warehouse schema
  `vt_baseball/trackman_data/compat_schema.txt` was used instead. It has: pitch tracking
  (RelSpeed, SpinRate, SpinAxis, Tilt, RelHeight/Side, Extension, IVB/HB, VAA/HAA,
  ZoneSpeed, ZoneTime, EffectiveVelo, the nine parameters), batted ball (ExitSpeed,
  Angle, Direction, Bearing, Distance, LastTrackedDistance, HangTime), game state
  (Inning, Outs, Balls, Strikes, OutsOnPlay, RunsScored, PlayResult), and **catcher
  throws (ThrowSpeed, PopTime, ExchangeTime, TimeToBase)**. Bat tracking is outside the
  compat schema: 2026 D1 only, 48 parks, 35,336 contacts, contacts only
  (`research/contact-depth/RESULTS.md`), and an owner rule (2026-10-28) keeps TrackMan
  bat tracking **inside the contact-depth explorer only**. Fall Blast (sensor) covers VT
  fall swings. No fielder start positions, no runner tracking or sprint speed, no
  Hawk-Eye pose, no ABS.
- **College already has it?** Grepped BaseballGOAT `scripts/`, `R/`, `defense/`,
  `web/lib`, `web/components`, and the glossary (`web/app/(dashboard)/glossary/page.tsx`),
  plus `vt_baseball/research/`.

Difficulty: **S** (days, existing bake), **M** (a new bake + one gate), **L** (new data
source or a multi-gate model). Value: what it adds to the college site for scouting,
portal and player-dev use, given what the site already shows.

## The audit

### Defense

| Stat | Measures | Evidence it is valuable | Inputs | TrackMan has? | College has? | Port |
|---|---|---|---|---|---|---|
| **OAA / range** | Outs made above a catch/convert probability | Ours: v3 confirmed vs Savant OAA, IF r .58, OF r .72 (§81); v1/v2 failed without start positions (§75, §80) | Batted ball, fielder start position, hang time, fielder identity | Batted ball + HangTime yes; start positions no; fielder from Sidearm PBP | **Yes**: IF/OF OAA (`BaseballGOAT/defense/`, research repo `baseballDefense`), hang time already in the drill | Done. Lesson to carry: §75→§81 showed start position is most of the IF signal, so college IF OAA should keep its wide intervals. No port. |
| **Framing** | Called strikes above a location-only model, priced in runs | Ours: Framing+ r .946 vs Savant, YoY .602 vs Savant .600 (`results/framing_plus.json`) | Taken pitch location, count, umpire, catcher | Yes (PlateLoc, Catcher, count) | **Yes**: Framing+, Fall framing, Receiving & Blocking | Done (college Framing+ is the original). |
| **Blocking** | Wild pitches + passed balls below expected | Public: Savant blocking leaderboard (2025, runs) | Pitch location, pitch type, runners on, WP/PB outcome | Location yes; runners via base-state from PBP | **Yes**: blocks above expected | Done. |
| **Throwing / pop time** | Catcher arm tools; Savant adds CS above average and runs | Public: Savant catcher throwing (pop, exchange, arm, CS above avg with runner speed) | Pop, exchange, throw speed, accuracy, runner speed, lead | Pop/Exchange/ThrowSpeed/TimeToBase **yes**; runner speed no | **Tools only**: Throwing+ "not a run-value metric" | **M**. Add a runs layer: CS above expected from pop + TimeToBase + pitcher, runner's prior SB rate in place of sprint speed. Value medium (catchers are a portal position). |

### Baserunning

| Stat | Measures | Evidence | Inputs | TrackMan has? | College has? | Port |
|---|---|---|---|---|---|---|
| **Sprint speed** | ft/s in the fastest one-second window | Public: Savant; large aging/defense literature | Runner tracking | **No** | No | Not portable. No proxy in TrackMan (no home-to-first). |
| **Baserunning RV** (XBT, SB/CS runs, outs on bases) | Runs from taking extra bases and steals vs average | Public: Savant baserunning/basestealing RV; FanGraphs BsR. goat-pro shows Savant's boards (COLLABORATION 2026-10-28) | Base-out states before/after each play, play type, hit location | Base state from PBP (`trackman_data/base_state_2025.parquet`, Sidearm PBP used by defense); hit Bearing/Distance yes | Partial: portal WAR uses only 0.187·SB − 0.423·CS | **M**. XBT runs (1st→3rd on singles, 2nd→home, 1st→home on doubles) vs a league table, plus SB/CS runs. No speed term. Value medium; also fills the WAR baserunning hole. |

### Bat tracking

| Stat | Measures | Evidence | Inputs | TrackMan has? | College has? | Port |
|---|---|---|---|---|---|---|
| **Bat speed, swing length** | Sweet-spot speed; head path length | Ours: stable pitcher-side traits (§21: split-half .52–.89); Deception+ built on them passed (`results/deception_plus.json`) | Per-swing bat tracking, every swing | 2026 D1, 48 parks, **contacts only**; camera bat speed r .04 vs Blast within hitter-game | Explorer only (owner rule); Fall Blast P90 metrics | **Blocked**: owner rule + coverage + whiffs missing. Revisit only if TrackMan coverage reaches most D1 parks and includes misses. |
| **Attack angle / ideal AA** | Bat path angle at contact; share of swings 5–20° | Public: Savant ideal attack angle (2025); Driveline | Bat tracking | Same as above (VertAttackAngle on contacts) | Fall: Range in-range%, attack angle vs tilt (Blast) | Blocked for games (rule). Fall/Blast version exists. |
| **Squared-up, blasts** | EV as a share of max possible from bat + pitch speed; blast = squared-up + fast | Public: Savant (2024); college fall uses the Nathan/Driveline smash form | Bat speed, pitch speed, EV | Bat speed blocked | **Yes (fall)**: Smash factor and squared-up rate (Blast) | Done for fall. Game version blocked. |

### Pitch physics

| Stat | Measures | Evidence | Inputs | TrackMan has? | College has? | Port |
|---|---|---|---|---|---|---|
| **Arm angle (measured)** | Shoulder-to-hand angle at release from pose | Ours: measured arm_angle adds to Stuff+ CSW% in 2 of 3 out-of-time pairs (§24); college null was "data-limited (a proxy angle)" | Hawk-Eye skeletal | **No** | Estimated slot from release + height (glossary "Arm slot") | Not portable. The college estimate is the ceiling. |
| **Active spin / spin efficiency** | Share of spin that makes movement | Public: Savant active spin (Nathan's method, from movement + spin rate) | Spin rate, movement, velo | **Yes** (Savant's own original method uses only these) | Computed as a Stuff+ input (`scripts/bake_pitching_plus_games.py` `spin_eff`, `web/lib/physics.ts`), shown only in the pitch grader | **S**. Promote to a per-pitch-type display column. Value low-medium (dev/coach vocabulary, not a grade). |
| **Spin axis / seam-shifted wake** | Observed axis minus movement-implied axis | Ours: stable trait (§16, YoY .70–.94) but rejected as a Stuff+ input under the honest harness (§20) | Measured (3D) spin axis independent of movement | **No**: TrackMan SpinAxis is movement re-expressed (§16) | "Spin axis for the slot" (tilt vs slot, a different idea) | Not portable, and not worth it on MLB evidence either. |

### Expected stats and decisions

| Stat | Measures | Evidence | Inputs | TrackMan has? | College has? | Port |
|---|---|---|---|---|---|---|
| **xwOBA** | Contact quality → wOBA | Ours: our spray-aware xwOBA failed twice vs Savant's EV/LA (§68, §77): spray makes it more descriptive, less predictive. College: xwOBA is the one hitter metric that cleared the naive floor | EV, LA (+K, BB) | Yes | **Yes** | Done. Do **not** add spray to college xwOBA (§77 is the reason). |
| **xBA / xSLG** | Same surface, hit / total-base targets | Public: Savant expected stats; standard in every scouting card | EV, LA | Yes | xBA only as "Hit chance" in the spray explorer; no xSLG anywhere | **S**. Two columns off the existing EV×LA surface. Value medium: the most-asked-for familiar numbers. Label descriptive. |
| **Swing/take run value** | Run value of decisions by Heart/Shadow/Chase/Waste | Ours: Decision+ r .52 with Savant swing/take; reliable but not a forecast beyond chase (§69) | Location, count, RV table | Yes | **Yes**: Decision+, IZA+/OZA+, region frame in `web/lib/decisions.ts` | Done (college is the origin). |
| **WPA** | Win-probability change per PA/pitch | Public: Tango et al., *The Book*; goat-pro ships a WPA layer from `delta_home_win_exp` | Inning, half, score, outs, bases, a WE table | Inning/Outs/RunsScored yes; bases from PBP; score must be accumulated (PA key needs Top/Bottom, see memory "TrackMan PA grouping") | Run environment + leverage layer (`scripts/verify_leverage_layer.py`), no WPA | **M**. Fit a D1 win-expectancy table on 2022–26 warehouse games, then per-PA WPA and game-report top moments. Value medium (game reports, reliever usage). |

### Rules, parks, value

| Stat | Measures | Evidence | Inputs | TrackMan has? | College has? | Port |
|---|---|---|---|---|---|---|
| **ABS challenges** | Challenge accuracy and runs gained | Public: Savant 2026 ABS board; goat-pro `/abs` | ABS events | **No ABS in college** | No | Not applicable. Umpire board + framing already cover the zone. |
| **Component park factors** | Venue effect per event (1B/2B/3B/HR/SO) | Ours: 2B and 3B CONFIRMED as EB-shrunk factors, 1B/BB noise, HR/SO descriptive (§70); park-adjusted wOBA/FIP failed (§72) | Events by venue, home/road | Yes (Stadium, PlayResult, KorBB) | Runs PF only, imported from an external table (`configs/park_factors*.json`) | **S–M**. HR, 2B/3B, SO factors by venue from 2022–26 warehouse, EB-shrunk, descriptive. Value medium-high: college park spread is far wider than MLB's and it is the first question on portal hitters. Watch unit-level EV calibration (`research/park-calibration`). |
| **Would-it-dong** | For each batted ball, how many parks it is a HR in | Public: Savant "Would it dong?" / xHR (MLBAM fence geometry + carry) | EV, LA, spray, distance, park fence geometry | EV/LA/Bearing/Distance/HangTime **yes**; fence geometry no (but inferable) | No ("xhr" in `bake_portal.py` is xFIP's HR/FB term) | **M**. Infer each park's fence by bearing bin from warehouse HR vs deepest non-HR fly (2022–26), then score every fly ball against a reference set of parks. Value high for power context on portal hitters. |
| **Our WAR components** | Batting + baserunning + fielding + positional + league + replacement | Ours: §85 all four gates pass (r .92/.81 vs bWAR, team wins r .91) | wOBA runs, park, fielding runs, positions, PA/IP | All but baserunning speed and positions (positions from rosters/PBP) | Portal WAR on FanGraphs totals + TrackMan Def; no positional or league term | **M–L**. Rebuild from the warehouse with §85's structure; needs the baserunning port first. Value high, but most of it exists, so value per effort is mid. |

### Site models

| Stat | Measures | Evidence | Inputs | TrackMan has? | College has? | Port |
|---|---|---|---|---|---|---|
| **Deception+** | Bat speed and contact point pushed off each hitter's own norm | Ours: traits pass (split-half d_bs .62, d_ic .82; YoY .63/.79), forecast ΔR² +.0104 over naive + Stuff+ → SHIP (`results/deception_plus.json`) | Per-swing bat speed + contact depth, hitter norms | Contact depth yes, all levels (3,627 D1 hitters with 30+ contacts); bat speed blocked | College "deception" whiff residual **failed** its gate (`research/deception-whiff/RESULTS.md`) | **M**. Contact-depth-only version (the d_ic half, the more reliable one on MLB). Must pass the same pre-registered gate with a pitch-mix control (§21: depth signal is partly mix). Value medium, uncertain. |
| **Decision+** | Swing/take decision value | Ours §69 (above) | — | Yes | **Yes** | Done. |
| **Tunnel+** | Pitch-pair tunneling | Ours §74, descriptive | — | Yes | **Yes** (college origin) | Done. |

## Top 10 ports, by value per effort

| Rank | Port | Effort | Value | Why this rank |
|---|---|---|---|---|
| 1 | **xBA + xSLG** off the existing EV×LA surface | S | Medium | Two columns, existing model, familiar numbers |
| 2 | **Component park factors** (HR, 2B/3B, SO), EB-shrunk, descriptive | S–M | Med-high | §70 method transfers; college parks vary far more than MLB's |
| 3 | **Would-it-dong** with fences inferred from warehouse fly balls | M | High | All ball inputs exist; the fence inference is the only new piece |
| 4 | **Spin efficiency** as a displayed pitch stat | S | Low-med | Already computed for Stuff+; display only |
| 5 | **Baserunning runs** from PBP (XBT + SB/CS runs) | M | Medium | Fills the WAR hole; no speed needed |
| 6 | **WPA** from a D1 win-expectancy table | M | Medium | Leverage layer exists; adds game-report moments |
| 7 | **Contact-depth Deception** (d_ic half of Deception+) | M | Medium, uncertain | Inputs at every level; needs a mix-controlled gate |
| 8 | **Catcher throwing runs** (CS above expected) | M | Medium | Pop/exchange/TimeToBase exist; runner speed proxied |
| 9 | **WAR rebuild** on §85's structure (positional + league terms) | M–L | High | Most value already exists in portal WAR; depends on #5 |
| 10 | **Game bat-tracking metrics** (bat speed, ideal AA, squared-up) | L | Medium | Blocked by the owner rule and coverage today; listed so it is revisited |

## Not portable (and why)

Sprint speed (no runner tracking), measured arm angle (no pose), seam-shifted wake
(TrackMan axis is derived from movement), fielder start positions for OAA (no positioning
data; college OAA exists without them), ABS challenges (no ABS in college).
