# Formula audit

Every rate the site shows, checked against the owner's knowledge base (kb) or the published definition, 2026-10-27.
When a formula changes, update this table and the glossary in the same commit.

| Stat | Site formula (where) | Reference | Verdict |
|---|---|---|---|
| wOBA (hitters) | Σ weight × event / (AB + uBB + HBP + SF) = PA − IBB − SH − CI; weights = event RV − out RV per season, scaled so league wOBA = league OBP each season, over every hitter's PA (`web_export.py` `woba_of`) | Tango, *Situational Wins* (kb `sources/web/tangotiger-net-a19245f301.md`, 2008): uBB, HBP, 1B, 2B, 3B, HR over PA | **Fixed 2026-10-27** (`9f38e75`): intentional walks were removed from the walk count twice. **Fixed 2026-10-29:** the scale pinned hitters with 100+ PA to .310 every season, so wOBA read about .011 below Savant (.024 in 2020) and seasons lost their run environment; it now uses the standard league-OBP scale. Savant-scale wOBA still ships separately as `wobaSavant`. |
| AVG / SLG / OBP | AB = PA − BB(all) − HBP − SF − SH − CI; OBP = (H + BB + HBP) / (AB + BB + HBP + SF) | Official scoring rules | **Fixed** (`9f38e75`, `75de630`, `191e268`): AB counted intentional walks; OBP had catcher's interference in both terms. |
| BB%, K% | all walks / PA, K / PA (hitters and pitchers) | FanGraphs convention (BB includes IBB) | **Changed** (`9f38e75`): pitcher and hitter BB% left out intentional walks. |
| FIP | (13·HR + 3·(BB + HBP) − 2·K) / IP + C, BB including IBB; C sets league FIP = league ERA each season | SABR, *The Many Flavors of DIPS* (kb `sources/baseball/sabr-org-8a8c75302c.md`, 2011): C + (13 HR + 3 BB − 2 K)/IP, "sometimes HBP are added to walks" | **Fixed** (`cd668ea`): MLB left out HBP while the glossary called it the FanGraphs form. Minor leagues (`minors_export.py`) already used BB + HBP. |
| WHIP | (H + BB) / IP, BB including IBB | Standard | **Fixed** (`9f38e75`). |
| Career IP | outs / 3, DP = 2 outs, TP = 3 | Standard | **Fixed** (`b384786`): double and triple plays counted as one out. |
| Season IP, K, BB, HBP, H, HR, PA (pitchers) | IP from the official Stats API outs; counts from every plate appearance | Official lines | **Fixed 2026-10-28**: IP came from Statcast events, which never carry outs on the bases and missed `grounded_into_double_play` (Valdez 2024: 147.7 vs 176.1 official). The counts went through the pitch-quality gate, which drops automatic IBBs, untracked pitches and knuckleballs. The 2024 FIP constant is now 3.166, the FanGraphs value; Wheeler 2024: 200.0 IP, 3.13 FIP, 788 BF. Per-game IP in game logs still comes from events (the double-play events are now counted), so outs on the bases are missing there. |
| Barrel % | Savant `launch_speed_angle = 6` / BBE | Savant CSV docs (kb `sources/baseball/baseballsavant-mlb-com-456f53c4de.md`, 2026); *Analyzing Baseball Data with R* app. C (kb `beanumber-github-io-1589c05dfd.md`) | **Fixed** (`6e0142d`): the hand table stopped widening at 113 mph and missed 24-39 MLB barrels a season. The skill-card Power population counted every 95+ mph ball as a barrel. |
| Hard-hit %, sweet spot % | EV ≥ 95 / BBE; LA 8-32° / BBE | Savant definitions | **Hard-hit fixed 2026-10-28**: foul balls carry `launch_speed`, so the numerator counted hard fouls over a BIP denominator (2025 hitters 48.0 vs Savant 40.8, r .937); every EV stat is now gated on `bb_type` (r .9997). Sweet spot is the launch-angle one (not bat contact quality; that is squared-up). 2025 vs Savant's board: r 0.979, ours 35.6 vs 34.2; GB% matches exactly (r 1.000), so the batted balls are the same and the gap is in the per-ball launch angle Savant's board uses (mean LA 13.1 vs 13.5). Not resolvable from the public CSV. |
| Avg EV / LA, EV90, max EV | Averages over batted balls without bunts (`des` not like 'bunt'); EV90 and max EV over all batted balls | Savant (its averages drop bunts; with them out, 2025 avg EV r .999, LA r 1.000) | **Fixed 2026-10-28**: fouls were in all four (EV90 read 2 mph low for 99% of hitters; max EV changed for 25%), and bunts in the averages. |
| PA / batters faced | distinct (game, at-bat) with an event, `truncated_pa` excluded | Official PA | **Fixed 2026-10-28**: an inning ending on the bases mid-PA (`truncated_pa`) counted as a PA (+0.7 a season); now matches Savant exactly. |
| Savant-style wOBA (`wobaSavant`, `wobaAg`) | Σ Statcast `woba_value` / Σ `woba_denom`, reaching on an error or fielder's choice scored 0 | Savant board | **Fixed 2026-10-28**: Statcast's `woba_value` scores ROE/FC like a single; they are outs in wOBA. Gap +.009 → +.003 (r .999); the rest is Savant's season weights. The site's own wOBA (row above) was unaffected. |
| Pull % / oppo % | see Spray row | Savant board | **Open**: 44.3 vs 39.3 (r .917) on 2025; sign, origin, threshold, bunts and switch hitters ruled out, the gap sits in ground balls. Savant most likely uses launch direction, which the public CSV lacks; ours is from where the ball was fielded. |
| Spray / pull | φ = atan((hc_x − 125.42)/(198.27 − hc_y)), signed so + = pulled; pull > 15°, oppo < −15° | *Analyzing Baseball Data with R* app. C (kb) | OK |
| xwOBA / xBA / xSLG / xwOBACON | Savant per-ball estimate on BIP, actual value otherwise, over wOBA denom / AB / BIP (`hitter_depth.py`) | Savant roll-up | OK |
| Squared-up, blast | Balls in play with EV ≥ 0.8 × (1.23·bat speed + 0.23·pitch speed at the plate), per competitive swing; blast = 100·EV/max + bat speed ≥ 164; competitive swings ≈ fastest 90% | *Swinging, Fast and Slow* (kb `papers/2507.01238v1.md`, 2025) quoting MLB's 80% rule | **Fixed 2026-10-28**: used release speed, which overstates the max EV; squared-up ran 1.4 and blast 2.1 pts under Savant. Plate speed (y = 17/12 ft, nine-parameter fit): 2025 r 0.999 for both, 26.0 vs 26.2 and 12.2 vs 12.1. Counting fouls was tested and rejected (r 0.933, 5 pts over). |
| Hitter Chase% (O-Swing%) | out-of-zone swings / out-of-zone pitches; lower is better for a hitter, higher for a pitcher | Savant / FanGraphs | **Fixed 2026-10-28**: the hitter profile, board chips and share card ranked it under `oSwingPct`, a key with no direction, so a high chase rate drew a high percentile. The sample-adjusted twins (`…Shrunk`) had the same gap and now rank in their raw stat's direction. |
| Pitch explorer (per-pitch files) | `pitches/{P|H}{id}-{season}.json.gz`, every pitch with a tracked location (100+ in the season); outcome from `description`/`events`; RV = `delta_pitcher_run_exp` (pitcher files) or its negative (hitter files); whiff = swinging strike (incl. blocked, foul tip, missed bunt) / swings; surfaces: Gaussian kernel, σ 0.5 ft (n ≤ 150) to 0.18 ft (n ≥ 600), 0.1 ft cells, drawn at kernel weight ≥ 5; per-pitch Whiff+ = 100 + 10z (z per `pipeline/whiff_game.py`) and Pitching+ = 101.503 + 1793.82·v (exact linear map of `location_plus.grades`), both in `cache/pitch_models.parquet`, so a slice's grade is the mean (Whiff+ clipped 50–175); xBA/xSLG = Statcast `estimated_ba/slg_using_speedangle` | Statcast | Descriptive. Count groups: pitcher ahead = strikes > balls, hitter ahead = balls > strikes, even excludes 0-0. |
| Pitch explorer season trends | client-side from the same file: per type, rolling mean of `w` (xwOBAcon) and `sl` (xSLG) over its last 50 balls in play; usage = type share of the last 100 pitches to each batter hand (shown when ≥20 pitches and ≥3% to that hand); one point per game day; dashed league line = `lgc[type]`, the level's season mean of `estimated_woba/slg_using_speedangle` on balls in play for that type; title = the split of one line (each side ≥ max(4, 1/6) of its points) with the largest |mean after − mean before|, shown when ≥ .040 xwOBAcon / .080 xSLG / 6 pts usage | Statcast | Descriptive; overlapping windows, no test. |
| Profile splits | pitch files (full season): hand = opponent hand; family FF/SI/CT, SL/SW/CB, CH/FS; PA stats on the PA's last pitch (`pe` code, `wv` = Statcast `woba_value` where `woba_denom` = 1); xwOBA = (Σ xwOBA on BIP + Σ wv on non-BIP PA ends) / PA with wv; xBA/xSLG = Σ estimated_ba/slg on BIP / (PA − BB − HBP); Decision+ split = 100 + 10·(100·mean dv − μ)/σ with the season μ, σ of `results/decisions_hitters.csv` (≥ 100 PA); dv from `cache/decision_pitches.parquet` (`decision_model.py --artifacts`, now keyed by pitch; refit drift vs shipped: ≤ 0.98 Decision+ points, r .9997, ≥ 100 PA) | Savant xwOBA convention | Descriptive. AB counts sacrifices. |
| Defense plays + clips | chance points: fx = 2.5·(hc_x − 125.42), fy = 2.5·(198.27 − hc_y) ft; batter/des from the mart on (game_pk, hc_x, hc_y); play_id + homeRunBallparks from Savant `gf?game_pk=` (`savant_play_ids.py` → `data/milb/savant_bip.parquet`, join (game_pk, at_bat_number, pitch_number)); clip resolved on click by `/api/savant-video` from `sporty-videos?playId=`; Savant block = `lb_fielding_run_value` parts + `lb_outs_above_average` directions, rec1b distribution per season | — | Descriptive; Savant numbers labelled. |
| Movement buckets | per site type with ≥ 2,000 league pitches 2023–26 (edges fixed; 2020–22 boards use the same edges, pre-2023 Hawk-Eye reads ~0.45 in less FF IVB): edges = league quintiles (0.2/0.4/0.6/0.8) of release_speed, pfx_z·12, arm-side pfx_x·12 (−pfx_x for RHP), rounded to integers, duplicates dropped; bin k = number of edges ≤ value; league line per bucket (pitcher side) in each pitch file (`lg`); board `buckets/{season}-{type}.json`: per player and bucket n ≥ 30, share of his pitches of that type, RV/100 good for him, whiff/swing, xwOBAcon | — | Descriptive. |
| Team (current) / per-club lines | current team = club of the most recent game (pitcher: home side in the top half; batter: away side in the top half; `inning_topbot` is 'Top'/'Bot'). Club lines: same counting stats grouped by club; club ERA/IP = official per-club lines (`pipeline/team_lines.py`, MLB Stats API per-person season splits; fallback RA9 and season outs × club share of Statcast event outs); club Whiff+ = grade(Σz / n) over the club's pitches from `cache/whiff_game.parquet` (`pipeline/whiff_game.py`, refs recovered from the shipped grades, max error 0.0001; floor 10 pitches) | MLB Stats API | **Fixed 2026-10-28**: was the season's most frequent club (`mode`), wrong after a trade. Projections stay season-long on the combined row. |
| Per-type shape ranks (arm°, IVB, HB, spin) | rank among the season's pitches of that type | — | **Neutral since 2026-10-28**: shown grey, no good/bad direction (high spin or less run hurts a changeup, helps a fastball). Velocity and the slot-band ΔIVB/ΔHB keep their colour (owner). |
| Hitter Marcel | 5/4/3 weights on counts, plus 1,200 PA of league rate; no age term | Marcel (kb `sources/baseball/tangotiger-net-2a3f95964b.md`): 3 years, recent heavier, regressed, age factor | OK, with the age term left out (stated in the glossary). The kb has no source for the 1,200 PA constant; it comes from Tango's published Marcel code. |
| Park factors | home/road rate ratio, 3 seasons, EB-shrunk log ratio, venue-level (not halved) | FanGraphs, *Park Factors – 5 Year Regressed* (kb `library-fangraphs-com-8599408685.md`, 2016) | OK for a venue factor. Any future `adj_*` stat must use (1 + PF)/2 for a full season line, per the same source. |
| Decision+ | 100 + 10·z of decision runs/100 among 100+ PA hitters | Site metric (RESULTS-MLB §69) | Documented; descriptive. |
| Outing+ (D-18) | 100 + 10·z of the outing's mean cross-fit Pitching+ (graded pitches) among that season's outings with ≥ 15 graded pitches; the game log also shows the outing's mean Whiff+ raw (`pipeline/p7_games.py` over `cache/pitch_models.parquet`). The xRV leg waits on recomposing the §78 model's per-pitch run values from its probability legs | `cache/p7_games.parquet` | Descriptive. |
| Pitch plan (D-20) | per pitcher-season × count: type mix (types ≥15%, top 3), CSW% = called+swinging strikes / pitches, RV/100 = 100·mean(−Δrun_exp); league lines per season × count pooled over types; counts < 25 pitches and arms < 400 total are left out (`pipeline/pitch_plan.py`) | `results/pitch_plan.csv`, `pitch_plan_league.csv` | Descriptive (§61–63). |
| Decision twins (D-02) | `drvPer100Shrunk` = (drv100·n + k·μ)/(n + k) toward the season's ≥100-PA mean μ; `decisionPlusShrunk` = the §69 scale on the twin. k = 632 decisions, measured by `measure_discipline_mlb.py` (median-date split, SB r_full .646, 2026 holdout .679) | Same file | Descriptive. |
| Run value / 100 | 100 × mean `delta_run_exp`, batter-positive; pitchers flipped | Savant CSV docs (kb) | OK |
| Tunnel+ | Chase-logistic lift at actual vs geometry-implied separation at the 23.8 ft commit point; EB-shrunk per pairing and per pitcher (pairing type removed); 100 + 10 per pairing SD (`tunnel_plus.py`) | Past the Eye Test, *Pitch+* (kb `sources/web/substack-com-b8664fc421.md`, 2026): 23.8 ft = 175 ms decision point from Baseball Prospectus; college `compute_tunnel_plus.py` | Ported 2026-10-28 (§74). Trajectories are rebuilt from Statcast's nine-parameter fit and match `release_pos` to a median of 0.03 in. |

