"""FanGraphs sanity check for a design: same NS sample as baselines.py (dev pitchers with FG rows, >= 120 outs
in S+1). FG grades are in-sample at FanGraphs, so they are a ceiling, not a bar.

    python research/pitching-plus-v6/fgcheck.py <design>@full [...]
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lib  # noqa: E402

df = lib.load(lib.META)
vs = {n: pd.read_parquet(lib.CACHE / f"oof_{n}.parquet")["v"].reindex(df.index) for n in sys.argv[1:]}
bv = pd.read_parquet(lib.CACHE / "baseline_values.parquet").set_index(df.index)
rows = lib.table(df, {**vs, "stuff": bv["stuff"]}, "P")
fg = pd.read_csv(lib.HERE / "data" / "fg_pitch_models.csv").rename(columns={"xMLBAMID": "pitcher", "Season": "season"})
ns = rows[rows["win"] == "NS"].merge(fg, on=["pitcher", "season"])
ns = ns[ns["outs"] >= 120].dropna(subset=["sp_pitching", "pb_overall"] + list(vs)).assign(nra=lambda d: -d["ra9"],
                                                                                          nfip=lambda d: -d["fip"])
res = {"n": len(ns)}
for n in vs:
    for y in ("nra", "nfip"):
        for ref in ("sp_pitching", "sp_stuff", "stuff"):
            d = lib.delta(ns, ref, n, y)
            d.pop("_boot")
            res[f"{n}|{y}|vs_{ref}"] = d
    # same-season descriptive check vs FG Pitching+ (FG in-sample)
    ss = lib.table(df, {n: vs[n]}, "P")
print(json.dumps(res, default=float))
lib.save("fgcheck_" + "_".join(vs), res)
