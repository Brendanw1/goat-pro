# Pre-registration: pitch buyback and decay (2026-10-27, written before any run)

**Question (Driveline, Ramilo & Lambert, as summarised in Greenberg "Arsenal Models in College Baseball", 2025).**
Each time a pitcher throws a pitch type, it gets cheaper for the hitter to recognise next time (decay). Throwing
the other pitches in the arsenal makes it dearer again (buyback). If that is true, the price of throwing pitch X
once more depends on what the hitter has already seen, and a usage optimizer must carry it.
§57 tested only the immediately previous pitch. This tests accumulated exposure within a game.

## Data
- Statcast `pitches_all`, regular season, pitch types with a known label (no PO/IN/EP/KN/null).
- **Selection:** 2023–2026.
- **Confirmation:** 2021–2022. These seasons are looked at once, after the selection result is written below.
- Pitches enter only from a batter's 2nd+ PA against this pitcher in the game, where cross-PA exposure exists.

## Exposure (counted from this pitcher to this batter, this game, in **earlier PAs only**)
- `S` = earlier pitches of the same `pitch_type`.
- `O` = earlier pitches of any other type.
- Placebos `S_f` and `O_f`: the same counts from **later** PAs in the game. They should carry no causal effect. A
  nonzero contrast exposes "a pitch that is working gets thrown more" selection.

## Model (OLS; fixed effects for pitcher × pitch_type × season, absorbed by demeaning)
`y = bS·S + bO·O + bSf·S_f + bOf·O_f + count dummies + times-through-order dummies + pitcher pitch count
(linear, quadratic) + platoon + FE`

- **Primary y:** pitcher-positive run value of the pitch, `-delta_run_exp`.
- **Secondary:** whiff per swing (swings only). Descriptive, no decision.
- **Inference:** standard errors clustered by pitcher (each pitcher counted once across seasons).

**Contrast** `D = bO - bS`: the value of one more earlier pitch of another type, relative to one more of the same
type. D > 0 means decay, buyback, or both. bS and bO are reported separately, to see which side carries it.

## Decision rule (fixed now)
Decay/buyback is **confirmed** only if, in **both** selection and confirmation:
1. D > 0 with a 95% CI excluding 0; and
2. `D - Df > 0` with a 95% CI excluding 0, where `Df = bOf - bSf` is the placebo contrast.

**Useful for a usage optimizer** additionally requires D ≥ 0.0005 runs per pitch per unit of exposure (0.05 runs
per 100 pitches per exposure shift). Smaller than that, no pitcher-level mix could move it measurably.

Per-class splits (FB / breaking / offspeed target pitch) and same-family robustness (SL=ST=SV, CU=KC=CS,
CH=FS=FO=SC) are descriptive. Neither can rescue a failed primary.

## Selection result (2023–26) and amendment, written before confirmation is opened
Selection passes the rule as written: D = +0.0021 [+0.0017, +0.0025] runs per pitch, and D − Df > 0. **But the placebo
is not a valid null.** Df = −0.019, ten times D. Future exposure is downstream of the current pitch: pitchers throw
more of what just worked. So Df measures the pitcher reacting, not confounding of the past, and D − Df passes
trivially. Condition 2 is withdrawn as uninformative. It is replaced, before confirmation, by these robustness
requirements. D must stay > 0 (95% CI) under:
- **R1 strict FE:** pitcher × pitch_type × **game** FE (absorbs "today's version of the pitch"), plus batter × season FE
  (absorbs hitters who get pitched differently and hit differently). Alternating projections.
- **R2 dose-response:** binned S (0, 1, 2, 3–4, 5+) with O held linear. The price should not reverse with dose.
Biases left after R1: within a game, a batter who handled X earlier sees less X later. That biases bS **upward**,
against finding decay.

## Results (2026-10-27)
| Run | D = bO − bS (runs per pitch per earlier look) | bS (same type) | bO (other types) |
|---|---|---|---|
| Selection 2023–26, plain FE | +0.0021 [+0.0017, +0.0025] | −0.0018 | +0.0003 |
| Selection, strict FE (R1) | +0.0014 [+0.0009, +0.0019] | −0.0010 | +0.0004 |
| **Confirmation 2021–22, plain** | **+0.0015 [+0.0009, +0.0022]** | −0.0015 | +0.0000 |
| **Confirmation, strict** | **+0.0011 [+0.0004, +0.0019]** | −0.0008 | +0.0003 (ns) |
| Mediator: + zone dummies (selection, strict) | +0.0014 [+0.0009, +0.0019] | — | — |

**Verdict: decay CONFIRMED and above the usefulness bar (≥ 0.0005). Buyback NOT supported as a general effect.**
- **Decay:** bO is about 0 and not robust, so D is carried by bS.
- **Dose-response (R2, strict):** 1 earlier look −0.0024, 2 looks −0.0045, 3–4 looks −0.0053, 5+ looks −0.0048 runs
  per pitch vs 0 looks. The cost is front-loaded and flattens after 2–3 looks.
- **Whiff per swing:** −0.6 points per earlier look at the same type, in both windows.
- **By class:** decay is largest for offspeed (D 0.0037 in selection).
- **Location:** controlling for zone leaves D unchanged. The cost is the hitter recognising the pitch, not the pitcher
  locating it worse.
- **Lineup (not pre-registered, suggestive only):** same-type pitches thrown to *other* batters also cost a little
  (DG +0.0009 per pitch). That is about 40% of the batter-specific rate per look, and it is entangled with in-game
  mix drift.

**What it means for usage:** each pitch type carries a price per look that saturates. Moving a primary pitch from 50%
to 40% barely changes its price. A pitch the hitter has not seen yet keeps about 0.25–0.5 runs per 100 pitches of
novelty. That value lands in the 2nd and 3rd times through the order, which argues for a third pitch for starters,
not for "buyback" mixing. College replication: vt_baseball research/buyback-decay (private data, kept there).
