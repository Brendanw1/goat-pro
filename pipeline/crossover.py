"""In-season crossover (Fable 1.9): how many pitches into a season until a pitcher's own results forecast the rest of
his season as well as the model does. That is what a stuff grade is for, and next-season r barely measures it.

    python crossover.py                                  # cache/pred_s4_bb.parquet (Whiff+, out of fold)
    python crossover.py cache/pred_swing_xrv_dml.parquet name

Per pitcher-season, pitches in game order (game_date, then the feature frame's game_pk / at-bat / pitch order). At
each checkpoint N (first N pitches), on pitcher-seasons with >= N + REST pitches:
  grade_N    mean out-of-fold P(whiff | swing) over the swings in the first N pitches (the stuff read)
  results_N  the same stat observed over the first N pitches
  rest       the stat over every pitch after N: whiff/swing, K/PA, RV/100
r(grade_N, rest) and r(results_N, rest) with a pitcher-clustered bootstrap CI (cluster_w, seasons share a pitcher's
draw); crossover = the first N where results_N's r reaches grade_N's. Unweighted: the population is fixed per N.
The predictions are joined back to dates by row order of train_mlb.FEATURE_SQL; the join is refused unless pitcher,
season, pitch type, batter side, whiff and swing agree on every row. SELECTION SET (MLB 2020-26, spent).
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

PIPE = Path(__file__).resolve().parent
sys.path.insert(0, str(PIPE))
from judge import _r, cluster_w  # noqa: E402

CHECKPOINTS, REST, DRAWS, SEED = (100, 200, 300, 500, 750, 1000, 1500), 300, 1000, 13
KEYS = ["pitcher", "season", "pitch_type", "stand", "whiff", "swing"]


def keyed(pred_path):
    """Per-pitch predictions with game_date, is_k, pa_end, rv, aligned by row order (verified)."""
    import train_mlb as tm
    p = pd.read_parquet(pred_path, columns=[*KEYS, "pred"])
    body, order = tm.FEATURE_SQL.format(lo=int(p["season"].min()), hi=2026).rsplit("ORDER BY", 1)
    con = tm.mart.connect()
    con.sql("SET threads = 2")
    k = con.sql(f"SELECT game_date, pitcher, season, pitch_type, stand, whiff, swing, rv, is_k, pa_end "
                f"FROM ({body}) ORDER BY {order}").df()
    k["pitcher"] = pd.to_numeric(k["pitcher"], errors="coerce")
    k = k[k["pitcher"].notna() & k["pitch_type"].map(tm.CLASS_OF).notna()].reset_index(drop=True)
    k["pitcher"] = k["pitcher"].astype("int64")
    if len(k) != len(p) or not all((k[c].to_numpy() == p[c].to_numpy()).all() for c in KEYS):
        raise SystemExit(f"row alignment failed: {len(k)} feature rows vs {len(p)} predictions")
    k = k.assign(pred=p["pred"].to_numpy())
    return k.sort_values(["pitcher", "season", "game_date"], kind="stable").reset_index(drop=True)


def checkpoint_table(k, n):
    """One row per pitcher-season with >= n + REST pitches: first-n reads and rest-of-season outcomes."""
    k = k.assign(i=k.groupby(["pitcher", "season"]).cumcount())
    size = k.groupby(["pitcher", "season"])["i"].transform("size")
    k = k[size >= n + REST]
    first, rest = k[k["i"] < n], k[k["i"] >= n]

    def stats(d, pre):
        g = d.groupby(["pitcher", "season"])
        sw = d[d["swing"] == 1].groupby(["pitcher", "season"])
        return pd.DataFrame({f"{pre}wps": sw["whiff"].mean(), f"{pre}grade": sw["pred"].mean(),
                             f"{pre}k": g["is_k"].sum() / g["pa_end"].sum().clip(lower=1),
                             f"{pre}rv100": 100 * g["rv"].mean()})
    return stats(first, "n_").join(stats(rest, "r_"), how="inner").dropna().reset_index()


def crossover(k):
    out = {}
    rng = np.random.default_rng(SEED)
    for n in CHECKPOINTS:
        t = checkpoint_table(k, n)
        if len(t) < 100:
            break
        w = cluster_w([t["pitcher"]], rng, DRAWS)[0]
        B = lambda c: np.broadcast_to(t[c].to_numpy(float), w.shape)  # noqa: E731
        row = {"n_pitcher_seasons": len(t)}
        for tgt in ("wps", "k", "rv100"):
            rg, rr = _r(B("n_grade"), B(f"r_{tgt}"), w), _r(B(f"n_{tgt}"), B(f"r_{tgt}"), w)
            d = rg - rr
            row[tgt] = {"grade_r": round(float(rg[0]), 4), "results_r": round(float(rr[0]), 4),
                        "grade_minus_results": round(float(d[0]), 4),
                        "ci": [round(float(x), 4) for x in np.percentile(d[1:], [2.5, 97.5])]}
        out[n] = row
    cross = {tgt: next((n for n, r in out.items() if r[tgt]["grade_minus_results"] <= 0), f">{max(out)}")
             for tgt in ("wps", "k", "rv100")}
    return {"checkpoints": out, "crossover_pitches": cross}


def demo():
    """Self-check on simulated pitches: a perfect grade (pred = true whiff rate) beats early results and the
    crossover comes later than with a noisy grade."""
    rng = np.random.default_rng(0)
    rows = []
    for m in range(600):
        t = rng.beta(20, 60)
        n = 2200
        sw = rng.random(n) < .45
        wh = sw & (rng.random(n) < t)
        rows.append(pd.DataFrame({"pitcher": m, "season": 2024, "swing": sw.astype(int), "whiff": wh.astype(int),
                                  "pred": t, "rv": rng.normal(0, .2, n), "is_k": 0, "pa_end": 1}))
    k = pd.concat(rows, ignore_index=True)
    good = crossover(k)["checkpoints"]
    assert good[100]["wps"]["grade_r"] > good[100]["wps"]["results_r"]
    bad = crossover(k.assign(pred=k["pred"] + np.repeat(rng.normal(0, .08, 600), 2200)))["checkpoints"]
    assert bad[100]["wps"]["grade_r"] < good[100]["wps"]["grade_r"]


if __name__ == "__main__":
    demo()
    if "--demo" not in sys.argv:
        path = PIPE.parent / (sys.argv[1] if len(sys.argv) > 1 else "cache/pred_s4_bb.parquet")
        name = sys.argv[2] if len(sys.argv) > 2 else "whiff_plus"
        res = {"pred": path.name, **crossover(keyed(path))}
        (PIPE / "results" / f"crossover_{name}.json").write_text(json.dumps(res, indent=1))
        for n, r in res["checkpoints"].items():
            print(n, r["n_pitcher_seasons"], {t: (r[t]["grade_r"], r[t]["results_r"]) for t in ("wps", "k", "rv100")})
        print("crossover:", res["crossover_pitches"])
