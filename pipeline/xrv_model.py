"""RESULTS-MLB §71 (D-03): expected run value per pitch, cross-fit by pitcher. Pitcher-positive throughout.

    nice -n 10 python xrv_model.py        # fit, the §71 read once, write results
    python xrv_model.py --demo            # self-check of the combine and the roll-up

Outcome leg: LightGBM multiclass {ball, called strike, whiff, foul, HBP, in play}. Contact leg: LightGBM regression
of the in-play run value with the batted ball valued by xwOBA (count-specific line, as judge.py). Per pitch
xRV = sum over non-BIP classes p x RV(class, count) + p(BIP) x contact leg. Bunts, pitchouts and automatic
balls/strikes are not pitches a model can price, so they are left out. Writes results/xrv_pitchers.csv,
results/xrv_pitch_types.csv and results/xrv_SEALED.json.
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
CLASSES = ["ball", "cs", "whiff", "foul", "hbp", "bip"]
BIP = CLASSES.index("bip")
FEATS = ["velo", "ivb", "hb_arm", "spin", "ext", "rel_z", "rel_x_arm", "x_in", "z_norm", "balls", "strikes", "same"]
SQL = """
SELECT pitcher, season, pitch_type, balls, strikes, -delta_run_exp AS rv,
       estimated_woba_using_speedangle AS xwoba,
       CASE WHEN description IN ('ball','blocked_ball') THEN 0 WHEN description = 'called_strike' THEN 1
            WHEN description IN ('swinging_strike','swinging_strike_blocked','foul_tip') THEN 2
            WHEN description = 'foul' THEN 3 WHEN description = 'hit_by_pitch' THEN 4 ELSE 5 END AS y,
       release_speed AS velo, pfx_z AS ivb,
       CASE WHEN p_throws = 'L' THEN -pfx_x ELSE pfx_x END AS hb_arm,
       release_spin_rate AS spin, release_extension AS ext, release_pos_z AS rel_z,
       CASE WHEN p_throws = 'L' THEN -release_pos_x ELSE release_pos_x END AS rel_x_arm,
       CASE WHEN stand = 'R' THEN -plate_x ELSE plate_x END AS x_in,
       (plate_z - sz_bot) / nullif(sz_top - sz_bot, 0) AS z_norm,
       (stand = p_throws)::INT AS same
FROM pitches_all
WHERE game_type = 'R' AND delta_run_exp IS NOT NULL AND plate_x IS NOT NULL AND release_speed IS NOT NULL
  AND description IN ('ball','blocked_ball','called_strike','swinging_strike','swinging_strike_blocked','foul_tip',
                      'foul','hit_by_pitch','hit_into_play')
  AND coalesce(events, '') NOT IN ('sac_bunt','sac_bunt_double_play') AND coalesce(bb_type, '') <> 'bunt'
"""
P_CLS = dict(objective="multiclass", num_class=6, learning_rate=0.08, num_leaves=63, min_data_in_leaf=500,
             feature_fraction=0.9, bagging_fraction=0.8, bagging_freq=1, num_threads=4, verbose=-1, seed=13)
P_BIP = dict(objective="regression", learning_rate=0.05, num_leaves=63, min_data_in_leaf=500, feature_fraction=0.9,
             bagging_fraction=0.8, bagging_freq=1, num_threads=4, verbose=-1, seed=13)
ROUNDS_CLS, ROUNDS_BIP = 250, 300
FIT_CAP = 1_500_000  # ponytail: outcome leg fits on a random 1.5M of each fold's ~3.5M pitches; raise if memory allows


def bip_value(d: pd.DataFrame, tr: np.ndarray) -> np.ndarray:
    """In-play run value with the batted ball valued by xwOBA: per-count line fit on the training rows."""
    out = d["rv"].to_numpy().copy()
    ok = (d["y"] == BIP) & d["xwoba"].notna()
    for (b, s), g in d[ok & tr].groupby(["balls", "strikes"]):
        k, c = np.polyfit(g["xwoba"], g["rv"], 1)
        m = (ok & (d["balls"] == b) & (d["strikes"] == s)).to_numpy()
        out[m] = c + k * d.loc[m, "xwoba"].to_numpy()
    return out


def combine(p: np.ndarray, rv_tab: np.ndarray, contact: np.ndarray) -> np.ndarray:
    """p: (n, 6) class probabilities; rv_tab: (n, 6) RV(class, count) for each pitch's count; contact: (n,)."""
    v = rv_tab.copy()
    v[:, BIP] = contact
    return (p * v).sum(1)


def crossfit(d: pd.DataFrame):
    rng = np.random.default_rng(13)
    p = np.zeros((len(d), 6))
    contact = np.zeros(len(d))
    rv_tab = np.zeros((len(d), 6))
    base_p = np.zeros((len(d), 6))
    d["bip_v"] = np.nan
    for k, (tr, te) in enumerate(GroupKFold(5).split(d, groups=d["pitcher"])):
        trm = np.zeros(len(d), bool)
        trm[tr] = True
        bv = bip_value(d, trm)
        d.loc[d.index[te], "bip_v"] = bv[te]
        fit = tr if len(tr) <= FIT_CAP else rng.choice(tr, FIT_CAP, replace=False)
        m = lgb.train(P_CLS, lgb.Dataset(d.iloc[fit][FEATS], d.iloc[fit]["y"]), ROUNDS_CLS)
        p[te] = m.predict(d.iloc[te][FEATS])
        b = tr[(d["y"].to_numpy()[tr] == BIP)]
        mc = lgb.train(P_BIP, lgb.Dataset(d.iloc[b][FEATS], bv[b]), ROUNDS_BIP)
        contact[te] = mc.predict(d.iloc[te][FEATS])
        t = d.iloc[tr]
        tab = t.groupby(["balls", "strikes", "y"])["rv"].mean().unstack().reindex(columns=range(6))
        cnt = t.groupby(["balls", "strikes"])["y"].value_counts(normalize=True).unstack().reindex(columns=range(6)).fillna(0)
        idx = pd.MultiIndex.from_arrays([d.iloc[te]["balls"], d.iloc[te]["strikes"]])
        rv_tab[te] = tab.reindex(idx).fillna(0).to_numpy()
        base_p[te] = cnt.reindex(idx).to_numpy()
        print(f"fold {k + 1}/5", flush=True)
    return p, contact, rv_tab, base_p


