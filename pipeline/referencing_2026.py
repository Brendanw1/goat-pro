"""2026 plate-convention re-referencing: affine-map 2026 plate_x/plate_z onto
the 2023-25 reference so the frozen hvaa residualization and the plate features
stay valid across the ABS convention break (docs/savant-gap-map.md, CRITICAL).

Why: the 2026 Savant CSV changed conventions -- plate_x/plate_z measured from
middle-of-plate, sz_top/sz_bot ABS-defined. The mart confirms: zone height
(sz_top - sz_bot) drops 1.830 -> 1.593 ft (-13%), sz_top -0.22 ft, mean
plate_z -0.076 ft vs 2025, while 2024 -> 2025 was stable. No pitching
population moves its average plate_z 0.076 ft (0.9 in) in one offseason: the
CONVENTION moved, not the pitchers. train_mlb.py fits the hvaa residualization
on 2023-24 plate_z and its Pitching+ boosters consume plate_x/plate_z, so
scoring 2026 rows raw injects a systematic convention offset into every 2026
grade and every 2025->2026 gate.

Map: per-feature affine (slope, intercept) fit by least squares on p1..p99
quantile pairs -- 2026 quantiles matched onto 2025's, computed from the mart
over the SAME population as train_mlb.FEATURE_SQL (regular season, the model's
pitch types and release filters, non-null plate/size columns). Guard: a
feature whose fit has |slope-1| < 0.02 AND |intercept| < 0.02 maps to identity
and says so. The affine form ABSORBS the convention shift (level and spread)
onto the 2023-25 reference; it is deliberately not a physical model of ABS --
it just makes the frozen v1 features comparable again.

Application point: the correction must land BEFORE hvaa is computed (hvaa =
vaa - (intercept + slope*plate_z), per class fitted on TRAIN 2023-24) and
before any plate column reaches a booster. load_features_2026ref() wraps
train_mlb.load_features and repairs the already-derived 2026 columns EXACTLY:
vaa depends only on the nine trajectory parameters (untouched by the map), so
with the per-class train fit (s, i):

    hvaa_mapped = vaa - (i + s*plate_z_mapped)
                = hvaa_loaded + s*(plate_z_loaded - plate_z_mapped)

and refitting (s, i) on the untouched train rows of the loaded frame
reproduces train_mlb._load_features' coefficients (deterministic polyfit on
identical data). The wrapper is therefore exact against the cached feature
frame with NO edit to train_mlb.py (claimed scope: this file only).
plate_x_arm is recomputed from the mapped plate_x (a no-op outside 2026, where
the map is the identity). sz_top/sz_bot never enter the feature frame
(FEATURE_SQL does not select them); their maps are derived and REPORTED as
documentation of the convention break and for any future zone/framing
consumer, but nothing here consumes them.

Gates: run_gates() is train_mlb.main()'s gate suite verbatim (stuff per-pitch
r + plate_z leak, pitching per-pitch r, YoY pairs, grade-vs-naive
predictiveness on CSW%), minus the export write. It runs twice -- raw loader
(BEFORE) vs re-referenced loader (AFTER) -- and the 2026-involved pairs
(stuff+ YoY 25->26, predict-2026) are compared against the 2023->24 / 2024->25
baseline pairs. Pitching+ YoY pairs are added as a supplementary gate because
Pitching+ is the model that actually consumes the mapped columns.

Run:    python pipeline/referencing_2026.py          (~2-6 min; boosters cached)
Writes: pipeline/results/referencing_2026.json
"""

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

PIPE = Path(__file__).resolve().parent
sys.path.insert(0, str(PIPE))
sys.path.insert(0, "/Users/brendanwaterval/Projects/vt_baseball/savant_mart")
import mart  # noqa: E402
import train_mlb  # noqa: E402

RESULTS = PIPE / "results" / "referencing_2026.json"
AFFINE_COLS = ("plate_x", "plate_z", "sz_top", "sz_bot")
GUARD = 0.02          # |slope-1| and |intercept| below this -> identity map
REF_SEASON = 2025     # quantile reference (stable 2024->25, pre-convention-break)
MAP_SEASON = 2026
PCLASSES = ("FB", "BB", "CH")


# ---------------------------------------------------------------- affine map

def _mart_where(year: int) -> str:
    """train_mlb.FEATURE_SQL's WHERE, season-scoped, + non-null location cols."""
    where = (train_mlb.FEATURE_SQL.split("WHERE", 1)[1]
             .split("ORDER BY", 1)[0]
             .replace("{lo}", str(year)).replace("{hi}", str(year)))
    return (where + " AND plate_x IS NOT NULL AND plate_z IS NOT NULL "
            "AND sz_top IS NOT NULL AND sz_bot IS NOT NULL")


