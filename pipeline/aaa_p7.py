"""RESULTS-MLB §66 (D-05): K+ and Prevention+ on AAA by frozen transfer, read once.

    GOAT_LO=2020 python aaa_p7.py

The shipped MLB ridges (fit on every MLB pair exactly as p7_export.py does) are applied unchanged to
AAA inputs: AAA K%, SwStr%, BB%, GB%, log PA, Marcel K% on AAA history only (AAA league K% as the
prior), Whiff+ from crossfit_v2_s7_aaa. High-altitude parks dropped (§44). Pairs AAA S -> S+1 for
2023..2025, >= 50 taken AAA pitches in S, >= 50 taken AAA + MLB pitches in S+1; outcomes in S+1 pool
both levels (aaa_judge.outcomes). Claims and rules: RESULTS-MLB §66.
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd

import aaa_judge
import kproj
import stack
from aaa_translation import AAA_OFFSET, HIGH_ALT
from train_mlb import mart

PIPE = Path(__file__).resolve().parent
SQL = f"""
SELECT pitcher AS mlbam, season, count(*) AS pa,
       sum((events IN ('strikeout','strikeout_double_play'))::INT) AS k,
       sum((events IN ('walk','intent_walk'))::INT) AS bb,
       sum((bb_type = 'ground_ball')::INT) AS gb, sum((bb_type IS NOT NULL)::INT) AS bip
FROM pitches_aaa WHERE game_type = 'R' AND events IS NOT NULL AND season BETWEEN 2021 AND 2026
  AND home_team NOT IN {HIGH_ALT} GROUP BY 1, 2
