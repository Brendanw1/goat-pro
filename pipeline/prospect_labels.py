"""prospect_labels.py — prospect program F2: value labels per snapshot row from our line WAR (pipeline/line_war.py).

    python pipeline/prospect_labels.py          # -> data/milb/prospect_labels.parquet + maturity table
    python pipeline/prospect_labels.py --demo   # self-check, no data

One row per (id, as_of) of prospect_snapshots. Control seasons = the debut season and the 5 after it (FanGraphs' minimum
of six; ponytail: no service-day refinement, add it if the label moves when control runs past six seasons).
  war6     WAR over the control seasons, if the debut comes within 4 seasons of the snapshot (t_debut 0..3), else 0
  star     at least two control seasons of 4+ WAR (Clemens 2026 "star odds")
  war2     WAR over the first two control seasons (the early label for the sealed 2019-22 lists; validated before use)
  obs6/obs2 control seasons observed through DATA_END; matured6/matured2 = the label can no longer change
These are targets only: never an input to features_asof.
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
MILB = ROOT / "data" / "milb"
DATA_END = 2026


def labels(S: pd.DataFrame, war: pd.Series) -> pd.DataFrame:
    """S: id, as_of, debut_season, t_debut, event. war: WAR indexed by (id, season), both roles summed."""
    o = S[["id", "as_of", "debut_season", "t_debut", "event"]].copy()
    arrived = o.t_debut.between(0, 3)

    def tot(n):
        return np.array([sum(war.get((i, s), 0.0) for s in range(int(d), int(d) + n)) if a else 0.0
                         for i, d, a in zip(o.id, o.debut_season, arrived)])
    o["war6"], o["war2"] = tot(6), tot(2)
    o["star"] = [float(sum(war.get((i, s), 0.0) >= 4 for s in range(int(d), int(d) + 6)) >= 2) if a else 0
                 for i, d, a in zip(o.id, o.debut_season, arrived)]
    for n in (6, 2):
        obs = np.where(arrived, np.clip(DATA_END - o.debut_season.fillna(0) + 1, 0, n), np.nan)
        y0 = o.as_of.dt.year + (o.as_of.dt.month >= 10)
        closed_no = (~arrived) & ((o.event == "exit") | (DATA_END - y0 + 1 >= 4))   # 4-season debut window closed
        o[f"obs{n}"] = obs
        o[f"matured{n}"] = ((arrived & (obs >= n)) | closed_no).astype(float)
    o.loc[o.event == "debuted_before", ["war6", "war2", "star", "matured6", "matured2"]] = np.nan
    return o


def demo():
    S = pd.DataFrame({"id": [1, 2, 3, 4], "as_of": pd.to_datetime(["2015-03-01"] * 3 + ["2024-03-01"]),
                      "debut_season": [2016, np.nan, 2021, 2025], "t_debut": [1, np.nan, 6, 1],
                      "event": ["debut", "exit", "debut", "debut"]})
    war = pd.Series({(1, 2016): 1.0, (1, 2017): 4.5, (1, 2018): 5.0, (1, 2022): 9.0, (3, 2021): 3.0, (4, 2025): 2.0})
    o = labels(S, war).set_index("id")
    assert o.at[1, "war6"] == 10.5 and o.at[1, "star"] == 1 and o.at[1, "war2"] == 5.5 and o.at[1, "matured6"]
    assert o.at[2, "war6"] == 0 and o.at[2, "matured6"]                       # never debuted, window closed
    assert o.at[3, "war6"] == 0                                                # debut outside the 4-season window
    assert o.at[4, "war2"] == 2.0 and o.at[4, "matured2"] and not o.at[4, "matured6"]
    print("demo ok")


if __name__ == "__main__":
    if "--demo" in sys.argv:
        demo()
        sys.exit()
    S = pd.read_parquet(MILB / "prospect_snapshots.parquet")
    w = pd.read_parquet(MILB / "line_war.parquet").groupby(["id", "season"]).war.sum()
    o = labels(S, w)
    o.to_parquet(MILB / "prospect_labels.parquet", compression="zstd")
    o["tyear"] = np.where(S.snap == "list", S.as_of.dt.year, S.as_of.dt.year + 1)
    lst = o[(S.snap.values == "list") & (o.tyear <= 2018)]      # sealed lists (2019+) are never summarized here
    print(lst.groupby("tyear").agg(rows=("id", "size"), matured6=("matured6", "mean"), matured2=("matured2", "mean"),
                                   war6_pos=("war6", lambda s: (s > 0).mean()), war6_ge1=("war6", lambda s: (s >= 1).mean()),
                                   star=("star", "mean")).round(3).to_string())
