"""P7 step 7.1 (COLLABORATION.md P7): K+ projection, judged against Marcel K%.

    GOAT_LO=2020 python kproj.py [--seal]

Next-season K/PA from Marcel K% (5/4/3 on S, S-1, S-2 + 1,200 weighted PA of league K%), K% and
SwStr% in S, the Whiff+ pitcher grade in S (crossfit_v2_s4_bb) and log PA. Ridge (alpha by inner
CV), 5-fold pitcher-grouped CV on dev pitchers (crc32("p7:" + id) % 5 != 0). --seal: fit on all dev
pitchers, score the sealed 20% once. Pairs: S -> S+1 for S in 2020..2025, >= 50 taken both seasons.
K+ = 100 + 10 z of the projection, constants frozen on dev pitcher-seasons with >= 100 PA.
"""
import json
import sys
import zlib
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import RidgeCV
from sklearn.model_selection import GroupKFold
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from judge import cluster_w

PIPE = Path(__file__).resolve().parent
SEAL = "--seal" in sys.argv
X_COLS = ["marcel", "k_s", "swstr_s", "whiff", "log_pa"]
R_MARCEL, W = 1200, (5, 4, 3)


def sealed(p):
    return zlib.crc32(f"p7:{p}".encode()) % 5 == 0


def frame(with_next=True):
    oc = pd.read_parquet(PIPE.parent / "cache" / "outcomes_2020.parquet")
    oc["k_n"] = oc["k"] * oc["pa"]
    pr = pd.read_parquet(PIPE.parent / "cache" / "pred_s4_bb.parquet", columns=["pitcher", "season", "whiff"])
    sw = pr[pr["season"] < 3000].groupby(["pitcher", "season"])["whiff"].mean().rename("swstr_s").reset_index()
    g = pd.read_csv(PIPE / "results" / "crossfit_v2_s4_bb_grades.csv").rename(columns={"grade": "whiff"})
    lg = oc.groupby("season").apply(lambda d: d["k_n"].sum() / d["pa"].sum())
    hist = oc.set_index(["mlbam", "season"])[["k_n", "pa"]]
    rows = []
    for (m, s), r in hist.iterrows():
        num, den = R_MARCEL * lg[s], float(R_MARCEL)
        for lag, w in enumerate(W):
            if (m, s - lag) in hist.index:
                h = hist.loc[(m, s - lag)]
                num, den = num + w * h["k_n"], den + w * h["pa"]
        rows.append((m, s, num / den))
    d = oc.merge(pd.DataFrame(rows, columns=["mlbam", "season", "marcel"]), on=["mlbam", "season"])
    d = d.rename(columns={"k": "k_s"}).assign(log_pa=np.log(d["pa"].clip(lower=1)))
    d = d.merge(sw.rename(columns={"pitcher": "mlbam"}), on=["mlbam", "season"]).merge(g, on=["mlbam", "season"])
    if not with_next:  # every pitcher-season, for the export (p7_export.py)
        return d.dropna(subset=X_COLS).reset_index(drop=True)
    nxt = oc.assign(season=oc["season"] - 1)[["mlbam", "season", "k", "pa", "n_taken"]].rename(
        columns={"k": "k_next", "pa": "pa_next", "n_taken": "n_taken_next"})
    d = d.merge(nxt, on=["mlbam", "season"])
    d = d[(d["n_taken"] >= 50) & (d["n_taken_next"] >= 50) & (d["season"] <= 2025)].dropna(subset=X_COLS)
    return d.assign(sealed=d["mlbam"].map(sealed)).reset_index(drop=True)


def model():
    return make_pipeline(StandardScaler(), RidgeCV(alphas=np.logspace(-3, 3, 13)))


def scores(d, pred, draws=2000, seed=13):
    """Pooled over pairs: r and RMSE of K+ vs Marcel, pitcher bootstrap clustered across pairs."""
    rng = np.random.default_rng(seed)
    out, boot = {}, []
    gs = list(d.assign(pred=pred).groupby("season"))
    for (s, g), w in zip(gs, cluster_w([g["mlbam"] for _, g in gs], rng, draws)):
        y, a, b = g["k_next"].to_numpy(), g["marcel"].to_numpy(), g["pred"].to_numpy()
        n = len(g)

        def r(x):
            mx, my = (w * x).sum(1) / w.sum(1), (w * y).sum(1) / w.sum(1)
            return ((w * (x - mx[:, None]) * (y - my[:, None])).sum(1)
                    / np.sqrt((w * (x - mx[:, None]) ** 2).sum(1) * (w * (y - my[:, None]) ** 2).sum(1)))

        def rmse(x):
            return np.sqrt((w * (x - y) ** 2).sum(1) / w.sum(1))
        boot.append(np.vstack([r(b) - r(a), rmse(a) - rmse(b)]))  # both positive = K+ better
        out[f"{s}->{s + 1}"] = {"n": n, "r_marcel": round(float(r(a)[0]), 4), "r_kplus": round(float(r(b)[0]), 4),
                               "r_last_k": round(float(np.corrcoef(g["k_s"], y)[0, 1]), 4),
                               "r_whiff": round(float(np.corrcoef(g["whiff"], y)[0, 1]), 4),
                               "rmse_marcel": round(float(rmse(a)[0]), 5), "rmse_kplus": round(float(rmse(b)[0]), 5)}
    B = np.mean(boot, axis=0)
    for i, k in enumerate(("dr", "d_rmse")):
        out[k] = {"est": round(float(B[i, 0]), 5), "ci": [round(float(x), 5) for x in np.percentile(B[i, 1:], [2.5, 97.5])]}
    return out


def main():
    d = frame()
    dev = d[~d["sealed"]].reset_index(drop=True)
    pred = np.zeros(len(dev))
    for tr, te in GroupKFold(5).split(dev, groups=dev["mlbam"]):
        pred[te] = model().fit(dev.loc[tr, X_COLS], dev.loc[tr, "k_next"]).predict(dev.loc[te, X_COLS])
    res = {"dev": scores(dev, pred)}
    full = model().fit(dev[X_COLS], dev["k_next"])
    coef = dict(zip(X_COLS, np.round(full[-1].coef_, 5)))
    p100 = full.predict(dev.loc[dev["pa"] >= 100, X_COLS])
    res["scale"] = {"mean": float(p100.mean()), "sd": float(p100.std()), "coef_std": coef,
                    "alpha": float(full[-1].alpha_)}
    if SEAL:
        sd = d[d["sealed"]].reset_index(drop=True)
        res["sealed"] = scores(sd, full.predict(sd[X_COLS]))
    print(json.dumps(res, indent=1, default=str))
    (PIPE / "results" / f"kproj{'_SEALED' if SEAL else '_dev'}.json").write_text(json.dumps(res, indent=1, default=str))


if __name__ == "__main__":
    main()
