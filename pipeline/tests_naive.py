"""The naive-persistence follow-ups, on the v1 models (csw_norm Stuff+ / rv Pitching+).

    python tests_naive.py

Three questions the RESULTS-MLB verdict left open:
  1. Pitching+ vs naive — the college PASSING pair (college Pitching+ beat naive
     on next-season RV/100 and xwOBA-against; Stuff+ never did). Tests next-season
     RV/100 and K%.
  2. Grade-lift — does adding the grade to naive persistence improve the
     forecast? Delta-R2 of {next ~ prior} vs {next ~ prior + grade}. The
     industry-standard claim for a component model (the E-RAPM/box-prior
     structure: the blend beats either alone).
  3. Small-sample regime — where naive degenerates (pitchers with a thin prior
     season, <150 train pitches). Reports grade-r where a prior exists, and RMSE
     vs the league-mean predictor everywhere (a constant has no correlation).

Writes results/naive_tests.json and prints the tables.
"""

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from train_mlb import (  # noqa: E402
    LOC_FEATURES, STUFF_FEATURES, frozen_scale, load_features, season_grades, train_boosters)

RESULTS = Path(__file__).resolve().parent / "results"


def r2(y, X):
    """OLS R^2 of y on design matrix X (with intercept added here)."""
    X1 = np.column_stack([np.ones(len(y)), X])
    beta, *_ = np.linalg.lstsq(X1, y, rcond=None)
    pred = X1 @ beta
    ss_res = np.sum((y - pred) ** 2)
    ss_tot = np.sum((y - y.mean()) ** 2)
    return 1 - ss_res / ss_tot if ss_tot > 0 else np.nan


