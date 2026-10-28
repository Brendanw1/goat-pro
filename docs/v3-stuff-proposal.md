# Proposal: Stuff+ v3 and a called-strike Location+ (owner approved 2026-10-26; ON HOLD: Location+ v2 failed §36, v3 gain not confirmed on the 2021–22 holdout §37)

From goat-pro-helper to kb-session, which owns `pipeline/stuff_v2.py` and the export.
The evidence is in RESULTS-MLB §30–§34. The prototype is `pipeline/crossfit_v2.py --target wps_dml`.

## Stuff+ v3: whiff per swing, with location partialled out

| | v2 (shipped) | v3 |
|---|---|---|
| Target | csw_norm, taken pitches | whiff on swings (`wps`) |
| Inputs | 13 v2 features | The same 13, each residualized on context |
| Context removed | none (hvaa only) | plate_x_arm, plate_z, balls, strikes, stand, lhp |
| Year-to-year | .79 / .83 / .82 | .84 / .87 / .85 |
| Leak, height / side | .233 / .134 | .020 / .051 |
| Next K%, Δr vs v2 | | +.012 / +.053 / +.027 |
| Next RV/100, Δr vs v2 | | +.001 / +.070\* / +.004 |
| Next CSW%, Δr vs v2 | | −.042 / −.018 / −.045 (called strikes move to Location+) |

**Recipe** (`crossfit_v2.add_dml`):
1. Fit nuisance models per class (FB/BB/CH) on TRAIN rows. Each is a LightGBM with 200 trees, lr .1, 31 leaves and min_child 1000, run on the context above.
2. Fit one model for E[wps | ctx] on swings only, and one model for E[feature | ctx] per input.
3. Train the usual class × side boosters on the residuals, with v2 params and v2 monotone constraints.
4. Score each pitch on its residualized inputs.

**At export:**
- The nuisance models are frozen alongside the boosters.
- Pitcher cross-fit stays (FoldBooster).
- The 2026 re-referencing must run before the nuisance models are applied.

The feature-engineering round on top of v3 (RESULTS-MLB §33) found nothing to add, so ship the 13 inputs as they are.

## Location+ v2: called strikes and command

Location+ should own what v3 drops: P(called strike | location, count, batter side, pitch class) on takes. It also keeps the existing command terms. Stuff+ v3 plus Location+ should then cover what CSW% covered.

**Pre-registered gate:**
- Next-season CSW% r of a joint Stuff+ v3 + Location+ v2 ridge must be at least v2 Stuff+'s r, within .01, in every pair.
- Location+ v2 year-to-year must be ≥ .5.

**Owner decision:** shipping both, plus the R2 upload, still needs the owner's sign-off once kb-session has built them.
