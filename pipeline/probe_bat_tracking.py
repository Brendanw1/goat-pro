"""Probe: is "swing disruption" from bat tracking a pitcher trait, and does it add to Stuff+?

    python probe_bat_tracking.py

Program item 4's first slice (docs/pitch-model-research-program.md). The swing is
the hitter's continuous response to the pitch; a whiff is its binary shadow.
Per tracked swing (Savant bat tracking, 2024-26), each metric is taken relative to
that batter's season mean, so batter quality cancels:
  d_bat_speed   bat speed below his norm (defensive / fooled swing)
  d_length      swing length vs his norm
  d_intercept_y contact point depth vs his norm (timing: out front vs deep)
  abs_intercept |d_intercept_y| (timing disruption either way)
Pitcher-season means (>= 100 tracked swings). Reports split-half (odd/even swings)
and YoY reliability, then 5-fold CV R^2 for next-season K% and CSW%:
naive, naive + cross-fit Stuff+, naive + Stuff+ + metric, and the same
with FB/CH share as a pitch-mix control (|mix).
Writes results/probe_bat_tracking.json.
"""

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

from paths import MART_DIR  # noqa: E402
sys.path.insert(0, str(MART_DIR))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import mart  # noqa: E402
from tests_small_sample import cv_r2  # noqa: E402
from train_mlb import load_features  # noqa: E402

RESULTS = Path(__file__).resolve().parent / "results"
METRICS = ["d_bat_speed", "d_length", "d_intercept_y", "abs_intercept"]
MIN_SWINGS = 100


def main() -> None:
    sw = mart.connect().sql("""
        SELECT season, pitcher, batter, bat_speed, swing_length,
               intercept_ball_minus_batter_pos_y_inches AS icpt_y,
               row_number() OVER (PARTITION BY season, pitcher
                                  ORDER BY game_pk, at_bat_number, pitch_number) AS k
        FROM pitches_all
        WHERE game_type = 'R' AND season >= 2024 AND bat_speed IS NOT NULL""").df()
    g = sw.groupby(["season", "batter"])
    sw["d_bat_speed"] = sw["bat_speed"] - g["bat_speed"].transform("mean")
    sw["d_length"] = sw["swing_length"] - g["swing_length"].transform("mean")
    sw["d_intercept_y"] = sw["icpt_y"] - g["icpt_y"].transform("mean")
    sw["abs_intercept"] = sw["d_intercept_y"].abs()
    out = {"coverage": {int(s): int(n) for s, n in sw.groupby("season").size().items()}}

    n = sw.groupby(["season", "pitcher"]).size()
    keep = n[n >= MIN_SWINGS].index
    sw = sw.set_index(["season", "pitcher"]).loc[keep].reset_index()
    half = sw.groupby(["season", "pitcher", sw["k"] % 2])[METRICS].mean().unstack()
    ps = sw.groupby(["season", "pitcher"])[METRICS].mean().reset_index()
    rel = {}
    for m in METRICS:
        sh = float(half[m].corr().iloc[0, 1])
        w = ps.pivot_table(index="pitcher", columns="season", values=m)
        yoy = {f"{a}->{b}": round(float(w[[a, b]].dropna().corr().iloc[0, 1]), 3)
               for a, b in ((2024, 2025), (2025, 2026))}
        rel[m] = {"split_half": round(sh, 3), "yoy": yoy}
        print(f"{m:14} split-half {sh:.3f}  YoY {yoy}")
    out["reliability"] = rel

    df = load_features()
    pa = df[df["pa_taken"] == 1]
    oc = pa.groupby(["pitcher", "season"]).agg(n=("csw", "size"), csw=("csw", "mean"),
                                              k=("is_k", "mean")).reset_index()
    oc[["csw", "k"]] *= 100
    cf = pd.read_csv(RESULTS / "crossfit_v2_grades.csv").rename(
        columns={"mlbam": "pitcher", "grade": "stuff"})
    # pitch-mix control: the college deception "signal" was pitch mix (deception-whiff/RESULTS.md)
    mix = (df.assign(fb=(df["pclass"] == "FB"), ch=(df["pclass"] == "CH"))
           .groupby(["pitcher", "season"])[["fb", "ch"]].mean().reset_index())
    t = (ps.merge(cf, on=["pitcher", "season"]).merge(oc, on=["pitcher", "season"])
         .merge(mix, on=["pitcher", "season"]))
    t = t[t["n"] >= 50]
    inc = {}
    for a, b in ((2024, 2025), (2025, 2026)):
        A, B = t[t["season"] == a].set_index("pitcher"), t[t["season"] == b].set_index("pitcher")
        h = A.join(B[["csw", "k"]], rsuffix="_next", how="inner")
        for tgt in ("k", "csw"):
            y = h[f"{tgt}_next"].to_numpy()
            base = cv_r2(y, h[[tgt, "stuff"]].to_numpy())
            cell = {"n": len(h), "naive": round(float(cv_r2(y, h[[tgt]].to_numpy())), 4),
                    "naive+stuff": round(float(base), 4)}
            mixed = cv_r2(y, h[[tgt, "stuff", "fb", "ch"]].to_numpy())
            cell["naive+stuff+mix"] = round(float(mixed), 4)
            for m in METRICS:
                cell[f"+{m}"] = round(float(cv_r2(y, h[[tgt, "stuff", m]].to_numpy()) - base), 4)
                cell[f"+{m}|mix"] = round(float(
                    cv_r2(y, h[[tgt, "stuff", "fb", "ch", m]].to_numpy()) - mixed), 4)
            inc[f"{a}->{b} {tgt}"] = cell
            print(f"{a}->{b} {tgt}: {cell}")
    out["incremental_cv_r2"] = inc
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / "probe_bat_tracking.json").write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
