"""P7 step 7.4b (COLLABORATION.md): BB+ projection, judged against Marcel BB%.

    GOAT_LO=2020 python bbproj.py [--seal]

kproj.py's design for walks: next-season BB/PA from Marcel BB% (5/4/3 + 1,200 weighted PA of league
BB%), BB% in S, Control+ (location_plus_ctrl grades) in S, log PA. Ridge, pitcher-grouped CV on dev;
--seal scores the sealed 20% once. BB+ = 100 + 10 z of the negated projection (higher = fewer walks).
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.model_selection import GroupKFold

import kproj
from judge import cluster_w

PIPE = Path(__file__).resolve().parent
SEAL = "--seal" in sys.argv
X_COLS = ["marcel", "bb_s", "control", "log_pa"]


def frame():
    oc = pd.read_parquet(PIPE.parent / "cache" / "outcomes_2020.parquet")  # bb is a count, k a rate
    oc["bb_rate"] = oc["bb"] / oc["pa"]
    lg = oc.groupby("season").apply(lambda d: d["bb"].sum() / d["pa"].sum())
    hist = oc.set_index(["mlbam", "season"])[["bb", "pa"]]
    rows = []
    for (m, s), _ in hist.iterrows():
        num, den = kproj.R_MARCEL * lg[s], float(kproj.R_MARCEL)
        for lag, w in enumerate(kproj.W):
            if (m, s - lag) in hist.index:
                h = hist.loc[(m, s - lag)]
                num, den = num + w * h["bb"], den + w * h["pa"]
        rows.append((m, s, num / den))
    d = oc.merge(pd.DataFrame(rows, columns=["mlbam", "season", "marcel"]), on=["mlbam", "season"])
    d = d.rename(columns={"bb_rate": "bb_s"}).assign(log_pa=np.log(d["pa"].clip(lower=1)))
    c = pd.read_csv(PIPE / "results" / "location_plus_ctrl_grades.csv")[["mlbam", "season", "grade"]]
    d = d.merge(c.rename(columns={"grade": "control"}), on=["mlbam", "season"])
    nxt = oc.assign(season=oc["season"] - 1)[["mlbam", "season", "bb_rate", "n_taken"]].rename(
        columns={"bb_rate": "k_next", "n_taken": "n_taken_next"})  # "k_next" so kproj.scores applies unchanged
    d = d.merge(nxt, on=["mlbam", "season"])
    d = d[(d["n_taken"] >= 50) & (d["n_taken_next"] >= 50) & (d["season"] <= 2025)].dropna(subset=X_COLS)
    return d.assign(sealed=d["mlbam"].map(kproj.sealed)).reset_index(drop=True)


def main():
    d = frame()
    kproj.X_COLS = X_COLS
    d["k_s"], d["whiff"] = d["bb_s"], d["control"]  # kproj.scores reports r_last_k / r_whiff columns
    dev = d[~d["sealed"]].reset_index(drop=True)
    pred = np.zeros(len(dev))
    for tr, te in GroupKFold(5).split(dev, groups=dev["mlbam"]):
        pred[te] = kproj.model().fit(dev.loc[tr, X_COLS], dev.loc[tr, "k_next"]).predict(dev.loc[te, X_COLS])
    res = {"dev": kproj.scores(dev, pred)}
    full = kproj.model().fit(dev[X_COLS], dev["k_next"])
    p100 = -full.predict(dev.loc[dev["pa"] >= 100, X_COLS])
    res["scale"] = {"mean_neg": float(p100.mean()), "sd": float(p100.std()),
                    "coef_std": dict(zip(X_COLS, np.round(full[-1].coef_, 5))), "alpha": float(full[-1].alpha_)}
    if SEAL:
        sd = d[d["sealed"]].reset_index(drop=True)
        res["sealed"] = kproj.scores(sd, full.predict(sd[X_COLS]))
    print(json.dumps(res, indent=1, default=str))
    (PIPE / "results" / f"bbproj{'_SEALED' if SEAL else '_dev'}.json").write_text(json.dumps(res, indent=1, default=str))


if __name__ == "__main__":
    main()
