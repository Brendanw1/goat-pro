# Pre-registration: count-state usage policy with off-policy evaluation (restart step 3 of 4) — 2026-10-27, before any run

**Why:** §60 judged an optimizer by natural year-to-year usage changes, which had no power and were confounded.
Within a node (pitcher × season × count × batter side), pitchers randomize their pitch type. That randomization is a
behavior policy μ, so a target policy π can be scored on pitches already thrown by importance weighting
(off-policy evaluation, OPE). Steps 1–2 set the constraints:
- start from the pitcher's own mix (usage carries private information, §61 M4);
- tilts are small and shrunk;
- no predictability penalty (§62).

## Data and timing
- Frame: `count_frame.py` (§61). a = denoised realized value, count × side adjusted; b = Pitching+ model value.
- Policy parameters come from **season t**. They are evaluated on **season t+1** pitches.
- **Selection pairs:** 2023→24, 24→25, 25→26. **Confirmation pairs:** 2021→22, 22→23, run once after selection is
  written below.

## Behavior policy μ (season t+1, cross-fit)
- μ(type | node) for a pitch in game-parity half h is estimated from half 1−h of t+1, shrunk with k = 20 toward
  the pitcher × season × side mix.
- For P4, μ also conditions on the batter's PA number vs this pitcher in the game (1, 2, 3+), shrunk with k = 20
  to the node μ.
- **Support:** types with μ ≥ .02 in the node.

## Target policies, all tilts of μ
- **P1 quality tilt:** π ∝ μ·exp(λ·d_b), where d_b is the type's season-t node mean of b minus the μ-weighted node mean.
- **P2 performance tilt:** the same with d_a, where a is shrunk to b with k = 300 pitches. Node-level a barely
  persists (§61 M1), so it is heavily shrunk.
- **P3 fastball → breaking-ball shift (§61 anomaly):** within nodes holding both families, move 5 points of share
  from FB (FF, SI) to BB (SL, CU), proportional within each family.
- **P4 save the offspeed:** in the batter's 1st PA, the OS share × 0.7, with the 0.3 removed spread proportionally
  over the other types. In his 3rd+ PA, the OS share × 1.3. 2nd PA unchanged.
- **Placebo P0:** P1 with d_b randomly permuted across the node's types. It must show no gain.
- **λ ∈ {10, 25} per run.** Typical |d| is 0.01–0.03 runs per pitch, so a type's share moves by about ×0.75–×1.5.
- Types new in t+1 get d = 0.

## Estimator
- **Doubly robust per pitch:** `Σ_x π(x)·q̂(x) + w·(a − q̂(type))`, with `w = π(type)/μ(type)` clipped at 3.
- **q̂(x | node):** the other-half t+1 node × type mean of a, shrunk to the node × type mean of b (k = 300).
- **Gain** = mean(DR − a) × 100, in runs per 100 pitches.
- **Self-normalized IPS** is reported beside it.
- **Effective sample size** (Σw)²/Σw² is reported.
- **Bootstrap:** pitcher-cluster, 1,000 reps, each pitcher once.

## Rule (fixed now)
**A policy has an edge** if, in both windows:
1. its DR gain > 0 with a 95% CI excluding 0 at either λ (P1/P2) or at its fixed setting (P3/P4); and
2. the placebo P0's CI includes 0 at the same λ.

Report the gain as runs per SP season (× 30 for about 3,000 pitches).

**Untestable assumption, stated now:** OPE needs pitch choice within a node to be as-good-as-random given μ.
Pitchers also choose on the specific hitter, runners and feel. The placebo checks the estimator, not this assumption.

## Amendment after the first selection run (estimator bias), written before confirmation
First run:
- **The DR placebo was −0.022 [−.026, −.017]** (λ10) and −0.029 (λ25), so rule 2 failed.
- Every DR gain was about −0.02, so the estimator is biased.
- The cause: with π = μ the DR "gain" is Σ(μ − f)·q̂, where f is this half's realized mix and μ is cross-fit from the
  other half. That is nonzero.
