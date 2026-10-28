"""RESULTS-MLB §68 (D-01): our own xwOBA, cross-fit by batter, judged against Savant's xwOBA.

    nice -n 10 python xwoba_model.py          # fit (5 batter-grouped folds), the §68 read once, write results
    nice -n 10 python xwoba_model.py --v2     # §77 re-test: ground-ball spray removed -> results/xwoba_v2_*
    python xwoba_model.py --demo              # self-check of the roll-up on a hand-worked frame

Per ball in play: LightGBM multiclass {out, 1B, 2B, 3B, HR} on EV, LA, spray angle (+ = pulled), sprint speed
(season median when missing), stand and season; expected wOBA = sum p(class) x that season's wOBA weight.
Balls without EV/LA keep their actual woba_value, as Savant's roll-up does. Writes
results/xwoba_own_{hitters,pitchers}.csv (per player-season) and results/xwoba_own_SEALED.json.
"""
import json
import sys
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.model_selection import GroupKFold

from hitter_depth import sprint
from paths import MART_DIR  # noqa: E402
sys.path.insert(0, str(MART_DIR))
import mart  # noqa: E402
from stack import pooled_dr  # noqa: E402

PIPE = Path(__file__).resolve().parent
CLS = {"single": 1, "double": 2, "triple": 3, "home_run": 4}
FEATS = ["ev", "la", "spray", "sprint", "lefty", "season"]
SQL = """
SELECT batter, pitcher, season, stand, launch_speed AS ev, launch_angle AS la, events, woba_value, woba_denom,
       estimated_woba_using_speedangle AS xw_sv, description = 'hit_into_play' AS bip,
       CASE WHEN hc_x IS NOT NULL THEN degrees(atan2(hc_x - 125.42, 198.27 - hc_y))
            * CASE WHEN stand = 'L' THEN 1 ELSE -1 END END AS spray
FROM pitches_all WHERE game_type = 'R' AND woba_denom > 0
"""
PARAMS = dict(objective="multiclass", num_class=5, learning_rate=0.05, num_leaves=63, min_data_in_leaf=200,
              feature_fraction=0.9, bagging_fraction=0.8, bagging_freq=1, num_threads=6, verbose=-1, seed=13)
ROUNDS = 400
V2 = "--v2" in sys.argv  # §77: no spray on ground balls (hc_x/hc_y is where they were fielded)
TAG = "xwoba_v2" if V2 else "xwoba_own"


def load(con) -> pd.DataFrame:
    d = con.sql(SQL).df()
    sp = sprint(con, sorted(d["season"].unique()))[["id", "season", "sprint_speed"]].rename(columns={"id": "batter"})
    d = d.merge(sp, on=["batter", "season"], how="left")
    d["sprint"] = d["sprint_speed"].fillna(d.groupby("season")["sprint_speed"].transform("median"))
    d["lefty"] = (d["stand"] == "L").astype(int)
    d["y"] = d["events"].map(CLS).fillna(0).astype(int)
    if V2:
        d.loc[d["la"] < 10, "spray"] = np.nan
    return d


def weights(d: pd.DataFrame) -> pd.DataFrame:
    """Season wOBA weight per class: the mean woba_value of BIP with that event (out = 0)."""
    b = d[d["bip"]]
    w = b[b["y"] > 0].groupby(["season", "y"])["woba_value"].mean().unstack().reindex(columns=[1, 2, 3, 4])
    w.insert(0, 0, 0.0)
    return w


def crossfit(d: pd.DataFrame) -> np.ndarray:
    b = d[d["bip"] & d["ev"].notna() & d["la"].notna()]
    p = np.zeros((len(b), 5))
    for k, (tr, te) in enumerate(GroupKFold(5).split(b, groups=b["batter"])):
        m = lgb.train(PARAMS, lgb.Dataset(b.iloc[tr][FEATS], b.iloc[tr]["y"]), ROUNDS)
        p[te] = m.predict(b.iloc[te][FEATS])
        print(f"fold {k + 1}/5", flush=True)
    w = weights(d).reindex(b["season"]).to_numpy()
    est = (p * w).sum(1)
    out = d["woba_value"].astype(float).copy()
    out.loc[b.index] = est
    ll = float(-np.log(np.clip(p[np.arange(len(b)), b["y"].to_numpy()], 1e-12, 1)).mean())
    return out.to_numpy(), ll


