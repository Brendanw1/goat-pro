"""RESULTS-MLB §69 (D-02): swing-decision value. E[RV | swing] and E[RV | take] per pitch, cross-fit by batter.

    nice -n 10 python decision_model.py        # fit, the §69 read once, write results
    python decision_model.py --demo            # self-check of the dRV sign and the roll-up

dRV per pitch = E[chosen] - E[other], batter-positive, at league-average execution. Per hitter-season:
dRV/100, IZA (in-zone dRV/100), OZA (out-of-zone dRV/100), Decision+ = 100 + 10 z (MLB, >= 100 PA).
Not decisions, so excluded: bunts, pitchouts, HBP, and automatic balls/strikes (pitch-clock calls).
Writes results/decisions_hitters.csv and results/decisions_SEALED.json.
"""
import json
import sys
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.model_selection import GroupKFold

from paths import MART_DIR  # noqa: E402
sys.path.insert(0, str(MART_DIR))
import mart  # noqa: E402
from stack import pooled_dr  # noqa: E402

PIPE = Path(__file__).resolve().parent
SWING = ("swinging_strike", "swinging_strike_blocked", "foul", "foul_tip", "hit_into_play")
TAKE = ("ball", "called_strike", "blocked_ball")
FEATS = ["x_in", "z_norm", "balls", "strikes", "fam", "velo", "hb_in", "ivb"]
SQL = f"""
SELECT batter, season, game_date, game_pk, at_bat_number, pitch_number, zone, balls, strikes, events,
       description IN {SWING} AS swing, delta_run_exp AS rv,
       CASE WHEN stand = 'R' THEN -plate_x ELSE plate_x END AS x_in,
       (plate_z - sz_bot) / nullif(sz_top - sz_bot, 0) AS z_norm,
       CASE WHEN pitch_type IN ('FF','SI') THEN 0 WHEN pitch_type = 'FC' THEN 1
            WHEN pitch_type IN ('SL','ST','SV','CU','KC','CS') THEN 2 ELSE 3 END AS fam,
       release_speed AS velo, CASE WHEN stand = 'R' THEN -pfx_x ELSE pfx_x END AS hb_in, pfx_z AS ivb
FROM pitches_all
WHERE game_type = 'R' AND description IN {SWING + TAKE} AND delta_run_exp IS NOT NULL AND plate_x IS NOT NULL
"""
PARAMS = dict(objective="regression", learning_rate=0.05, num_leaves=63, min_data_in_leaf=500, feature_fraction=0.9,
              bagging_fraction=0.8, bagging_freq=1, num_threads=6, verbose=-1, seed=13)
ROUNDS = 300


def crossfit(d: pd.DataFrame) -> pd.DataFrame:
    d = d.copy()
    d["e_sw"] = np.nan
    d["e_tk"] = np.nan
    for k, (tr, te) in enumerate(GroupKFold(5).split(d, groups=d["batter"])):
        t = d.iloc[tr]
        for col, mask in (("e_sw", t["swing"]), ("e_tk", ~t["swing"])):
            m = lgb.train(PARAMS, lgb.Dataset(t.loc[mask, FEATS], t.loc[mask, "rv"], categorical_feature=["fam"]), ROUNDS)
            d.iloc[te, d.columns.get_loc(col)] = m.predict(d.iloc[te][FEATS])
        print(f"fold {k + 1}/5", flush=True)
    return d


def drv(d: pd.DataFrame) -> pd.Series:
    return np.where(d["swing"], d["e_sw"] - d["e_tk"], d["e_tk"] - d["e_sw"])


def rollup(d: pd.DataFrame) -> pd.DataFrame:
    d = d.assign(drv=drv(d), inz=d["zone"].between(1, 9))
    g = d.groupby(["batter", "season"])
    r = pd.DataFrame({
        "n": g.size(), "drv100": 100 * g["drv"].mean(), "drv_runs": g["drv"].sum(),
        "iza": 100 * d[d["inz"]].groupby(["batter", "season"])["drv"].mean(),
        "oza": 100 * d[~d["inz"]].groupby(["batter", "season"])["drv"].mean(),
        "chase": d[~d["inz"]].groupby(["batter", "season"])["swing"].mean(),
    }).reset_index().rename(columns={"batter": "mlbam"})
    return r