## Pitch-code standard (pipeline/web_export.py `fold_to_site`, 2026-10-29)
- Every per-pitch-type key in the export is a **site code** (`SC_TO_SITE`, mirrors `web/lib/constants.ts` PITCH_CONFIG):
  FF, SI, FC→CT, SL and SV→SL, SW and ST→SW, CU and KC→CB, CH, FS and FO→FS.
- `fold_to_site` makes one row per pitcher-season-site: counts sum, means are n-weighted (EV/LA by balls in play), movement
  SDs pool (within + between), and a floor (xRV/100 n ≥ 30, Prev+ n ≥ 150) applies to the folded n. `nPa` sums, so a PA
  that saw both folded codes counts twice.
- It feeds the profile arsenal rows, the arsenal boards, the per-type percentile pools, classRank (ranks within site code),
  Prev+ and xRV/100 lookups, pitch_rv, the mix metrics and the slot files (slot league cells, deltas and arm° pools key on site).
- Codes without a site code: EP passes through as its own row (no site label; slot keeps it as EP; transitions call it OS).
  FA, KN, CS, SC, UN are outside the bake gate (xRV rows for them are dropped).
- Model files that train on Statcast classes are unchanged; only the export joins fold.

## Trade tracker (pipeline/trades.py → trades/{season}.json)

