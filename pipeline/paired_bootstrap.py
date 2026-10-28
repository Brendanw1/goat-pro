"""Paired pitcher bootstrap: is grade set B better than A at predicting next-season outcomes?

    python paired_bootstrap.py results/crossfit_v2_grades.csv results/crossfit_v2_arm_grades.csv

Resamples pitchers (with replacement, 2000 draws, seed 13) within each season pair and
reports r(B, next) - r(A, next) for CSW%, K% and RV/100 with a 95% percentile interval.
Same population as the gates: >= 50 taken pitches in both seasons.
"""

import json
import os
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from train_mlb import load_features  # noqa: E402

PAIRS = tuple((s, s + 1) for s in range(int(os.environ.get("GOAT_LO", 2023)), 2026))


def outcomes():
    df = load_features()
    pa = df[df["pa_taken"] == 1]
    oc = pa.groupby(["pitcher", "season"]).agg(n=("csw", "size"), csw=("csw", "mean"),
                                              k=("is_k", "mean")).reset_index()
    rv = (100 * df.groupby(["pitcher", "season"])["rv"].mean()).rename("rv100").reset_index()
    oc = oc.merge(rv, on=["pitcher", "season"])  # run value per 100 pitches, all pitches
    return oc[oc["n"] >= 50].rename(columns={"pitcher": "mlbam"})


def compare(path_a, path_b, oc=None, draws=2000):
    oc = outcomes() if oc is None else oc
    a = pd.read_csv(path_a).rename(columns={"grade": "ga"})
    b = pd.read_csv(path_b).rename(columns={"grade": "gb"})
    g = a.merge(b, on=["mlbam", "season"])
    rng = np.random.default_rng(13)
    out = {}
    for s0, s1 in PAIRS:
        h = (g[g["season"] == s0].merge(oc[oc["season"] == s1], on="mlbam")
             .merge(oc[oc["season"] == s0][["mlbam"]], on="mlbam"))
        for tgt in ("csw", "k", "rv100"):
            x = h[["ga", "gb", tgt]].to_numpy()
            point = np.corrcoef(x[:, 1], x[:, 2])[0, 1] - np.corrcoef(x[:, 0], x[:, 2])[0, 1]
            idx = rng.integers(0, len(x), size=(draws, len(x)))
            boot = [np.corrcoef(x[i, 1], x[i, 2])[0, 1] - np.corrcoef(x[i, 0], x[i, 2])[0, 1] for i in idx]
            lo, hi = np.percentile(boot, [2.5, 97.5])
            out[f"{s0}->{s1} {tgt}"] = {"n": len(x), "delta_r": round(float(point), 4),
                                        "ci95": [round(float(lo), 4), round(float(hi), 4)]}
            print(f"{s0}->{s1} {tgt:3}: delta r {point:+.4f} [{lo:+.4f}, {hi:+.4f}] (n={len(x)})")
    return out


if __name__ == "__main__":
    res = compare(sys.argv[1], sys.argv[2])
    tag = Path(sys.argv[2]).stem.replace("_grades", "")
    (Path(__file__).resolve().parent / "results" / f"bootstrap_{tag}.json").write_text(json.dumps(res, indent=1))
