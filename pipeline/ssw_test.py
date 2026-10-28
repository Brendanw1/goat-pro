"""Program item 1: does the seam-wake signature add to Stuff+ v2?

    python ssw_test.py

axis_dev = Hawk-Eye's observed spin axis minus the axis implied by movement
(180 - atan2(pfx_x, pfx_z), Statcast convention), wrapped to +-180, signed
arm-relative (LHP mirrored), clipped to +-90 (gyro pitches whose tiny movement
gives a noisy direction), then centered on the season x class median so the
~16 deg slider axis drift across 2023-26 (era audit) cannot leak in.
probe_axis.py showed it is a stable pitcher trait (RESULTS-MLB §16).

Trains v2 and v2 + axis_dev with stuff_v2's own trainer and grading (the
module's FEATURES is swapped for the second run), then applies the
pre-registered rule in COLLABORATION.md. Writes results/ssw_test.json.
"""

import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import stuff_v2  # noqa: E402
from physics import add_physics  # noqa: E402
from train_mlb import frozen_scale, load_features  # noqa: E402

RESULTS = Path(__file__).resolve().parent / "results"
BASE = list(stuff_v2.FEATURES)


def add_axis_dev(df):
    implied = (180 - np.degrees(np.arctan2(df["hb"], df["ivb"]))) % 360
    dev = ((df["spin_axis"] - implied + 180) % 360 - 180).clip(-90, 90)
    df["axis_dev"] = dev * np.where(df["p_throws"] == "L", -1, 1)
    df["axis_dev"] -= df.groupby(["season", "pclass"])["axis_dev"].transform("median")
    return df


def run(df, features):
    stuff_v2.FEATURES = features  # train_boosters/grade_seasons read the module global
    bst = stuff_v2.train_boosters(df)
    refs = frozen_scale(df, bst, features, "csw_norm")
    rows, scored = stuff_v2.grade_seasons(df, bst, refs)
    g = stuff_v2.gates(scored, rows, df)
    sub = scored[["season", "stuff_pred", "csw"]].dropna()
    g["fit_by_season"] = {int(s): float(np.corrcoef(x["stuff_pred"], x["csw"])[0, 1])
                          for s, x in sub.groupby("season")}
    return g


def main() -> None:
    df = add_axis_dev(stuff_v2.prepare(add_physics(load_features())))
    print("v2 baseline...", flush=True)
    base = run(df, BASE)
    print("v2 + axis_dev...", flush=True)
    ssw = run(df, BASE + ["axis_dev"])
    rule = {
        "fit_up_2025": ssw["fit_by_season"][2025] > base["fit_by_season"][2025],
        "fit_up_2026": ssw["fit_by_season"][2026] > base["fit_by_season"][2026],
        "predict_not_lower": all(
            ssw["predictiveness_vs_naive"][p]["grade"] >= base["predictiveness_vs_naive"][p]["grade"]
            for p in ("2024->2025", "2025->2026")),
        "yoy_drop_le_01": all(base["yoy"][p] - ssw["yoy"][p] <= 0.01 for p in base["yoy"]),
        "leak_not_up": ssw["location_leak"] <= base["location_leak"],
    }
    verdict = "PASS" if all(rule.values()) else "REJECTED"
    for name, g in (("v2", base), ("v2+axis_dev", ssw)):
        print(f"{name:12} fit {g['fit_by_season']} leak {g['location_leak']:.3f} "
              f"yoy {g['yoy']} predict { {k: round(v['grade'], 3) for k, v in g['predictiveness_vs_naive'].items()} }")
    print(rule, "->", verdict)
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / "ssw_test.json").write_text(json.dumps(
        {"v2": base, "v2_axis_dev": ssw, "rule": rule, "verdict": verdict}, indent=1,
        default=lambda o: o.item()))  # numpy scalars


if __name__ == "__main__":
    main()
