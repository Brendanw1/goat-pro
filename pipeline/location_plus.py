"""P7 step 7.4 Location+ (COLLABORATION.md, row "P7 step 7.4"): command value with shape held fixed.

    GOAT_LO=2020 python location_plus.py            fit both variants, dev judge
    GOAT_LO=2020 python location_plus.py --seal X    read the sealed pitchers once for variant X

Per-pitch target y (pitcher-positive): swings at xrv, called pitches umpire-neutral (p(called strike)
x count strike value + (1 - p) x count ball value), HBP at actual rv. L_direct = f(location, count,
pitch type) - E[y | count, type]; L_ctrl = f(location, count, shape) - g(count, shape). Per class x
batter side, dev pitchers' 2023-24 pitches, 4 pitcher folds. Grades 100 + 10 z; judge = ridge
[Whiff+, xrv grade] vs [+ Location+] on next-season RV/100, pitcher-grouped CV on dev.
"""
import json
import sys
import zlib
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import kproj  # noqa: E402
import stack  # noqa: E402
import stuff_v2  # noqa: E402
from physics import add_physics  # noqa: E402
from train_mlb import TRAIN_SEASONS, load_features  # noqa: E402

PIPE = Path(__file__).resolve().parent
CACHE = PIPE.parent / "cache"
SEAL = sys.argv[sys.argv.index("--seal") + 1] if "--seal" in sys.argv else ""
LGB = dict(n_estimators=300, learning_rate=0.1, num_leaves=63, min_child_samples=1000, n_jobs=4, verbose=-1)
TYPE_CODE = {t: i for i, t in enumerate(["FF", "SI", "FC", "SL", "CU", "KC", "SW", "SV", "ST", "CH", "FS", "FO", "EP"])}
LOC = ["plate_x_arm", "plate_z", "balls", "strikes"]


def sealed(p):
    return zlib.crc32(f"p7:{p}".encode()) % 5 == 0


def target(df):
    import lightgbm as lgb
    tr = df["season"].isin(TRAIN_SEASONS)
    sw, cs = df["swing"] == 1, (df["csw"] == 1) & (df["swing"] == 0)
    hbp = (df["swing"] == 0) & (df["csw"] == 0) & (df["pa_end"] == 1) & (df["balls"] < 3)
    called = (df["swing"] == 0) & ~hbp
    ip = sw & (df["pa_taken"] == 0)
    y = df["rv"].copy()
    fit = tr & ip & df["xwoba"].notna() & df["rv"].notna()
    for (b, s), g in df[fit].groupby(["balls", "strikes"]):
        cb, ca = np.polyfit(g["xwoba"], g["rv"], 1)
        m = ip & df["xwoba"].notna() & (df["balls"] == b) & (df["strikes"] == s)
        y[m] = ca + cb * df.loc[m, "xwoba"]
    v_cs = df[tr & cs].groupby(["balls", "strikes"])["rv"].mean().rename("v_cs")
    v_b = df[tr & called & ~cs].groupby(["balls", "strikes"])["rv"].mean().rename("v_b")
    vals = df[["balls", "strikes"]].join(v_cs, on=["balls", "strikes"]).join(v_b, on=["balls", "strikes"])
    X = df[["plate_x", "plate_z", "balls", "strikes"]].assign(stand=(df["stand"] == "L").astype(int))
    df["p_cs"] = np.nan
    for era, rows in (("pre", df["season"] < 2026), ("abs", df["season"] == 2026)):
        f = called & (tr if era == "pre" else rows) & df["plate_x"].notna()
        clf = lgb.LGBMClassifier(**LGB).fit(X[f], cs[f].astype(int))
        df.loc[rows, "p_cs"] = clf.predict_proba(X[rows])[:, 1]
    y[called] = df.loc[called, "p_cs"] * vals.loc[called, "v_cs"] + (1 - df.loc[called, "p_cs"]) * vals.loc[called, "v_b"]
    df["y"] = y
    return df


def fit_variant(df, name):
    import lightgbm as lgb
    shape = stuff_v2.FEATURES
    if name == "direct":
        full, base = LOC + ["ptype"], ["balls", "strikes", "ptype"]
    else:
        full, base = LOC + shape, ["balls", "strikes"] + shape
    fold = df["pitcher"].map(lambda p: zlib.crc32(str(p).encode()) % 4)
    dev_tr = df["season"].isin(TRAIN_SEASONS) & ~df["pitcher"].map(sealed) & df["y"].notna()
    val = pd.Series(np.nan, index=df.index)
    for k in range(4):
        for pc in ("FB", "BB", "CH"):
            for side in ("R", "L"):
                cell = (df["pclass"] == pc) & (df["stand"] == side)
                tr = cell & dev_tr & (fold != k)
                te = cell & (fold == k) & df["plate_x"].notna()
                f = lgb.LGBMRegressor(**LGB).fit(df.loc[tr, full], df.loc[tr, "y"])
                g = lgb.LGBMRegressor(**LGB).fit(df.loc[tr, base], df.loc[tr, "y"])
                val[te] = f.predict(df.loc[te, full]) - g.predict(df.loc[te, base])
        print(f"{name} fold {k} done", flush=True)
    return val


