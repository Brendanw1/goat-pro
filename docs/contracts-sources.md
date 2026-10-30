# Contracts: source research (D-44 step 1, 2026-10-29)

**Status: research only — nothing fetched into the pipeline, nothing public.** The row's
own rule (and the D-31 precedent: FanGraphs terms restrict republication, confirm with the
owner before any number is shown) applies to every source here.

## Sources

| source | what it carries | status |
|---|---|---|
| **Cot's Baseball Contracts** (legacy.baseballprospectus.com/compensation/cots/) | per-team pages: actual + CBT payroll, per-player contract-year rows (base, bonuses, AAV/CBT salary, option type + values, buyouts, opt-outs, deferrals, MiLB deals, service time) | **live, verified 2026-10-29** (front page renders the 30 team links + payroll tables). **Accuracy reference only** until terms are settled: no republication license is posted — the pages carry Baseball Prospectus copyright, figures "unofficial, collected from published reports". No explicit permission to republish; no explicit prohibition either. Owner ruling needed before any Cot's number or derived table ships. Parsing surface for an eventual *local* accuracy copy: one HTML page per team, tables per player. |
| **Spotrac** (spotrac.com) | same money, structured per-player pages, MLB/NCB/NFL/NHL | cross-check role. Same republication caution (their terms page states no republication without permission). |
| **RosterResource** (fanGraphs property) | payroll + contract detail per team | cross-check role; FanGraphs terms already flagged under D-31. |
| **MLB's published CBT rankings** (MLB Communications, end-of-season) | official competitive-balance-tax payroll per team | **official anchor** for team totals — public numbers, safe to cite/compare. |
| **AP opening-day payrolls** | official-ish actual payroll per team | second anchor. |
| MLB Stats API | no salary endpoint exists | — |
| Lahman database | salaries through 2016 only | historical validation only. |

## Data model the row asks for (unchanged)

Contract-year rows per player: season, base, bonus proration, AAV / CBT salary, option
type + values, buyout, deferrals (present value), opt-out dates, no-trade. Guaranteed
length + future commitments then fall out of the rows.

## Validation plan (when data lands)

1. Team CBT totals vs MLB's published rankings (exact match target; discrepancies =
   quirk findings: benefits, proration, deferral PV).
2. Player totals vs Cot's/Spotrac agreement (two-source rule).
3. 2020 proration and pre-arb/arb minimums as known-quirk test cases.

## Open owner questions (for the after-lanes list)

1. May Cot's/Spotrac numbers be shown on the site with attribution, or only used
   privately as the accuracy reference against official anchors?
2. If display is allowed: team money only, or player contract rows too?