- IPS on the same run: P1 +0.011 / +0.020, P2 +0.012 / +0.022 (CIs > 0), P3 +0.002 (ns), P4 −0.003 (ns), placebo
  −0.002 / −0.009.

**Fix:** score every policy as the DR **contrast with the identity policy**:
`G = mean[ Σ_x (π − μ)(x)·q̂(x) + (w − 1)·(a − q̂(type)) ]`. The identity's bias cancels, and π = μ gives exactly 0.

**Note on the placebo, written now:** §61 found μ near equilibrium, with the more-used types better. A random tilt
on average moves share toward less-used types, so its *expected* value is slightly negative, not 0. So rule 2 is
restated: **the placebo's gain must not be positive** (its upper CI ≤ the policy's lower CI). Rule 1 is unchanged.

## Selection under the amended estimator (written before confirmation)
| Policy | DR gain, runs/100 |
|---|---|
| Identity | −0.0001 (✓) |
| Placebo λ10 | −0.0025 [−.0056, +.0008] |
| Placebo λ25 | −0.0094 |
| P1 λ10 / λ25 | +0.0100 [+.0064, +.0136] / +0.0188 [+.0102, +.0269] |
| P2 λ10 / λ25 | +0.0111 [+.0074, +.0147] / +0.0214 [+.0133, +.0297] |
| P3 | +0.0011 (ns) |
| P4 | −0.0022 (ns) |

P1 and P2 pass both rules in selection.

**Descriptive add-on for confirmation (no decision):** OPE scores pitches at current usage, so it cannot see value
falling with usage. The reported adjustment is the cost `s·Σ Δu·(u + Δu)` per pitch, with s = 0.5 (§59 decay) and
s = 1.0 (§61 slope, an upper bound because it includes quality selection).

## Confirmation (2021→23, opened once) and verdict
| Policy | Selection DR | Confirmation DR | Usage-response cost (s = .5 / 1) |
|---|---|---|---|
| Identity | −0.0001 | +0.0006 | — |
| Placebo λ10 | −0.0025 [−.0056, +.0008] | +0.0038 [−.0000, +.0075] | — |
| Placebo λ25 | −0.0094 | +0.0040 [−.0041, +.0123] | — |
| P1 quality λ10 | +0.0100 [.0064, .0136] | +0.0081 [.0035, .0125] | −.003 / −.006 |
| P1 quality λ25 | +0.0188 | +0.0132 [.0034, .0237] | −.013 / −.025 |
| P2 perf λ10 | +0.0111 [.0074, .0147] | +0.0093 [.0049, .0138] | −.003 / −.006 |
| P2 perf λ25 | +0.0214 | +0.0159 [.0059, .0262] | −.013 / −.025 |
| P3 FB→BB | +0.0011 (ns) | +0.0085 [.0034, .0137] | +.001 |
| P4 save-OS | −0.0022 (ns) | −0.0038 [−.0076, .0000] | −.002 |

**Verdict: no policy confirmed.**
- **P1/P2:** pass rule 1 in both windows, but fail the restated rule 2 in confirmation. The placebo upper CI (.0075
  / .0123) is above the policies' lower CIs.
- **P3:** fails selection.
- **P4:** null to negative.

**Size, even on point estimates:** the best tilt (P2 λ10) gains +0.009–0.011 runs/100 before usage response and
about +0.004–0.008 after. That is ≈ 0.1–0.25 runs per SP season. At λ25 the usage-response cost erases the gain.

**Reading across §60–§63:** MLB pitch usage is close to equilibrium. Within-count allocation tracks quality (with
information the models lack), and sequence predictability is not priced. Policy tilts that survive OPE are worth
tenths of a run per season. **The value is in pitch quality, not mix.**
