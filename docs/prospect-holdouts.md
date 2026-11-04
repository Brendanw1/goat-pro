# Prospect holdout ledger

Every Pipeline list year × task, with what has been read. A read is legal only on a **sealed** cell, after its power
check is attached here and a pre-registration is in RESULTS-MLB.md. `pipeline/prospect_eval.py` mirrors the sealed
cells in `SEALED` and refuses to score them unless a read is named. Update both in the same commit.

Lists are dated in March. "Value" = control-year outcome (war6/star; earlier the FSE label). "Arrival" = debut within k
seasons.

| list | value | arrival | notes |
|---|---|---|---|
| 2011–12 | dev (training only) | dev (training only) | no fold tests these; too early for tyear ≤ Y − 4 |
| 2013–14 | dev (§99 value dev) | dev | |
| 2015 | dev (§99 dev, §104 dev, sleeper pre-check) | dev (§99/§104 arrival dev) | |
| 2016–17 | **spent** (§99f read; §104 post-hoc; sleeper pre-check) | dev | |
| 2018 | **spent** (§104 read 2026-11-03; sleeper pre-check) | dev | arrival labels were scored as dev, so value read was not fully untouched |
| 2019–21 | **sealed** (value, war2 early label) | dev (§99/§104 arrival dev, k ≤ 4) | debut outcomes already seen in arrival dev: a sealed value read on these lists is not fully untouched (y > 0 implies a debut) |
| 2022 | **sealed** (value, war2 early label) | **spent** (§99f arrival read) | same caveat |
| 2023 | not matured (war2 needs debut + 2 seasons) | **spent** (§99f arrival read) | |
| 2024 | not matured | **sealed** (§99g / §99h read) | full k = 4 window never closes; G2 proposes k ≤ 2 (owner decision pending) |
| 2025 | not matured | **sealed** (k ≤ 2 matures after 2026) | unreserved |
| 2026 | not matured | not matured (k ≤ 1 only) | live list: scored for the site, never read as a test |

## Rules

- Spent and dev cells may be re-scored freely (R0 and every dev table), always labelled dev or post-hoc.
- A sealed cell is read once. After it is read, its row is edited to **spent** with the date and section.
- Summaries of sealed cells (base rates, label means, maturity shares) count as reads. Scripts never print them
  (`prospect_labels.py` limits its summary to lists ≤ 2018).
- Season-level MiLB data in the 2019+ seasons are inputs (features) for any list dated after them; only list-year
  outcomes are sealed.

## Power checks attached

| cell | gate | expected effect (dev) | MDE | status |
|---|---|---|---|---|
| value 2019–22 pooled (G1 sleeper watch) | Δ p@50 and Δ log loss vs LR + rates | Δ p@50 ≈ .13–.14 (2015–18 post-hoc) | ≈ .11–.12 (4 classes, full label) | early label not yet validated; MDE to be recomputed on war2 |
| arrival 2024 (G2) | ΔBrier vs B1, k ≤ 2 | — | — | not computed |
