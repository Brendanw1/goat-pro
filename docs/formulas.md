# Formula audit

Every rate the site shows, checked against the owner's knowledge base (kb) or the published definition, 2026-10-27.
When a formula changes, update this table and the glossary in the same commit.

| Stat | Site formula (where) | Reference | Verdict |
|---|---|---|---|
| wOBA (hitters) | Σ weight × event / (AB + uBB + HBP + SF) = PA − IBB − SH − CI; weights = event RV − out RV per season, scaled so league = .310 (`web_export.py` `woba_of`) | Tango, *Situational Wins* (kb `sources/web/tangotiger-net-a19245f301.md`, 2008): uBB, HBP, 1B, 2B, 3B, HR over PA | **Fixed 2026-10-27** (`9f38e75`): intentional walks were removed from the walk count twice. The .310 scale is a site choice; Savant-scale wOBA ships separately as `wobaSavant`. |
| AVG / SLG / OBP | AB = PA − BB(all) − HBP − SF − SH − CI; OBP = (H + BB + HBP) / (AB + BB + HBP + SF) | Official scoring rules | **Fixed** (`9f38e75`, `75de630`, `191e268`): AB counted intentional walks; OBP had catcher's interference in both terms. |
| BB%, K% | all walks / PA, K / PA (hitters and pitchers) | FanGraphs convention (BB includes IBB) | **Changed** (`9f38e75`): pitcher and hitter BB% left out intentional walks. |
| FIP | (13·HR + 3·(BB + HBP) − 2·K) / IP + C, BB including IBB; C sets league FIP = league ERA each season | SABR, *The Many Flavors of DIPS* (kb `sources/baseball/sabr-org-8a8c75302c.md`, 2011): C + (13 HR + 3 BB − 2 K)/IP, "sometimes HBP are added to walks" | **Fixed** (`cd668ea`): MLB left out HBP while the glossary called it the FanGraphs form. Minor leagues (`minors_export.py`) already used BB + HBP. |
| WHIP | (H + BB) / IP, BB including IBB | Standard | **Fixed** (`9f38e75`). |
| Career IP | outs / 3, DP = 2 outs, TP = 3 | Standard | **Fixed** (`b384786`): double and triple plays counted as one out. |
| Barrel % | Savant `launch_speed_angle = 6` / BBE | Savant CSV docs (kb `sources/baseball/baseballsavant-mlb-com-456f53c4de.md`, 2026); *Analyzing Baseball Data with R* app. C (kb `beanumber-github-io-1589c05dfd.md`) | **Fixed** (`6e0142d`): the hand table stopped widening at 113 mph and missed 24-39 MLB barrels a season. The skill-card Power population counted every 95+ mph ball as a barrel. |
| Hard-hit %, sweet spot % | EV ≥ 95 / BBE; LA 8-32° / BBE | Savant definitions | OK |
| Spray / pull | φ = atan((hc_x − 125.42)/(198.27 − hc_y)), signed so + = pulled; pull > 15°, oppo < −15° | *Analyzing Baseball Data with R* app. C (kb) | OK |
| xwOBA / xBA / xSLG / xwOBACON | Savant per-ball estimate on BIP, actual value otherwise, over wOBA denom / AB / BIP (`hitter_depth.py`) | Savant roll-up | OK |
| Squared-up, blast | EV ≥ 0.8 × (1.23·bat speed + 0.23·pitch speed); blast = 100·EV/max + bat speed ≥ 164; competitive swings ≈ fastest 90% | *Swinging, Fast and Slow* (kb `papers/2507.01238v1.md`, 2025) quoting MLB's 80% rule | OK. The competitive-swing filter is approximate (documented). |
| Hitter Marcel | 5/4/3 weights on counts, plus 1,200 PA of league rate; no age term | Marcel (kb `sources/baseball/tangotiger-net-2a3f95964b.md`): 3 years, recent heavier, regressed, age factor | OK, with the age term left out (stated in the glossary). The kb has no source for the 1,200 PA constant; it comes from Tango's published Marcel code. |
| Park factors | home/road rate ratio, 3 seasons, EB-shrunk log ratio, venue-level (not halved) | FanGraphs, *Park Factors – 5 Year Regressed* (kb `library-fangraphs-com-8599408685.md`, 2016) | OK for a venue factor. Any future `adj_*` stat must use (1 + PF)/2 for a full season line, per the same source. |
| Decision+ | 100 + 10·z of decision runs/100 among 100+ PA hitters | Site metric (RESULTS-MLB §69) | Documented; descriptive. |
| Run value / 100 | 100 × mean `delta_run_exp`, batter-positive; pitchers flipped | Savant CSV docs (kb) | OK |
