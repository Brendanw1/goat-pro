"""The college location-independence check (standard L), verbatim, v1 vs v2.

    python location_check.py

vt_baseball research/stuff-model/evaluate.py `location_dependence()`, the
check as the college program defines it (their docstring: "|r| between the
pitcher's grade and where he actually threw. Near zero is the point of a
stuff model; a large value means location leaked back in"):

  - PITCHER level (the headline number): within one season, the pitcher's
    grade -- the MEAN raw prediction over his pitches, >= MIN_PITCHES (100)
    floor -- against his MEAN plate height, MEAN arm-mirrored plate side and
    MEAN edge distance; |Pearson r| across pitcher-seasons.
  - PER-PITCH supplement: pooled |r| of the raw prediction vs plate_z and
    plate_x_arm over every pitch of the season (no floor).

College documented numbers (D1, RESULTS.md standard L / GATE.md): A_noev
.007 pitcher-grade vs mean height (v5 .147, shipped v6 .112); per-pitch |r|
vs plate height/side <= .002.

Adaptations -- columns and nothing else (task spec):
  - identity: their PitcherKey -> our `pitcher` (MLBAM); their positional
    pred array -> the `{model}_pred` column season_grades() writes.
  - plate_x_arm: the task brief assumed we have none. We do --
    train_mlb._load_features has built it since the v1 port, arm side
    positive. The mirror negates RHP where the college SQL negates LHP
    (`case when PitcherThrows = 'Left' then -PlateLocSide else ...`) because
    Statcast plate_x is batter-view while TrackMan PlateLocSide is
    catcher-view; the semantics (positive = arm side) are identical, which is
    exactly why the port added it. Raw plate_x is reported alongside as
    `side_raw` for continuity with any unmirrored reading.
  - season: 2025 (validation) is the primary -- out-of-sample for both
    designs and free of the 2026 ABS plate-convention break (RESULTS-MLB 10).
    2026 is reported as a continuity row against RESULTS-MLB 5's v1 numbers,
    computed on the same raw (unreferenced) plate frame, so the v1-vs-v2
    comparison on it is fair.
  - grades are RAW mean predictions (evaluate.py `grades()` convention), not
    the shipped 100 +/- 10 grade: the frozen per-cell scale is affine per
    cell and cannot change any Pearson r (RESULTS-MLB preamble), and the raw
    mean is what their check aggregates.

VERDICT RULE (college GATE.md semantics): v2 (stuff_v2: + spin_eff
per-class-constrained, + velo_x_ivb) replaces v1 iff its check numbers are
NOT MATERIALLY WORSE than v1's, materiality = 0.01 (the GATE.md gate line
"no metric > 0.01 below" the reference design). v2 may pass even if both
designs exceed the D1 numbers, PROVIDED the D1-vs-MLB population difference
is documented -- on MLB the D1 absolutes are unreachable by ANY csw_norm
design because the target's shape->location-CHOICE coupling alone produces
0.2+ per-pitch within fastballs (RESULTS-MLB 5) -- but if v2 is materially
worse, v1 stays and spin_eff is dropped from features.

Output: results/location_check.json (+ this module's printed verdict).
"""

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from stuff_v2 import CLASS_MONO, FEATURES as V2_FEATURES  # noqa: E402
from train_mlb import (  # noqa: E402
    STUFF_FEATURES, frozen_scale, load_features, season_grades, train_boosters)

HERE = Path(__file__).resolve().parent
RESULTS = HERE / "results"
MIN_PITCHES = 100   # evaluate.py floor, verbatim
MATERIAL = 0.01     # GATE.md materiality bar ("no metric > 0.01 below")
CHECK_SEASONS = (2025, 2026)
D1_DOCUMENTED = {"pitcher_grade_vs_mean_height": {"A_noev": 0.007, "v5": 0.147, "v6": 0.112},
                 "per_pitch_max": 0.002}


def location_dependence(scored: pd.DataFrame, pred_col: str, season: int) -> dict:
    """evaluate.py location_dependence() verbatim, our column names."""
    d = scored[[pred_col, "pitcher", "season", "plate_z", "plate_x_arm", "plate_x"]] \
        .dropna(subset=[pred_col])          # they drop on the prediction only
    d = d[d.season == season]
    g = d.groupby("pitcher", observed=True).agg(
        grade=(pred_col, "mean"), n=(pred_col, "size"),
        z=("plate_z", "mean"), x=("plate_x_arm", "mean"), xr=("plate_x", "mean"))
    g = g[g.n >= MIN_PITCHES]
    per_pitch = {c: round(float(abs(d[pred_col].corr(d[c]))), 3)
                 for c in ("plate_z", "plate_x_arm", "plate_x")} if len(d) else {}
    return {"pitcher_grade_vs_mean_height": round(float(abs(g.grade.corr(g.z))), 3),
            "pitcher_grade_vs_mean_side": round(float(abs(g.grade.corr(g.x))), 3),
            "pitcher_grade_vs_mean_side_raw": round(float(abs(g.grade.corr(g.xr))), 3),
            "per_pitch": per_pitch, "n_pitchers": int(len(g)),
            "n_pitches": int(len(d))}


def _csw_target(df: pd.DataFrame) -> pd.DataFrame:
    """csw / E[CSW|count], E fitted on TRAIN only -- both designs' target."""
    e_csw = (df[df["train_season"] & (df["pa_taken"] == 1)]
             .groupby(["balls", "strikes"])["csw"].mean().rename("e_csw_count"))
    df = df.join(e_csw, on=["balls", "strikes"])
    df["csw_norm"] = np.where(df["pa_taken"] == 1, df["csw"] / df["e_csw_count"], np.nan)
    return df