def derive_affine() -> tuple[dict, dict]:
    """Quantile-match MAP_SEASON onto REF_SEASON per feature; p1..p99, OLS."""
    con = mart.connect()
    ref = con.sql(f"SELECT {', '.join(AFFINE_COLS)} FROM pitches "
                  f"WHERE {_mart_where(REF_SEASON)}").df()
    new = con.sql(f"SELECT {', '.join(AFFINE_COLS)} FROM pitches "
                  f"WHERE {_mart_where(MAP_SEASON)}").df()
    ps = np.arange(1, 100)
    params, audit = {}, {c: {} for c in AFFINE_COLS}
    for col in AFFINE_COLS:
        q_ref = np.percentile(ref[col].to_numpy(), ps)
        q_new = np.percentile(new[col].to_numpy(), ps)
        slope, intercept = (float(v) for v in np.polyfit(q_new, q_ref, 1))
        identity = abs(slope - 1.0) < GUARD and abs(intercept) < GUARD
        if identity:
            slope, intercept = 1.0, 0.0
        params[col] = {
            "slope": slope, "intercept": intercept, "identity": identity,
            "fit_slope": (1.0 if identity else slope),  # fit_slope/fit_intercept
            "fit_intercept": (0.0 if identity else intercept),  # pre-guard values
            "max_abs_quantile_residual": float(
                np.abs(q_ref - (slope * q_new + intercept)).max()),
            "n_ref": int(len(ref)), "n_map": int(len(new)),
        }
    for year in (2024, REF_SEASON, MAP_SEASON):
        row = con.sql("SELECT "
                      + ", ".join(f"avg({c}) AS {c}_m, stddev_samp({c}) AS {c}_s"
                                  for c in AFFINE_COLS)
                      + f" FROM pitches WHERE {_mart_where(year)}").df().iloc[0]
        for col in AFFINE_COLS:
            audit[col][str(year)] = {"mean": float(row[f"{col}_m"]),
                                     "sd": float(row[f"{col}_s"])}
    return params, audit


# ------------------------------------------------------- patched feature path

def apply_2026_reference(df: pd.DataFrame, params: dict) -> tuple[pd.DataFrame, dict]:
    """Map season-2026 rows of a loaded feature frame onto the 2023-25
    reference: plate_x/plate_z affine, plate_x_arm recomputed, hvaa repaired
    exactly (see module docstring). All other rows are untouched."""
    df = df.copy()
    m = df["season"] == MAP_SEASON
    px_new = params["plate_x"]["slope"] * df["plate_x"] + params["plate_x"]["intercept"]
    pz_new = params["plate_z"]["slope"] * df["plate_z"] + params["plate_z"]["intercept"]
    px_new[~m] = df["plate_x"]          # the map only ever touches 2026 rows
    pz_new[~m] = df["plate_z"]
    pz_shift = df["plate_z"] - pz_new   # raw minus mapped; hvaa' = hvaa + s*pz_shift
    hvaa_raw = df["hvaa"].copy()        # full-length copy of the loaded hvaa
    pz_raw, px_raw = df.loc[m, "plate_z"].copy(), df.loc[m, "plate_x"].copy()
    df["plate_x"] = px_new
    df["plate_z"] = pz_new
    df["plate_x_arm"] = px_new * np.where(df["p_throws"] == "L", 1.0, -1.0)
    # exact hvaa repair: refit the per-class line on untouched TRAIN rows, then
    # add s * (plate_z_raw - plate_z_mapped) to the 2026 class rows
    train_mask = df["season"].isin(train_mlb.TRAIN_SEASONS)
    fits = {}
    for pc in PCLASSES:
        tm = train_mask & (df["pclass"] == pc)
        slope, intercept = np.polyfit(df.loc[tm, "plate_z"], df.loc[tm, "vaa"], 1)
        fits[pc] = {"slope": float(slope), "intercept": float(intercept)}
        cm = m & (df["pclass"] == pc)
        df.loc[cm, "hvaa"] = hvaa_raw[cm] + slope * pz_shift[cm]
    # validation: mapped 2026 hvaa should sit at the 2025 level per class and
    # stay near-orthogonal to mapped plate_z within class (as on TRAIN)
    fb26 = m & (df["pclass"] == "FB")
    val = {
        "hvaa_fits_train": fits,
        "hvaa_mean_by_class": {
            pc: {"2025": float(df.loc[(df["season"] == REF_SEASON)
                                      & (df["pclass"] == pc), "hvaa"].mean()),
                 "2026_before": float(hvaa_raw[m & (df["pclass"] == pc)].mean()),
                 "2026_after": float(df.loc[m & (df["pclass"] == pc), "hvaa"].mean())}
            for pc in PCLASSES},
        "corr_hvaa_plate_z_2026_within_FB_after": float(
            df.loc[fb26, ["hvaa", "plate_z"]].corr().iloc[0, 1]),
        "plate_z_2026": {"mean_before": float(pz_raw.mean()),
                         "mean_after": float(df.loc[m, "plate_z"].mean()),
                         "sd_before": float(pz_raw.std()),
                         "sd_after": float(df.loc[m, "plate_z"].std())},
        "plate_x_2026": {"mean_before": float(px_raw.mean()),
                         "mean_after": float(df.loc[m, "plate_x"].mean())},
        "n_2026_rows": int(m.sum()),
    }
    return df, val


