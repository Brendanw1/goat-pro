"""Step 3: per-scope report for one design (dev OOF only; lockbox untouched).

    OMP_NUM_THREADS=3 nice -n 10 python research/pitching-plus-v6/report.py <design>@full [--credit]

Scopes P (pitcher), T (pitch type), TH (pitch type x batter hand). Deltas vs Stuff+ and vs the dev-fit
Stuff+ + Command+ blend with pitcher-cluster bootstrap CIs; split-half reliability and the r >= .50 floor;
calibration slope; permutation credit by feature group (--credit, refits fold 0); robustness by season.
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


def calib(rows, g, y="rv100"):
    d = rows[[g, y]].dropna()
    return round(float(np.polyfit(d[g] * 100, d[y], 1)[0]), 3)


def credit(df, name):
    """Mean |change in per-pitch value| when one feature group is permuted, fold-0 model, 100k held-out pitches."""
    base = name.split("@")[0]
    kind, tgt, feats, extra = ladder.spec_of(base)
    y = None
    if kind == "reg":
        y = lib.target(df, tgt)
        y = y - y.groupby([df["season"], df["balls"], df["strikes"]]).transform("mean")
    _, models = lib.fit_oof(df, feats, kind, y, params=extra, frac=1.0, folds=[0], return_models=True)
    bst, const = models[0]
    te = df[df["fold"] == 0].sample(100_000, random_state=3)

    def val(X):
        if kind == "reg":
            return bst.predict(X, num_iteration=bst.best_iteration)
        return (bst.predict(X, num_iteration=bst.best_iteration) * lib.const_rows(te, const)).sum(1)

    v0 = val(te[feats])
    rng = np.random.default_rng(0)
    out = {}
    for gname, cols in lib.GROUPS.items():
        cols = [c for c in cols if c in feats]
        if not cols:
            continue
        X = te[feats].copy()
        perm = rng.permutation(len(X))
        X[cols] = X[cols].to_numpy()[perm]  # permute the group jointly
        out[gname] = float(np.abs(val(X) - v0).mean())
    tot = sum(out.values())
    return {k: round(v / tot, 3) for k, v in out.items()}


def main():
    name = sys.argv[1]
    os.environ.setdefault("FRAC", "1.0")
    df = lib.load(lib.META + lib.BASE + ladder.EXTRA + ["at_bat_number"])
    base = name.split("@")[0]
    if not base.startswith("NN") and any(f in ladder.spec_of(base)[2] for f in ladder.D1 + ladder.D2):
        df = ladder.add_d(df)
    v = pd.read_parquet(lib.CACHE / f"oof_{name}.parquet")["v"].reindex(df.index)
    bv = pd.read_parquet(lib.CACHE / "baseline_values.parquet").set_index(df.index)
    vs = {"g": v, "stuff": bv["stuff"], "command": bv["command"]}
    out = lib.outcome_table()
    meta = df.assign(half=lib.halves(df))
    fmap = df.groupby("pitcher")["fold"].first()
    rep = {"design": name}
    for scope in ("P", "T", "TH"):
        rows = lib.table(meta, vs, scope, out)
        folds = rows["pitcher"].map(fmap)
        ys = ("rv100", "kbb") if scope == "P" else ("rv100",)
        for y in ys:
            rows[f"blend_{y}"] = lib.blend(rows, ["stuff", "command"], y, folds)
        r = {}
        if scope == "P":
            r["vs_stuff"] = lib.J(rows, "stuff", "g")
            r["vs_blend"] = lib.J(rows, {"rv100": "blend_rv100", "kbb": "blend_kbb"}, "g")
            ns = rows[(rows["win"] == "NS") & (rows["outs"] >= 120)].assign(nra=lambda d: -d["ra9"],
                                                                              nfip=lambda d: -d["fip"])
            for y in ("nra", "nfip"):
                ns[f"bl_{y}"] = lib.blend(ns, ["stuff", "command"], y, ns["pitcher"].map(fmap))
                for ref in ("stuff", f"bl_{y}"):
                    d = lib.delta(ns, ref, "g", y)
                    d.pop("_boot")
                    r[f"next_{y[1:]}_vs_{ref.split('_')[0]}"] = d
            r["by_season"] = {}
            for s, g in rows.groupby("season"):
                j = lib.J(g, "stuff", "g", B=1000)
                jb = lib.J(g, {"rv100": "blend_rv100", "kbb": "blend_kbb"}, "g", B=1000)
                r["by_season"][int(s)] = {"vs_stuff": [j["J"], j["lo"], j["hi"]], "vs_blend": [jb["J"], jb["lo"],
                                                                                               jb["hi"]], "n": len(g)}
            r["same_season"] = lib.same_season(df, {"g": v, "stuff": bv["stuff"]}, out)
        else:
            for ref in ("stuff", "blend_rv100"):
                d = lib.delta(rows, ref, "g", "rv100")
                d.pop("_boot")
                r[f"vs_{ref.split('_')[0]}"] = d
        r["calibration_slope_rv100"] = {"g": calib(rows, "g")}
        keys = ["pitcher", "season"] + lib.SCOPES[scope]
        r["split_half"] = {k: lib.split_half(df, vs[k], by=keys, min_half={"P": 50, "T": 20, "TH": 15}[scope])
                           for k in ("g", "stuff", "command")}
        rep[scope] = r
        print(scope, json.dumps({k: (v_ if k != "by_season" else "...") for k, v_ in r.items()}, default=float)[:1500],
              flush=True)
    if "--credit" in sys.argv and not base.startswith("NN"):
        rep["credit"] = credit(df, name)
        print("credit", rep["credit"])
    lib.save(f"report_{name}", rep)


if __name__ == "__main__":
    main()