def rollup(d: pd.DataFrame, by) -> pd.DataFrame:
    g = d.groupby(by)
    return pd.DataFrame({"n": g.size(), "xrv100": 100 * g["xrv"].mean(), "rv100": 100 * g["rv"].mean(),
                         "obs_xrv100": 100 * g["obs_xrv"].mean()}).reset_index().rename(columns={"pitcher": "mlbam"})


def demo():
    p = np.array([[0.5, 0.2, 0.1, 0.1, 0.0, 0.1]])
    tab = np.array([[-0.05, 0.04, 0.05, 0.03, -0.08, 9.9]])  # the BIP slot is replaced by the contact leg
    x = combine(p, tab, np.array([-0.2]))[0]
    assert abs(x - (-0.025 + 0.008 + 0.005 + 0.003 - 0.02)) < 1e-12, x
    d = pd.DataFrame({"pitcher": [1, 1], "season": [2025] * 2, "xrv": [0.01, 0.03], "rv": [0.0, 0.1], "obs_xrv": [0.0, 0.05]})
    r = rollup(d, ["pitcher", "season"]).iloc[0]
    assert abs(r["xrv100"] - 2.0) < 1e-9 and abs(r["rv100"] - 5.0) < 1e-9 and r["n"] == 2
    print("demo ok")


def main():
    con = mart.connect()
    d = con.sql(SQL).df()
    d["pitch_type"] = d["pitch_type"].astype("category")
    for c in ("balls", "strikes", "y", "same"):
        d[c] = d[c].astype("int8")
    print(f"{len(d):,} pitches", flush=True)
    p, contact, rv_tab, base_p = crossfit(d)
    d["xrv"] = combine(p, rv_tab, contact)
    d["obs_xrv"] = np.where(d["y"] == BIP, d["bip_v"], d["rv"])  # judge.py's observed xRV (actual outcomes)
    yy = d["y"].to_numpy()
    ll = lambda q: float(-np.log(np.clip(q[np.arange(len(q)), yy], 1e-12, 1)).mean())  # noqa: E731
    res = {"n_pitches": int(len(d)), "logloss": {"model": round(ll(p), 4), "count_only": round(ll(base_p), 4)},
           "per_pitch_r": round(float(np.corrcoef(d["xrv"], d["rv"])[0, 1]), 4)}

    r = rollup(d, ["pitcher", "season"])
    bf = con.sql("""SELECT pitcher AS mlbam, season, count(DISTINCT (game_pk, at_bat_number)) AS bf
                    FROM pitches_all WHERE game_type = 'R' AND events IS NOT NULL GROUP BY 1, 2""").df()
    r = r.merge(bf, on=["mlbam", "season"], how="left")
    q = r[r["bf"] >= 100]
    mu, sd = q.groupby("season")["xrv100"].transform("mean"), q.groupby("season")["xrv100"].transform("std")
    r.loc[q.index, "xrv_plus"] = 100 + 10 * (q["xrv100"] - mu) / sd
    r["luck"] = r["rv100"] - r["xrv100"]
    r.round(4).to_csv(PIPE / "results" / "xrv_pitchers.csv", index=False)
    rollup(d, ["pitcher", "season", "pitch_type"]).round(4).to_csv(PIPE / "results" / "xrv_pitch_types.csv", index=False)

    nxt = r[["mlbam", "season", "bf", "rv100", "xrv100"]].assign(season=r["season"] - 1).rename(
        columns={"bf": "bf_next", "rv100": "rv_next", "xrv100": "xrv_next"})
    pr = r.merge(nxt, on=["mlbam", "season"])
    pr = pr[(pr["bf"] >= 100) & (pr["bf_next"] >= 100) & pr["season"].between(2020, 2025)].reset_index(drop=True)
    c = pooled_dr(pr, "rv100", "xrv100", "rv_next")
    won = sum(v["r_xrv100"] > v["r_rv100"] for v in c["pairs"].values())
    c.update(pairs_won=won, n=int(len(pr)),
             verdict="CONFIRMED" if c["ci"][0] > 0 and won >= len(c["pairs"]) - 1 else "NOT CONFIRMED")
    res["claim"] = c
    o = pooled_dr(pr, "obs_xrv100", "xrv100", "rv_next")
    o["pairs_won"] = sum(v["r_xrv100"] > v["r_obs_xrv100"] for v in o["pairs"].values())
    res["vs_observed_xrv"] = o
    res["year_to_year_r_xrv100"] = round(float(pr["xrv100"].corr(pr["xrv_next"])), 3)
    print(json.dumps(res, indent=1, default=str))
    (PIPE / "results" / "xrv_SEALED.json").write_text(json.dumps(res, indent=1, default=str))


if __name__ == "__main__":
    demo() if "--demo" in sys.argv else main()
