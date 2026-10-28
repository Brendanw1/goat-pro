# Pre-registration: decay-aware usage optimizer (2026-10-27, written before any run)

**Question:** is there a usage edge? Is a pitcher's mix leaving runs on the table, and does an optimizer's
prediction survive contact with reality?

A static optimizer, which raises use of the pitches with the best run value, always finds gains on paper. Three
things can erase them:
1. Per-type value gaps are noise and don't persist.
2. A pitch's value falls as it is used more: within-game decay (§59) and hitters adapting over a season.
3. Usage changes coincide with quality changes.

The tests below separate these.

## Units and values (Statcast `pitches_all`, regular season)
- **Unit:** pitcher × season × platoon side (same / opposite hand), ≥ 300 pitches. A type counts if used ≥ 3%.
- **Types:** FF, SI, FC, SL (SL/ST/SV), CU (CU/KC/CS), CH (CH/FS/FO/SC).
- **Value v:** count-adjusted run value per pitch. That is `-delta_run_exp` minus the league mean for that
  season × count × platoon, so a putaway pitch is not credited for being thrown in 0-2.
- **Shrinkage:** toward the league mean for type × platoon, with k = σ²/τ² estimated per type on the selection seasons.
- **Role:** SP if ≥ 50 pitches per game. Pitches per PA and the times-through-order weights are measured per role.

## Decay-aware value
- Decay curve: §59's strict MLB bins, f(S) = 0, −.0024, −.0045, −.0053 (at S = 0, 1, 2, 3.5), flat beyond 3.5.
- It is scaled by class (FB .00161, BB .00152, OS .00412, relative to pooled .00141).
- Penalty at usage u: `pen(u) = Σ_k w_k f(u · P · (k−1))`, where P is pitches per PA and w_k the share of PAs that
  are the k-th time through.
- `v(u) = v0 + pen(u)`, with v0 = observed v − pen(observed u).
- **Static optimizer:** v constant.
- **Decay-aware optimizer:** maximize Σ u·v(u).
- **Bounds for both:** |Δu| ≤ .10 per type, u ≥ .03 for types kept, Σu = 1.

## Season pairs
- **Selection:** 2023→24, 24→25, 25→26.
- **Confirmation:** 2021→22, 22→23, run once after the selection results are written below.
- A unit enters a pair if it qualifies in both seasons. Types are those present in both.
- **Bootstrap:** 1,000 reps, each pitcher resampled once across all pairs (`judge.cluster_w` rule).

## Tests
- **T1 (stability):** correlation of within-unit type value deviations (v_x − unit mean) between t and t+1.
  - Any edge requires r > 0 (CI).
- **T2 (adaptation):** within unit × type, regress Δv on Δu.
  - Controls: v_t, Δvelo, Δpfx_x, Δpfx_z, Δspin.
  - Compare the slope with the slope implied by the decay curve (−pen′ at the mean).
  - Steeper than implied means hitters adapt beyond within-game decay.
