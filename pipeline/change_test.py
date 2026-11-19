"""Change test (Resnick, Pitcher Greeks §5): when a pitcher's pitch changes between seasons, does
the model's predicted change track the realized change? Out-of-fold predictions from crossfit_v2's
*_pt.csv.

    python change_test.py results/crossfit_v2_A_pt.csv results/crossfit_v2_B_pt.csv

Pairs: same pitcher x pitch type in consecutive seasons, >= 50 swings in both (>= 30 balls in play for GB). Per
pitch class and pooled: r of predicted vs realized change and OLS slope, for whiff per swing (the Stuff construct),
CSW, RV/100 and GB/BIP (Fable 1.8: does the grade move runs and contact, not only whiffs). CI: pitcher-clustered
bootstrap (judge.cluster_w; a pitcher's pitch types and seasons are drawn together), replacing the old pitch-level
shuffle, which treated a pitcher's three pitches as independent. SELECTION SET (MLB 2020-26).
"""
import json
import sys
import tempfile
from pathlib import Path

import numpy as np
import pandas as pd

PIPE = Path(__file__).resolve().parent
sys.path.insert(0, str(PIPE))
from judge import _r, cluster_w  # noqa: E402
from train_mlb import CLASS_OF, DEV  # noqa: E402

PT_SQL = """
SELECT pitcher, season, pitch_type, 100 * avg(-delta_run_exp) AS rv100,
       count(*) FILTER (description = 'hit_into_play') AS n_bip,
       count(*) FILTER (description = 'hit_into_play' AND bb_type = 'ground_ball')
         / greatest(count(*) FILTER (description = 'hit_into_play'), 1) AS gb
FROM pitches_all WHERE game_type = 'R' AND season BETWEEN 2020 AND 2026 GROUP BY 1, 2, 3
"""
TARGETS = {"wps": "n_sw", "csw": "n_sw", "rv100": "n_sw", "gb": "n_bip"}
MIN = {"n_sw": 50, "n_bip": 30}


def pt_outcomes():
    path = (Path(DEV, "cache") if DEV else PIPE.parent / "cache") / "pt_outcomes_2020.parquet"
    if not path.exists():
        from train_mlb import mart
        path.parent.mkdir(parents=True, exist_ok=True)
        mart.connect().sql(PT_SQL).df().to_parquet(path)
    return pd.read_parquet(path)


def pairs(path, extra=None):
    pt = pd.read_csv(path)
    pt = pt.merge(pt_outcomes() if extra is None else extra, on=["pitcher", "season", "pitch_type"], how="left")
    nxt = pt.assign(season=pt["season"] - 1)
    j = pt.merge(nxt, on=["pitcher", "season", "pitch_type"], suffixes=("", "_1"))
    j = j.assign(dp=j["pred_1"] - j["pred"], pclass=j["pitch_type"].map(CLASS_OF))
    for t in TARGETS:
        j[f"d_{t}"] = j[f"{t}_1"] - j[t]
    return j


def stats(j, rng, draws=1000):
    out = {}
    for t, n in TARGETS.items():
        q = j[(j[n] >= MIN[n]) & (j[f"{n}_1"] >= MIN[n])].dropna(subset=["dp", f"d_{t}"])
        if len(q) < 30:
            continue
        w = cluster_w([q["pitcher"]], rng, draws)[0]
        r = _r(np.broadcast_to(q["dp"].to_numpy(float), w.shape), np.broadcast_to(q[f"d_{t}"].to_numpy(float), w.shape), w)
        out[t] = {"pairs": len(q), "r": round(float(r[0]), 3), "ci": [round(float(x), 3) for x in np.percentile(r[1:], [2.5, 97.5])],
                  "slope": round(float(np.polyfit(q["dp"], q[f"d_{t}"], 1)[0]), 3)}
    return out


def demo():
    """Self-check: a prediction that is the true whiff change recovers r > 0 with a CI above 0; a shuffled one does not."""
    rng = np.random.default_rng(0)
    n = 3000
    p0, step = rng.beta(20, 60, n), rng.normal(0, .03, n)
    pt = pd.concat([pd.DataFrame({"pitcher": np.arange(n) // 3, "season": s, "pitch_type": np.tile(["FF", "SL", "CH"], n // 3),
                                  "pred": p0 + (s - 2023) * step, "wps": p0 + (s - 2023) * step + rng.normal(0, .04, n),
                                  "csw": .3, "rv100": 0.0, "n_sw": 200, "gb": .4, "n_bip": 60}) for s in (2023, 2024)])
    tmp = Path(tempfile.mkdtemp()) / "_change_demo.csv"
    pt.drop(columns=["rv100", "gb", "n_bip"]).to_csv(tmp, index=False)
    try:
        j = pairs(tmp, pt[["pitcher", "season", "pitch_type", "rv100", "gb", "n_bip"]])
    finally:
        tmp.unlink()
    good = stats(j, rng, 300)["wps"]
    assert good["r"] > .4 and good["ci"][0] > 0, good
    bad = stats(j.assign(dp=rng.permutation(j["dp"].to_numpy())), rng, 300)["wps"]
    assert bad["ci"][0] < 0 < bad["ci"][1], bad


if __name__ == "__main__":
    demo()
    rng = np.random.default_rng(13)
    res = {}
    for path in sys.argv[1:]:
        j = pairs(path)
        res[Path(path).stem] = {"all": stats(j, rng), **{c: stats(g, rng) for c, g in j.groupby("pclass")}}
        print(Path(path).stem, json.dumps(res[Path(path).stem]))
    if res:
        out = Path(DEV, "results") if DEV else PIPE / "results"
        out.mkdir(parents=True, exist_ok=True)
        (out / "change_test.json").write_text(json.dumps(res, indent=1))