def grades(df, val):
    d = df.assign(v=val).dropna(subset=["v"])
    ps = d.groupby(["pitcher", "season"]).agg(v=("v", "mean"), n=("v", "size")).reset_index()
    ref = ps[ps["season"].isin(TRAIN_SEASONS) & (ps["n"] >= 300) & ~ps["pitcher"].map(sealed)]
    ps["grade"] = 100 + 10 * (ps["v"] - ref["v"].mean()) / ref["v"].std()
    return ps.rename(columns={"pitcher": "mlbam"})


def judge(ps, cols_extra=("loc",), which="dev"):
    d = stack.frame()
    xg = pd.read_csv(PIPE / "results" / "crossfit_v2_p72_xrv_grades.csv").rename(columns={"grade": "xrv_g"})
    d = d.merge(xg, on=["mlbam", "season"]).merge(ps[["mlbam", "season", "grade"]].rename(columns={"grade": "loc"}),
                                                  on=["mlbam", "season"])
    from sklearn.model_selection import GroupKFold
    dev, sl = d[~d["sealed"]].reset_index(drop=True), d[d["sealed"]].reset_index(drop=True)
    stack.add_kplus(dev, sl)
    out = {}
    specs = {"base": ["whiff", "xrv_g"], "loc": ["whiff", "xrv_g", "loc"],
             "prev": stack.S_COLS, "prev_loc": stack.S_COLS + ["loc"]}
    for y in ("rv_next", "xrv_next"):
        for nm, cols in specs.items():
            dev[f"{nm}_{y}"] = 0.0
            for tr, te in GroupKFold(5).split(dev, groups=dev["mlbam"]):
                dev.loc[te, f"{nm}_{y}"] = kproj.model().fit(dev.loc[tr, cols], dev.loc[tr, y]).predict(dev.loc[te, cols])
            sl[f"{nm}_{y}"] = kproj.model().fit(dev[cols], dev[y]).predict(sl[cols])
        tgt = dev if which == "dev" else sl
        out[y] = {"claim_loc_vs_base": stack.pooled_dr(tgt, f"base_{y}", f"loc_{y}", y),
                  "loc_added_to_prevention": stack.pooled_dr(tgt, f"prev_{y}", f"prev_loc_{y}", y)}
    return out, d


def extras(df, val, ps, d):
    rng = np.random.default_rng(13)
    x = df.assign(v=val).dropna(subset=["v"])
    x = x[~x["pitcher"].map(sealed)]
    rel = {}
    for n in (100, 200, 400, 800):
        a, b = [], []
        for _, g in x.groupby(["pitcher", "season"]):
            if len(g) >= 2 * n:
                v = g["v"].to_numpy()[rng.permutation(len(g))[:2 * n]]
                a.append(v[:n].mean()), b.append(v[n:].mean())
        rel[n] = round(float(np.corrcoef(a, b)[0, 1]), 3) if len(a) >= 30 else None
    nxt = ps.assign(season=ps["season"] - 1)
    j = ps.merge(nxt, on=["mlbam", "season"], suffixes=("", "_n"))
    j = j[(j["n"] >= 300) & (j["n_n"] >= 300)]
    comp = x.assign(heart=(x["p_cs"] >= .95) & (x["plate_x"].abs() <= .5), edge=x["p_cs"].between(.25, .75),
                    waste=x["p_cs"] < .02).groupby(["pitcher", "season"])[["heart", "edge", "waste"]].mean()
    cj = ps.set_index(["mlbam", "season"]).join(comp.rename_axis(["mlbam", "season"]), how="inner")
    return {"split_half": rel, "yoy_300": round(float(j["grade"].corr(j["grade_n"])), 3),
            "r_with_whiff": round(float(d["loc"].corr(d["whiff"])), 3),
            "component_r_with_grade": {c: round(float(cj["grade"].corr(cj[c])), 3) for c in ("heart", "edge", "waste")},
            "component_means": {c: round(float(cj[c].mean()), 3) for c in ("heart", "edge", "waste")}}


def main():
    df = stuff_v2.prepare(add_physics(load_features()))
    df["ptype"] = df["pitch_type"].map(TYPE_CODE)
    df = target(df)
    res = {}
    for name in ([SEAL] if SEAL else ["direct", "ctrl"]):
        path = CACHE / f"locval_{name}.parquet"
        if path.exists():
            val = pd.read_parquet(path)["v"].reindex(df.index)
        else:
            val = fit_variant(df, name)
            val.rename("v").to_frame().to_parquet(path)
        ps = grades(df, val)
        ps.to_csv(PIPE / "results" / f"location_plus_{name}_grades.csv", index=False)
        j, d = judge(ps, which="sealed" if SEAL else "dev")
        res[name] = {"judge": j, **extras(df, val, ps, d)}
        print(name, json.dumps(res[name]), flush=True)
    (PIPE / "results" / f"location_plus{'_SEALED_' + SEAL if SEAL else '_dev'}.json").write_text(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
