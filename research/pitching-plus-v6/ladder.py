"""Step 2: the ablation ladder. One named experiment per call; OOF values cached; judged against a reference.

    OMP_NUM_THREADS=3 nice -n 10 python research/pitching-plus-v6/ladder.py <name> [--vs <name>]
"""
import json
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lib  # noqa: E402

B = lib.BASE
C1 = ["z_n", "edge"]
C2 = ["t2_dx", "t2_dz", "t2_dist"]
C3 = ["t3_dx", "t3_dz", "t3_dist"]
D1 = ["ivb_rel", "hb_rel", "vaa_rel"]
D2 = ["spin_diff", "rel_h_diff", "rel_s_diff"]
SPECS = {  # name: (kind, target, features, extra params)
    "M0_T0": ("reg", "T0", B, {}),
    "M0_T1": ("reg", "T1", B, {}),
    "M0_T2": ("reg", "T2", B, {}),
    "M1_mc": ("mc", None, B, {}),
}
ADDS = {"c1": C1, "c2": C2, "c3": C3, "d1": D1, "d2": D2, "d3": ["arm_angle"]}
PARAMS = {"huber": {"objective": "huber", "alpha": 0.5}, "tuned": {}}


def spec_of(base):
    """'M0_T0+c1+d3' -> (kind, target, features, params): base spec plus feature adds / param tokens."""
    head, *mods = base.split("+")
    kind, tgt, feats, extra = SPECS[head]
    feats, extra = list(feats), dict(extra)
    for m in mods:
        if m in ADDS:
            feats += ADDS[m]
        else:
            extra.update(PARAMS[m])
    return kind, tgt, feats, extra


EXTRA = ["is_bip", "xwoba", "cls", "z_n", "edge", "sz_top", "sz_bot", "plate_x", "vaa", "arm_angle"] + C2 + C3


def add_d(df):
    """Shape+ v2-style relative physics (features only, fit on dev pitches; no outcome)."""
    import lightgbm as lgb
    ctx = ["velo", "rel_h", "rel_s_arm", "ext", "arm_angle", "plate_z", "ptype"]
    for col, name in (("ivb", "ivb_rel"), ("hb_arm", "hb_rel"), ("vaa", "vaa_rel")):
        m = lgb.LGBMRegressor(n_estimators=200, learning_rate=0.1, num_leaves=63, min_child_samples=500,
                              n_jobs=lib.THREADS, verbose=-1)
        s = df.sample(frac=0.3, random_state=1)
        ok = s[ctx + [col]].notna().all(1)
        m.fit(s.loc[ok, ctx], s.loc[ok, col], categorical_feature=["ptype"])
        df[name] = (df[col] - m.predict(df[ctx])).astype("float32")
    # extra fastball differentials (pitcher-season primary fastball = his most-thrown FB type)
    fb = df[df["pitch_type"].isin(["FF", "SI", "FC"])]
    prim = fb.groupby(["pitcher", "season"])["pitch_type"].agg(lambda s: s.value_counts().index[0])
    ref = fb.merge(prim.rename("pt").reset_index(), on=["pitcher", "season"])
    ref = ref[ref["pitch_type"] == ref["pt"]].groupby(["pitcher", "season"])[["spin", "rel_h", "rel_s_arm"]].mean()
    j = df[["pitcher", "season"]].join(ref, on=["pitcher", "season"])
    df["spin_diff"] = df["spin"] - j["spin"].to_numpy()
    df["rel_h_diff"] = df["rel_h"] - j["rel_h"].to_numpy()
    df["rel_s_diff"] = df["rel_s_arm"] - j["rel_s_arm"].to_numpy()
    return df


def run(name, spec, df, frac=None, params=None, mono=None, seed=0):
    import os
    frac = frac or float(os.environ.get("FRAC", 0.4))
    path = lib.CACHE / f"oof_{name}.parquet"
    if path.exists():
        return pd.read_parquet(path)["v"].reindex(df.index)
    if name.startswith("NN_mh"):  # shared-trunk net, folds fitted by nn_multihead.py (laptop CPU or Thunder)
        raw = pd.concat([pd.read_parquet(lib.CACHE / f"nn_fold{k}.parquet") for k in range(5)])["v_raw"]
        raw = raw.reindex(df.index)
        v = raw - raw.groupby([df["season"], df["balls"], df["strikes"]]).transform("mean")
        v.rename("v").astype("float32").to_frame().to_parquet(path)
        return v
    kind, tgt, feats, extra = spec
    t = time.time()
    y = lib.target(df, tgt) if kind == "reg" else None
    if y is not None:  # count-normalize the target per (season, count) on dev
        y = y - y.groupby([df["season"], df["balls"], df["strikes"]]).transform("mean")
    v = lib.fit_oof(df, feats, kind, y, params={**extra, **(params or {})}, frac=frac, mono=mono, seed=seed)
    v.rename("v").astype("float32").to_frame().to_parquet(path)
    print(f"{name}: fit {time.time() - t:.0f}s", flush=True)
    return v


def judge(df, vs, ref, name, out, extra_refs=("stuff",)):
    bv = pd.read_parquet(lib.CACHE / "baseline_values.parquet").set_index(df.index)
    allv = {**{k: bv[k] for k in ("stuff", "command")}, **vs}
    rows = lib.table(df, allv, "P", out)
    folds = rows["pitcher"].map(df.groupby("pitcher")["fold"].first())
    for y in ("rv100", "kbb"):
        rows[f"blend_{y}"] = lib.blend(rows, ["stuff", "command"], y, folds)
    bl = {"rv100": "blend_rv100", "kbb": "blend_kbb"}
    res = {"vs_ref": lib.J(rows, ref, name) if ref in allv else None,
           "vs_stuff": lib.J(rows, "stuff", name), "vs_blend": lib.J(rows, bl, name),
           "levels": {y: round(float(rows[[name, y]].dropna().corr().iloc[0, 1]), 4) for y in ("rv100", "kbb")}}
    ns = rows[(rows["win"] == "NS") & (rows["outs"] >= 120)]
    res["next_ra9_fip"] = {y: round(float(np.corrcoef(ns[name], -ns[y])[0, 1]), 4) for y in ("ra9", "fip")}
    res["by_window"] = {w: {y: round(float(g[[name, y]].dropna().corr().iloc[0, 1]), 4) for y in ("rv100", "kbb")}
                        for w, g in rows.groupby("win")}
    res["same_season"] = lib.same_season(df, {name: vs[name]}, out)[name]
    res["split_half"] = lib.split_half(df, vs[name])
    return res


def main():
    name = sys.argv[1]
    base = name.split("@")[0]
    ref = sys.argv[sys.argv.index("--vs") + 1] if "--vs" in sys.argv else "stuff"
    df = lib.load(lib.META + lib.BASE + EXTRA + ["at_bat_number", "lockbox"])
    df = df.drop(columns="lockbox")
    if not base.startswith("NN") and any(f in spec_of(base)[2] for f in D1 + D2):
        df = add_d(df)
    out = lib.outcome_table()
    vs = {name: run(name, None if base.startswith("NN") else spec_of(base), df)}
    if ref not in ("stuff",):
        vs[ref] = pd.read_parquet(lib.CACHE / f"oof_{ref}.parquet")["v"].reindex(df.index)
    res = judge(df, vs, ref, name, out)
    lib.save(name, res)
    print(json.dumps({k: res[k] for k in ("vs_ref", "vs_stuff", "vs_blend", "levels", "next_ra9_fip",
                                          "same_season", "split_half")}, default=float))


if __name__ == "__main__":
    main()