- Source: Stats API `/transactions`, `typeCode == "TR"`, both clubs MLB; deal key = (date, description).
- Player value = Σ delta_run_exp with the acquiring club on/after the trade date (hitters: as batter; pitchers: negated, as pitcher). `rvSeason` = same, trade year only.
- Club: In = Σ value of players received; Out = Σ value of players sent (with their new club); Net = In − Out.
- Deadline = modal July–August trade date. Prospect rank = Pipeline top 100, else org list, in the trade year.

## Postseason (pipeline/postseason.py → postseason/index.json, postseason/games/{gid}.json.gz)

- Bracket and scores: Stats API `schedule/postseason/series`; series wins = Final games won; winner = first to ⌊best-of/2⌋ + 1.
- Lineups and box lines: Stats API `game/{pk}/boxscore` (starters = battingOrder ending 00; subs listed under their slot); SP = first pitcher listed.
- PA table, win probability: Statcast `game_type` F/D/L/W, the same PA encoding and WPA telescoping as `games/` and `wpa/` (swing = Σ delta_home_win_exp, sign flipped for the top half).
- Leaders: WPA = Σ swing per PA (pitchers −Σ); RV = Σ delta_run_exp (pitchers −Σ); wOBA = Σ woba_value / Σ woba_denom. Board = top 25 by WPA ∪ top 25 by RV.

