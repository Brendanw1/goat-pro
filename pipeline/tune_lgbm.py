"""Tune the v2 LightGBM on a pitcher-grouped split (RESULTS-MLB §30, item 1).

    python tune_lgbm.py

The shipped params (800 trees, 63 leaves, min_child 100) were never tuned against held-out
PITCHERS, and memorization (§17) is overfitting to pitcher identity. Train on folds 1-3's
2023-24 pitches (crc32(pitcher) % 4, as crossfit_v2.py), validate on fold 0's 2023-24 pitches
with early stopping. Grid: num_leaves x min_child_samples, lr .05. Score = row-weighted
validation r(pred, csw_norm) over the six cells; the winner's params (n_estimators = median
best iteration) go to results/tune_lgbm.json for `crossfit_v2.py --params`. Fold 0 also
sits inside the cross-fit evaluation; two hyperparameters chosen on it is a negligible leak.
"""

import json
import sys
import zlib
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import stuff_v2  # noqa: E402
from physics import add_physics  # noqa: E402
from train_mlb import LGBM_PARAMS, load_features  # noqa: E402

RESULTS = Path(__file__).resolve().parent / "results"
GRID = [(nl, mc) for nl in (7, 15, 31, 63) for mc in (100, 1000, 5000)]


def main() -> None:
    import lightgbm as lgb
    df = stuff_v2.prepare(add_physics(load_features()))
    F = stuff_v2.FEATURES
    fold = df["pitcher"].map(lambda p: zlib.crc32(str(p).encode()) % 4)
    d = df[df["train_season"] & df["csw_norm"].notna()]
    fold = fold[d.index]
    out = []
    for nl, mc in GRID:
        params = {**LGBM_PARAMS, "num_leaves": nl, "min_child_samples": mc,
                  "learning_rate": 0.05, "n_estimators": 3000, "n_jobs": 5}
        rs, ws, iters = [], [], []
        for pc in ("FB", "BB", "CH"):
            mono = stuff_v2.CLASS_MONO[pc]
            for side in ("R", "L"):
                c = d[(d["pclass"] == pc) & (d["stand"] == side)]
                tr, va = c[fold[c.index] != 0], c[fold[c.index] == 0]
                m = lgb.LGBMRegressor(monotone_constraints=[mono.get(f, 0) for f in F], **params)
                m.fit(tr[F], tr["csw_norm"], eval_set=[(va[F], va["csw_norm"])],
                      callbacks=[lgb.early_stopping(100, verbose=False)])
                rs.append(np.corrcoef(m.predict(va[F]), va["csw_norm"])[0, 1])
                ws.append(len(va))
                iters.append(m.best_iteration_)
        row = {"num_leaves": nl, "min_child_samples": mc, "val_r": float(np.average(rs, weights=ws)),
               "best_iters": iters, "n_estimators": int(np.median(iters))}
        out.append(row)
        print(row, flush=True)
    best = max(out, key=lambda r: r["val_r"])
    tuned = {"num_leaves": best["num_leaves"], "min_child_samples": best["min_child_samples"],
             "learning_rate": 0.05, "n_estimators": best["n_estimators"]}
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / "tune_lgbm.json").write_text(json.dumps({"grid": out, "tuned": tuned}, indent=1))
    print("tuned:", json.dumps(tuned))


if __name__ == "__main__":
    main()
