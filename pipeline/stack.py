"""P7 step 7.3 (COLLABORATION.md P7): does Whiff+ + K+ + BB% + GB% forecast run prevention?

    GOAT_LO=2020 python stack.py [--seal]

Next-season RV/100 (primary) and xRV/100 (judge.py's outcomes) from the Whiff+ grade, K+ (kproj.py,
out of fold on dev), BB% and GB% in S. Ridge, the same 5-fold pitcher-grouped CV on dev pitchers.
Benchmarks in S: K-BB%, FIP and xFIP per PA (constants dropped: correlation only; xFIP = FIP with
HR replaced by FB x league HR/FB, FB = fly_ball + popup). The best benchmark on dev is the one the
stack must beat; --seal reads the sealed 20% once.
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.model_selection import GroupKFold

import kproj
from judge import cluster_w
from train_mlb import mart

PIPE = Path(__file__).resolve().parent
SEAL = "--seal" in sys.argv
S_COLS = ["whiff", "kplus", "bb_s", "gb_s"]
SQL = """
SELECT pitcher AS mlbam, season, count(*) AS pa,
       sum((events IN ('strikeout','strikeout_double_play'))::INT) AS k,
       sum((events IN ('walk','intent_walk'))::INT) AS bb, sum((events = 'hit_by_pitch')::INT) AS hbp,
       sum((events = 'home_run')::INT) AS hr, sum((bb_type = 'ground_ball')::INT) AS gb,
       sum((bb_type IN ('fly_ball','popup'))::INT) AS fb, sum((bb_type IS NOT NULL)::INT) AS bip
FROM pitches_all WHERE game_type = 'R' AND events IS NOT NULL AND season BETWEEN 2020 AND 2026 GROUP BY 1, 2
"""


def frame(with_next=True):
    d = kproj.frame(with_next)
    ev = mart.connect().sql(SQL).df()
    lg = ev.groupby("season")[["hr", "fb"]].sum()
    ev = ev.join((lg["hr"] / lg["fb"]).rename("lg_hrfb"), on="season")
    ev["bb_s"] = ev["bb"] / ev["pa"]
    ev["gb_s"] = ev["gb"] / ev["bip"].clip(lower=1)
    ev["kbb_s"] = (ev["k"] - ev["bb"]) / ev["pa"]
    ev["fip_s"] = -(13 * ev["hr"] + 3 * (ev["bb"] + ev["hbp"]) - 2 * ev["k"]) / ev["pa"]  # sign: higher = better
    ev["xfip_s"] = -(13 * ev["fb"] * ev["lg_hrfb"] + 3 * (ev["bb"] + ev["hbp"]) - 2 * ev["k"]) / ev["pa"]
    oc = pd.read_parquet(PIPE.parent / "cache" / "outcomes_2020.parquet")
    nxt = oc.assign(season=oc["season"] - 1)[["mlbam", "season", "rv100", "xrv100"]].rename(
        columns={"rv100": "rv_next", "xrv100": "xrv_next"})
    d = d.merge(ev[["mlbam", "season", "bb_s", "gb_s", "kbb_s", "fip_s", "xfip_s"]], on=["mlbam", "season"])
    if not with_next:
        return d.dropna(subset=["bb_s", "gb_s"]).reset_index(drop=True)
    return d.merge(nxt, on=["mlbam", "season"]).dropna().reset_index(drop=True)


def add_kplus(dev, sealed):
    dev["kplus"] = 0.0
    for tr, te in GroupKFold(5).split(dev, groups=dev["mlbam"]):
        dev.loc[te, "kplus"] = kproj.model().fit(dev.loc[tr, kproj.X_COLS], dev.loc[tr, "k_next"]).predict(
            dev.loc[te, kproj.X_COLS])
    sealed["kplus"] = kproj.model().fit(dev[kproj.X_COLS], dev["k_next"]).predict(sealed[kproj.X_COLS])


def pooled_dr(d, a, b, y, draws=2000, seed=13):
    """Pooled over pairs: r(b, y) - r(a, y), pitcher bootstrap clustered across pairs."""
    rng = np.random.default_rng(seed)
    boot, per = [], {}
    gs = list(d.groupby("season"))
    for (s, g), w in zip(gs, cluster_w([g["mlbam"] for _, g in gs], rng, draws)):
        n = len(g)
        yy = g[y].to_numpy()

        def r(x):
            mx, my = (w * x).sum(1) / w.sum(1), (w * yy).sum(1) / w.sum(1)
            return ((w * (x - mx[:, None]) * (yy - my[:, None])).sum(1)
                    / np.sqrt((w * (x - mx[:, None]) ** 2).sum(1) * (w * (yy - my[:, None]) ** 2).sum(1)))
        v = r(g[b].to_numpy()) - r(g[a].to_numpy())
        per[f"{s}->{s + 1}"] = {"n": n, "r_" + a: round(float(r(g[a].to_numpy())[0]), 4),
                               "r_" + b: round(float(r(g[b].to_numpy())[0]), 4)}
        boot.append(v)
    B = np.mean(boot, axis=0)
    return {"pairs": per, "dr": round(float(B[0]), 4), "ci": [round(float(x), 4) for x in np.percentile(B[1:], [2.5, 97.5])]}


def main():
    d = frame()
    dev, sealed = d[~d["sealed"]].reset_index(drop=True), d[d["sealed"]].reset_index(drop=True)
    add_kplus(dev, sealed)
    res = {}
    for y in ("rv_next", "xrv_next"):
        dev[f"stack_{y}"] = 0.0
        for tr, te in GroupKFold(5).split(dev, groups=dev["mlbam"]):
            dev.loc[te, f"stack_{y}"] = kproj.model().fit(dev.loc[tr, S_COLS], dev.loc[tr, y]).predict(dev.loc[te, S_COLS])
        bench = {b: float(np.mean([np.corrcoef(g[b], g[y])[0, 1] for _, g in dev.groupby("season")]))
                 for b in ("kbb_s", "fip_s", "xfip_s")}
        best = max(bench, key=bench.get)
        full = kproj.model().fit(dev[S_COLS], dev[y])
        res[y] = {"bench_mean_r_dev": {k: round(v, 4) for k, v in bench.items()}, "best": best,
                  "coef_std": dict(zip(S_COLS, np.round(full[-1].coef_, 4))),
                  "dev": pooled_dr(dev, best, f"stack_{y}", y)}
        if SEAL:
            sealed[f"stack_{y}"] = full.predict(sealed[S_COLS])
            res[y]["sealed"] = pooled_dr(sealed, best, f"stack_{y}", y)
    print(json.dumps(res, indent=1))
    (PIPE / "results" / f"stack{'_SEALED' if SEAL else '_dev'}.json").write_text(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
