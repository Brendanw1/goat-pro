"""RESULTS-MLB §73 (D-07): Whiff+ by pitch type vs each batter hand, with a shrunk grade, a CI and usage.

    python platoon_splits.py          # the §73 read once -> results/platoon_splits.csv + platoon_SEALED.json
    python platoon_splits.py --demo   # self-check of the scale, shrink and usage

Per pitcher x season x site type x stand, from the cross-fit per-pitch predictions (separate models per hand):
grade = the type's frozen TRAIN scale on the mean prediction (both hands on one scale, so the league platoon
edge stays in); shrunk = pulled toward the pitcher's own all-hands type prediction with K_SHRINK pitches;
lo/hi = 95% normal interval over this season's pitches; usage = share of all pitches to that hand.
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

import stack
from type_grades import K_SHRINK, SITE, type_table

PIPE = Path(__file__).resolve().parent
RES = PIPE / "results"
PRED = PIPE.parent / "cache" / "pred_s4_bb.parquet"
MIN_SW = 50     # §73: swings from each hand, both seasons
DISPLAY_N = 10  # p7_export.DISPLAY_N


def splits(pr: pd.DataFrame, type_pred: pd.Series, ref: pd.DataFrame) -> pd.DataFrame:
    """pr: per pitch (pitcher, season, pitch_type, stand, pred, whiff, swing); type_pred indexed by
    (pitcher, season, site); ref: per-site mean/std of the type scale."""
    side_n = pr.groupby(["pitcher", "season", "stand"]).size().rename("side_n")
    pr = pr[pr["pitch_type"].isin(SITE)].assign(site=lambda x: x["pitch_type"].map(SITE))
    g = (pr.groupby(["pitcher", "season", "site", "stand"])
         .agg(n=("pred", "size"), m=("pred", "mean"), sd=("pred", "std"), sw=("swing", "sum"), wh=("whiff", "sum"))
         .reset_index().join(side_n, on=["pitcher", "season", "stand"])
         .join(type_pred.rename("type_pred"), on=["pitcher", "season", "site"]).join(ref, on="site"))
    sc = lambda v: 100 + 10 * (v - g["mean"]) / g["std"]  # noqa: E731
    half = 1.96 * g["sd"].fillna(0) / np.sqrt(g["n"])
    return g.assign(usage=100 * g["n"] / g["side_n"], grade=sc(g["m"]), lo=sc(g["m"] - half), hi=sc(g["m"] + half),
                    grade_shrunk=sc((g["n"] * g["m"] + K_SHRINK * g["type_pred"]) / (g["n"] + K_SHRINK)))


def demo():
    pr = pd.DataFrame({"pitcher": 1, "season": 2025, "pitch_type": ["SL", "SL", "FF", "FF"], "stand": ["L", "L", "L", "R"],
                       "pred": [.30, .30, .20, .20], "whiff": 0, "swing": 0})
    tp = pd.Series([.25], index=pd.MultiIndex.from_tuples([(1, 2025, "SL")], names=["pitcher", "season", "site"]))
    ref = pd.DataFrame({"mean": [.25, .2], "std": [.05, .05]}, index=pd.Index(["SL", "FF"], name="site"))
    s = splits(pr, tp, ref).set_index(["site", "stand"])
    sl = s.loc[("SL", "L")]
    assert np.isclose(sl["grade"], 110) and np.isclose(sl["lo"], 110) and np.isclose(sl["usage"], 200 / 3), sl
    assert np.isclose(sl["grade_shrunk"], 100 + 10 * ((2 * .30 + K_SHRINK * .25) / (2 + K_SHRINK) - .25) / .05), sl
    assert np.isclose(s.loc[("FF", "R"), "usage"], 100) and np.isnan(s.loc[("FF", "R"), "grade_shrunk"])
    print("demo ok")


def main():
    t, ref = type_table(str(RES / "crossfit_v2_s4_bb_pt.csv"), 1)
    g = splits(pd.read_parquet(PRED, columns=["pitcher", "season", "pitch_type", "stand", "pred", "whiff", "swing"]),
               t.set_index(["pitcher", "season", "site"])["type_pred"], ref)
    out = g[g["n"] >= DISPLAY_N][["pitcher", "season", "site", "stand", "n", "usage", "grade", "grade_shrunk", "lo", "hi"]]
    out.round(2).to_csv(RES / "platoon_splits.csv", index=False)

    w = g.pivot_table(index=["pitcher", "season", "site"], columns="stand", values=["grade", "grade_shrunk", "sw", "wh"])
    w.columns = [f"{a}_{b}" for a, b in w.columns]
    w = w[(w["sw_L"] >= MIN_SW) & (w["sw_R"] >= MIN_SW)].reset_index()
    w["obs_gap"] = w["wh_L"] / w["sw_L"] - w["wh_R"] / w["sw_R"]
    w["pred_gap"], w["raw_gap"] = w["grade_shrunk_L"] - w["grade_shrunk_R"], w["grade_L"] - w["grade_R"]
    nxt = w.assign(season=w["season"] - 1)[["pitcher", "season", "site", "obs_gap", "pred_gap"]]
    d = w.merge(nxt, on=["pitcher", "season", "site"], suffixes=("", "_next")).dropna(subset=["pred_gap", "pred_gap_next"])
    d = d[d["season"].between(2021, 2025)].rename(columns={"pitcher": "mlbam"}).sort_values(["season", "mlbam", "site"])
    d = d.reset_index(drop=True)
    claim = stack.pooled_dr(d, "obs_gap", "pred_gap", "obs_gap_next")
    claim["verdict"] = "CONFIRMED" if claim["ci"][0] > 0 else "NOT CONFIRMED"
    res = {"claim": claim, "n": int(len(d)),
           "reported": {"raw_gap": stack.pooled_dr(d, "obs_gap", "raw_gap", "obs_gap_next"),
                        "yoy_pred_gap": round(float(d["pred_gap"].corr(d["pred_gap_next"])), 4)}}
    print(json.dumps(res, indent=1))
    (RES / "platoon_SEALED.json").write_text(json.dumps(res, indent=1))


if __name__ == "__main__":
    demo() if "--demo" in sys.argv else main()
