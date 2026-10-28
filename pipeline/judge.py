"""P0 judge (COLLABORATION.md P0): pooled composite of next-season outcomes, one paired bootstrap.

    GOAT_LO=2020 python judge.py results/crossfit_v2_A_grades.csv results/crossfit_v2_B_grades.csv [--skip 2023]

Outcome panel per pitcher-season (regular season, >= 50 taken pitches in both seasons):
  k      K / PA
  kbb    (K - BB) / PA
  rv100  100 x mean(-delta_run_exp), all pitches
  xrv100 same, balls in play valued by E[rv | xwOBA, count] (linear per count, fit on TRAIN)
Composite = mean over the four outcomes of the pooled delta r (B minus A), pooled = mean over the
season pairs. Pitchers are resampled within each pair; the same draws serve every outcome, so the
composite CI is joint. --skip drops a pair's start season (e.g. 2023 for runs tuned on 2023->24).
"""
import json
import os
import sys
import zlib
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from train_mlb import TRAIN_SEASONS, mart  # noqa: E402

LO = int(os.environ.get("GOAT_LO", 2023))
OUTCOMES = ("k", "kbb", "rv100", "xrv100")
PITCHERS = sys.argv[sys.argv.index("--pitchers") + 1] if "--pitchers" in sys.argv else ""
CACHE = Path(__file__).resolve().parent.parent / "cache" / f"outcomes_{LO}.parquet"

SQL = """
SELECT season, pitcher, balls, strikes, -delta_run_exp AS rv,
       estimated_woba_using_speedangle AS xwoba,
       description = 'hit_into_play' AS bip,
       events IS NOT NULL AS pa_end,
       events IN ('strikeout', 'strikeout_double_play') AS is_k,
       events IN ('walk', 'intent_walk') AS is_bb
FROM pitches_all WHERE game_type = 'R' AND season BETWEEN {lo} AND 2026
"""


def outcomes() -> pd.DataFrame:
    if CACHE.exists():
        return pd.read_parquet(CACHE)
    df = mart.connect().sql(SQL.format(lo=LO)).df()
    fit = df["season"].isin(TRAIN_SEASONS) & df["bip"] & df["xwoba"].notna() & df["rv"].notna()
    coef = {k: np.polyfit(g["xwoba"], g["rv"], 1) for k, g in df[fit].groupby(["balls", "strikes"])}
    xr = df["rv"].copy()
    m = df["bip"] & df["xwoba"].notna()
    keys = list(zip(df.loc[m, "balls"], df.loc[m, "strikes"]))
    xr[m] = [coef.get(k, (0.0, 0.0))[0] * x + coef.get(k, (0.0, 0.0))[1] for k, x in zip(keys, df.loc[m, "xwoba"])]
    df["xrv"] = xr
    g = df.groupby(["pitcher", "season"])
    oc = pd.DataFrame({"n_taken": g["bip"].apply(lambda b: int((~b).sum())), "pa": g["pa_end"].sum(),
                       "k": g["is_k"].sum(), "bb": g["is_bb"].sum(),
                       "rv100": 100 * g["rv"].mean(), "xrv100": 100 * g["xrv"].mean()})
    oc["kbb"] = (oc["k"] - oc["bb"]) / oc["pa"]
    oc["k"] = oc["k"] / oc["pa"]
    oc = oc.reset_index().rename(columns={"pitcher": "mlbam"})
    CACHE.parent.mkdir(exist_ok=True)
    oc.to_parquet(CACHE)
    return oc


def _r(x, y, w):
    mx, my = (x * w).sum(1) / w.sum(1), (y * w).sum(1) / w.sum(1)
    dx, dy = x - mx[:, None], y - my[:, None]
    return (w * dx * dy).sum(1) / np.sqrt((w * dx * dx).sum(1) * (w * dy * dy).sum(1))


def cluster_w(ids, rng, draws):
    """Pitcher-clustered bootstrap weights (Location+ critique, RESULTS-MLB §54): one multinomial draw over
    every distinct pitcher, shared by all season pairs, so a pitcher in several pairs is resampled once.
    Returns, per pair, a (1 + draws) x n weight matrix whose row 0 is all ones (the point estimate)."""
    u = np.unique(np.concatenate([np.asarray(i) for i in ids]))
    W = rng.multinomial(len(u), np.full(len(u), 1 / len(u)), size=draws)
    return [np.vstack([np.ones(len(i)), W[:, np.searchsorted(u, np.asarray(i))]]) for i in ids]


def judge(path_a, path_b, skip=(), draws=2000, seed=13):
    oc = outcomes()
    oc = oc[oc["n_taken"] >= 50]
    if PITCHERS:  # P7 pitcher seal: dev = 80%, sealed = crc32("p7:" + id) % 5 == 0
        sealed = oc["mlbam"].map(lambda p: zlib.crc32(f"p7:{p}".encode()) % 5 == 0)
        oc = oc[sealed if PITCHERS == "sealed" else ~sealed]
    a = pd.read_csv(path_a).rename(columns={"grade": "ga"})
    b = pd.read_csv(path_b).rename(columns={"grade": "gb"})
    rng = np.random.default_rng(seed)
    pairs = [(s, s + 1) for s in range(LO, 2026) if s not in skip]
    per_pair, boot, ds = {}, [], []
    for s0, s1 in pairs:
        d = a[a["season"] == s0].merge(b[b["season"] == s0], on=["mlbam", "season"])
        ds.append(d.merge(oc[oc["season"] == s1].drop(columns="season"), on="mlbam").dropna(subset=list(OUTCOMES)))
    for (s0, s1), d, w in zip(pairs, ds, cluster_w([d["mlbam"] for d in ds], rng, draws)):
        n = len(d)
        res = {}
        for o in OUTCOMES:
            y = np.broadcast_to(d[o].to_numpy(), w.shape)
            res[o] = (_r(np.broadcast_to(d["gb"].to_numpy(), w.shape), y, w)
                      - _r(np.broadcast_to(d["ga"].to_numpy(), w.shape), y, w))
        per_pair[f"{s0}->{s1}"] = {"n": n, **{o: float(res[o][0]) for o in OUTCOMES}}
        boot.append(np.vstack([res[o] for o in OUTCOMES]))  # outcomes x (1 + draws)
    B = np.mean(boot, axis=0)  # pooled over pairs: outcomes x (1 + draws)
    out = {"pairs": per_pair}
    for i, o in enumerate(list(OUTCOMES) + ["composite"]):
        v = B.mean(0) if o == "composite" else B[i]
        out[o] = {"dr": float(v[0]), "se": float(v[1:].std()), "ci": [float(x) for x in np.percentile(v[1:], [2.5, 97.5])]}
    return out


if __name__ == "__main__":
    skip = (int(sys.argv[sys.argv.index("--skip") + 1]),) if "--skip" in sys.argv else ()
    res = judge(sys.argv[1], sys.argv[2], skip)
    for o in list(OUTCOMES) + ["composite"]:
        print(f"{o:9} pooled dr {res[o]['dr']:+.4f}  se {res[o]['se']:.4f}  ci [{res[o]['ci'][0]:+.4f}, {res[o]['ci'][1]:+.4f}]")
    tag = Path(sys.argv[2]).stem.replace("_grades", "").replace("crossfit_v2_", "") + (f"_{PITCHERS}" if PITCHERS else "")
    (Path(__file__).resolve().parent / "results" / f"judge_{tag}.json").write_text(json.dumps(res, indent=1))