def demo():
    d = pd.DataFrame({"batter": [1, 1], "season": [2025, 2025], "zone": [5, 14], "swing": [True, False],
                      "e_sw": [0.05, -0.04], "e_tk": [-0.01, 0.02]})
    r = rollup(d).iloc[0]
    # in-zone swing on a pitch worth +.05 swung vs -.01 taken: +.06; chase avoided: +.06 -> dRV/100 = 6
    assert abs(r["drv100"] - 6.0) < 1e-9 and abs(r["iza"] - 6.0) < 1e-9 and abs(r["oza"] - 6.0) < 1e-9 and r["chase"] == 0
    print("demo ok")


def main():
    con = mart.connect()
    d = con.sql(SQL).df()
    base = d.groupby(["balls", "strikes", "swing"])["rv"].transform("mean")
    d = crossfit(d)
    res = {"n_pitches": int(len(d)), "rmse": {
        "swing_model": round(float(np.sqrt(((d.loc[d.swing, "rv"] - d.loc[d.swing, "e_sw"]) ** 2).mean())), 5),
        "take_model": round(float(np.sqrt(((d.loc[~d.swing, "rv"] - d.loc[~d.swing, "e_tk"]) ** 2).mean())), 5),
        "count_only": round(float(np.sqrt(((d["rv"] - base) ** 2).mean())), 5)}}
    r = rollup(d)
    pa = con.sql("""SELECT batter AS mlbam, season, count(*) AS pa,
                           avg((events IN ('walk','intent_walk'))::INT) - avg((events IN ('strikeout','strikeout_double_play'))::INT) AS bbk
                    FROM pitches_all WHERE game_type = 'R' AND events IS NOT NULL GROUP BY 1, 2""").df()
    r = r.merge(pa, on=["mlbam", "season"])
    q = r[r["pa"] >= 100]
    mu, sd = q.groupby("season")["drv100"].transform("mean"), q.groupby("season")["drv100"].transform("std")
    r.loc[q.index, "decision_plus"] = 100 + 10 * (q["drv100"] - mu) / sd
    r.round(4).to_csv(PIPE / "results" / "decisions_hitters.csv", index=False)

    nxt = r[["mlbam", "season", "pa", "bbk", "drv100"]].assign(season=r["season"] - 1).rename(
        columns={"pa": "pa_next", "bbk": "bbk_next", "drv100": "drv100_next"})
    p = r.merge(nxt, on=["mlbam", "season"])
    p = p[(p["pa"] >= 100) & (p["pa_next"] >= 100) & p["season"].between(2020, 2025)].reset_index(drop=True)
    p["neg_chase"] = -p["chase"]
    c = pooled_dr(p, "neg_chase", "decision_plus", "bbk_next")
    won = sum(v["r_decision_plus"] > v["r_neg_chase"] for v in c["pairs"].values())
    c.update(pairs_won=won, n=int(len(p)),
             verdict="CONFIRMED" if c["ci"][0] > 0 and won >= len(c["pairs"]) - 1 else "NOT CONFIRMED")
    res["claim"] = c

    # reported: split-half (odd/even pitch in game order), year-to-year, Savant swing/take validity
    d = d.assign(drv=drv(d), inz=d["zone"].between(1, 9)).sort_values(["batter", "season", "game_date", "game_pk",
                                                                        "at_bat_number", "pitch_number"])
    d["half"] = d.groupby(["batter", "season"]).cumcount() % 2
    sh = {}
    keep = set(map(tuple, r.loc[r["pa"] >= 100, ["mlbam", "season"]].to_numpy()))
    for name, mask in (("drv100", None), ("iza", d["inz"]), ("oza", ~d["inz"])):
        x = d if mask is None else d[mask]
        h = x.groupby(["batter", "season", "half"])["drv"].mean().unstack().dropna()
        h = h[[k in keep for k in h.index]]
        rr = float(h[0].corr(h[1]))
        sh[name] = {"split_half_r": round(rr, 3), "spearman_brown": round(2 * rr / (1 + rr), 3), "n": int(len(h))}
    res["reliability"] = sh
    res["year_to_year_r_drv100"] = round(float(p["drv100"].corr(p["drv100_next"])), 3)
    sv = []
    for s in (2024, 2025, 2026):
        t = f"lb_swing_take_{s}"
        st = con.sql(f"SELECT player_id AS mlbam, {s} AS season, runs_all FROM {t}").df()
        sv.append(st.merge(r, on=["mlbam", "season"]))
    sv = pd.concat(sv)
    res["savant_swing_take_r"] = {"n": int(len(sv)), "r_total_runs": round(float(sv["drv_runs"].corr(sv["runs_all"])), 3)}
    print(json.dumps(res, indent=1, default=str))
    (PIPE / "results" / "decisions_SEALED.json").write_text(json.dumps(res, indent=1, default=str))


if __name__ == "__main__":
    demo() if "--demo" in sys.argv else main()