- **T3 (primary: does the optimizer's arithmetic predict reality?)**
  - Predicted gain of the actual t→t+1 usage change, from year-t values:
    - `G_static = Σ Δu·v̂_t`
    - `G_decay = Σ [u1·v(u1) − u0·v(u0)]`
  - Realized: R = change in the unit's count-adjusted RV/100 from t to t+1.
  - Regress R on G with usage-weighted Δvelo / Δpfx / Δspin as controls.
  - **Edge exists** if the G_decay slope > 0 (95% CI) in both selection and confirmation.
  - **Decay-aware wins** if |slope_decay − 1| < |slope_static − 1| with the bootstrap CI of the difference
    excluding 0, in both windows.
  - The calibration slope also discounts T4: realistic edge = paper edge × slope.
- **T4 (edge sizing):**
  - Paper gain of the optimal mix over the actual mix (decay-aware), in runs/100 and runs/season, by role.
  - Which classes the optimizer moves usage toward.
  - Kovash–Levitt check: does the class with the higher decay-adjusted marginal value in t still have the higher
    realized value in t+1?
- **T5 (other outcomes, descriptive):** the same T3 regression with realized Δwhiff/swing, ΔCSW% and ΔK% as
  outcomes. Optimal-vs-actual mix projected whiff, CSW and zone%.

Nothing is tuned after the selection run except what is written below before confirmation.

## Implementation details (fixed before the first run)
- **T3 mix:** the types common to t and t+1 (≥ 3% in each), with usage renormalized over them. A unit enters only
  if those common types cover ≥ 85% of its pitches in both seasons. Pitchers who add or drop a big pitch are out:
  the optimizer has no t-value for a new pitch.
- **T2 and T3 regressions:** WLS with harmonic-n weights, n_t·n_t1 / (n_t + n_t1). OLS is reported beside it.
- **Exposure:** decay exposure counts all pitches to the batter, in any count.

## Selection result (2023→26) and amendment, written before confirmation is opened
Selection, as pre-registered:

| Test | Result |
|---|---|
| T1 stability | r = .33 [.30, .37] |
| T2 slope | **+4.3** [+3.7, +4.9], but decay implies −0.5 |
| T3 slope, static | 4.4 [3.1, 5.7] |
| T3 slope, decay-aware | 3.8 [2.6, 5.1] |
| "Decay-aware wins" rule | +0.60 [+0.29, +0.94] |

**T2 and T3 are not interpretable as designed.** Usage in t+1 reacts to performance in t+1: pitchers throw more of
what is working. So Δu and the realized value move together by reverse causality. The positive T2 slope proves it.
The decay-aware "win" is only because G_decay is smaller than G_static, not better calibrated. The T3 decision rule is
withdrawn. It is replaced, before confirmation, by:

- **ITT (intent-to-treat) versions of T2 and T3:**
  - Usage in t+1 is measured in **March/April only**, where the mix is set mostly from t information.
  - Value (T2 Δv, T3 R) in t+1 is measured **May 1 onward only**.
  - The t+1 unit needs ≥ 80 pitches before May and ≥ 200 from May on.
  - Later results cannot cause April usage. The confounding left is offseason quality change, which the physical
    controls partly absorb.
- **Rules:**
  - Edge exists if the ITT T3 slope on G_decay > 0 (95% CI) in both windows.
  - Decay-aware is better calibrated if |slope_d − 1| < |slope_s − 1| with the CI of the difference excluding 0, in
    both windows.
  - The ITT T2 slope is compared with the decay-implied slope (−0.5). It is descriptive.
- **T1 and the Kovash–Levitt persistence check stand as run.** Neither uses t+1 usage, so neither is contaminated.
  - Kovash–Levitt in selection: predicted gap +0.59 runs/100, realized +0.35 [+0.19, +0.51], about 60% persistence.

## Confirmation result (2021→23, opened once) and verdict
| Test | Selection 2023→26 | Confirmation 2021→23 |
|---|---|---|
| T1 type-value stability r | .33 [.30, .37] | .42 [.39, .46] |
| Kovash–Levitt: predicted gap → realized gap (runs/100) | .59 → **.35** [.19, .51] | .65 → **.39** [.20, .59] |
| ITT T2 Δv per usage share (decay implies −0.5) | −0.12 [−0.74, +0.49] | −0.30 [−1.08, +0.48] |
| **ITT T3 slope, G_decay** | 2.34 [0.99, 3.65] | **1.34 [−0.25, 2.86]** |
| ITT T3 slope, G_static | 2.65 [1.40, 3.96] | 2.00 [0.37, 3.50] |
| ITT calibration, decay − static | +0.31 [−0.11, +0.70] | +0.66 [−0.78, +0.93] |
| Pitchers' own move toward the optimum (projection) | .11 [.07, .15] | .10 [.06, .16] |
| Paper gain, decay-aware, median runs/season: SP / RP | 1.16 / 0.40 | 1.29 / 0.45 |

**Verdict:**
- **Edge, per the T3 rule: NOT CONFIRMED.** The confirmation CI includes 0. The point estimate is about 1.3, so there
  is no sign the paper gain is overstated, but n = 619 can't confirm it.
- **Decay-aware better calibrated: NOT CONFIRMED.** The two optimizers can't be told apart.
- **What does replicate:**
  - Value gaps between a pitcher's pitch types persist at about 60% of the shrunk prediction (Kovash–Levitt, both
    windows).
  - No hitter adaptation beyond within-game decay is detectable (ITT T2 is consistent with −0.5).
  - Pitchers close only about 10% of the gap on their own.
- **Optimizer direction:**
  - Stable across windows: vs same-side hitters, more SL / FC / SI, fewer CH / CU / FF.
  - Not stable across eras: vs opposite-side hitters (CU +0.1 → +6.3, SI −0.8 → −5.5).
  - Decay mostly changes the call on changeups vs opposite-hand hitters: static +1.9 pts, decay-aware −0.1.
- **Leading alternative explanation, untested:** fastballs carry the strike-throwing burden when behind in the count.
  Count adjustment removes count means, not the selection of which pitch is thrown in which count. Next test:
  per-count-state minimax (even and ahead counts only).