"""


def marcel(ev):
    lg = ev.groupby("season")["k"].sum() / ev.groupby("season")["pa"].sum()
    hist = ev.set_index(["mlbam", "season"])[["k", "pa"]]
    out = []
    for (m, s), _ in hist.iterrows():
        num, den = kproj.R_MARCEL * lg[s], float(kproj.R_MARCEL)
        for lag, w in enumerate(kproj.W):
            if (m, s - lag) in hist.index:
                h = hist.loc[(m, s - lag)]
                num, den = num + w * h["k"], den + w * h["pa"]
        out.append(num / den)
    return out


def aaa_frame(with_next=True):
    ev = mart.connect().sql(SQL).df()
    ev["marcel"] = marcel(ev)
    ev = ev.assign(k_s=ev["k"] / ev["pa"], bb_s=ev["bb"] / ev["pa"], gb_s=ev["gb"] / ev["bip"].clip(lower=1),
                   kbb_s=(ev["k"] - ev["bb"]) / ev["pa"], log_pa=np.log(ev["pa"].clip(lower=1)))
    pr = pd.read_parquet(PIPE.parent / "cache" / "pred_s7_aaa.parquet", columns=["pitcher", "season", "whiff"])
    pr = pr[pr["season"] > 3000]
    sw = pr.groupby(["pitcher", "season"])["whiff"].mean().rename("swstr_s").reset_index()
    sw = sw.assign(season=sw["season"] - AAA_OFFSET).rename(columns={"pitcher": "mlbam"})
    g = pd.read_csv(PIPE / "results" / "crossfit_v2_s7_aaa_grades.csv")
    g = g[g["season"] > 3000].assign(season=lambda x: x["season"] - AAA_OFFSET).rename(columns={"grade": "whiff"})
    aaa_judge.HI = 2026
    both, aaa, mlb = aaa_judge.outcomes()
    d = (ev.merge(sw, on=["mlbam", "season"]).merge(g, on=["mlbam", "season"])
           .merge(aaa[["mlbam", "season", "n_taken"]], on=["mlbam", "season"]))
    if not with_next:  # every AAA pitcher-season 2023-26 with >= 50 taken, for aaa_export.py
        d = d[(d["n_taken"] >= 50) & (d["season"] >= 2023)]
        return d.dropna(subset=kproj.X_COLS + stack.S_COLS[2:]).reset_index(drop=True)
    nxt = both.assign(season=both["season"] - 1).rename(columns={
        "k": "k_next", "rv100": "rv_next", "xrv100": "xrv_next", "n_taken": "n_taken_next"})
    d = d.merge(nxt[["mlbam", "season", "k_next", "rv_next", "xrv_next", "n_taken_next"]], on=["mlbam", "season"])
    d = d[(d["n_taken"] >= 50) & (d["n_taken_next"] >= 50) & d["season"].between(2023, 2025)]
    m_s = set(zip(mlb["mlbam"], mlb["season"]))
    m_next = set(zip(mlb.loc[mlb["n_taken"] >= 50, "mlbam"], mlb.loc[mlb["n_taken"] >= 50, "season"]))
    d["promoted"] = [(m, s) not in m_s and (m, s + 1) in m_next for m, s in zip(d["mlbam"], d["season"])]
    return d.dropna(subset=kproj.X_COLS + stack.S_COLS[2:] + ["kbb_s"]).reset_index(drop=True)


def frozen_models():
    tr = stack.frame()
    kp = kproj.model().fit(tr[kproj.X_COLS], tr["k_next"])
    tr["kplus"] = kp.predict(tr[kproj.X_COLS])
    return kp, kproj.model().fit(tr[stack.S_COLS], tr["rv_next"])


def scored():
    """Every AAA pitcher-season (>= 50 taken) with k_proj / k_plus / prevention_plus on p7_export's MLB
    scale (constants from MLB pitcher-seasons with >= 100 PA), so the two levels read on one scale."""
    tr = stack.frame()
    kp, pv = frozen_models()
    tr["kplus"] = kp.predict(tr[kproj.X_COLS])
    big = tr[tr["pa"] >= 100]
    kp100, pv100 = kp.predict(big[kproj.X_COLS]), pv.predict(big[stack.S_COLS])
    d = aaa_frame(with_next=False)
    d["k_proj"] = kp.predict(d[kproj.X_COLS])
    d["kplus"] = d["k_proj"]
    d["k_plus"] = 100 + 10 * (d["k_proj"] - kp100.mean()) / kp100.std()
    d["prevention_plus"] = 100 + 10 * (pv.predict(d[stack.S_COLS]) - pv100.mean()) / pv100.std()
    return d[["mlbam", "season", "k_proj", "k_plus", "prevention_plus"]]


def main():
    d = aaa_frame()
    kp, pv = frozen_models()
    d["kplus"] = kp.predict(d[kproj.X_COLS])
    d["prev"] = pv.predict(d[stack.S_COLS])
    res = {"n": int(len(d)), "pairs_n": d.groupby("season").size().to_dict()}
    k = stack.pooled_dr(d, "marcel", "kplus", "k_next")
    k["pairs_won"] = sum(v["r_kplus"] > v["r_marcel"] for v in k["pairs"].values())
    k["rmse"] = {s: [round(float(np.sqrt(((g[c] - g["k_next"]) ** 2).mean())), 5) for c in ("marcel", "kplus")]
                 for s, g in d.groupby("season")}
    res["kplus"] = k
    for y in ("rv_next", "xrv_next"):
        res[f"prevention_{y}"] = stack.pooled_dr(d, "kbb_s", "prev", y)
    p = d[d["promoted"]]
    res["promoted (reported, not judged)"] = {
        "n": int(len(p)),
        "dr_kplus_vs_marcel": float(np.corrcoef(p["kplus"], p["k_next"])[0, 1] - np.corrcoef(p["marcel"], p["k_next"])[0, 1]),
        "dr_prev_vs_kbb_rv": float(np.corrcoef(p["prev"], p["rv_next"])[0, 1] - np.corrcoef(p["kbb_s"], p["rv_next"])[0, 1])}
    res["verdict"] = {
        "kplus": "CONFIRMED" if k["ci"][0] > 0 and k["pairs_won"] >= 2 else "NOT CONFIRMED",
        "prevention": "CONFIRMED" if all(res[f"prevention_{y}"]["ci"][0] > 0 for y in ("rv_next", "xrv_next"))
        else "NOT CONFIRMED"}
    print(json.dumps(res, indent=1, default=str))
    (PIPE / "results" / "aaa_p7_SEALED.json").write_text(json.dumps(res, indent=1, default=str))


if __name__ == "__main__":
    main()
