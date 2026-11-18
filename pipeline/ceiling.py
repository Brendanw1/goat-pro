"""Noise ceiling of every next-season target: the r a grade would reach if it knew each pitcher's true talent in S.

    python ceiling.py            # writes results/ceilings.json

No model is fit and no grade is read: game-level sums from pitches_all, regular season 2021-26, selection set.
Per target, on pairs S -> S+1 with >= 50 taken pitches in both seasons (judge.py's floor, applied to S too because
a reliability needs both halves):
  rel_s, rel_s1   odd/even-game split-half r, Spearman-Brown to the full season
  yoy             observed r(S, S+1)
  talent_yoy      yoy / sqrt(rel_s * rel_s1): how much true talent carries over (the rest is real change)
  ceiling         talent_yoy * sqrt(rel_s1) = yoy / sqrt(rel_s): perfect knowledge of S talent, scored on noisy S+1
  oracle          sqrt(rel_s1): perfect knowledge of S+1 talent. oracle - ceiling is the room in predicting change.
Each is given unweighted (judge.py as it stands) and weighted by next-season PA (scorecard.py default since Fable 1.2; --unweighted for the old read).
A grade can pass `ceiling` only by forecasting change (age, a new pitch), never by knowing the level better.
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

PIPE = Path(__file__).resolve().parent
RATES = {"k": ("k", "pa"), "bb": ("bb", "pa"), "kbb": ("kbb", "pa"), "gb": ("gb", "bip"), "rv100": ("rv", "n_rv"),
         "xwobacon": ("xwc", "bip_x")}
SQL = """
SELECT pitcher AS mlbam, season, game_pk, min(game_date) AS date,
       count(*) FILTER (description <> 'hit_into_play') AS n_taken,
       sum(-delta_run_exp) AS rv, count(delta_run_exp) AS n_rv,
       count(events) AS pa,
       count(*) FILTER (events IN ('strikeout', 'strikeout_double_play')) AS k,
       count(*) FILTER (events IN ('walk', 'intent_walk')) AS bb,
       count(*) FILTER (bb_type = 'ground_ball') AS gb,
       count(*) FILTER (description = 'hit_into_play') AS bip,
       sum(estimated_woba_using_speedangle) FILTER (description = 'hit_into_play') AS xwc,
       count(estimated_woba_using_speedangle) FILTER (description = 'hit_into_play') AS bip_x
FROM pitches_all WHERE game_type = 'R' AND season BETWEEN 2021 AND 2026 GROUP BY 1, 2, 3
"""


def wr(x, y, w):
    mx, my = np.average(x, weights=w), np.average(y, weights=w)
    return float(np.sum(w * (x - mx) * (y - my)) / np.sqrt(np.sum(w * (x - mx) ** 2) * np.sum(w * (y - my) ** 2)))


def ceilings(g, floor=50):
    """g: one row per pitcher-season-game with the RATES numerators and denominators, n_taken, pa, date."""
    g = g.assign(kbb=g["k"] - g["bb"]).sort_values(["mlbam", "season", "date"])
    g["half"] = g.groupby(["mlbam", "season"]).cumcount() % 2
    full = g.groupby(["mlbam", "season"]).sum(numeric_only=True)
    half = g.groupby(["mlbam", "season", "half"]).sum(numeric_only=True).unstack("half")
    out = {}
    for name, (num, den) in RATES.items():
        f = pd.DataFrame({"v": full[num] / full[den], "a": half[(num, 0)] / half[(den, 0)],
                          "b": half[(num, 1)] / half[(den, 1)], "n": full["n_taken"], "pa": full["pa"]}).reset_index()
        p = f.merge(f.assign(season=f["season"] - 1), on=["mlbam", "season"], suffixes=("", "1"))
        p = p[(p["n"] >= floor) & (p["n1"] >= floor)].replace([np.inf, -np.inf], np.nan).dropna()
        out[name] = {"pairs": int(len(p))}
        for tag, w in (("unweighted", np.ones(len(p))), ("weighted", p["pa1"].to_numpy(float))):
            sb = lambda r: 2 * r / (1 + r)  # noqa: E731
            r0, r1, yoy = sb(wr(p["a"], p["b"], w)), sb(wr(p["a1"], p["b1"], w)), wr(p["v"], p["v1"], w)
            t = min(1.0, yoy / np.sqrt(r0 * r1))
            out[name][tag] = {"rel_s": round(r0, 3), "rel_s1": round(r1, 3), "yoy": round(yoy, 3),
                              "talent_yoy": round(t, 3), "ceiling": round(t * np.sqrt(r1), 3),
                              "oracle": round(float(np.sqrt(r1)), 3)}
    return out


def demo():
    """Self-check: talent fixed across seasons, binomial noise -> talent_yoy ~ 1 and ceiling ~ sqrt(rel)."""
    rng = np.random.default_rng(0)
    rows = []
    for m in range(1500):
        p = rng.beta(22, 78)
        for s in (2021, 2022):
            for d in range(20):
                rows.append((m, s, d, 20, 20, rng.binomial(20, p), 0, rng.normal(), 20, rng.binomial(20, .4), 20, rng.normal(), 20))
    g = pd.DataFrame(rows, columns=["mlbam", "season", "date", "n_taken", "pa", "k", "bb", "rv", "n_rv", "gb", "bip",
                                    "xwc", "bip_x"])
    with np.errstate(invalid="ignore"):   # the noise-only rv column has no reliability
        c = ceilings(g)["k"]["unweighted"]
    assert c["talent_yoy"] > .93 and abs(c["ceiling"] - np.sqrt(c["rel_s1"])) < .05, c


if __name__ == "__main__":
    demo()
    if "--demo" not in sys.argv:
        from train_mlb import mart
        con = mart.connect()
        con.sql("SET threads = 2")
        res = {"note": "MLB 2021-26, selection set; see ceiling.py docstring", "floor_taken": 50,
               "targets": ceilings(con.sql(SQL).df())}
        (PIPE / "results" / "ceilings.json").write_text(json.dumps(res, indent=1))
        for k, v in res["targets"].items():
            print(f"{k:6} pairs {v['pairs']:5}  ceiling {v['unweighted']['ceiling']:.3f} (weighted {v['weighted']['ceiling']:.3f})"
                  f"  talent yoy {v['unweighted']['talent_yoy']:.3f}  oracle {v['unweighted']['oracle']:.3f}")