def main() -> None:
    df = load_features()
    e_csw = (df[df["train_season"] & (df["pa_taken"] == 1)]
             .groupby(["balls", "strikes"])["csw"].mean().rename("e_csw_count"))
    df = df.join(e_csw, on=["balls", "strikes"])
    df["csw_norm"] = np.where(df["pa_taken"] == 1, df["csw"] / df["e_csw_count"], np.nan)
    print("training stuff + pitching boosters (v1 spec)...", flush=True)
    stuff_bst = train_boosters(df, STUFF_FEATURES, "csw_norm", mono=True)
    stuff_refs = frozen_scale(df, stuff_bst, STUFF_FEATURES, "csw_norm")
    pitch_bst = train_boosters(df, LOC_FEATURES, "rv", mono=False)
    pitch_refs = frozen_scale(df, pitch_bst, LOC_FEATURES, "rv")

    rows, pr = [], []
    for season in (2023, 2024, 2025, 2026):
        sdf = df[df["season"] == season]
        rows += season_grades(sdf, "stuff", stuff_bst, stuff_refs, STUFF_FEATURES)[0]
        pr += season_grades(sdf, "pitch", pitch_bst, pitch_refs, LOC_FEATURES)[0]
    gw = pd.DataFrame([{"pid": r["mlbam"], "s": r["season"], "stuff": r["grade"]} for r in rows])
    pw = pd.DataFrame([{"pid": r["mlbam"], "s": r["season"], "pitch": r["grade"]} for r in pr])
    grades = gw.merge(pw, on=["pid", "s"], how="outer")

    # per pitcher-season outcomes from the mart frame
    pa = df[df["pa_taken"] == 1]
    out = pa.groupby(["pitcher", "season"]).apply(lambda s: pd.Series({
        "rv100": 100 * s["rv"].sum() / max(1, len(s)),
        "k_pct": 100 * s["is_k"].sum() / max(1, len(s)),
        "csw_pct": 100 * s["csw"].sum() / max(1, len(s)),
        "n_train": len(s),
    }), include_groups=False).reset_index().rename(columns={"pitcher": "pid", "season": "s"})

    j = grades.merge(out, on=["pid", "s"], how="inner")
    j = j[j["n_train"] >= 50]
    results = {}

    for label, grade_col in (("pitching", "pitch"), ("stuff", "stuff")):
        # outcome the college program paired with each model
        targets = ("rv100", "k_pct") if label == "pitching" else ("csw_pct", "k_pct")
        per_target = {}
        for tgt in targets:
            wide_g = j.pivot_table(index="pid", columns="s", values=grade_col)
            wide_o = j.pivot_table(index="pid", columns="s", values=tgt)
            for a, b in ((2023, 2024), (2024, 2025), (2025, 2026)):
                have = pd.DataFrame({"grade": wide_g[a], "prior": wide_o[a],
                                     "next": wide_o[b]}).dropna()
                if len(have) < 30:
                    continue
                rg = np.corrcoef(have["grade"], have["next"])[0, 1]
                rn = np.corrcoef(have["prior"], have["next"])[0, 1]
                r2_prior = r2(have["next"].to_numpy(), have[["prior"]].to_numpy())
                r2_both = r2(have["next"].to_numpy(), have[["prior", "grade"]].to_numpy())
                per_target[f"{a}->{b} {tgt}"] = {
                    "grade_r": round(float(rg), 3), "naive_r": round(float(rn), 3),
                    "grade_beats": bool(rg > rn),
                    "r2_prior": round(float(r2_prior), 4),
                    "r2_prior_plus_grade": round(float(r2_both), 4),
                    "delta_r2_lift": round(float(r2_both - r2_prior), 4), "n": len(have)}
        results[label] = per_target
        print(f"\n=== {label} ===")
        for k, v in per_target.items():
            print(f"  {k}: grade {v['grade_r']} vs naive {v['naive_r']} "
                  f"({'WINS' if v['grade_beats'] else 'loses'}) | dR2 {v['delta_r2_lift']:+.4f} (n={v['n']})")

    # 3. small-sample regime: thin prior season
    print("\n=== small-sample regime (Stuff+ vs CSW%, 2024->2025) ===")
    wide_g = j.pivot_table(index="pid", columns="s", values="stuff")
    wide_o = j.pivot_table(index="pid", columns="s", values="csw_pct")
    wide_n = j.pivot_table(index="pid", columns="s", values="n_train")
    have = pd.DataFrame({"grade": wide_g[2024], "prior": wide_o[2024], "next": wide_o[2025],
                         "n_prior": wide_n[2024]}).dropna()
    thin, full = have[have["n_prior"] < 150], have[have["n_prior"] >= 150]
    reg = {}
    for name, c in (("thin(<150 prior pitches)", thin), ("full(>=150)", full)):
        if len(c) < 30:
            continue
        rg = float(np.corrcoef(c["grade"], c["next"])[0, 1])
        rn = float(np.corrcoef(c["prior"], c["next"])[0, 1])
        league_mean = float(have["next"].mean())
        rmse_mean = float(np.sqrt(((c["next"] - league_mean) ** 2).mean()))
        rmse_grade = float(np.sqrt(((c["next"] - (league_mean + (c["grade"] - 100))) ** 2).mean()))
        reg[name] = {"n": len(c), "grade_r": round(rg, 3), "naive_r": round(rn, 3),
                     "grade_beats_naive": bool(rg > rn),
                     "rmse_league_mean": round(rmse_mean, 2), "rmse_grade": round(rmse_grade, 2)}
        print(f"  {name}: grade r={rg:.3f} vs naive r={rn:.3f} "
              f"({'WINS' if rg > rn else 'loses'}) | RMSE league-mean {rmse_mean:.2f} vs grade {rmse_grade:.2f} (n={len(c)})")
    results["small_sample"] = reg

    RESULTS.mkdir(exist_ok=True)
    (RESULTS / "naive_tests.json").write_text(json.dumps(results, indent=1))
    print(f"\n-> results/naive_tests.json")


if __name__ == "__main__":
    main()
