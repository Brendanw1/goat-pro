# Pre-registration: Deception+ (model request 2) — swing disruption as a trait

Written 2026-10-28, BEFORE any metric below was computed. Owner directed web-fork-agent
to build the queued model requests; this is request 2. The descriptive layer already
ships (Arsenal-tab swing disruption). This pre-registration decides whether a GRADE
(Deception+, 100/10 scale) may ship.

## Question

Is a pitcher's swing disruption — bat speed and contact-point pushed off EACH batter's
own season norm — a persistent pitcher trait that adds to forecasting next-season
missed-bat outcomes beyond Stuff+ and naive persistence?

## Population

Bat-tracking era pitcher-seasons 2023-25 with >= 200 tracked swings against batters
with >= 100-swing norms (the shipped deception family's computation, reproduced here).
Forecast pairs: (season N -> N+1) for N in 2023-25, both seasons qualified. Outcomes:
next-season CSW% (per pitch) primary, K% per PA secondary, both computed from the mart
over regular-season play.

## Metrics per pitcher-season

- d_bs: mean(bat_speed − batter_norm) over tracked swings.
- d_icpt: mean |intercept_y − batter_norm| (timing disruption).
- Shrunk versions toward the league mean with K = 400 swings
  (shrunk = lg + n/(n+K)·(mean − lg)), pre-registered before reading.

## Gates

1. **Trait gates** (descriptive, both required for any display): split-half
   reliability (odd/even swings within season; correlation of half-means among
   qualified) >= 0.50 for d_bs and d_icpt each; year-to-year r >= 0.35 each.
2. **Forecast gate** (decides the GRADE): 5-fold GroupKFold over the pair set,
   grouped by PITCHER, linear models on standardized features, predicting
   next-season CSW%:
   - A (naive): this-season CSW%.
   - B: A + cross-fit Stuff+ (`stuff_plus_abs` from mlb_pitcher_grades.json).
   - C: B + shrunk d_bs + shrunk d_icpt.
   PASS if ΔR²(C − B) >= +0.005 and the pooled coefficient on d_bs is negative
   (slower bats against him -> more next-season whiffs). K% reported the same way,
   no gate on it.
3. **Kill**: any trait gate fails -> no grade, the descriptive panel stays as is.
   Forecast gate fails but traits pass -> ship "Deception (reliable trait,
   descriptive)" without the 100/10 scale.

Everything lands in `results/deception_plus.json` whichever way it goes.
