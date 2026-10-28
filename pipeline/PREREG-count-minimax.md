# Pre-registration: per-count minimax (restart step 1 of 4) — 2026-10-27, before any run

**Why:** §60's season-mix frame mixed "throw better pitches" with "get into better counts". Pitchers choose a pitch at
a decision node (count × batter side), not a season share. Test at the node.

## Values, per pitch, Statcast 2021–26 (the Pitching+ frame: `stuff_v2.prepare(add_physics(load_features()))` →
`location_plus.target` → `pitching_plus.add_batter`, GOAT_LO=2020)
- **a = realized, denoised:** `y` (BIP via xwOBA-by-count, takes via called-strike probability, swings as realized)
  minus the league mean of y for season × count × batter side. This is the game-theory payoff: it carries how hitters
  actually play this pitcher.
- **b = model value:** cached `pitchval_raw` (f(shape, location, count) − E[y | count], cross-fit). This is pitch
  quality for a generic hitter. It cannot see this pitcher's tendencies.
- **Node:** pitcher × season × count × batter side. **Types:** FF, SI, FC, SL (SL/ST/SV), CU (CU/KC/CS),
  CH (CH/FS/FO/SC). A type enters a node with ≥ 10 pitches; a node needs ≥ 2 such types.

## Theory being tested
At a minimax equilibrium, *marginal* values are equal within a node. With value falling in usage (§59 decay,
predictability), marginal = v + u·v′ (v′ < 0). So the more-used type should show the **higher average** value:
`v_x = M + u_x·|v′_x|`.
- **Equilibrium predicts** within-node deviations of a are positively related to usage share.
- **Misallocation predicts** the best-average pitch is under-used: a flat or negative relation, with deviations that
  persist.

## Tests
Selection 2023–26; confirmation 2021–22, run once after selection is written below. Pitcher-cluster bootstrap,
1,000 reps, each pitcher drawn once.
- **M1 persistence:** split each pitcher-season by game_pk parity. Correlation of within-node type deviations of a
  between halves.
  - r > 0 means real per-node gaps.
- **M2 equilibrium slope:** within-node deviation of a in half B, regressed on within-node usage-share deviation in
  half A. Halves are swapped and averaged. Usage from the other half blocks within-half reaction.
- **M3 the fastball strike burden:** pooled usage-weighted FB−BB value gap (a and b). Three versions:
  - (i) the season-level frame, count-adjusted only;
  - (ii) within node (node fixed effects);
  - (iii) by count group: behind (1-0, 2-0, 3-0, 2-1, 3-1), even (0-0, 1-1, 2-2, 3-2), ahead (0-1, 0-2, 1-2).
- **M4 the situational premium:** within node, regress (a − b) on usage share. A negative slope means
  rarely-thrown types beat their quality (surprise value). This links to step 2.

## Decision rule (fixed now)
- **Misallocation confirmed** if, in both windows, M1 r > 0 (CI) **and** the M2 slope < 0 (CI excludes 0).
- **Equilibrium-consistent** if M2 > 0 (CI) in both. Otherwise **inconclusive**.
- **The fastball "burden" explains the §60 gap** if the within-node FB−BB gap on a (M3 ii) is less than half the
  season-level gap (M3 i), with the bootstrap CI of the ratio excluding 0.5 from above.

## Power
Nodes come from about 4.5M pitches. M1 and M2 are pitch-level within node, so the noise SE per node is about
sd(a)/√n. This is checked before the decision, not after: the selection run reports the minimum detectable M2 slope
(2.8 × SE).

## Implementation details (fixed before the first run)
- **Halves:** a type needs ≥ 10 pitches in the node over the full season and ≥ 3 in each half.
- **Within-node deviations:** n-weighted over the node's types in that half.
- **Usage deviation:** u minus the unweighted mean u of the node's eligible types.
- **Weights:** harmonic n of the two halves.
- **Bootstrap:** multinomial pitcher weights.
- **FB vs BB:** FB = FF + SI, BB = SL + CU. FC and CH appear in M1 and M2 only.

## Selection result (2023–26), written before confirmation is opened
- **M1:** r = +.026 [.017, .035]. Per-node gaps barely persist within a season (most node-level variation is noise).
- **M2:** slope +1.17 [1.00, 1.35] runs/100 per unit usage share (MDE 0.25). The more-used type is the better one
  within a count, the equilibrium sign.
- **M4:** +0.46 [+0.26, +0.66], the opposite of the predicted sign. Heavily used types beat their model value.
  Usage carries information the model lacks.
- **M3:** FB−BB on a. Season −0.17 [−.24, −.10], within node −0.22 [−.30, −.14], ratio 1.30 [1.12, 1.61]. So the
  strike burden does **not** explain the gap. By count group: behind −0.20, even −0.32, ahead −0.07 (ns). The model
  value b agrees.

## Confirmation (2021–22, opened once) and verdict
| | Selection | Confirmation |
|---|---|---|
| M1 persistence r | +.026 [.017, .035] | +.029 [.014, .045] |
| M2 equilibrium slope (runs/100 per unit share) | +1.17 [1.00, 1.35] | +0.87 [0.68, 1.06] |
| M4 (a−b) on usage | +0.46 [.26, .66] | +0.33 [.12, .54] |
| M3 FB−BB, season / within node | −0.17 / −0.22 | −0.29 / −0.32 |
| M3 ratio (within node / season) | 1.30 [1.12, 1.61] | 1.06 [0.90, 1.23] |

**Verdict:**
- **Misallocation NOT supported.** At the count node, pitchers' allocation is **equilibrium-consistent** (M2 > 0 in
  both windows, the pre-registered rule). The more-used pitch is the better one, by about 0.9–1.2 runs/100 per unit of
  usage share. That is steeper than within-game decay alone (+0.5), so value falls with usage faster than decay
  explains. Predictability, i.e. hitters guessing, is the likely reason, and step 2 tests it.
- **M4 positive in both windows.** Usage tracks quality the model cannot see, so pitchers and teams carry private
  information about their pitches. An optimizer built on model values alone would override better information.
- **The one durable anomaly:** fastballs trail breaking balls by about 0.2–0.3 runs/100 pitches **within the same
  count**, on realized value and on model value. The strike burden does not explain it (ratio ≈ 1).
  - It is the Kovash–Levitt pattern, still present in 2021–26.
  - At current usage it is worth about 1 run per season per starter for a 10-point FB→BB shift, before decay.
  - Candidate reasons it is left on the table: per-pitch run value does not price arm stress, command variance or
    setup value.