def load_features_2026ref(params: dict) -> pd.DataFrame:
    """train_mlb.load_features() with season-2026 rows re-referenced."""
    df, val = apply_2026_reference(train_mlb.load_features(), params)
    load_features_2026ref.validation = val
    return df


# ------------------------------------------------------------------- gates

def run_gates(df: pd.DataFrame, label: str) -> dict:
    """train_mlb.main()'s training + gate suite verbatim, minus the export."""
    print(f"\n=== gates [{label}] ===")
    e_csw = (df[df["train_season"] & (df["pa_taken"] == 1)]
             .groupby(["balls", "strikes"])["csw"].mean().rename("e_csw_count"))
    df = df.join(e_csw, on=["balls", "strikes"])
    df["csw_norm"] = np.where(df["pa_taken"] == 1, df["csw"] / df["e_csw_count"], np.nan)

    stuff_bst = train_mlb.train_boosters(df, train_mlb.STUFF_FEATURES, "csw_norm", mono=True)
    stuff_refs = train_mlb.frozen_scale(df, stuff_bst, train_mlb.STUFF_FEATURES, "csw_norm")
    pitch_bst = train_mlb.train_boosters(df, train_mlb.LOC_FEATURES, "rv", mono=False)
    pitch_refs = train_mlb.frozen_scale(df, pitch_bst, train_mlb.LOC_FEATURES, "rv")

    rows, pitch_rows, scored_stuff, scored_pitch = [], [], [], []
    for season in train_mlb.GRADE_SEASONS:
        sdf = df[df["season"] == season]
        s_rows, s_scored = train_mlb.season_grades(sdf, "stuff", stuff_bst,
                                                   stuff_refs, train_mlb.STUFF_FEATURES)
        p_rows, p_scored = train_mlb.season_grades(sdf, "pitch", pitch_bst,
                                                   pitch_refs, train_mlb.LOC_FEATURES)
        rows += s_rows
        pitch_rows += p_rows
        scored_stuff.append(s_scored)
        scored_pitch.append(p_scored)
    scored_stuff = pd.concat(scored_stuff)
    scored_pitch = pd.concat(scored_pitch)

    out = {"stuff": {}, "pitching": {}}
    sub = scored_stuff[["stuff_pred", "csw", "plate_z"]].dropna()
    out["stuff"]["per_pitch_r_vs_csw"] = float(
        np.corrcoef(sub["stuff_pred"], sub["csw"])[0, 1])
    out["stuff"]["per_pitch_absr_vs_plate_z"] = float(abs(
        np.corrcoef(sub["stuff_pred"], sub["plate_z"])[0, 1]))
    subp = scored_pitch[["pitch_pred", "rv"]].dropna()
    out["pitching"]["per_pitch_r_vs_rv"] = float(
        np.corrcoef(subp["pitch_pred"], subp["rv"])[0, 1])
    print(f"GATE stuff: per-pitch r={out['stuff']['per_pitch_r_vs_csw']:.3f}, "
          f"|r vs plate_z|={out['stuff']['per_pitch_absr_vs_plate_z']:.3f}")
    print(f"GATE pitching: per-pitch r={out['pitching']['per_pitch_r_vs_rv']:.3f}")

    for model, gate_rows in (("stuff", rows), ("pitching", pitch_rows)):
        gw = pd.DataFrame([{"mlbam": r["mlbam"], "season": r["season"],
                            "grade": r["grade"]} for r in gate_rows])
        wide = gw.pivot_table(index="mlbam", columns="season", values="grade")
        yoy = {}
        for a, b in ((2023, 2024), (2024, 2025), (2025, 2026)):
            pair = wide[[a, b]].dropna()
            if len(pair) >= 30:
                yoy[f"{a}->{b}"] = {"r": float(np.corrcoef(pair[a], pair[b])[0, 1]),
                                    "n": int(len(pair))}
                print(f"GATE {model}+ YoY {a}->{b}: r={yoy[f'{a}->{b}']['r']:.3f} (n={len(pair)})")
        out[model]["yoy"] = yoy
        if model == "stuff":
            actual = (df[df["pa_taken"] == 1].groupby(["pitcher", "season"])
                      .apply(lambda s: 100 * s["csw"].sum() / max(1, len(s)),
                             include_groups=False).rename("csw_pct").reset_index())
            aw = actual.pivot_table(index="pitcher", columns="season", values="csw_pct")
            pred = {}
            for a, b in ((2023, 2024), (2024, 2025), (2025, 2026)):
                have = pd.DataFrame({"grade": wide[a], "actual_next": aw[b],
                                     "actual_prior": aw[a]}).dropna()
                pred[str(b)] = {
                    "grade_r": float(np.corrcoef(have["grade"], have["actual_next"])[0, 1]),
                    "naive_r": float(np.corrcoef(have["actual_prior"], have["actual_next"])[0, 1]),
                    "n": int(len(have))}
                print(f"GATE predict {b} CSW%: grade {a} r={pred[str(b)]['grade_r']:.3f} "
                      f"vs naive persistence r={pred[str(b)]['naive_r']:.3f} (n={len(have)})")
            out["stuff"]["predict_vs_naive"] = pred
    # 2026 stuff+ grades themselves (before/after comparison in main())
    out["_rows_2026_stuff"] = [{"mlbam": r["mlbam"], "name": r["name"],
                                "grade": r["grade"], "pitches": r["pitches_graded"]}
                               for r in rows if r["season"] == MAP_SEASON]
    return out