## Matchup view (/matchup; no new bake, reads players/, hitters/, buckets/)

- Pitch bin per axis = count of the type's bucket edges ≤ the pitch's mean (velo mph, IVB in, arm-side HB in = −hb for RHP).
- Cell edge per axis = hitter RV/100 in that bin − league hitter-side RV/100 in that bin (league `lg.rv100` negated); bins need 30+ pitches (the buckets file floor).
- Pitch read = n-weighted mean edge over the axes; "handles it" ≥ +1.0, "struggles" ≤ −1.0, else near league; under 150 pitches (mean over axes) it "leans". Arsenal = usage-weighted mean of the pitch reads, usage vs the hitter's side (switch hitters bat opposite the pitcher).

## Role conversion (pipeline/role_conversion.py → roles/roles.json, RESULTS-MLB §87)

- xwOBA per PA = estimated wOBA on contact, else wOBA value (woba_denom = 1). Start = threw his team's first pitch. Season role = `role_of(G, GS)`.
- Shrink: s(x, n) = (n·x + 300·lg) / (n + 300), lg = league mean for that split and season.
- RP→SP projection (A0) = s(relief xwOBA) + P, P = BF-weighted mean of (starter xwOBA in S+1 − s(relief xwOBA in S)) over 2020–25 RP→SP converters (+.010).
- SP→RP short-burst estimate (B1) = s(first-TTO xwOBA in starts) + O, O = converters' mean (relief xwOBA in S+1 − s(first-TTO in S)) (−.005). Gain = s(full starter xwOBA) − B1.
- TTO pen = s(TTO3+) − s(TTO1). Fade = fastball mph inning 1 − innings 5+. Fade/10 = 10 × slope of outing-demeaned FB mph on pitch sequence (outings 15+ pitches). Rest = FB mph on 0–1 days rest − 2+. Platoon = s₁₅₀(vs opposite) − s₁₅₀(vs same).
- Depth = types with ≥ 10% usage; graded = those with whiff/swing ≥ league median for the type and season. Eff = exp(−Σ u ln u). Velo bump = converters' mean FB mph in relief S+1 − in starts S (+0.9).
- Gates: 5 GroupKFold folds by pitcher, BF-weighted out-of-fold MSE, 2,000-draw pitcher bootstrap; all three failed, so both boards are descriptive.

## WAR (pipeline/war.py → war_index.json, RESULTS-MLB §85)

- Position: WAR = (Bat + BsR + Fld + Pos + Lg + Rep) / RPW. Bat = Σ(lw_event − lg mean lw) − (PF_venue − 1)·lgR/PA per PA; lw_event = season mean `delta_run_exp` on PA-ending pitches of that event. PF_venue = 1 + ½(home R/G ÷ road R/G − 1), seasons S−2..S.
- Pos = Σ_slot adj162 · (def PA at slot ÷ league team def PA) · (team games ÷ 162); DH = −17.5/162 per game batted without a field slot.
- Lg = −Σ(Bat+BsR+Fld+Pos)/ΣPA per PA; Rep = 0.57 · 1000 · G/2430 · RPW / ΣPA per PA; RPW = 9·(R/IP)·1.5 + 3.
- Pitchers: FIPR9 = (FIP_raw + lgRA9 − lgFIP_raw) / PF; dRPW = (((18 − IP/G)·lgRA9 + (IP/G)·FIPR9)/18 + 2)·1.5; WAR = [(lgRA9 − FIPR9)/dRPW + 0.03(1 − GS/G) + 0.12·GS/G]·IP/9·lev, lev = 1 + (1 − GS/G)((1 + gmLI)/2 − 1); + season constant per IP to 43% of 1000·G/2430.
- gmLI: LI of his first PA in each relief appearance; LI = mean |ΣΔWE| per PA in its (inning ≤ 9, half, outs, bases, diff ±4) state ÷ overall mean.

## Minor-league translations (pipeline/milb_translation.py → translation/, RESULTS-MLB §88)

