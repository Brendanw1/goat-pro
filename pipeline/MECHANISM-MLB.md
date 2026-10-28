# MLB mechanism study — what Hawk-Eye measurement actually says causes whiffs

2026-10-25. Descriptive study on 2.12M pitches (2023–25, regular season) using
the physics decomposition in `physics.py` — measurements college TrackMan could
not isolate (trajectory-derived active spin, drag, Magnus-vs-measured
separation). Every claim here is a marginal effect *within* pitch type; n per
cell in `results/bakeoff_targets.json` lineage. This is the "describe what is
actually happening" layer the public site should present alongside grades.

## Finding 1 — active spin helps fastballs, HURTS breaking balls

Whiff rate by active-spin quartile (Q1 lowest → Q4 highest):

| Type | Q1 | Q4 | Effect |
|---|---|---|---|
| FF | 8.3% | 10.2% | **+1.9 pts** (ride: more active spin = more carry) |
| SI | 5.2% | 6.3% | +1.1 pts |
| **SL** | **17.0%** | **14.8%** | **−2.2 pts — gyro sliders whiff MORE** |
| CU | 12.9% | 12.1% | −0.8 pts |
| CH | 14.9% | 14.3% | −0.6 pts |

The sign flips by class. Gyro is not wasted spin on breaking balls — it delays
break (deception). Verified within-stratum: holding Magnus-implied movement
fixed (terciles), low-active-spin sliders out-whiff high-active-spin ones in
every stratum (17.4 vs 15.8 in the lowest). **College verdict revisited:** the
college program found spin_eff "below noise" under TrackMan radar spin; under
Hawk-Eye optical measurement the effect is real (1–2.3 pts), class-dependent,
and NEGATIVE for breaking balls. Model implication: spin_eff enters per class
with a per-class direction (+1 FB, −1 BB), never globally — the college
per-class ALE-constraint pattern, extended to a feature college never had.

## Finding 2 — velo and shape interact multiplicatively (the user's scaling hypothesis, resolved)

FB/SI whiff% by velo tercile × IVB tercile:

| | ivb_low | ivb_mid | ivb_hi | shape spread |
|---|---|---|---|---|
| velo_low | 5.2 | 6.5 | 7.4 | 2.2 pts |
| velo_mid | 5.7 | 7.9 | 9.8 | 4.1 pts |
| velo_hi | 6.5 | 9.6 | 12.6 | **6.1 pts** |

Same grid by VAA (flat = ride): 10.0→15.2 across velo bins, spread widening
6.3→10.6 pts. **Shape matters more as velo rises** — velo is the enabler, shape
the multiplier. The hypothesis "shape matters most mid-velo" is not what MLB
says for fastballs; "higher velo is always better" (the global monotone
constraint) is also an incomplete description — the correct structure is an
interaction. Model implication: an explicit `velo × shape` term (or trusting
tree depth to learn it — num_leaves 63 can) matters more than a log transform.
The college `velo_diff`/`ivb_diff` anchor features partially encode this;
the residual amplification (absolute velo × absolute movement) does not appear
in the feature list and is the candidate addition.

## Finding 3 — drag is a small, real whiff signal

Higher deceleration → more whiffs within type: SI +1.7 pts, SL +2.3 pts,
CH +1.1 pts (tercile spreads). Hawk-Eye-only measurement; consistent with
seam-orientation effects. Candidate feature (a_drag), low priority.

## What this means for the model (queued in COLLABORATION.md)

1. Add `spin_eff` with per-class monotone direction (+1 FB, −1 BB, 0 CH).
2. Add the velo×shape interaction (product of the standardized velo and
   movement terms) to Stuff+ features.
3. Re-run the bake-off gates; the physics arm was rejected as a raw bundle —
   this is the targeted re-test with the two structures the mechanism study
   justifies.
4. The mechanism tables above are themselves site content (the "why" panels
   next to grades) — public-safe, computed from public data.

## Reproduce

`physics.add_physics(train_mlb.load_features())` → the queries are one-liners
documented here; full numbers regenerate in under three minutes on this machine.
