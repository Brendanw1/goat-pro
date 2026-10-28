"""P0 step 5 (COLLABORATION.md): split-half reliability per pitch type + T2 slider gyro display check.

    python step5.py cache/pred_s4_bb.parquet      (from crossfit_v2.py --save-pred)

Reliability: pitcher x season x site type cells with >= 2N pitches; two disjoint random halves of N
pitches; r(mean out-of-fold prediction half A, half B) across cells. Same for realized whiff/swing
with N swings per half. Reported per type and N; "stable at" = smallest N with r >= .70.
T2: Statcast SL pitcher-seasons, gyro share = 1 - mean spin_eff; SL-gyro if >= .75 (pre-registered).
Per group: count, mean prediction, r(pitcher-season SL prediction, next-season SL whiff/swing),
YoY; and whether centring the prediction within group (a split display scale) changes that r.
Display only: nothing here changes a grade.
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

from type_grades import MIN_N, SITE

NS = (25, 50, 100, 200, 400)
GYRO_CUT = .75


def split_half(g, col, n, rng):
    """r between the means of two disjoint random n-row halves, one draw per cell."""
    a, b = [], []
    for _, x in g:
        if len(x) < 2 * n:
            continue
        v = x[col].to_numpy()[rng.permutation(len(x))[:2 * n]]
        a.append(v[:n].mean()), b.append(v[n:].mean())
    return (round(float(np.corrcoef(a, b)[0, 1]), 3), len(a)) if len(a) >= 30 else (None, len(a))


def main(path):
    rng = np.random.default_rng(13)
    df = pd.read_parquet(path)
    df["site"] = df["pitch_type"].map(SITE)
    df = df[df["site"].notna() & df["pred"].notna()]
    rel = {}
    for site, d in df.groupby("site"):
        cells = d.groupby(["pitcher", "season"])
        sw = d[d["swing"] == 1].groupby(["pitcher", "season"])
        rel[site] = {n: {"grade": split_half(cells, "pred", n, rng), "whiff_swing": split_half(sw, "whiff", n, rng)}
                     for n in NS}
        stable = {k: next((n for n in NS if (rel[site][n][k][0] or 0) >= .70), None) for k in ("grade", "whiff_swing")}
        rel[site]["stable_at"] = stable
        print(site, {n: (rel[site][n]["grade"][0], rel[site][n]["whiff_swing"][0]) for n in NS}, "stable at", stable)

    sl = df[df["pitch_type"] == "SL"]
    ps = sl.groupby(["pitcher", "season"]).agg(pred=("pred", "mean"), gyro=("spin_eff", lambda s: 1 - s.mean()),
                                              n=("pred", "size"))
    sws = sl[sl["swing"] == 1].groupby(["pitcher", "season"])["whiff"].agg(["mean", "size"])
    ps = ps.join(sws.rename(columns={"mean": "wps", "size": "n_sw"})).reset_index()
    ps["grp"] = np.where(ps["gyro"] >= GYRO_CUT, "SL-gyro", "SL-other")
    nxt = ps.assign(season=ps["season"] - 1)[["pitcher", "season", "pred", "wps", "n_sw", "grp"]]
    j = ps.merge(nxt, on=["pitcher", "season"], suffixes=("", "_next"))
    j = j[(j["n_sw"] >= MIN_N) & (j["n_sw_next"] >= MIN_N)]
    j["pred_c"] = j["pred"] - j.groupby("grp")["pred"].transform("mean")
    t2 = {"cut": GYRO_CUT, "pooled_r": round(j["pred"].corr(j["wps_next"]), 3),
          "group_centred_r": round(j["pred_c"].corr(j["wps_next"]), 3),
          "group_switch_rate": round(float((j["grp"] != j["grp_next"]).mean()), 3), "groups": {}}
    for grp, g in j.groupby("grp"):
        t2["groups"][grp] = {"pitcher_seasons": int((ps["grp"] == grp).sum()), "pairs": len(g),
                             "mean_pred": round(g["pred"].mean(), 4), "mean_wps": round(g["wps"].mean(), 3),
                             "r_next_wps": round(g["pred"].corr(g["wps_next"]), 3),
                             "yoy": round(g["pred"].corr(g["pred_next"]), 3)}
    print("T2:", json.dumps(t2))
    out = Path(__file__).resolve().parent / "results" / f"step5_{Path(path).stem.removeprefix('pred_')}.json"
    out.write_text(json.dumps({"reliability": rel, "t2": t2}, indent=1, default=str))


if __name__ == "__main__":
    main(sys.argv[1])