- Lines: MLB Stats API season lines, teams at one level summed. Hitters: K% = SO/PA, BB% = BB/PA, ISO = (2B + 2·3B + 3·HR)/AB, BABIP = (H − HR)/(AB − SO − HR + SF), wOBA = (.69·uBB + .72·HBP + .89·1B + 1.27·2B + 1.62·3B + 2.10·HR)/(AB + uBB + SF + HBP). Pitchers: K%, BB%, HBP%, HR% per BF.
- AAA park: per home team, EB-shrunk home/road log ratio (§70 `shrink`, no hand split) for 1B, 2B, 3B, HR, BB, SO over 2023–25 Statcast; player factor = (1 + e^eb)/2, each count divided by it. AA: none.
- Environment: rel = stat (park-adjusted) / league × season mean (PA/BF-weighted over his teams); MLB: season mean.
- Factor: f = Σ h·rel_MLB / Σ h·rel_level, h = 2/(1/n_level + 1/n_MLB), pairs = level line in S (2021–25, ≥ 200 PA / 150 BF) with MLB in S+1 (≥ 100). AA uses direct AA → MLB pairs.
- MLE = f · (1 + (rel − 1)·n/(n + k)) · MLB mean in S; k from {0, 50, …, 3200} by weighted MSE on the fit pairs. HR/9 = 9·HR%·(BF/IP)_MLB; FIP = (BF/IP)_MLB·(13·HR% + 3·(BB% + HBP%) − 2·K%) + MLB FIP constant (season S).
- Gate: 5 player-grouped folds, S ∈ 2023–25 → MLB S+1, MLB-PA/BF-weighted MSE vs the raw line and vs the MLB mean, 2,000-draw player bootstrap. Tested (v1, pre-registered): AAA hitter K%, BB%, ISO; AA hitter BB%. Provisional (v2 re-test on already-read rows; confirm on 2026 → 2027): AA hitter K%, AAA pitcher K%. The rest descriptive. Shipped numbers use the v2 factors throughout.

## Would it dong (pipeline/dong.py → dong/board.json, dong/players/{id}.json.gz, RESULTS-MLB §86)

- Spray φ = atan2(hc_x − 125.42, 198.27 − hc_y) (deg, − = LF). v = launch_speed · 1.4667 ft/s, θ = launch_angle, contact at 3 ft.
- Flight (2-D, RK2, dt 0.02 s): a = −g ẑ − K·ρ_r·|v|·(C_D v − C_L v⊥), v⊥ = (−v_z, v_x), K = 0.005307 /ft, C_L = 0.25, ρ_r = exp(−elev/27,500 ft).
- C_D per ball by bisection so the own-park flight (ρ_r of the venue) lands at hit_distance_sc. Balls < 250 ft or θ < 10° = 0 parks.
- Park p: R_p(φ), H_p(φ) linear between the knots in `pipeline/data/park_dims.csv`, R shifted by `park_offsets.csv`. Clears p ⇔ height at x = R_p(φ) under ρ_r(p) > H_p(φ).
- X/30 = parks cleared; xHR = Σ X/30; no-doubter X = 30, mostly gone 8–29, doubter ≤ 7 (HRs only); elsewhere = non-HR with X ≥ 1; best/worst park = argmax/argmin over p of Σ balls clearing p.

## Contact depth (pipeline/contact_depth.py → depth/{id}-{season}.json.gz, depth/league.json, RESULTS-MLB §89)

- Swings: `swing_common.competitive_mask` (bunts out; fastest 90% per hitter-season + 60+ mph swings with 90+ EV), contact = foul + in play.
- y = intercept_ball_minus_batter_pos_y_inches (+ = out front, from the batter); x = _x_inches (+ = away from his body). dc = y − mean(y | hitter, season, side) (`depth_centered`).
- Plate in his frame: front edge at y = avg_batter_y_position, centre at x = avg_batter_x_position (Savant swing-path board; league 27.9 / 27.7 in. before 2025); 17 in. wide, back point 17 in. behind the front.
- League curve L(d): 2024 balls in play, xwOBA by dc on a 1-in. grid −20…+20, Gaussian kernel bw 2 in. Personal shift δ = argmin over −10…+10 (0.5) of Σ(xw − m − L(dc − δ))², m refit per δ.
- Late on velo: res = dc − mean(dc | season, fastball, round(release_speed)); his read = mean res on fastballs ≥ 95 mph (25+ contacts; 40+ on the board).
- Late by type (depth/late-{season}.json; keys FB95, FB, FF, SI, CT, SL, SW, CB, CH, FS): rt = dc − norm(season, type, round(velo)); a norm cell under 300 contacts falls back to the pitch family at that velo, then all types. Board floor 40 contacts (fastball keys) or 30. Reliability per key: split-half by alternate games (2025, 15+ per half), YoY 2024→2025 (25+).
- Pitcher mirror (depth/pitchers-{season}.json): over contacts by hitters with 100+ competitive swings, per pitcher (100+ contacts) and pitcher × type (50+): dc = mean centred depth (velo and mix included), rt = mean (dc − the type × velo norm above), xwOBAcon, EV, mean velo. Reliability: split-half by his alternate games (50+ per half overall, 25+ per type) and YoY.
- Hitter filters (client, contact-depth-panel.tsx): pts carry pitcher id `pid` and hand `th`; the cloud, damage bins and rolling trend recompute on the filtered set (rolling window 50, or n/3 with a 15 floor under 150 contacts; needs 30+).
- Rolling trend: mean dc over his last 50 contacts, band ±1.96·SD/√50; league reference = weekly mean dc (weeks from Mar 15).
- Percentiles: among hitter-seasons with 100+ competitive swings, rank / (n − 1). xwOBAcon and EV good-high (coloured); depth and late-on-velo neutral.

## Deception+ percentile (web/lib/data.ts deceptionPcts, read-time over deception_index.json)