def rollup(d: pd.DataFrame, who: str) -> pd.DataFrame:
    sv = np.where(d["bip"] & d["xw_sv"].notna(), d["xw_sv"], d["woba_value"])
    g = d.assign(sv=sv).groupby([who, "season"])
    return pd.DataFrame({"pa": g.size(), "den": g["woba_denom"].sum(), "own": g["own"].sum(), "sv": g["sv"].sum(),
                         "wv": g["woba_value"].sum()}).reset_index().assign(
        xw_own=lambda x: x["own"] / x["den"], xw_sv=lambda x: x["sv"] / x["den"], woba=lambda x: x["wv"] / x["den"]
    ).rename(columns={who: "mlbam"})


def pairs(r: pd.DataFrame) -> pd.DataFrame:
    nxt = r[["mlbam", "season", "pa", "woba"]].assign(season=r["season"] - 1).rename(
        columns={"pa": "pa_next", "woba": "woba_next"})
    p = r.merge(nxt, on=["mlbam", "season"])
    return p[(p["pa"] >= 100) & (p["pa_next"] >= 100) & p["season"].between(2020, 2025)].reset_index(drop=True)


def demo():
    d = pd.DataFrame({"batter": [1, 1, 1], "season": [2025] * 3, "bip": [True, True, False], "xw_sv": [0.5, None, None],
                      "woba_value": [0.9, 0.0, 0.7], "woba_denom": [1, 1, 1], "own": [0.6, 0.1, 0.7]})
    r = rollup(d, "batter").iloc[0]
    assert abs(r["xw_sv"] - (0.5 + 0.0 + 0.7) / 3) < 1e-9 and abs(r["xw_own"] - 1.4 / 3) < 1e-9 and abs(r["woba"] - 1.6 / 3) < 1e-9
    print("demo ok")


def main():
    con = mart.connect()
    d = load(con)
    d["own"], ll = crossfit(d)
    res = {"bip_logloss_crossfit": round(ll, 4), "n_pa": int(len(d))}
    for who, label in (("batter", "hitters"), ("pitcher", "pitchers")):
        r = rollup(d, who)
        r.round(4).to_csv(PIPE / "results" / f"{TAG}_{label}.csv", index=False)
        if V2:  # §77 diagnosis test: v2 against v1 on the same pairs
            v1 = pd.read_csv(PIPE / "results" / f"xwoba_own_{label}.csv")[["mlbam", "season", "xw_own"]]
            r = r.merge(v1.rename(columns={"xw_own": "xw_v1"}), on=["mlbam", "season"], how="left")
        p = pairs(r)
        dr = pooled_dr(p, "xw_sv", "xw_own", "woba_next")
        won = sum(v["r_xw_own"] > v["r_xw_sv"] for v in dr["pairs"].values())
        same = r[r["pa"] >= 100]
        dr.update(pairs_won=won, n=int(len(p)), same_season_r={
            "own": round(float(same["xw_own"].corr(same["woba"])), 4), "savant": round(float(same["xw_sv"].corr(same["woba"])), 4)})
        if V2:
            dg = pooled_dr(p.dropna(subset=["xw_v1"]).reset_index(drop=True), "xw_v1", "xw_own", "woba_next")
            dr["diagnosis_v2_minus_v1"] = dict(dg, verdict="CONFIRMED" if dg["ci"][0] > 0 else "NOT CONFIRMED")
        if label == "hitters" and V2:
            dr["verdict"] = ("HEADLINE" if dr["ci"][0] > 0 and won >= len(dr["pairs"]) - 1
                             else "NON-INFERIOR" if dr["ci"][0] > -0.010 else "NOT SHIPPED")
        elif label == "hitters":
            dr["verdict"] = "CONFIRMED" if dr["ci"][0] > 0 and won >= len(dr["pairs"]) - 1 else "NOT CONFIRMED"
        else:
            dr["verdict"] = "reported, not judged"
        res[label] = dr
    print(json.dumps(res, indent=1, default=str))
    (PIPE / "results" / f"{TAG}_SEALED.json").write_text(json.dumps(res, indent=1, default=str))


if __name__ == "__main__":
    demo() if "--demo" in sys.argv else main()
