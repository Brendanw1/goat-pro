"""§104 (D-43): VectorSSM — a bivariate Kalman projection of next-season RV/100 and K/PA.

    python ssm_proj.py            # -> results/ssm_proj_SEALED.json + ssm_proj_grades.csv
    python ssm_proj.py --demo     # self-check of the filter on a hand-worked series

Per pitcher, the state is true talent [RV/100, K/PA]; the observations are his season
values; innovations are correlated (the vector part). Q and R are estimated pool-wide
on the TRAIN pairs (ending 2020-2023) by method of moments on successive differences,
exactly as §104 froze. The projection for S+1 is the filtered state at S — no drift.
The gate is the shipped stack (Prevention+ / K+), judged by judge.py on the grade
files this script writes; the details and clauses live in RESULTS-MLB §104.
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

PIPE = Path(__file__).resolve().parent
sys.path.insert(0, str(PIPE))
from paths import MART_DIR  # noqa: E402
sys.path.insert(0, str(MART_DIR))
import mart  # noqa: E402

MODELS = PIPE.parent / "data" / "export" / "mlb_pitcher_models.json"
TRAIN_PAIR_ENDS = (2020, 2021, 2022, 2023)
TEST_ENDS = (2023, 2024, 2025)  # pairs 2023->24, 24->25, 25->26
MIN_BF = 50  # the judge's population floor, mirrored here so R/Q see the same data

SQL = """
WITH p AS (
  SELECT pitcher, season,
         count(*) FILTER (WHERE description NOT IN ('pitchout','intent_ball','automatic_ball')) AS pitches,
         count(*) FILTER (WHERE events IN ('strikeout','strikeout_double_play')) AS k,
         count(*) FILTER (WHERE events IS NOT NULL) AS pa
  FROM pitches_all
  WHERE game_type = 'R' AND pitcher IS NOT NULL
  GROUP BY 1, 2
), r AS (
  SELECT pitcher, season, 100 * avg(-delta_run_exp) AS rv100
  FROM pitches_all
  WHERE game_type = 'R' AND pitcher IS NOT NULL AND delta_run_exp IS NOT NULL
  GROUP BY 1, 2
)
SELECT p.pitcher, p.season, p.pitches, p.pa, p.k, r.rv100,
       CASE WHEN p.pa > 0 THEN p.k * 1.0 / p.pa END AS kpa
FROM p JOIN r USING (pitcher, season)
WHERE p.pitches >= 300
"""


def filter_series(ys: list[tuple[float, float]], R: np.ndarray, Q: np.ndarray) -> list[np.ndarray]:
    """Bivariate local-level Kalman: x_0 = y_0, P_0 = R; one update per season."""
    x = np.array(ys[0], dtype=float)
    P = R.copy()
    I = np.eye(2)
    states = []
    for y in ys:
        S = P + R
        K = np.linalg.solve(S, P.T).T  # Kalman gain, robust to singular S
        x = x + K @ (np.asarray(y, dtype=float) - x)
        P = (I - K) @ P
        states.append(x.copy())
        P = P + Q  # evolve to the next season (random walk)
    return states


def estimate_rq(ev: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
    """TRAIN-only method of moments, exactly as §104 froze it."""
    tr = ev[ev["season"].isin(range(2018, TRAIN_PAIR_ENDS[-1] + 1))]
    y = tr[["rv100", "kpa"]].dropna()
    # R: pooled within-pitcher mean square about each pitcher's own TRAIN mean
    R = np.zeros((2, 2))
    for _, g in tr.dropna(subset=["rv100", "kpa"]).groupby("pitcher"):
        if len(g) >= 2:
            d = g[["rv100", "kpa"]].to_numpy() - g[["rv100", "kpa"]].to_numpy().mean(axis=0)
            R += d.T @ d / max(1, len(g) - 1)
    R /= max(1, len(tr.dropna(subset=["rv100", "kpa"]).groupby("pitcher")))
    # Q: pooled covariance of successive differences, halved, minus R, floored
    dcov = np.zeros((2, 2))
    n = 0
    for _, g in tr.dropna(subset=["rv100", "kpa"]).sort_values("season").groupby("pitcher"):
        arr = g[["rv100", "kpa"]].to_numpy()
        if len(arr) >= 3:
            d = np.diff(arr, axis=0)
            dcov += d.T @ d
            n += len(d)
    Q = dcov / max(1, n) / 2 - R / 2
    ev_var = np.max(np.diag(R)) or 1.0
    floor = 0.01 * np.max(np.diag(R))
    w, V = np.linalg.eigh(Q)
    w = np.maximum(w, floor)
    Q = V @ np.diag(w) @ V.T
    return R, Q


def demo() -> None:
    ys = [(4.0, 0.25), (4.2, 0.27), (3.6, 0.22)]
    R = np.diag([1.0, 0.001])
    Q = np.diag([0.05, 0.0002])
    st = filter_series(ys, R, Q)
    last = st[-1]
    assert last[0] < 4.0 and last[0] > 3.6, last  # pulled toward the noisy low outlier, not all the way
    assert 0.22 < last[1] < 0.25, last
    # a perfectly correlated pair of observations moves both states together
    R2 = np.array([[1.0, 0.0], [0.0, 0.001]])
    Q2 = np.diag([0.05, 0.0002])
    assert np.isfinite(filter_series(ys, R2, Q2)[-1]).all()
    print("demo ok")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--demo", action="store_true")
    ap.add_argument("--qs", type=float, default=1.0, help="Q scale for the pre-declared sensitivity")
    a = ap.parse_args()
    if a.demo:
        demo()
        return
    ev = mart.connect().sql(SQL).df()
    ev = ev[ev["pa"] >= MIN_BF].dropna(subset=["rv100", "kpa"])
    R, Q = estimate_rq(ev)
    Q = Q * a.qs
    print("R diag:", np.round(np.diag(R), 4), "Q diag:", np.round(np.diag(Q), 4))

    out_rows = []
    for pid, g in ev.sort_values("season").groupby("pitcher"):
        if g["season"].min() > TRAIN_PAIR_ENDS[-1] - 2:
            continue  # need some history before the test pairs
        ys = list(g[["rv100", "kpa"]].itertuples(index=False, name=None))
        seasons = list(g["season"])
        states = filter_series(ys, R, Q)
        for s, st in zip(seasons, states):
            out_rows.append({"mlbam": int(pid), "season": int(s),
                             "proj_rv100": round(float(st[0]), 3),
                             "proj_kpa": round(float(st[1]), 4)})
    out = pd.DataFrame(out_rows)
    out.to_csv(PIPE / "results" / "ssm_proj_grades.csv", index=False)
    print(f"ssm_proj_grades.csv: {len(out):,} pitcher-season projections")
    (PIPE / "results" / "ssm_proj_meta.json").write_text(json.dumps(
        {"R": np.diag(R).tolist(), "Q": np.diag(Q).tolist(), "q_scale": a.qs,
         "n_cells": len(out)}, indent=1))


if __name__ == "__main__":
    main()
