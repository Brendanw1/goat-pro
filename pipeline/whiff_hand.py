"""RESULTS-MLB §82: Whiff+ regraded from the cross-fit predictions, each pitch vs its own batter hand.

    python whiff_hand.py [TAG]    # -> results/crossfit_v2_{TAG}_{hand,quirk}_grades.csv (TAG s4_bb, or s7_aaa)
    python whiff_hand.py --demo   # self-check of the two hand rules

Same frozen references as crossfit_v2's frozen_scale (TRAIN pitcher means of the prediction over swings,
>= 10 swings, per class x batter hand) and season_grades' grade (clip(100 + 10 x mean z, 50, 175), >= 5
pitches). "quirk" replicates the pre-§82 rule (whole class vs its first pitch's hand) to isolate the fix.
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

import train_mlb as tm

RES = Path(__file__).resolve().parent / "results"


def refs(p: pd.DataFrame) -> pd.DataFrame:
    tr = p[p["season"].isin(tm.TRAIN_SEASONS) & (p["swing"] == 1)]
    pm = tr.groupby(["pclass", "stand", "pitcher"])["pred"].agg(["mean", "count"])
    return pm[pm["count"] >= 10].groupby(["pclass", "stand"])["mean"].agg(["mean", "std"])


def grades(p: pd.DataFrame, ref: pd.DataFrame, quirk: bool) -> pd.DataFrame:
    hand = p.groupby(["pitcher", "season", "pclass"])["stand"].transform("first") if quirk else p["stand"]
    r = ref.reindex(pd.MultiIndex.from_arrays([p["pclass"], hand])).to_numpy()
    g = p.assign(z=(p["pred"].to_numpy() - r[:, 0]) / r[:, 1]).groupby(["pitcher", "season"])["z"].agg(["mean", "size"])
    g = g[g["size"] >= 5]
    return pd.DataFrame({"mlbam": g.index.get_level_values(0), "season": g.index.get_level_values(1),
                         "grade": np.clip(100 + 10 * g["mean"].to_numpy(), 50, 175)})


def demo():
    p = pd.DataFrame({"pitcher": 1, "season": 2025, "pclass": "BB", "stand": ["L", "R", "R", "R", "R"], "pred": .3})
    ref = pd.DataFrame({"mean": [.2, .3], "std": [.1, .1]},
                       index=pd.MultiIndex.from_tuples([("BB", "L"), ("BB", "R")], names=["pclass", "stand"]))
    assert np.isclose(grades(p, ref, False)["grade"].iloc[0], 100 + 10 * (1 / 5))  # one LHH pitch at z = 1
    assert np.isclose(grades(p, ref, True)["grade"].iloc[0], 110)  # every pitch scored vs LHH
    print("demo ok")


def main(tag="s4_bb"):
    p = pd.read_parquet(Path(__file__).resolve().parent.parent / "cache" / f"pred_{tag}.parquet",
                        columns=["pitcher", "season", "pitch_type", "stand", "pred", "swing"])
    p["pclass"] = p["pitch_type"].map(tm.CLASS_OF)
    ref = refs(p)
    for name, q in (("hand", False), ("quirk", True)):
        grades(p, ref, q).round(4).to_csv(RES / f"crossfit_v2_{tag}_{name}_grades.csv", index=False)
    print(ref)


if __name__ == "__main__":
    demo() if "--demo" in sys.argv else main(*sys.argv[1:2])
