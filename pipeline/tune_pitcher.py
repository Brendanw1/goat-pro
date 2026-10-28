"""T1: tuning ceiling of the v2 boosters on a pitcher-level objective (COLLABORATION.md T1).

    python tune_pitcher.py

§30's tune_lgbm.py tuned on per-pitch fit and raised the leak. Here the objective is what the
grade is for: r(pitcher x pitch type mean prediction in 2023, same pitcher x type whiff/swing in
2024), pairs >= 50 swings both seasons, on pitchers the cells never saw (4 pitcher folds inside
TRAIN 2023-24; 2021-23 confirmation pairs are never read). Per class; per-type r reported.
Writes results/tune_pitcher.json; "tuned" is the per-class --params for crossfit_v2.py.
--target wps (P0 step 4): train on whiff/swing instead; writes tune_pitcher_wps.json.
--classes BB,CH limits the classes tuned.
"""
import json
import sys
import zlib
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import stuff_v2  # noqa: E402
from physics import add_physics  # noqa: E402
from train_mlb import LGBM_PARAMS, load_features  # noqa: E402
from type_grades import SITE  # noqa: E402

RESULTS = Path(__file__).resolve().parent / "results"
CHECK = (25, 50, 100, 200, 400, 800)
GRID = [("ref", {})] + [(f"nl{nl}_mc{mc}", {"num_leaves": nl, "min_child_samples": mc,
                                             "learning_rate": 0.1, "n_estimators": max(CHECK)})
                        for nl in (7, 31, 63) for mc in (100, 1000, 5000)]
MIN_SW = 50
TARGET = sys.argv[sys.argv.index("--target") + 1] if "--target" in sys.argv else "csw_norm"
CLASSES = tuple(sys.argv[sys.argv.index("--classes") + 1].split(",")) if "--classes" in sys.argv else ("FB", "BB", "CH")


def main() -> None:
    import lightgbm as lgb
    df = stuff_v2.prepare(add_physics(load_features()))
    F = stuff_v2.FEATURES
    df["wps"] = df["whiff"].where(df["swing"] == 1)
    df["fold"] = df["pitcher"].map(lambda p: zlib.crc32(str(p).encode()) % 4)
    tr = df[df["train_season"] & df[TARGET].notna()]
    sw = df[(df["season"] == 2024) & (df["swing"] == 1)]
    nxt = sw.groupby(["pitcher", "pitch_type"])["whiff"].agg(["mean", "size"])
    nxt = nxt[nxt["size"] >= MIN_SW]["mean"].rename("wps_next")
    n23 = df[(df["season"] == 2023) & (df["swing"] == 1)].groupby(["pitcher", "pitch_type"]).size()
    keep23 = n23[n23 >= MIN_SW].index
    out = {}
    for name, over in GRID:
        params = {**LGBM_PARAMS, **over, "n_jobs": 6}
        checks = (params["n_estimators"],) if name == "ref" else CHECK
        res = {}
        for pc in CLASSES:
            mono = stuff_v2.CLASS_MONO[pc]
            preds = {c: [] for c in checks}
            for k in range(4):
                for side in ("R", "L"):
                    cell = tr[(tr["pclass"] == pc) & (tr["stand"] == side) & (tr["fold"] != k)]
                    m = lgb.LGBMRegressor(monotone_constraints=[mono.get(f, 0) for f in F], **params)
                    m.fit(cell[F], cell[TARGET])
                    va = df[(df["season"] == 2023) & (df["pclass"] == pc) & (df["stand"] == side)
                            & (df["fold"] == k)]
                    for c in checks:
                        preds[c].append(pd.Series(m.predict(va[F], num_iteration=c), index=va.index))
            res[pc] = {}
            for c in checks:
                p = pd.concat(preds[c])
                pt = df.loc[p.index].assign(pred=p).groupby(["pitcher", "pitch_type"])["pred"].mean()
                j = pd.concat([pt[pt.index.isin(keep23)], nxt], axis=1, join="inner").reset_index()
                by_type = {s: round(g["pred"].corr(g["wps_next"]), 4)
                           for s, g in j.assign(site=j["pitch_type"].map(SITE)).groupby("site")
                           if len(g) >= 30}
                res[pc][c] = {"r": round(j["pred"].corr(j["wps_next"]), 4), "pairs": len(j), "by_type": by_type}
            print(name, pc, {c: res[pc][c]["r"] for c in checks}, flush=True)
        out[name] = res
    tuned, ceiling = {}, {}
    for pc in CLASSES:
        ref = next(iter(out["ref"][pc].values()))["r"]
        best = max(((n, c, out[n][pc][c]["r"]) for n, _ in GRID[1:] for c in CHECK), key=lambda t: t[2])
        tuned[pc] = {**dict(GRID)[best[0]], "learning_rate": 0.1, "n_estimators": best[1]}
        ceiling[pc] = {"ref_r": ref, "best": best[0], "trees": best[1], "best_r": best[2],
                       "gain": round(best[2] - ref, 4)}
    print("ceiling:", json.dumps(ceiling))
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / ("tune_pitcher.json" if TARGET == "csw_norm" else f"tune_pitcher_{TARGET}.json")).write_text(json.dumps(
        {"grid": out, "tuned": tuned, "ceiling": ceiling}, indent=1))


if __name__ == "__main__":
    main()