def _baseline(yoy: dict) -> float:
    """Mean of the two baseline pairs (23->24, 24->25) of a YoY dict."""
    return float(np.mean([yoy["2023->2024"]["r"], yoy["2024->2025"]["r"]]))


# -------------------------------------------------------------------- main

def main() -> None:
    params, audit = derive_affine()
    print("2026 -> 2025 affine maps (mart quantile match p1..p99, OLS):")
    for col, p in params.items():
        tag = ("IDENTITY (guard: |slope-1|<0.02 and |intercept|<0.02)"
               if p["identity"] else "applied")
        print(f"  {col:8s} slope={p['slope']:.4f} intercept={p['intercept']:+.4f} "
              f"max|q-resid|={p['max_abs_quantile_residual']:.4f} ft  -> {tag}")
    print("season means (ft): " + " | ".join(
        f"{col}: " + ", ".join(f"{y} {audit[col][y]['mean']:.3f}"
                               for y in ("2024", "2025", "2026"))
        for col in AFFINE_COLS))

    print("\nloading features (cached) ...")
    df_before = train_mlb.load_features()
    gates_before = run_gates(df_before, "BEFORE raw 2026")
    del df_before
    df_after, val = apply_2026_reference(train_mlb.load_features(), params)
    gates_after = run_gates(df_after, "AFTER re-referenced 2026")
    del df_after

    yoy_b, yoy_a = gates_before["stuff"]["yoy"], gates_after["stuff"]["yoy"]
    prd_b, prd_a = (gates_before["stuff"]["predict_vs_naive"],
                    gates_after["stuff"]["predict_vs_naive"])
    pit_b = gates_before["pitching"]["yoy"]
    pit_a = gates_after["pitching"]["yoy"]

    # pitcher-level 2026 grade movement (materiality of the map on the artifact)
    gb = {r["mlbam"]: r for r in gates_before.pop("_rows_2026_stuff")}
    ga = {r["mlbam"]: r for r in gates_after.pop("_rows_2026_stuff")}
    common = sorted(set(gb) & set(ga))
    d = np.array([ga[k]["grade"] - gb[k]["grade"] for k in common])
    grade_delta = {
        "n_pitchers_2026": len(common),
        "r_grade_before_vs_after": float(np.corrcoef([gb[k]["grade"] for k in common],
                                                     [ga[k]["grade"] for k in common])[0, 1]),
        "mean_abs_delta": float(np.abs(d).mean()),
        "p90_abs_delta": float(np.percentile(np.abs(d), 90)),
        "max_abs_delta": float(np.abs(d).max()),
        "n_moved_gt5pts": int((np.abs(d) > 5).sum()),
        "mean_grade_before": float(np.mean([gb[k]["grade"] for k in common])),
        "mean_grade_after": float(np.mean([ga[k]["grade"] for k in common])),
        "top_movers": [{"name": gb[k]["name"], "before": gb[k]["grade"],
                        "after": ga[k]["grade"], "delta": round(ga[k]["grade"] - gb[k]["grade"], 1)}
                       for k in sorted(common, key=lambda k: abs(ga[k]["grade"] - gb[k]["grade"]),
                                       reverse=True)[:5]],
    }

    verdict = {
        "stuff_yoy_25_26": {
            "before": yoy_b["2025->2026"], "after": yoy_a["2025->2026"],
            "baseline_mean_before": _baseline(yoy_b), "baseline_mean_after": _baseline(yoy_a),
            "moved_toward_baseline": bool(
                abs(yoy_a["2025->2026"]["r"] - _baseline(yoy_a))
                < abs(yoy_b["2025->2026"]["r"] - _baseline(yoy_b))),
        },
        "pitching_yoy_25_26_supplementary": {
            "before": pit_b["2025->2026"], "after": pit_a["2025->2026"],
            "baseline_mean_before": _baseline(pit_b), "baseline_mean_after": _baseline(pit_a),
            "moved_toward_baseline": bool(
                abs(pit_a["2025->2026"]["r"] - _baseline(pit_a))
                < abs(pit_b["2025->2026"]["r"] - _baseline(pit_b))),
        },
        "predict_2026_csw": {
            "before": prd_b["2026"], "after": prd_a["2026"],
            "baseline_grade_r_mean_before": float(np.mean([prd_b["2024"]["grade_r"],
                                                           prd_b["2025"]["grade_r"]])),
            "baseline_naive_r_mean": float(np.mean([prd_b["2024"]["naive_r"],
                                                    prd_b["2025"]["naive_r"]])),
            "invariant_by_construction": True,
            "why": ("the predict-2026 predictor is the 2025 grade (wide[2025]); the map "
                    "touches 2026 features only, so this gate cannot move. The convention "
                    "break's exposure is in the 2026 GRADES (YoY 25->26, per-pitch stats), "
                    "not in 2025-grade -> 2026-outcome forecasting."),
        },
        "grade_delta_2026": grade_delta,
    }

    print("\n=== verdict ===")
    print(f"stuff+ YoY 25->26: {yoy_b['2025->2026']['r']:.3f} -> {yoy_a['2025->2026']['r']:.3f} "
          f"(baseline pairs mean {_baseline(yoy_b):.3f} / {_baseline(yoy_a):.3f}) "
          f"moved toward baseline: {verdict['stuff_yoy_25_26']['moved_toward_baseline']}")
    print(f"pitching+ YoY 25->26 (supplementary): {pit_b['2025->2026']['r']:.3f} -> "
          f"{pit_a['2025->2026']['r']:.3f} (baseline {_baseline(pit_b):.3f} / "
          f"{_baseline(pit_a):.3f}) moved toward baseline: "
          f"{verdict['pitching_yoy_25_26_supplementary']['moved_toward_baseline']}")
    print(f"predict 2026 CSW%: grade r {prd_b['2026']['grade_r']:.3f} -> "
          f"{prd_a['2026']['grade_r']:.3f} (naive {prd_b['2026']['naive_r']:.3f}); "
          f"gap vs naive {prd_b['2026']['grade_r'] - prd_b['2026']['naive_r']:+.3f} -> "
          f"{prd_a['2026']['grade_r'] - prd_a['2026']['naive_r']:+.3f}")
    print("hvaa mean (FB): "
          f"2025 {val['hvaa_mean_by_class']['FB']['2025']:.3f}, "
          f"2026 before {val['hvaa_mean_by_class']['FB']['2026_before']:.3f} -> "
          f"after {val['hvaa_mean_by_class']['FB']['2026_after']:.3f}")
    print(f"2026 stuff+ grades: r(before, after)={grade_delta['r_grade_before_vs_after']:.4f}, "
          f"mean |delta|={grade_delta['mean_abs_delta']:.2f} pts, "
          f"p90={grade_delta['p90_abs_delta']:.2f}, max={grade_delta['max_abs_delta']:.2f}, "
          f"moved >5 pts: {grade_delta['n_moved_gt5pts']}/{grade_delta['n_pitchers_2026']}")

    RESULTS.parent.mkdir(exist_ok=True)
    RESULTS.write_text(json.dumps({
        "params": params, "audit_means": audit, "validation": val,
        "gates_before": gates_before, "gates_after": gates_after,
        "verdict": verdict,
    }, indent=1))
    print(f"\nwrote {RESULTS}")


if __name__ == "__main__":
    main()
