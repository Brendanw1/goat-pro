"""Rung f (EB roll-up) and f2 (location-shrunk scoring, post-hoc per Amendment 1) on a ladder design.

    OMP_NUM_THREADS=3 nice -n 10 python research/pitching-plus-v6/rollup.py <design>@full
"""
import json
import os
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ladder  # noqa: E402
import lib  # noqa: E402

LAMBDAS = (0.0, 0.25, 0.5, 0.75)


def eb_shrink(meta, v, keys):
    """Per-pitch value scaled so each unit's mean becomes its EB posterior mean: m * n / (n + k), k = s2 / tau2,
    s2 and tau2 fit per outer fold on the training pitchers only (units with >= 50 pitches)."""
    d = meta[keys + ["fold"]].assign(v=v)
    out = pd.Series(np.nan, index=meta.index)
    for f in range(5):
        tr = d[(d["fold"] != f) & d["v"].notna()]
        g = tr.groupby(keys)["v"].agg(["mean", "var", "size"])
        g = g[g["size"] >= 50]
        s2 = float(g["var"].mean())
        tau2 = max(float(g["mean"].var() - (g["var"] / g["size"]).mean()), 1e-9)
        k = s2 / tau2
        te = d["fold"] == f
        n = d[te].groupby(keys)["v"].transform("count")
        out[te] = d.loc[te, "v"] * n / (n + k)  # unit mean of this = m * n / (n + k)
        print(f"  EB {keys[2:] or 'P'} fold {f}: k = {k:.0f} pitches", flush=True)
    return out


def main():
    name = sys.argv[1]
    base = name.split("@")[0]
    os.environ.setdefault("FRAC", "1.0")
    df = lib.load(lib.META + lib.BASE + ladder.EXTRA + ["at_bat_number"])
    spec = ladder.spec_of(base)
    if any(f in spec[2] for f in ladder.D1 + ladder.D2):
        df = ladder.add_d(df)
    out = lib.outcome_table()
    kind, tgt, feats, extra = spec
    y = None
    if kind == "reg":
        y = lib.target(df, tgt)
        y = y - y.groupby([df["season"], df["balls"], df["strikes"]]).transform("mean")
    v, models = lib.fit_oof(df, feats, kind, y, params=extra, frac=float(os.environ["FRAC"]), return_models=True)
    tx = df["plate_x_arm"] - df["t2_dx"]
    tz = df["plate_z"] - df["t2_dz"]
    vs = {name: v}
    for lam in LAMBDAS:
        X = df[feats].copy()
        has = tx.notna() & tz.notna()
        X.loc[has, "plate_x_arm"] = tx[has] + lam * (df.loc[has, "plate_x_arm"] - tx[has])
        X.loc[has, "plate_z"] = tz[has] + lam * (df.loc[has, "plate_z"] - tz[has])
        pred = pd.Series(np.nan, index=df.index)
        for k, (bst, const) in models.items():
            te = df.index[df["fold"] == k]
            if kind == "reg":
                pred[te] = bst.predict(X.loc[te], num_iteration=bst.best_iteration)
            else:
                P = bst.predict(X.loc[te], num_iteration=bst.best_iteration)
                pred[te] = (P * lib.const_rows(df.loc[te], const)).sum(1)
        pred[~has] = np.nan  # no own target -> not graded under f2
        vs[f"f2_{lam}"] = pred - pred.groupby([df["season"], df["balls"], df["strikes"]]).transform("mean")
    vs["f_eb"] = eb_shrink(df, v, ["pitcher", "season"])
    pd.DataFrame(vs).astype("float32").to_parquet(lib.CACHE / f"rollup_{name}.parquet")
    res = {}
    for k_, vv in vs.items():
        if k_ == name:
            continue
        r = ladder.judge(df, {name: v, k_: vv}, name, k_, out)
        res[k_] = r
        j = r["vs_ref"]
        print(k_, "vs base J", j["J"], [j["lo"], j["hi"]], "rv", j["rv100"]["d"], "kbb", j["kbb"]["d"],
              "| vs blend", r["vs_blend"]["J"], "| split", r["split_half"], flush=True)
    lib.save(f"rollup_{name}", res)


if __name__ == "__main__":
    main()