def v1_design(df: pd.DataFrame):
    """v1: 11 A_noev features, csw_norm, monotone LightGBM (train_mlb.main()).
    Returns (prepared frame, boosters, refs, features)."""
    df = _csw_target(df)
    bst = train_boosters(df, STUFF_FEATURES, "csw_norm", mono=True)
    refs = frozen_scale(df, bst, STUFF_FEATURES, "csw_norm")
    return df, bst, refs, STUFF_FEATURES


def v2_design(df: pd.DataFrame):
    """v2: + spin_eff per-class monotone, + velo_x_ivb (stuff_v2.main(), verbatim:
    its training loop is not exposed as a function and this task's claim is
    location_check.py only, so the 8 lines are duplicated, not refactored)."""
    import lightgbm as lgb
    df = _csw_target(df)
    df["velo_x_ivb"] = df["velo"] * df["ivb"]
    train = df[df["train_season"] & df["csw_norm"].notna()]
    boosters = {}
    for pclass in ("FB", "BB", "CH"):
        constraints = [CLASS_MONO[pclass].get(f, 0) for f in V2_FEATURES]
        for side in ("R", "L"):
            key = f"{pclass}_vs_{'LHH' if side == 'L' else 'RHH'}"
            cell = train[(train["pclass"] == pclass) & (train["stand"] == side)]
            boosters[key] = lgb.LGBMRegressor(
                monotone_constraints=constraints, n_estimators=800, learning_rate=0.03,
                num_leaves=63, min_child_samples=100, subsample=0.8, subsample_freq=1,
                colsample_bytree=0.8, verbose=-1).fit(cell[V2_FEATURES], cell["csw_norm"])
            print(f"  {key}: {len(cell):,} rows")
    refs = frozen_scale(df, boosters, V2_FEATURES, "csw_norm")
    return df, boosters, refs, V2_FEATURES


def verdict(v1: dict, v2: dict, season: int) -> dict:
    """GATE.md semantics: v2 wins iff no check number is worse by > MATERIAL."""
    keys = [("pitcher-level height", "pitcher_grade_vs_mean_height"),
            ("pitcher-level side", "pitcher_grade_vs_mean_side"),
            ("per-pitch plate_z", ("per_pitch", "plate_z")),
            ("per-pitch plate_x_arm", ("per_pitch", "plate_x_arm"))]
    rows, worst = [], 0.0
    for label, k in keys:
        a = v1[k] if isinstance(k, str) else v1[k[0]][k[1]]
        b = v2[k] if isinstance(k, str) else v2[k[0]][k[1]]
        delta = round(b - a, 3)            # positive = v2 MORE location-dependent
        worst = max(worst, delta)
        rows.append({"metric": label, "v1": a, "v2": b, "v2_minus_v1": delta,
                     "materially_worse": bool(delta > MATERIAL)})
    win = worst <= MATERIAL
    return {"season": season, "bar": MATERIAL, "worst_v2_minus_v1": round(worst, 3),
            "metrics": rows,
            "verdict": ("v2 replaces v1" if win
                        else "v1 stays; spin_eff dropped from features (v2 materially worse)")}


def main() -> None:
    df = load_features()        # already carries add_physics (spin_eff) + plate_x_arm
    print(f"features loaded: {len(df):,} pitches")

    designs = {}
    for label, build in (("v1", v1_design), ("v2", v2_design)):
        print(f"training {label}...")
        dfd, bst, refs, feats = build(df)
        scored = pd.concat([season_grades(dfd[dfd["season"] == s], "stuff", bst, refs, feats)[1]
                            for s in CHECK_SEASONS])
        designs[label] = scored
        print(f"  {label} scored {len(scored):,} rows")

    out = {"definition": "vt_baseball evaluate.py location_dependence() verbatim",
           "min_pitches": MIN_PITCHES, "materiality_bar": MATERIAL,
           "d1_documented": D1_DOCUMENTED, "designs": {}, "verdicts": {}}
    for label, scored in designs.items():
        out["designs"][label] = {str(s): location_dependence(scored, "stuff_pred", s)
                                 for s in CHECK_SEASONS}
        for s in CHECK_SEASONS:
            print(f"{label} {s}: {json.dumps(out['designs'][label][str(s)])}")

    out["verdicts"]["2025"] = verdict(out["designs"]["v1"]["2025"],
                                      out["designs"]["v2"]["2025"], 2025)
    print(f"\nVERDICT (2025, GATE.md bar {MATERIAL}): {out['verdicts']['2025']['verdict']} "
          f"(worst v2-v1 = {out['verdicts']['2025']['worst_v2_minus_v1']:+.3f})")

    if out["verdicts"]["2025"]["verdict"].startswith("v2"):
        out["export_refresh"] = ("v2 won: the artifact refresh is deliberately NOT run by "
                                 "this check. bakeoff.export currently hard-bakes the v1 "
                                 "feature list (tm.STUFF_FEATURES + global MONO); wire "
                                 "stuff_v2's FEATURES/CLASS_MONO into it first, then the "
                                 "one-command refresh is `python pipeline/bakeoff.py export "
                                 "--target csw_norm` (plus the rv pitching leg it always runs)")
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / "location_check.json").write_text(json.dumps(out, indent=1))
    print(f"-> results/location_check.json")


if __name__ == "__main__":
    main()