- Per season, over the index rows (200+ tracked swings): pct(v) = round(100 · (#below + #equal/2) / n), clamped 1–99.
- plusPct on Deception+; slowPct on −batSpeedVsNorm (slower swings rank high); timingPct on timingDisruption (more shift ranks high). All pitcher-good.
- The baked batSpeedPct is the raw delta's percentile (low = good for the pitcher) and is not displayed.

## Horizontal break convention (web/lib/arm-slot.ts armSideHb; every movement plot)

- Baked `hb`, `expHb`, the movement cloud and the career mix are Statcast pfx_x (·12 = inches), the catcher's view: a RHP's arm side is negative, a LHP's positive. Tables that print raw HB say so.
- Every movement plot and arm-side number goes through armSideHb: arm-side HB = −hb for RHP, hb for LHP, hand = the pitcher-season's mode p_throws; unknown hand draws nothing. Plots put arm side on the right for both hands (the pitcher's view for a RHP, mirrored for a LHP), so a sinker or changeup sits right and a sweeper left. All layers (his dots, means, slot rings) take the same transform; the bake never pre-flips a position.
- Slot file deltas dHb / dHbPct are baked arm-side (+ = more arm-side run than his slot's typical, ranked so a high pct = more arm-side). Fixed 2026-10-30: the profile plot and the season-movement plot drew RHP arm side on the "glove side" label, and dHb/dHbPct were in the RHP catcher frame.
- Guard: web/__tests__/arm-slot.test.ts (Webb SI/SW, Skubal CH/CB).

## ΔIVB / ΔHB vs slot (web/lib/boards/slot.ts enrichArsenal; /arsenal/[pitch] and the slot board)

- hb_arm = −hb for RHP, hb for LHP (arsenal hb is Statcast pfx_x, catcher's view).
- Peer pool = same pitch type, season and arm-slot band (slotBand of the slot file's primary-fastball arm angle), pitch-weighted by n_pitches.
- ΔIVB = ivb − (Σ ivb·n − ivb_i·n_i) / (N − n_i); ΔHB likewise on hb_arm. Blank when N − n_i < 1,000 (SHAPE_PEER_MIN).
- Neutral (no good/bad colour). Age = the pitchers board season age; Deception+ = the pitcher-season grade joined by (id, season).

## Swing plane match (pipeline/plane_match.py, RESULTS-MLB §90; research only, not shipped)

- M1 = |AA + VAA| (deg). AA = Savant attack_angle (+ = rising), VAA from `swing_common.vaa()` (− = descending).
- M2 = |tan AA / max(cos AD, 0.5) + tan VAA|: inches of vertical bat-ball offset per inch of depth (timing) error, where
  AD = attack_direction. Ball dz/dy = tan(−VAA); sweet spot dz/dy = tan AA / cos AD.
- Model: hitter-season-demeaned OLS of squared-up (`swing_common.squared_up`, per contact) on pitch group, plate speed,
  plate_z/x quadratics, count, centred depth (+²), AA + AA², VAA + VAA², + M. Hitter-clustered bootstrap, 1,000 draws.
- Verdict: failed. β(M1) is positive (+2.8 pp squared-up per IQR); the mirror holds on low pitches and breaking/offspeed and reverses on four-seamers up in the zone.

## Swing plane, refined (pipeline/plane_match_v2.py → plane/league.json, plane/{id}-{season}.json.gz, plane/pitchers-{season}.json; RESULTS-MLB §90b)

- s = AA + VAA (deg, + = swing steeper than the pitch). Cells = pitch group (FF, SI, FC, SL/ST/SV, CU/KC, CH/FS) × plate_z (< 2.08, 2.08–2.68, ≥ 2.68 ft).
- P1 curve: hitter-season-demeaned OLS of sweet spot (BIP, LA 8–32°) on a linear spline in s (knots −8.9, −2.9, 3.8, 10.4, 16.3) + controls
  (pitch group, plate speed, plate_x/z quadratics + x·z, count, centred-depth spline with knots −15, −8, 0, 8, 15 in.); shown as f(s) − f(0) in pp, per cell, s P5–P95.
- P2 curve: xwOBAcon centred within hitter-season (+ league mean), by |centred depth| bin, for |s| ≤ P25 (2.81°) vs |s| ≥ P75 (9.89°).
- Hitter cell plane: aa_c = his mean AA on competitive contact swings in cell c (primary batting side; ≥ 20 swings, ≥ 10 contacts);
  delta_c = aa_c − league aa_c (same season); offset = swing-weighted mean of delta_c; rel_c = delta_c − offset;
  contactPp_c = rel_c × (−100 × 0.02034 / 5.39) = −0.377 pp per degree (the §90b P3 estimate). Hitter-season floor 150 competitive swings.
- Matchup plane = Σ_c usage_c × contactPp_c / Σ_c usage_c over his qualified cells, usage = the pitcher's share of all regular-season pitches
  in cell c (pitchers with ≥ 200); blank when his cells cover < 40% of the pitcher's pitches. "Misfits" = his lowest contactPp among cells
  with ≥ 10% usage, if ≤ −0.5 pp. Descriptive; a contact read, not damage.

## Timing residual (pipeline/timing_residual.py → timing/timing.json; RESULTS-MLB §92)

- Competitive contact swings (foul + in play). y = `intercept_ball_minus_batter_pos_y_inches` (+ = out front).
- ŷ0 = hitter-grouped out-of-fold LightGBM (per season) of y on plate speed, release speed, pitch type, pfx_x and plate_x
  signed by batter hand, pfx_z, plate_z, balls, strikes, same-hand flag. r0 = y − ŷ0.
- offset = mean r0 over his other games that season and side (leave-one-game-out). e = r0 − offset (in., + = early, − = late).
- bias_g = mean e over group g (FB = FF/SI/FC, BR = SL/ST/SV/CU/KC/CS, OS = CH/FS/FO; FB bands 92–95, 95+), shown shrunk:
  bias_g · n/(n + k_g), k from split halves (FB 56, BR 35, OS 35, 92–95 70, 95+ 51). Spread = SD(e).
- Tags ("late on 95+"): shrunk bias beyond the season's 20th/80th percentile, half-floor n met (40 per group, 25 per band), strongest first.
  Hitter-season floor 100 contacts. Descriptive.

## Swing archetypes (pipeline/swing_archetypes.py → archetypes/archetypes.json; RESULTS-MLB §94)

- Hitter-season means over competitive swings (300+ swings, 150+ contacts): bat speed, swing length, attack angle,
  attack_dir_pull (= −attack_direction), swing_path_tilt, contact depth (raw intercept y, contact swings only, measured from the batter).
- z = (trait − mean) / SD with the 2024–25 pooled mean and SD (frozen). k = argmin BIC of a full-covariance GMM over k = 2…10 (→ 2).
  Shipped clusterer = k-means (n_init 20) at that k; 2026 assigned to the frozen centroids. Label = top three |z| ≥ 0.4 of the centroid in words.
- Map = first two principal components of z (x shown flipped: right = longer, faster, pull). Comps = 5 nearest hitter-seasons by
  Euclidean distance in z, other hitters only. Aging = same hitter's S → S+1 change in bat speed and length by type × age band (age_bat).

## Prevention+ per pitch (pipeline/prevention_pitch.py --score → results/prevention_pitch_scores.csv → players/ arsenal rows; RESULTS-MLB §101)

- Unit: pitcher × season × Statcast type, 150+ pitches of the type. Target the spec was frozen on: next-season RV/100 of that type (100 × mean −delta_run_exp).
- ŷ = RidgeCV (median impute, standardize) on the frozen families: swing-miss (whiff/swing, CSW%), context (other-pitch RV/100, primary-FB velo and
  ΔVelo/ΔIVB/ΔHB vs it, # types, K%, BB%), location (zone, heart, edge, chase, z-swing, called-strike, ball %), contact (GB%, LA, xwOBAcon, hard-hit%),
  Whiff+ per pitch, usage, shape, putaway, + type one-hots and season. Site fit = all pitchers' 2020→25 pairs (the seal is spent).
- Grade = 100 + 10·(ŷ − .0530) / .4665 (frozen dev scale). vs LHH / vs RHH: the same model on that hand's rows (100+ pitches), descriptive.

## Swing Quality (pipeline/swing_quality.py → swingq/swingq.json; RESULTS-MLB §98)

- Per tracked ball in play: ŷ = Ridge(α 1) on SplineTransformer(6 knots, degree 3) of §91's features (bat speed, swing length, attack angle,
  attack direction as pull, path tilt; plate speed, horizontal break and plate_x signed away, pfx_z, VAA, plate_z, same hand, balls,
  strikes; contact depth and lateral centred leave-one-out on his other contacts that season and side), target Savant xwOBA. 5 hitter folds
  (crc32), each hitter scored by the fold that never saw him.
- SQcon = mean ŷ over his tracked BIP. Grade = 100 + 10·(SQcon − league mean ŷ) / SD(SQcon over hitters with 100+ BIP), per season.
- Parts: feature j's spline terms × ridge weights, centred on the training fold's mean, summed into groups and scaled ×10/SD. Sum = grade − 100.
- Gap = 1000·(his mean xwOBA on tracked BIP − SQcon). Floor 25 tracked BIP; reliability fair < 50, good < 100, high ≥ 100.

## Bat speed drift (pipeline/bat_speed_drift.py; RESULTS-MLB §95; research only, failed, not shipped)

- Game mean of competitive bat speed (4+ swings); baseline = mean and SD of his previous ≤ 30 games that season (10+); z = (x − b)/SD.
- CUSUM C_t = max(0, C_{t−1} − z_t − 0.5), alert at 4. Bayesian online change point: Gaussian known variance, hazard 1/60, alert at
  P(run ≤ 4) ≥ .5 with a 1 mph drop. Naive: z ≤ −2. Hit = alert 1–14 days before an IL start (retroactive date when given).

## Two-strike adaptation (pipeline/two_strike.py → twostrike/twostrike.json; RESULTS-MLB §93)

- All non-bunt tracked swings (not the competitive filter). Residual = observed − hitter-grouped out-of-fold LightGBM expectation
  from §92's pitch features without balls/strikes, for bat speed, swing length, contact (foul + in play vs whiff incl. foul tip) and
  depth (contact swings, then centred within hitter × season × side).
- Δ = mean residual with two strikes − mean residual at 0–1 strikes. ΔBS 2K (mph), ΔSL (ft), Δ depth (in.), Δ contact (pp).
  Floors: 100 two-strike and 200 other swings. Board column ΔBS 2K = dBS. Descriptive.

## Speed Score (D-39, descriptive)

Mean of the within-season percentile ranks (0-100, among players carrying the component) of:

- **sprint** — Savant sprint speed (ft/s), the anchor and required component;
- **sb** — stolen-base runs per PA (`lb_baserunning_run_value.runner_runs_SBX`; min 100 PA);
- **xb** — extra-bases-taken runs per PA (`runner_runs_XB`; min 100 PA);
- **x3b** — triples per ball in play (site PA/BIP gates; min 50 BIP).

A missing component drops out of the mean. Built by `pipeline/speed_tool.py` from published
Savant aggregates plus two locally computed rates; PA/BIP use the site's gates (events not
null, no truncated PA). No gate: the inputs are season aggregates, so no within-season
split-half exists — reliability is the reported year-to-year stickiness (Speed Score .708,
sprint .929, 2020-26). Shown on the Savant tab (profiles) and the /defense board beside the
range runs, per the §100 finding that speed belongs in decomposition views, not in p.

## Zone chart, Where he swings (web_export.py scouting family → hitter_scouting/{id}-{season}.json.gz `zgrid`, scouting_league.json `zgrid`; components/ui/scouting-card.tsx)

- Cells: a 5x5. Inner 3x3 = the rulebook zone in thirds: |x| ≤ 0.83 ft (plate half-width + ball radius), thirds at ±0.277; sz_bot..sz_top in thirds. Outer ring = every pitch outside the zone on that side (shadow and chase together, no outer cutoff). x = plate_x mirrored by the pitch's batter side (+ = his inside). Pitches without plate_x/plate_z/sz are dropped. Replaced the 2026-10-30 5x3 grid whose inside/away columns ran past the plate edge.
- Splits keyed `<hand><group|type>`: hand A (all) / R / L = p_throws; '' (all) / FB / BR / OS = PITCH_FAMILY on SC_TO_SITE codes (FB = FF, SI, CT) / an exact site code (FF SI CT SL SW CB CH FS). A player's exact-type split ships only with 50+ pitches of that type from that hand. Untyped pitches count only in ''.
- Per cell [n, swings, whiffs, rv, bip, xw, hard] in ZGRID_ORDER (above→below, off-inside→off-away). rv = Σ delta_run_exp (batter +); bip = balls in play with EV and xwOBA; xw = Σ Statcast xwOBA (estimated_woba_using_speedangle) over them; hard = 95+ mph among them. No thin-cell cut (owner 2026-10-30): an empty cell is [0], one without balls in play stops at bip; xw at 2 dp. `s` = his majority batter side in the split.
- Metrics, every cell coloured by its raw value with its sample printed in it: Swing% = swings/n; Whiff% = whiffs/swings (sample = swings); xwOBACON = xw/bip; Hard-hit% = hard/bip (sample = BIP; EV90 is not stable on a few balls per cell); RV/100 = 100·rv/n. Levels sit on a single-hue scale (swing 0–80%, whiff 0–60%, xwOBACON .200–.600, hard-hit 0–70%); RV/100 and every vs-league diff (his − league, same season, batter side `s`, split, cell) use the site's good/bad ramp, green = good for the hitter (fewer whiffs green), saturating at whiff ±15 pts, xwOBACON ±.100, RV ±6/100.
- View: vs RHP and vs LHP side by side (stacked under 640px), or one All panel; catcher's view, a RHH's inside columns on the left.
- Smooth view (zone_hex/{id}-{season}.json.gz + zone_hex/league-{season}.json.gz, lazy via /api/data/zone-hex/[id] and /api/data/zone-hex-league; web/lib/zone-hex.ts): RAW counts [n, sw, wh, rv, bip, xw, hd] per 0.1 ft pointy-top hex (x ±1.5 ft batter frame; z' = 1.5 + 2·(plate_z − sz_bot)/(sz_top − sz_bot) over 0.5–4.5), sparse, per pitcher hand × exact site type ('X' untyped); groups/All are sums in the browser, the league route sums server-side. The browser smooths each column with a Gaussian kernel (bandwidth 0.12 / 0.2 / 0.3 ft, cutoff 3σ), ratio = smoothed num / smoothed den; opacity = smoothed den / (6 pitches | 4 swings | 3 BIP), floor 0.1, never hidden. Colour: levels clipped to the 5th–95th pct of its opaque (well-sampled) hexes; signed views capped at their 95th pct of |value|; vs-league = his ratio − the league's at the same bandwidth.

## Catcher running game (pipeline/catcher_export.py → catcher/{id}-{season}.json.gz `throwing.ours`, catcher/board.json, catcher/p/{id}-{season}.json.gz; RESULTS-MLB §108a-v2, §108c)

- xCS (per attempt) = §108a-v2 leave-one-season-out prediction (`cache/catcher/xcs_v2_pred.parquet`), clipped to [.005, .995]. Population: SB attempts of 2B/3B, pitchouts out; home steals have no xCS.
- xCS% = 100 · Σ xCS / attempts; CS above xCS = Σ (CS − xCS); per attempt = that / attempts.
- CS runs = Σ (CS − xCS) · (RE(after SB) − RE(after CS)); RE = `baserunning_runs.re_table` for the attempt's season; state = mart pitch at the latest pitch_number ≤ play_init_seq (70.5% consistent; else the season × base mean gap).
- Deterrence (PA × lead runner, 2020-26 LOSO, `catcher_108c.py`): attempts below expected = Σ p(attempt) − attempts; deterrence runs = that · V_s, V_s = season mean over attempts of (CS ? ΔRE_CS : ΔRE_SB) (−.008 to +.033).
- Throwing runs = CS runs + deterrence runs. Savant's exp CS / CS above average / catcher_stealing_runs ship beside, labelled.
- Pitcher file: Savant board `r_sec_minus_prim_lead` (lead gained, pct among n_init ≥ 200, lower = better), n_sb / n_cs / n_pk, rate_sbx · 100, runs_prevented_on_running_attr; ours: Σ (CS − xCS) over attempts with him pitching. Files for n_init ≥ 30.
