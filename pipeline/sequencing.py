"""P7 step 7.6 sequencing (COLLABORATION.md, row "P7 step 7.6"): does the previous pitch add value?

    GOAT_LO=2020 python sequencing.py            fits f_seq and f_placebo, tests (a) exists and (b) trait
    GOAT_LO=2020 python sequencing.py --seal     test (c) on the sealed pitchers, only if (a) passed

f = Pitching+ P_raw (cache/pitchval_raw.parquet + count baseline). f_seq adds the previous pitch in the
same PA (class, deltas in velo / IVB / HB / VAA, previous location, distance, same-type flag);
f_placebo shuffles those features among pitches of the same pitcher, game and count.
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import kproj  # noqa: E402
import location_plus as lp  # noqa: E402
import pitching_plus as pp  # noqa: E402
import stack  # noqa: E402
import stuff_v2  # noqa: E402
from judge import cluster_w  # noqa: E402
from physics import add_physics  # noqa: E402
from train_mlb import TRAIN_SEASONS, load_features  # noqa: E402

PIPE = Path(__file__).resolve().parent
SEAL = "--seal" in sys.argv
PREV = ["prev_class", "d_velo", "d_ivb", "d_hb", "d_vaa", "prev_px", "prev_pz", "prev_dist", "same_type"]


def add_prev(df):
    o = df.sort_values(["game_pk", "at_bat_number", "pitch_number"])
    g = o.groupby(["game_pk", "at_bat_number"])
    prev = g[["velo", "ivb", "hb", "vaa", "plate_x_arm", "plate_z", "pitch_type", "pclass"]].shift(1)
    o["prev_class"] = prev["pclass"].map({"FB": 0, "BB": 1, "CH": 2})
    for c in ("velo", "ivb", "hb", "vaa"):
        o[f"d_{c}"] = o[c] - prev[c]
    o["prev_px"], o["prev_pz"] = prev["plate_x_arm"], prev["plate_z"]
    o["prev_dist"] = np.hypot(o["plate_x_arm"] - prev["plate_x_arm"], o["plate_z"] - prev["plate_z"])
    o["same_type"] = (o["pitch_type"] == prev["pitch_type"]).astype(float).where(prev["pitch_type"].notna())
    o["has_prev"] = prev["pitch_type"].notna()
    return o.loc[df.index]


def placebo(df, seed=13):
    """Shuffle the previous-pitch block among pitches of the same pitcher, game and count."""
    rng = np.random.default_rng(seed)
    x = df.loc[df["has_prev"], ["pitcher", "game_pk", "balls", "strikes"]]
    src = np.empty(len(x), dtype=np.int64)
    pos = pd.Series(np.arange(len(x)), index=x.index)
    for _, idx in x.groupby(["pitcher", "game_pk", "balls", "strikes"]).indices.items():
        src[idx] = idx[rng.permutation(len(idx))]
    out = df.copy()
    out.loc[x.index, PREV] = df.loc[x.index, PREV].to_numpy()[src]
    del pos
    return out


def fit(df, X, name):
    import lightgbm as lgb
    import zlib
    fold = df["pitcher"].map(lambda p: zlib.crc32(str(p).encode()) % 4)
    dev_tr = df["season"].isin(TRAIN_SEASONS) & ~df["pitcher"].map(lp.sealed) & df["y"].notna()
    pred = pd.Series(np.nan, index=df.index)
    for k in range(4):
        for pc in ("FB", "BB", "CH"):
            for side in ("R", "L"):
                cell = (df["pclass"] == pc) & (df["stand"] == side)
                tr, te = cell & dev_tr & (fold != k), cell & (fold == k) & df["plate_x"].notna()
                pred[te] = lgb.LGBMRegressor(**lp.LGB).fit(X[tr], df.loc[tr, "y"]).predict(X[te])
        print(f"{name} fold {k} done", flush=True)
    return pred


def boot_mean(per, num, den, draws=2000, seed=13):
    """Pitcher bootstrap of sum(num) / sum(den) over a per-pitcher table."""
    rng = np.random.default_rng(seed)
    w = rng.multinomial(len(per), np.full(len(per), 1 / len(per)), size=draws)
    est = per[num].sum() / per[den].sum()
    b = (w @ per[num].to_numpy()) / (w @ per[den].to_numpy())
    return {"est": float(est), "ci": [float(x) for x in np.percentile(b, [2.5, 97.5])]}


def main():
    df = stuff_v2.prepare(add_physics(load_features()))
    df["ptype"] = df["pitch_type"].map(lp.TYPE_CODE)
    df = lp.target(df)
    df, _ = pp.add_batter(df)  # identical frame and row order to pitching_plus.py
    df = add_prev(df)
    dev_tr = df["season"].isin(TRAIN_SEASONS) & ~df["pitcher"].map(lp.sealed) & df["y"].notna()
    base = df[["balls", "strikes"]].join(df[dev_tr].groupby(["balls", "strikes"])["y"].mean().rename("c"),
                                         on=["balls", "strikes"])["c"]
    v = pd.read_parquet(lp.CACHE / "pitchval_raw.parquet")["v"]
    v.index = df.index
    f = v + base
    cols = lp.LOC + stuff_v2.FEATURES + PREV
    preds = {}
    for name, frame in (("seq", df), ("placebo", None)):
        path = lp.CACHE / f"seqpred_{name}.parquet"
        if path.exists():
            p = pd.read_parquet(path)["p"]
            p.index = df.index
        else:
            frame = frame if frame is not None else placebo(df)
            p = fit(df, frame[cols], name)
            p.rename("p").to_frame().to_parquet(path)
        preds[name] = p
    sv = (preds["seq"] - f).where(df["has_prev"])
    res = {}
    if not SEAL:
        m = df["has_prev"] & df["y"].notna() & f.notna() & ~df["pitcher"].map(lp.sealed)
        e0 = (df.loc[m, "y"] - f[m]) ** 2
        per = pd.DataFrame({"pitcher": df.loc[m, "pitcher"],
                            "d_seq": e0 - (df.loc[m, "y"] - preds["seq"][m]) ** 2,
                            "d_pl": e0 - (df.loc[m, "y"] - preds["placebo"][m]) ** 2, "e0": e0, "n": 1.0})
        per["d_net"] = per["d_seq"] - per["d_pl"]
        per = per.groupby("pitcher")[["d_seq", "d_pl", "d_net", "e0", "n"]].sum()
        res["a_exists"] = {"mse_base": float(per["e0"].sum() / per["n"].sum()),
                           "mse_red_seq": boot_mean(per, "d_seq", "n"), "mse_red_placebo": boot_mean(per, "d_pl", "n"),
                           "mse_red_net": boot_mean(per, "d_net", "n"),
                           "net_share_of_mse": float(per["d_net"].sum() / per["e0"].sum())}
        ps = df.assign(s=sv).dropna(subset=["s"]).groupby(["pitcher", "season"]).agg(s=("s", "mean"), n=("s", "size")).reset_index()
        ps = ps[~ps["pitcher"].map(lp.sealed)]
        j = ps.merge(ps.assign(season=ps["season"] - 1), on=["pitcher", "season"], suffixes=("", "_n"))
        j = j[(j["n"] >= 300) & (j["n_n"] >= 300)]
        gs = list(j.groupby("season"))
        rs = []
        for (s, g), w in zip(gs, cluster_w([g["pitcher"] for _, g in gs], np.random.default_rng(13), 2000)):
            x, y = g["s"].to_numpy(), g["s_n"].to_numpy()
            mx, my = (w * x).sum(1) / w.sum(1), (w * y).sum(1) / w.sum(1)
            rs.append((w * (x - mx[:, None]) * (y - my[:, None])).sum(1)
                      / np.sqrt((w * (x - mx[:, None]) ** 2).sum(1) * (w * (y - my[:, None]) ** 2).sum(1)))
        R = np.mean(rs, axis=0)
        res["b_trait"] = {"yoy": float(R[0]), "ci": [float(x) for x in np.percentile(R[1:], [2.5, 97.5])],
                          "pairs": int(len(j)), "sd_seq_value_per100": float(100 * ps["s"].std())}
        # who sequences best (dev, 2025, >= 1000 pitches), runs per 100 pitches
        top = ps[(ps["season"] == 2025) & (ps["n"] >= 1000)].assign(r100=lambda x: 100 * x["s"])
        res["top_2025"] = top.nlargest(5, "s")[["pitcher", "r100"]].round(3).values.tolist()
        res["bottom_2025"] = top.nsmallest(5, "s")[["pitcher", "r100"]].round(3).values.tolist()
    else:
        dev = json.loads((PIPE / "results" / "sequencing_dev.json").read_text())
        a = dev["a_exists"]["mse_red_net"]["ci"]
        assert a[0] > 0, "test (a) did not pass on dev: the seal stays unread for sequencing (pre-registered)"
        ps = df.assign(s=sv).dropna(subset=["s"]).groupby(["pitcher", "season"])["s"].mean().rename("seq").reset_index()
        g = pd.read_csv(PIPE / "results" / "pitching_plus_raw_grades.csv")[["mlbam", "season", "grade"]]
        oc = pd.read_parquet(PIPE.parent / "cache" / "outcomes_2020.parquet")
        nxt = oc.assign(season=oc["season"] - 1)[["mlbam", "season", "rv100", "n_taken"]].rename(
            columns={"rv100": "rv_next", "n_taken": "nt_next"})
        d = (g.merge(ps.rename(columns={"pitcher": "mlbam"}), on=["mlbam", "season"])
             .merge(oc[["mlbam", "season", "n_taken"]], on=["mlbam", "season"]).merge(nxt, on=["mlbam", "season"]))
        d = d[(d["n_taken"] >= 50) & (d["nt_next"] >= 50) & (d["season"] <= 2025)].dropna()
        d["sealed"] = d["mlbam"].map(lp.sealed)
        dev_d, sl = d[~d["sealed"]], d[d["sealed"]].copy()
        for nm, c in (("p", ["grade"]), ("ps", ["grade", "seq"])):
            sl[nm] = kproj.model().fit(dev_d[c], dev_d["rv_next"]).predict(sl[c])
        res["c_claim_sealed"] = stack.pooled_dr(sl, "p", "ps", "rv_next")
    print(json.dumps(res, indent=1, default=str))
    (PIPE / "results" / f"sequencing{'_SEALED' if SEAL else '_dev'}.json").write_text(json.dumps(res, indent=1, default=str))


if __name__ == "__main__":
    main()
