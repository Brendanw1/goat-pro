# Pre-registration: pitch predictability (restart step 2 of 4) — 2026-10-27, before any run

**Why:** §61 found value falling with usage within a count about twice as fast as within-game decay explains
(+0.9–1.2 vs +0.5 runs/100 per unit share). The candidate is predictability: hitters (with scouting reports) guess
what is coming. If a pitch does worse *when it was expected*, holding its quality fixed, predictability has a price.
Step 3's policy needs that price.

## Expectation model (what an advance-scouted hitter knows, leak-free)
`p` = probability of the pitch's own type, given:
- pitcher × season × count × batter side × **previous pitch type in the PA** (`NONE` on the first pitch);
- estimated **leave-one-game-out** (the current game's pitches never inform their own p);
- shrunk with k = 20 toward the same cell without the previous pitch, which is itself shrunk with k = 20 toward
  the pitcher-season-side mix.

Types: FF, SI, FC, SL (SL/ST/SV), CU (CU/KC/CS), CH (CH/FS/FO/SC). Frame: `count_frame.py` (§61).

## Model
`a = β·p + γ·b + FE + ε`
- **a:** realized, denoised value.
- **b:** Pitching+ model value (shape, location, count), so β is the price of being expected *beyond* the pitch's
  quality.
- **FE:** pitcher × season × count × side × type. Variation in p then comes only from sequence context (what was
  thrown before). The FE is two-way with a league **previous-type × type × count** FE, so league-wide sequencing
  effects (e.g. BB after FB) are absorbed. That leaves pitcher-specific sequencing **habits** as the identifying
  variation.
- **SE:** clustered by pitcher.

**Placebo:** the same model with `p_shuf`, where the previous pitch type is shuffled among the pitcher's pitches in
the same season × count × side before p is estimated. It should give β ≈ 0.

## Rule (fixed now)
Selection 2023–26; confirmation 2021–22, run once after selection is written below.

**Predictability is priced** if, in both windows:
1. β < 0, 95% CI excluding 0; and
2. the placebo β's CI includes 0, or is less than half of |β|.

Report the runs/100 effect of p going 0.3 → 0.7.

## Descriptive (no decision)
- β by count group (behind / even / ahead) and by type class.
- Hitter channel: the same model with outcomes swing, whiff | swing, chase (swing at pitches outside the zone), and
  y on contact.
- β × (PA ≥ 2nd time through), the familiarity interaction.

## Amendment after the first selection run (the placebo failed), written before confirmation
First run: β = −0.026 [−0.031, −0.021], but the **placebo β = −0.040**, larger. That is a fail of rule 2, and it
exposes an artifact. Leave-one-game-out p falls on days the pitcher throws a type a lot, and pitchers throw more of
what is working that day. So p is mechanically linked to same-day value. The fix:

- **Cross-fit p by halves.** Pitches in game-parity half h get p estimated only from the other half (same shrinkage
  hierarchy).
- **FE gains `half`:** pitcher × season × count × side × type × half.

Within a cell, p then varies only through the previous pitch type, the scouting-report variation. The placebo
(shuffled previous type, same cross-fit) must again show the CI including 0 or less than half of |β|. Rules
otherwise unchanged. Selection is re-run under this spec, then confirmation once.

## Selection under the amended spec (written before confirmation)
- **β = +0.0025 [−0.0039, +0.0089].** p .3 → .7 gives +0.10 [−0.16, +0.35] runs/100.
- **Placebo:** +0.0016 [−0.0053, +0.0085].
- **Rule 1 fails.** The −0.026 in the first run was the leave-one-game-out artifact.
- **By count group and class:** all near 0, except OS at +0.017 [+.003, +.031], the "wrong" sign (expected
  changeups did better).
- **Hitter channels:** all null (swing +0.56, whiff|swing −0.33, chase +0.15, contact +0.25 pts or runs ×100;
  every CI includes 0).

## Confirmation (2021–22, opened once) and verdict
- **β = +0.0002 [−0.0085, +0.0088]**; placebo +0.0073 [−0.0030, +0.0177].
- Hitter channels all null.
- OS flips sign (−0.026 here vs +0.017 in selection), which is noise.

**Verdict: sequence predictability is NOT priced in MLB 2021–26.** Holding pitch quality and the pitcher's count
tendencies fixed, a pitch that a scouting report on his sequencing habits would have predicted does no worse. The CI
rules out a penalty above about 0.16 (selection) / 0.34 (confirmation) runs/100 for p .3 → .7.

The first-run "effect" (−0.026) was a leave-one-game-out artifact, caught by the pre-registered placebo. **Any
expectation model must be cross-fit across games, never leave-one-game-out.**

**Implications:**
- The §61 usage–value slope steeper than decay is not predictability. It is most likely quality selection (pitchers
  use their truly better pitches more, as M4 shows).
- Step 3 gets **no predictability penalty**. Its costs are §59 decay only.
- **Limit:** count-level tendencies are absorbed by the FE, so whether being a predictable *pitcher overall* costs
  value is not tested. That comparison is cross-pitcher and confounded.
