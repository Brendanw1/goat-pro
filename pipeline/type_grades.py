"""Per-pitch-type Stuff+ (owner ask 2026-10-26): grade each pitch type from its own pitches and
scale it against that type's league distribution (slider vs sliders, sweeper vs sweepers), instead
of the shared class grade (one BB grade for a pitcher's SL, ST and CU).

    python type_grades.py results/crossfit_v2_holdout_base_pt.csv

Type grade = 100 + 10 * (own-type mean prediction - type mean) / type sd, mean/sd frozen on TRAIN
(2023-24) pitcher x type rows with >= 50 pitches. Out-of-fold predictions only (crossfit_v2 *_pt.csv).
Checks per site type: YoY of the type grade, and r with that type's next-season whiff/swing for
the type grade vs the class grade it replaces (pre-registered: type grade wins in >= 6 of 8 types).
"""
import json
import sys

import numpy as np
import pandas as pd

from train_mlb import CLASS_OF, TRAIN_SEASONS

SITE = {"FF": "FF", "SI": "SI", "FC": "CT", "SL": "SL", "SV": "SL", "SW": "SW", "ST": "SW",
        "CU": "CB", "KC": "CB", "CH": "CH", "FS": "FS", "FO": "FS"}  # web_export.SC_TO_SITE
MIN_N = 50
K_SHRINK = 150  # pre-registered: pull toward the class prediction with weight of 150 pitches


def type_table(path, min_n=MIN_N):
    """Type grades for cells with >= min_n pitches; the scale is always frozen on TRAIN cells with >= MIN_N."""
    pt = pd.read_csv(path)
    pt = pt[pt["pitch_type"].isin(SITE)]
    pt["site"], pt["pclass"] = pt["pitch_type"].map(SITE), pt["pitch_type"].map(CLASS_OF)
    w = lambda c: (pt[c] * pt["n"])  # noqa: E731
    cls = (pt.assign(wp=w("pred")).groupby(["pitcher", "season", "pclass"])
           .agg(wp=("wp", "sum"), n=("n", "sum")))
    cls = (cls["wp"] / cls["n"]).rename("class_pred")
    t = (pt.assign(wp=w("pred"), ws=pt["wps"] * pt["n_sw"]).groupby(["pitcher", "season", "site", "pclass"])
         .agg(wp=("wp", "sum"), n=("n", "sum"), ws=("ws", "sum"), n_sw=("n_sw", "sum")).reset_index())
    t["type_pred"], t["wps"] = t["wp"] / t["n"], t["ws"] / t["n_sw"]
    t = t.join(cls, on=["pitcher", "season", "pclass"])
    t["raw_pred"] = t["type_pred"]  # own pitches only (first, failed spec)
    t["type_pred"] = (t["n"] * t["raw_pred"] + K_SHRINK * t["class_pred"]) / (t["n"] + K_SHRINK)
    ref = t[t["season"].isin(TRAIN_SEASONS) & (t["n"] >= MIN_N)].groupby("site")["type_pred"].agg(["mean", "std"])
    t = t.join(ref, on="site")
    t["type_grade"] = 100 + 10 * (t["type_pred"] - t["mean"]) / t["std"]
    return t[t["n"] >= min_n], ref


def main(path):
    t, ref = type_table(path)
    nxt = t.assign(season=t["season"] - 1)[["pitcher", "season", "site", "wps", "type_grade", "n_sw"]]
    j = t.merge(nxt, on=["pitcher", "season", "site"], suffixes=("", "_next"))
    j = j[(j["n_sw"] >= MIN_N) & (j["n_sw_next"] >= MIN_N)]
    out = {}
    for site, g in j.groupby("site"):
        out[site] = {"pairs": len(g),
                     "yoy_type_grade": round(g["type_grade"].corr(g["type_grade_next"]), 3),
                     "r_next_whiff_type": round(g["type_pred"].corr(g["wps_next"]), 3),
                     "r_next_whiff_raw": round(g["raw_pred"].corr(g["wps_next"]), 3),
                     "r_next_whiff_class": round(g["class_pred"].corr(g["wps_next"]), 3),
                     "type_mean": round(ref.loc[site, "mean"], 4), "type_sd": round(ref.loc[site, "std"], 4)}
    wins = sum(v["r_next_whiff_type"] > v["r_next_whiff_class"] for v in out.values())
    worst = min(v["r_next_whiff_type"] - v["r_next_whiff_class"] for v in out.values())
    print(pd.DataFrame(out).T.to_string(), f"\nshrunk type grade beats class grade in {wins} of {len(out)}"
          f" types, worst delta {worst:+.3f}")
    tag = path.split("crossfit_v2_")[-1].replace("_pt.csv", "")
    (pd.io.common.Path(path).parent / f"type_grades_{tag}.json").write_text(json.dumps(out, indent=1))
    t[["pitcher", "season", "site", "n", "type_grade"]].to_csv(path.replace("_pt.csv", "_type_grades.csv"), index=False)


if __name__ == "__main__":
    main(sys.argv[1])
