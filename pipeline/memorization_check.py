"""Does Stuff+ v2 memorize pitchers? Pitcher-grouped holdout inside the train seasons.

    python memorization_check.py

The v2 per-pitch fit (r of prediction vs csw) is ~.29 on the 2023-24 training
seasons but ~.07 on 2025-26 (ssw_test.json). Two readings: (a) 2025-26 differ
(drift), or (b) the boosters learn pitcher identity from fingerprint features
(release point, pitcher-relative velo/ivb/hb diffs) and replay each training
pitcher's own CSW rate. Game-fold OOF (stuff_v2 --oof) cannot separate them:
every pitcher sits in every fold. Here pitchers are split in half by
crc32(pitcher): train on half A's 2023-24 pitches, score half B's 2023-24
pitches. (b) predicts B's r collapses toward .07; (a) predicts it stays ~.29.
Writes results/memorization_check.json.
"""

import json
import sys
import zlib
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import stuff_v2  # noqa: E402
from physics import add_physics  # noqa: E402
from train_mlb import load_features  # noqa: E402

RESULTS = Path(__file__).resolve().parent / "results"


def per_pitch_r(df, bst, mask):
    out = {}
    for key, b in bst.items():
        pclass, side = key.split("_vs_")
        m = mask & (df["pclass"] == pclass) & (df["stand"] == ("L" if side == "LHH" else "R"))
        df.loc[m, "pred"] = b.predict(df.loc[m, stuff_v2.FEATURES])
    sub = df.loc[mask, ["pred", "csw", "season"]].dropna()
    return {int(s): round(float(np.corrcoef(x["pred"], x["csw"])[0, 1]), 4)
            for s, x in sub.groupby("season")}


def main() -> None:
    df = stuff_v2.prepare(add_physics(load_features()))
    half = df["pitcher"].map(lambda p: zlib.crc32(str(p).encode()) % 2)
    full_train = df["train_season"].copy()
    df["train_season"] = full_train & (half == 0)  # trainer reads this flag
    print("training on half A of pitchers (2023-24)...", flush=True)
    bst = stuff_v2.train_boosters(df)
    df["pred"] = np.nan
    res = {"seen_pitchers_train_seasons": per_pitch_r(df, bst, full_train & (half == 0)),
           "unseen_pitchers_train_seasons": per_pitch_r(df, bst, full_train & (half == 1)),
           "test_seasons_all": per_pitch_r(df, bst, df["season"].isin([2025, 2026])),
           "test_seasons_unseen_half": per_pitch_r(df, bst, df["season"].isin([2025, 2026]) & (half == 1))}
    for k, v in res.items():
        print(f"{k:32} {v}")
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / "memorization_check.json").write_text(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
