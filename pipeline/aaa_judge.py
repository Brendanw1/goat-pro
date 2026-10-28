"""P0 step 6 (COLLABORATION.md): the P0 composite on AAA pitchers, AAA grade in S -> AAA + MLB in S+1.

    GOAT_LO=2020 python aaa_judge.py results/crossfit_v2_s6_base_grades.csv results/crossfit_v2_s6_s4bb_grades.csv
    ... --open-seal     the one sealed read: adds AAA 2025 -> 2026

Grades come from crossfit_v2.py --aaa (AAA seasons coded 3023-3025, pitcher-fold cross-fit, models
trained on MLB 2023-24 only). Outcomes per pitcher-season pool AAA (five high-altitude parks dropped,
as in grading) and MLB regular-season pitches: K/PA, (K-BB)/PA, RV/100, xRV/100 (balls in play
valued by the count-specific xwOBA line fitted on MLB TRAIN, judge.py's). Pairs need >= 50 taken AAA
pitches in S and >= 50 taken pitches (AAA + MLB) in S+1. Subset "promoted": no MLB pitch in S, >= 50
taken MLB pitches in S+1. Development pairs: 2023->24, 2024->25. Without --open-seal no AAA 2026 row
is read.
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from aaa_translation import AAA_OFFSET, HIGH_ALT  # noqa: E402
from judge import OUTCOMES, _r, cluster_w  # noqa: E402
from train_mlb import TRAIN_SEASONS, mart  # noqa: E402

SEAL = "--open-seal" in sys.argv
HI = 2026 if SEAL else 2025
SQL = """
SELECT '{lvl}' AS lvl, season, pitcher, balls, strikes, -delta_run_exp AS rv,
       estimated_woba_using_speedangle AS xwoba, description = 'hit_into_play' AS bip,
       events IS NOT NULL AS pa_end, events IN ('strikeout', 'strikeout_double_play') AS is_k,
       events IN ('walk', 'intent_walk') AS is_bb
FROM {tbl} WHERE game_type = 'R' AND season BETWEEN 2023 AND {hi} {extra}
"""


def outcomes():
    con = mart.connect()
    df = pd.concat([con.sql(SQL.format(lvl="MLB", tbl="pitches_all", hi=HI, extra="")).df(),
                    con.sql(SQL.format(lvl="AAA", tbl="pitches_aaa", hi=HI,
                                       extra=f"AND home_team NOT IN {HIGH_ALT}")).df()])
    fit = (df["lvl"] == "MLB") & df["season"].isin(TRAIN_SEASONS) & df["bip"] & df["xwoba"].notna() & df["rv"].notna()
    coef = {k: np.polyfit(g["xwoba"], g["rv"], 1) for k, g in df[fit].groupby(["balls", "strikes"])}
    m = df["bip"] & df["xwoba"].notna()
    ab = np.array([coef.get(k, (0.0, 0.0)) for k in zip(df.loc[m, "balls"], df.loc[m, "strikes"])])
    df["xrv"] = df["rv"]
    df.loc[m, "xrv"] = ab[:, 0] * df.loc[m, "xwoba"] + ab[:, 1]
    df["taken"] = ~df["bip"]

    def agg(d):
        g = d.groupby(["pitcher", "season"])
        o = pd.DataFrame({"n_taken": g["taken"].sum(), "pa": g["pa_end"].sum(), "k": g["is_k"].sum(),
                          "bb": g["is_bb"].sum(), "rv100": 100 * g["rv"].mean(), "xrv100": 100 * g["xrv"].mean()})
        o["kbb"], o["k"] = (o["k"] - o["bb"]) / o["pa"], o["k"] / o["pa"]
        return o.reset_index().rename(columns={"pitcher": "mlbam"})
    return agg(df), agg(df[df["lvl"] == "AAA"]), agg(df[df["lvl"] == "MLB"])


def main(path_a, path_b, draws=2000, seed=13):
    both, aaa, mlb = outcomes()
    a = pd.read_csv(path_a).rename(columns={"grade": "ga"})
    b = pd.read_csv(path_b).rename(columns={"grade": "gb"})
    g = a.merge(b, on=["mlbam", "season"])
    g = g[g["season"] > AAA_OFFSET + 2000].assign(season=lambda x: x["season"] - AAA_OFFSET)
    g = g.merge(aaa[aaa["n_taken"] >= 50][["mlbam", "season"]], on=["mlbam", "season"])
    mlb_s = set(zip(mlb["mlbam"], mlb["season"]))
    mlb_next = set(zip(mlb.loc[mlb["n_taken"] >= 50, "mlbam"], mlb.loc[mlb["n_taken"] >= 50, "season"]))
    pairs = [(2023, 2024), (2024, 2025)] + ([(2025, 2026)] if SEAL else [])
    rng = np.random.default_rng(seed)
    out = {}
    for subset in ("all", "promoted"):
        per_pair, boot, ds = {}, [], []
        for s0, s1 in pairs:
            d = g[g["season"] == s0].merge(both[(both["season"] == s1) & (both["n_taken"] >= 50)]
                                           .drop(columns="season"), on="mlbam").dropna(subset=list(OUTCOMES))
            if subset == "promoted":
                d = d[[(p, s0) not in mlb_s and (p, s1) in mlb_next for p in d["mlbam"]]]
            ds.append(d)
        for (s0, s1), d, w in zip(pairs, ds, cluster_w([d["mlbam"] for d in ds], rng, draws)):
            n = len(d)
            res = {o: _r(np.broadcast_to(d["gb"].to_numpy(), w.shape), np.broadcast_to(d[o].to_numpy(), w.shape), w)
                   - _r(np.broadcast_to(d["ga"].to_numpy(), w.shape), np.broadcast_to(d[o].to_numpy(), w.shape), w)
                   for o in OUTCOMES}
            per_pair[f"{s0}->{s1}"] = {"n": n, **{o: round(float(res[o][0]), 4) for o in OUTCOMES},
                                       "composite": round(float(np.mean([res[o][0] for o in OUTCOMES])), 4),
                                       "composite_se": round(float(np.mean([res[o] for o in OUTCOMES], 0)[1:].std()), 4)}
            boot.append(np.vstack([res[o] for o in OUTCOMES]))
        B = np.mean(boot, axis=0)
        res = {"pairs": per_pair}
        for i, o in enumerate(list(OUTCOMES) + ["composite"]):
            v = B.mean(0) if o == "composite" else B[i]
            res[o] = {"dr": round(float(v[0]), 4), "se": round(float(v[1:].std()), 4),
                      "ci": [round(float(x), 4) for x in np.percentile(v[1:], [2.5, 97.5])]}
        out[subset] = res
        print(subset, json.dumps(per_pair))
        for o in list(OUTCOMES) + ["composite"]:
            print(f"  {o:9} pooled dr {res[o]['dr']:+.4f}  se {res[o]['se']:.4f}  ci [{res[o]['ci'][0]:+.4f}, {res[o]['ci'][1]:+.4f}]")
    tag = Path(path_b).stem.replace("_grades", "").replace("crossfit_v2_", "")
    name = f"aaa_judge_{tag}{'_SEALED' if SEAL else '_dev'}.json"
    (Path(__file__).resolve().parent / "results" / name).write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main(*[x for x in sys.argv[1:] if not x.startswith("--")][:2])
