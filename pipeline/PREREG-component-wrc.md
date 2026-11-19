# Component-adjusted wOBA vs one run-scale park factor, MLB confirmation on Retrosheet: pre-registration

Owner go 2026-11-19. Written before any outcome read on the sealed block. The design, arms, metric and pass rule
below are fixed now; the dev block fixes handling details and the wOBA scale only.

The information used here was obtained free of charge from and is copyrighted by Retrosheet. Interested parties may
contact Retrosheet at 20 Sunset Rd., Newark, DE 19711.

## Question

College dev (vt_baseball `research/park-dimensions/PLAN-P1-data-layer.md` section 2, `RESULTS-P1.md` section 2):
**component-adjusted wOBA** (each hit's wOBA weight divided by its park's 1B/2B/3B/HR factor, clipped to [0.5, 2])
beat **one run-scale park factor** (0.45 x pooled home/road run ratio) as a hitter park adjustment: H1 c - a +.0109
[+.0020, +.0202], H2 +.0109 [-.0025, +.0235]. That read was development only. The owner intends to adopt (c) on the
college site; this read decides whether we can say it held up on MLB.

## Data and seal

- **Source:** Retrosheet parsed play-by-play (`https://www.retrosheet.org/downloads/{season}/{season}csvs.zip`:
  `plays.csv`, `gameinfo.csv`), regular season. Raw zips and slim parquets in `cache/retrosheet/` (gitignored).
  `component_wrc.py extract` keeps PA rows (`pa == 1`) with game, park (`site`), batting side, batter id and the event
  (IBB / BB / HBP / K / 1B / 2B / 3B / HR / SH-or-interference / out; ROE, FC = out), plus per game: home, away,
  park, runs, PA. Only row counts are printed.
- **Unspent:** the holdout ledger (`docs/ml-hardening-plan.md` §2 and the park-factor row) has every MLB event
  season 2020-26 spent, 2015-19 Statcast spent for park factors, and pre-2020 game events never fetched. No season
  >= 2015 and no 2027 is used. Caveat: pre-2015 MLB season lines (not home/road splits or events) may have been seen
  in aggregate as prospect-model features, so this is a strong seal for a park claim, not for every hitter claim.
- **Blocks (disjoint):** **dev 2001-2007**; **sealed 2008-2014**. Each block is self-contained: its factors are
  built only from its own seasons. The sealed block is read **once** by `component_wrc.py sealed`, which writes
  `results/component_wrc_SEALED.json` before the read, refuses to run if it exists, and refuses a script whose
  sha256 is not recorded in this file.

## Arms (each applied per PA at the park the PA was in)

wOBA per PA with fixed weights BB .69, HBP .72, 1B .88, 2B 1.24, 3B 1.56, HR 1.95 (the college weights); IBB, sac
bunts and catcher interference are dropped (standard wOBA denominator: AB + uBB + HBP + SF).

- **raw:** no adjustment.
- **(a) one run-scale PF (site recipe):** `build_park_factors_pooled.py` ported. A team-season's park = its modal
  stadium; ratio = (runs/PA in its home games at that park, both teams) / (runs/PA in its road games, both teams,
  neutral-site home games counted as road), team-seasons with 8+ home and 8+ road games, summed over the pooled
  seasons, keyed by park. PF = 1 + 0.45 x (ratio - 1). Adjusted weight = w - SCALE x lgR/PA(s) x (PF - 1).
- **(c) component:** the same cells and seasons; for k in 1B/2B/3B/HR, y_k = log of (k per BIP at home) / (k per
  BIP in the team's road games), BIP = PA - BB - HBP - K (HR included). **Results-only EB** (physics adds nothing on
  MLB, PREREG-park-eb.md): v = 1/n_home + 1/n_road, tau2 = max(0, mean(y^2 - v)) across parks, shrunk
  theta = tau2/(tau2 + v) x y toward 0; m_k = exp(theta). Adjusted weight of a k hit = w_k / clip(m_k, 0.5, 2);
  BB, HBP, K, outs unchanged.
