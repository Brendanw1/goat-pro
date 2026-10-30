"""§106 (prospect value) + §107 (fringe trades): the read scripts share this panel builder.

    python prospect_value.py            # -> results/prospect_value_SEALED.json (§106)
    python trade_study.py               # -> results/trade_study_SEALED.json (§107)

Spine: MLB Pipeline top-100 lists 2011- (data/milb/prospects.json), §85 own-WAR per
player-season (data/export/web/war_index.json, window 2020-2024), and the §105
roster-snapshot labels (data/rosters40/). Nothing external.
"""
import json
import sys
from collections import defaultdict
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
PROSPECTS_F = ROOT / "data" / "milb" / "prospects.json"
WAR_F = ROOT / "data" / "export" / "web" / "war_index.json"
WINDOW = (2020, 2024)
LIST_SPAN = range(2016, 2022)  # cohorts whose first-3-season columns complete inside the window


def load_war() -> pd.DataFrame:
    d = json.load(open(WAR_F))
    rows = []
    for season, block in d["seasons"].items():
        for side, key in (("hitters", "hitters"), ("pitchers", "pitchers")):
            for r in block[key]:
                rows.append({"id": str(r["id"]), "season": int(season), "war": r["war"],
                             "pa_ip": r.get("pa") or r.get("ip"), "side": side})
    df = pd.DataFrame(rows)
    return df.groupby(["id", "season", "side"], as_index=False).agg(war=("war", "sum"), pa_ip=("pa_ip", "sum"))


def load_prospects() -> pd.DataFrame:
    d = json.load(open(PROSPECTS_F))
    rows = []
    for year, lists in d.items():
        y = int(year)
        if y not in LIST_SPAN and y < 2011:
            continue
        for r in lists.get("top100", []) or []:
            if r.get("id") and r.get("rank"):
                pos = (r.get("pos") or "")
                is_p = any(x in pos for x in ("P", "LHP", "RHP"))
                rows.append({"id": str(r["id"]), "name": r.get("name"), "year": y, "rank": int(r["rank"]),
                             "pos": pos, "side": "pitchers" if is_p else "hitters",
                             "eta": r.get("eta"), "age": r.get("age")})
    df = pd.DataFrame(rows)
    best = df.loc[df.groupby(["id", "name", "year"])["rank"].idxmin(),
                  ["id", "name", "year", "rank", "side"]].reset_index(drop=True)
    best["tier"] = pd.cut(best["rank"], [0, 10, 25, 50, 100], labels=["1-10", "11-25", "26-50", "51-100"])
    # a player's prospect identity = his best tier across cohorts in the span
    ident = best.groupby("id").agg(name=("name", "first"), best_rank=("rank", "min"),
                                   first_year=("year", "min"), last_year=("year", "max"),
                                   side=("side", "first"))
    ident["tier"] = pd.cut(ident["best_rank"], [0, 10, 25, 50, 100], labels=["1-10", "11-25", "26-50", "51-100"])
    return ident.reset_index()


def war_after(df: pd.DataFrame, first_year: int, n: int) -> float:
    m = df[(df["season"] >= first_year) & (df["season"] <= min(first_year + n - 1, WINDOW[1]))]
    return float(m["war"].sum())
