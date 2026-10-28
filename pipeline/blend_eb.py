"""Program item 5: one empirical-Bayes rule for the small-sample product.

    python tests_small_sample.py --aaa --crossfit --dump   # writes results/small_sample_rows.csv
    python blend_eb.py

The small-sample tests (RESULTS-MLB §18) blend first-N CSW% and Stuff+ with a fresh OLS
per N. A product needs one rule for any N. Empirical Bayes: prior mean from Stuff+
(mu = a + b * grade), then shrink the observed first-N CSW% toward it,
    pred = (n_taken * naive + k * mu) / (n_taken + k)
with a, b, k fitted ONCE on 2024 (cross-fit grades, so honest) by least squares on
rest-of-season CSW%, then frozen and applied to 2025 and 2026 at every N.
Pre-registered (COLLABORATION.md): the rule passes if its out-of-sample R^2 is within
.01 of the per-N OLS blend's CV R^2 at every N in 2025 and 2026.
Writes results/blend_eb.json.
"""

import json
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.optimize import minimize

from tests_small_sample import cv_r2

RESULTS = Path(__file__).resolve().parent / "results"


def predict(p, d):
    a, b, log_k = p
    k = np.exp(log_k)
    mu = a + b * d["grade"].to_numpy()
    return (d["n_taken"].to_numpy() * d["naive"].to_numpy() + k * mu) / (d["n_taken"].to_numpy() + k)


def main() -> None:
    rows = pd.read_csv(RESULTS / "small_sample_rows.csv")
    fit = rows[rows["season"] == 2024]
    loss = lambda p: np.mean((fit["rest"].to_numpy() - predict(p, fit)) ** 2)  # noqa: E731
    b0 = np.polyfit(fit["grade"], fit["rest"], 1)
    p = minimize(loss, x0=[b0[1], b0[0], np.log(200)], method="Nelder-Mead",
                 options={"maxiter": 4000, "xatol": 1e-6, "fatol": 1e-8}).x
    a, b, k = p[0], p[1], float(np.exp(p[2]))
    print(f"fitted on 2024: prior CSW% = {a:.2f} + {b:.4f} * Stuff+, k = {k:.0f} taken pitches")
    out = {"a": a, "b": b, "k": k, "cells": {}}
    ok = True
    for (season, n), d in rows[rows["season"] > 2024].groupby(["season", "N"]):
        y = d["rest"].to_numpy()
        eb = 1 - np.sum((y - predict(p, d)) ** 2) / np.sum((y - y.mean()) ** 2)
        ols = cv_r2(y, d[["naive", "grade"]].to_numpy())
        naive = cv_r2(y, d[["naive"]].to_numpy())
        passed = eb >= ols - 0.01
        ok &= passed
        out["cells"][f"{season} N={n}"] = {"n": len(d), "eb_r2": round(float(eb), 4),
                                           "ols_cv_r2": round(float(ols), 4),
                                           "naive_cv_r2": round(float(naive), 4), "pass": bool(passed)}
        print(f"{season} N={n:>3}: EB {eb:.3f} | per-N OLS {ols:.3f} | naive {naive:.3f} "
              f"(n={len(d)}) {'ok' if passed else 'MISS'}")
    out["verdict"] = "PASS" if ok else "REJECTED"
    print("->", out["verdict"])
    (RESULTS / "blend_eb.json").write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