- PAs at a park with no cell in the pooled seasons (neutral sites; a park's only season being the target) get
  factor 1 in both arms.
- **No target-season leak:** factors for a read pool the block's seasons other than every season the read uses
  (H1 season s: all but s; H2 s -> s+1: all but s and s+1). Stricter than the college arm (a) (which dropped only
  the target season) and the same for both arms.
- College arm (b) (G5 run PF) is not ported: it needs the launch/physics model, and the question is (c) vs (a).

## Designs and metric (college P1 section 2)

- **H1** home -> road, same season: predictor = home wOBA (adjusted), target = road wOBA (raw). Hitter-seasons with
  100+ PA and 30+ BIP both home and road.
- **H2** season s all PA (adjusted, 100+ PA) -> season s+1 road wOBA (raw; 30+ PA and 30+ BIP).
- Metric: r(adjusted predictor, raw target) - r(raw predictor, raw target); pairwise c - a. Hitter-cluster
  bootstrap (batter id across seasons), 1,000 draws, seed 1, percentile 95% CIs.

## Pass rule (the college rule, arms a and c)

1. An arm is eligible only if its gain over raw has CI lower > -.01 in both designs.
2. **(c) is confirmed on MLB (PASS)** only if it is eligible, beats (a) at the point in both H1 and H2, its CI vs
   (a) excludes 0 in its favour in at least one design, and in neither design is it worse than (a) with a CI
   excluding 0.
3. Otherwise **FAIL**: we do not tell the owner it held up on MLB.

**Power (MDE):** MDE80 = 2.8 x bootstrap SE of c - a (two-sided .05, 80% power), reported per design from the dev
block below and again from the sealed read.

## Failure diagnosis plan

A FAIL gets a data / handling / modeling diagnosis, flagged when it could be our error:
- **data:** park reconfigurations inside a block (same Retrosheet park id, moved fences: e.g. Petco 2013, Citi Field
  2012, Safeco 2013, Comerica 2003); thin cells (park counts, shrink weights, clip counts); MLB park spread vs the
  college spread (SD of the park term in wRC+ points under each arm).
- **handling:** event mapping (counts vs the Retrosheet flags), factor key (modal park), the leave-out seasons,
  clip counts.
- **modeling:** results-only EB vs the college physics prior; full-ratio component vs the 0.45-kept run factor
  (size of each arm's park term and their correlation); whether MLB's smaller spread leaves no detectable gap
  (MDE vs the college effect +.011).

## Development (2001-2007; nothing here is a claim)

`component_wrc.py dev` (2026-11-19, about 10 s): 7 seasons, 1.31M PA rows, 35 park cells per read. Every number is
in `results/component_wrc_dev.json`.

- **SCALE** (wOBA scale for the fixed weights) = 1 / slope of team-season R/PA on team-season wOBA, 210 dev
  team-seasons: **1.3163**. lgR/PA per season .120-.125 (sealed: each sealed season's own league R/PA, a league
  constant, as the site uses its season constants).
- Event mapping checked on 2001 plays: IBB rows carry `walk = 1` and `iw = 1` (IBB is tested first), K-reached-safe
  rows carry `k = 1`, hit flags are exclusive.
- Factors (H1 2007, pooled 2001-06): EB tau2 1B .0005 / 2B .0092 / 3B .106 / HR .0169; median shrink weight .60 /
  .89 / .89 / .89. Run PF (a) .92 (Qualcomm) to 1.12 (Coors); Coors m: 1B 1.06, 2B 1.08, 3B 1.45, HR 1.20. **0 clips**
  (the [0.5, 2] clip never binds on MLB pooled cells).
- Park term SD in wRC+ points (2007 hitters, 100+ PA): (a) 1.7, (c) 3.6; r(a term, c term) .70.

| read | n (hitters) | r raw | (a) - raw | (c) - raw | **(c) - (a)** | MDE80 of c - a |
|---|---|---|---|---|---|---|
| H1 home -> road | 3,004 (845) | .3548 | +.0117 [+.0079, +.0154] | +.0172 [+.0073, +.0259] | **+.0055 [-.0017, +.0125]** | .010 |
| H2 s -> s+1 road | 2,131 (636) | .4312 | +.0026 [+.0001, +.0050] | +.0038 [-.0024, +.0097] | **+.0012 [-.0037, +.0057]** | .007 |

Dev rule outcome (not a claim): both arms eligible; (c) beats (a) at the point in both designs, neither CI excludes
0, so the rule would keep (a). No handling bug was found; nothing was changed after the dev read. The sealed block
has the same structure (7 seasons), so expect MDE80 about .010 (H1) and .007 (H2): the read can detect a gap the size
of the college H1 effect (+.011) but not much smaller.

## Freeze

Frozen 2026-11-19 before the sealed block was extracted or read:
- script `pipeline/component_wrc.py` sha256 `d88168ee7f624b2a0854d0935ea54ec39f9b5bdac1f556866e03e640aec42a40`
- `results/component_wrc_dev.json` sha256 `1c0d5d79ad81529688d80685ca264a7beae87ea625645bd7d6c63d087814e6bb` (SCALE 1.3163 is read from it)
- `sealed` refuses to run unless the script hash above is in this file and `results/component_wrc_SEALED.json`
  is absent.

## Sealed result (2008-2014)

SEALED_PLACEHOLDER
