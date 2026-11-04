# The FanGraphs gap (step 1 sanity check)

Sample: dev pitchers (70% of MLB pitchers), next-season pairs 2021->22 ... 2025->26, >= 200 graded pitches in S,
>= 120 outs in S+1, with a FanGraphs row: n 1,117 pitcher-seasons, 490 pitchers. r with minus next-season value.
FanGraphs leaderboards fetched 2026-11-04 (type 36, `sp_*` and `pb_*`); kept local in `data/`, not committed.

| grade (season S) | next RA9 | next FIP |
|---|---|---|
| our Stuff+ (Whiff+ cross-fit) | .172 | .299 |
| our Command+ analogue | .046 | .010 |
| our Stuff+ + Command+ blend (dev OOF weights) | .167 | .282 |
| Pitching+ v5 (shipped, §56) | .190 | .316 |
| M0_T0 single regressor (OOF) | .218 | .302 |
| M0_T0 fit in-sample (diagnosis only) | .246 | .342 |
| FG Stuff+ | .209 | .416 |
| FG Location+ | .042 | .012 |
| FG Pitching+ | .233 | .387 |
| PitchingBot overall | .209 | .335 |
| K-BB% / xFIP / SIERA | .248 / .228 / .186 | .332 / .334 / .353 |

FG Pitching+ minus our blend on next RA9: +.066 [+.010, +.124]. Our M0_T0 minus FG Pitching+: RA9 -.015
[-.056, +.027] (approaches it), FIP -.085 [-.128, -.042] (does not).

## Measured so far

- **In-sample advantage** (one diagnostic fit, already run before the pause): fitting M0_T0 on every dev pitcher and
  scoring the same pitchers lifts next RA9 .218 -> .246 (above FG Pitching+) and next FIP .302 -> .342, which
  closes about half of the FIP gap. FanGraphs grades are trained on these seasons and these pitchers, so part of
  their edge is the memorization that pitcher-grouped cross-fit removes (RESULTS-MLB §17: seen .38 vs unseen .055
  per-pitch r for Stuff+ v2).

## Hypotheses for the rest (none tested; no new fits were run for this note)

1. **Target.** FG Stuff+ is trained on run value; our Stuff+ (Whiff+) is a whiff-per-swing grade. FIP is K, BB and
   HR; an RV-trained stuff grade carries HR and called-strike information a whiff grade does not. Test: an RV-target
   Stuff+ (no location) under the same cross-fit, against Whiff+ on next FIP.
2. **Features.** FG uses an axis-differential (seam-shifted wake) term and secondaries relative to the primary
   fastball; we exclude spin_axis (era drift) and our anchor is the p95-velo fastball. Test: add the axis
   differential with a per-season correction.
3. **Training seasons and pitchers.** Each of our fold models sees about 56% of pitchers (70% dev x 4/5 folds), and
   Whiff+ trains on 2023-24 only. FanGraphs trains on more seasons and every pitcher. Test: a learning curve
   (25/50/100% of training pitchers) on the same folds.
4. **Cross-fit cost.** Scoring every pitcher with a model that never saw him is the honest number, and it costs
   level. This is the in-sample point above, stated as a price: the gap that remains after hypotheses 1-3 is the
   part we should not try to close.
5. **Aggregation.** FG season grades are pitch-weighted means of per-pitch grades scaled per pitch type; ours are
   plain means of count-normalized per-pitch value. Per-type scaling changes the arsenal weighting. Test: re-aggregate
   our OOF values with per-type z-scaling (no refit).
6. **Selection of the comparison sample.** FG rows exist only for pitchers FanGraphs lists in S; the >= 120 outs
   floor in S+1 favours survivors. Both sides see the same rows, so this moves levels, not the gap.
