"""Diagnosis for the FanGraphs gap: the M0_T0 design fit IN-SAMPLE (all dev pitchers in training, scored on
themselves, the way public leaderboards are built). Not a candidate; only explains the gap.

    OMP_NUM_THREADS=3 nice -n 10 python research/pitching-plus-v6/insample.py
"""
import sys
from pathlib import Path

import lightgbm as lgb
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ladder  # noqa: E402
import lib  # noqa: E402

df = lib.load(lib.META + lib.BASE + ladder.EXTRA + ["at_bat_number"])
y = df["rv"].astype("float64")
y = y - y.groupby([df["season"], df["balls"], df["strikes"]]).transform("mean")
p = {**lib.FIXED, "objective": "regression", "n_jobs": lib.THREADS, "seed": 0}
bst = lgb.train(p, lgb.Dataset(df[lib.BASE], y, categorical_feature=["ptype"]), 250)
pred = pd.Series(bst.predict(df[lib.BASE]), index=df.index)
v = pred - pred.groupby([df["season"], df["balls"], df["strikes"]]).transform("mean")
v.rename("v").astype("float32").to_frame().to_parquet(lib.CACHE / "oof_INSAMPLE_M0_T0@full.parquet")
print("written")
