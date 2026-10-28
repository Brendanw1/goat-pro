"""Change test (Resnick, Pitcher Greeks §5): when a pitcher's pitch changes between seasons, does
the model's predicted change track the realized change? Out-of-fold predictions from crossfit_v2's
*_pt.csv; realized outcome is whiff per swing for every model (the Stuff construct).

    python change_test.py results/crossfit_v2_A_pt.csv results/crossfit_v2_B_pt.csv

Pairs: same pitcher x pitch type in consecutive seasons, >= 50 swings in both. Per class: r of
predicted vs realized change, OLS slope, and a shuffle p (2000 shuffles of the predicted change).
"""
import sys

import numpy as np
import pandas as pd

from train_mlb import CLASS_OF


def pairs(path):
    pt = pd.read_csv(path)
    pt = pt[pt["n_sw"] >= 50]
    nxt = pt.assign(season=pt["season"] - 1)
    j = pt.merge(nxt, on=["pitcher", "season", "pitch_type"], suffixes=("", "_1"))
    return j.assign(dp=j["pred_1"] - j["pred"], dr=j["wps_1"] - j["wps"],
                    pclass=j["pitch_type"].map(CLASS_OF))


def stats(j, rng):
    r = np.corrcoef(j["dp"], j["dr"])[0, 1]
    null = [np.corrcoef(rng.permutation(j["dp"].to_numpy()), j["dr"])[0, 1] for _ in range(2000)]
    return {"pairs": len(j), "r": round(r, 3), "slope": round(np.polyfit(j["dp"], j["dr"], 1)[0], 3),
            "shuffle_p": round(float(np.mean(np.array(null) >= r)), 4)}


if __name__ == "__main__":
    rng = np.random.default_rng(13)
    for path in sys.argv[1:]:
        j = pairs(path)
        print(path.split("/")[-1], {c: stats(g, rng) for c, g in j.groupby("pclass")})
