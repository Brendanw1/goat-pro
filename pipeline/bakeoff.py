"""Target bake-off for the GOAT-Pro Stuff+ target on MLB Statcast (Task 2).

Runs the college §14 experiment (research/stuff-model RESULTS.md) on MLB data:
same A_noev feature shape, same learner and architecture, four targets, every
variant judged with the college statistics -- stickiness (YoY r of the season
grade), reliability (split-half r at fixed pitch counts), predictiveness (season
N grade vs N+1 CSW%, whiff%, K/PA, RV/100 against the naive persistence baseline
with a PAIRED pitcher bootstrap) and location-independence (evaluate.py's check,
verbatim). Per-pitch fit is reported but CANNOT rank across targets: log loss is
in different units for different binaries and RMSE for rv is not comparable to
either, which is exactly why the college work ranks on 5-7.

Targets (all count baselines fitted on TRAIN seasons only, 2023-24):
  csw_norm   csw / E[CSW | count]                     -- the incumbent (v1)
  whiff_norm whiff / E[whiff | count]  (whiff incl. blocked, every pitch)
  rv         raw per-pitch run value (-delta_run_exp) -- FanGraphs/tjStuff+ style
  rv_cnorm   rv - E[rv | count] (difference, not ratio: rv is signed)

Row sets are each target's natural ones, as in the college bake-off: csw_norm is
undefined on balls in play (the v1 convention, kept), the others are defined on
every pitch. Grades are scored on every pitch either way, so pitcher cohorts
differ only marginally; the paired bootstrap intersects them exactly.

STATISTICS ARE COMPUTED ON RAW MEAN PREDICTIONS per pitcher-season
(evaluate.py's grades(), 100+ pitches), not on the 100-centered cell scale: the
frozen per-cell scale is affine per cell and cannot change any Pearson r, while
the pitch-weighted cell-z average is a DIFFERENT grade construction. The
college standard is the raw mean; the export uses the cell scale. Season grades
for 2023-24 are IN-SAMPLE (the fit saw them); the college work had out-of-fold
predictions there, which this budget does not. 2025->2026 is the clean pair and
the verdict leans on it; in-sample pairs are reported for completeness and
flagged. Monotone velo +1 / ext +1, per class x batter side, MIN_ROWS=3000
pooled fallback, frozen per-cell 100-centred scale -- all as train_mlb.py.

Location-independence (the open problem) is diagnosed with evaluate.py's check
verbatim PLUS a decomposition of the gap to our earlier per-pitch pooled number
(0.138): their headline is PITCHER-level (grade vs MEAN plate height/side, 100+
pitch floor, both plate axes); the v1 gate printed the per-pitch pooled |r| of
prediction vs plate_z only, with no pitcher floor and no horizontal axis.

Usage:
    python bakeoff.py bake [--with-physics]   # all four targets + report
    python bakeoff.py export --target NAME    # winning design -> export JSON
"""

import argparse
import json
import time
from pathlib import Path

import numpy as np
import pandas as pd

import train_mlb as tm
import physics

HERE = Path(__file__).resolve().parent
RESULTS = HERE / "results"
MODELS = HERE / "models"
EXPORT = HERE.parent / "data" / "export"

MIN_PITCHES = 100          # evaluate.py grades() floor per pitcher-season
STICK_MIN = 30             # task: stickiness pairs need n >= 30 pitchers
PAIRS = ((2023, 2024), (2024, 2025), (2025, 2026))
PRED_PAIRS = ((2023, 2024), (2024, 2025), (2025, 2026))
GRID = [25, 50, 100, 200, 400, 800, 1600]   # evaluate.py reliability grid
REPORT_GRID = [25, 50, 100, 400]
BOOT = 2000
SEED = 13
METRICS = ("csw", "whiff", "k_pa", "rv100")
PHYS_FEATURES = ["spin_eff", "mag_ivb", "mag_hb", "mag_break", "a_drag"]

TARGET_DEFS = {
    "csw_norm": "csw / E[CSW|count], E from train (v1 incumbent; NaN on BIP)",
    "whiff_norm": "whiff (incl. blocked) / E[whiff|count], E from train over all pitches",
    "rv": "raw per-pitch run value (-delta_run_exp)",
    "rv_cnorm": "rv - E[rv|count], E from train (difference: rv is signed)",
}


# ---------------------------------------------------------------- targets ---
def build_targets(df):
    """Attach all four targets and their train-only count baselines."""
    tr = df["train_season"]
    e_csw = (df[tr].groupby(["balls", "strikes"])["csw"].mean()
             .rename("e_csw_count"))
    df = df.join(e_csw, on=["balls", "strikes"])
    tak = df["pa_taken"] == 1
    df["csw_norm"] = np.where(tak, df["csw"] / df["e_csw_count"], np.nan)
    e_whiff = (df[tr].groupby(["balls", "strikes"])["whiff"].mean()
               .rename("e_whiff_count"))
    df = df.join(e_whiff, on=["balls", "strikes"])
    df["whiff_norm"] = df["whiff"] / df["e_whiff_count"]
    e_rv = (df[tr].groupby(["balls", "strikes"])["rv"].mean()
            .rename("e_rv_count"))
    df = df.join(e_rv, on=["balls", "strikes"])
    df["rv_cnorm"] = df["rv"] - df["e_rv_count"]
    return df


# ------------------------------------------------------------ outcomes -----
def outcomes(df):
    """One row per (pitcher, season): ACTUAL outcomes over ALL his pitches.
    College rule: outcomes never come off the model's own rows or row subset."""
    g = df.groupby(["pitcher", "season"]).agg(
        pitches=("rv", "size"), csw=("csw", "mean"), whiffs=("whiff", "sum"),
        swings=("swing", "sum"), k=("is_k", "sum"), pa=("pa_end", "sum"),
        rv=("rv", "mean"))
    g["whiff"] = g["whiffs"] / g["swings"].replace(0, np.nan)
    g["k_pa"] = g["k"] / g["pa"].replace(0, np.nan)
    g["rv100"] = g["rv"] * 100
    return g[["pitches", "csw", "whiff", "k_pa", "rv100"]].reset_index()


# -------------------------------------------------------------- grades -----
def raw_grades(scored, model, outs):
    """evaluate.py grades(): mean prediction per pitcher-season, 100+ pitches,
    joined to actual outcomes (which never share the model's row subset)."""
    d = scored[[f"{model}_pred", "pitcher", "season"]].dropna()
    g = (d.groupby(["pitcher", "season"])
         .agg(grade=(f"{model}_pred", "mean"), n=(f"{model}_pred", "size"))
         .reset_index())
    g = g[g["n"] >= MIN_PITCHES]
    return g.merge(outs, on=["pitcher", "season"], how="left")


def _join(g, a, b):
    return (g[g.season == a].set_index("pitcher")
            .join(g[g.season == b].set_index("pitcher"), lsuffix="_a",
                  rsuffix="_b", how="inner"))


def stickiness(g):
    out = {}
    for a, b in PAIRS:
        j = _join(g, a, b)
        if len(j) >= STICK_MIN:
            out[f"{a}-{b}"] = {"r": round(float(j.grade_a.corr(j.grade_b)), 3),
                               "n": int(len(j)),
                               "in_sample_fit": a <= 2024}
    return out


def reliability(scored, model, season=2026):
    """evaluate.py reliability() verbatim: two disjoint random halves of n
    pitches each, no Spearman-Brown correction; the number read off IS the
    reliability of an n-pitch sample."""
    d = scored[[f"{model}_pred", "pitcher", "season"]].dropna()
    d = d[d.season == season]
    rng = np.random.default_rng(11)
    d = d.assign(u=rng.random(len(d))).sort_values(["pitcher", "u"])
    d["rk"] = d.groupby("pitcher", observed=True).cumcount()
    tot = d.groupby("pitcher", observed=True).size()
    out = {}
    for n in GRID:
        keys = tot[tot >= 2 * n].index
        if len(keys) < 30:
            continue
        s = d[d.pitcher.isin(keys) & (d.rk < 2 * n)]
        h = s.assign(half=(s.rk >= n).astype(int)).groupby(
            ["pitcher", "half"], observed=True)[f"{model}_pred"].mean().unstack()
        out[n] = round(float(h[0].corr(h[1])), 3)
    for thr in (0.5, 0.7):
        hit = [n for n, r in out.items() if isinstance(n, int) and r >= thr]
        out[f"stabilize_r{thr}"] = min(hit) if hit else None
    return out


def location_dependence(scored, model, season=2026):
    """evaluate.py location_dependence() verbatim: |r| between the pitcher's
    grade and where he actually threw, plus the per-pitch supplement."""
    d = scored[[f"{model}_pred", "pitcher", "season", "plate_z", "plate_x_arm"]].dropna()
    d = d[d.season == season]
    g = d.groupby("pitcher", observed=True).agg(
        grade=(f"{model}_pred", "mean"), n=(f"{model}_pred", "size"),
        z=("plate_z", "mean"), x=("plate_x_arm", "mean"),
        edge=("plate_x_arm", lambda s: s.abs().mean()))
    g = g[g.n >= MIN_PITCHES]
    per_pitch = {c: round(float(abs(d[f"{model}_pred"].corr(d[c]))), 3)
                 for c in ("plate_z", "plate_x_arm")} if len(d) else {}
    return {"pitcher_grade_vs_mean_height": round(float(abs(g.grade.corr(g.z))), 3),
            "pitcher_grade_vs_mean_side": round(float(abs(g.grade.corr(g.x))), 3),
            "pitcher_grade_vs_mean_edge": round(float(abs(g.grade.corr(g.edge))), 3),
            "per_pitch": per_pitch, "n_pitchers": int(len(g))}


def per_pitch_fit(scored, model, target):
    """Per-pitch fit, un-normalised back to one common scale per family:
    csw_norm/whiff_norm -> log loss on their binary via pred x E[outcome|count];
    rv/rv_cnorm -> RMSE on raw rv. Not comparable ACROSS families (college
    rule: log loss/RMSE rank only within one target)."""
    rows = {}
    cols = [f"{model}_pred", "season"]
    if target in ("csw_norm", "whiff_norm"):
        ecol = "e_csw_count" if target == "csw_norm" else "e_whiff_count"
        ycol = "csw" if target == "csw_norm" else "whiff"
        d = scored[cols + [ecol, ycol]].dropna()
    else:
        d = scored[cols + ["rv"]].dropna()
    for season in (2025, 2026):
        s = d[d.season == season]
        if target in ("csw_norm", "whiff_norm"):
            p = np.clip((s[f"{model}_pred"] * s[ecol]).to_numpy(float), 1e-6, 1 - 1e-6)
            y = s[ycol].to_numpy(float)
            rows[season] = {"log_loss": round(float(-(y * np.log(p)
                                + (1 - y) * np.log(1 - p)).mean()), 5),
                            "n": int(len(s))}
        else:
            r = s["rv"].to_numpy(float) - s[f"{model}_pred"].to_numpy(float)
            rows[season] = {"rmse": round(float(np.sqrt((r ** 2).mean())), 5),
                            "n": int(len(s))}
    return rows


# ---------------------------------------------------------- bootstrap ------
def paired_bootstrap(grades_by_variant, outs):
    """College grade_corr_ci: for each (pair, metric), resample the SAME
    pitchers for every design (one set of indices, reused), 95% interval on the
    grade->next-season r and on |r| - |r_naive|. Beats naive iff the lower
    bound of the magnitude difference is > 0. Also the pairwise |r| difference
    between variants on the shared draws."""
    out = {}
    for a, b in PRED_PAIRS:
        joined = {}
        for variant, g in grades_by_variant.items():
            j = _join(g, a, b)
            joined[variant] = j
        common = None
        for variant, j in joined.items():
            have = set(j.index)
            common = have if common is None else (common & have)
        common = sorted(common)
        if len(common) < 30:
            continue
        rng = np.random.default_rng(SEED)
        idxs = [rng.integers(0, len(common), len(common)) for _ in range(BOOT)]
        for metric in METRICS:
            key = f"{a}->{b}"
            top = out.setdefault(key, {"n": len(common)})
            top.setdefault("_pairwise", {}).setdefault(metric, {})
            slot = top.setdefault(metric, {})
            draws_all = {}
            for variant, j in joined.items():
                v = j.loc[common]
                need = ["grade_a", f"{metric}_a", f"{metric}_b"]
                v = v.dropna(subset=need)
                if len(v) < 30:
                    continue
                gade = v.grade_a.to_numpy()
                nxt = v[f"{metric}_b"].to_numpy()
                now = v[f"{metric}_a"].to_numpy()
                # keep the bootstrap paired: every variant scored on the same
                # resampled pitcher INDICES of the common list
                keep = np.array([i for i, p in enumerate(common) if p in v.index])
                draws = np.array([np.corrcoef(gade[keep][i], nxt[keep][i])[0, 1]
                                  for i in idxs])
                nvd = np.array([np.corrcoef(now[keep][i], nxt[keep][i])[0, 1]
                                for i in idxs])
                draws_all[variant] = np.abs(draws)
                slot[variant] = {
                    "r": round(float(np.corrcoef(gade, nxt)[0, 1]), 3),
                    "ci": [round(float(x), 3) for x in np.percentile(draws, [2.5, 97.5])],
                    "naive_r": round(float(np.corrcoef(now, nxt)[0, 1]), 3),
                    "vs_naive": round(float(abs(np.corrcoef(gade, nxt)[0, 1])
                                            - abs(np.corrcoef(now, nxt)[0, 1])), 3),
                    "vs_naive_ci": [round(float(x), 3) for x in
                                    np.percentile(np.abs(draws) - np.abs(nvd), [2.5, 97.5])],
                    "beats_naive": bool(np.percentile(np.abs(draws) - np.abs(nvd),
                                                      2.5) > 0)}
            labels = list(draws_all)
            for i in range(len(labels)):
                for k in range(i + 1, len(labels)):
                    d = draws_all[labels[i]] - draws_all[labels[k]]
                    lo, hi = np.percentile(d, [2.5, 97.5])
                    top["_pairwise"][metric][f"{labels[i]}-{labels[k]}"] = {
                        "mean": round(float(d.mean()), 4),
                        "ci": [round(float(lo), 4), round(float(hi), 4)],
                        "significant": bool(lo > 0 or hi < 0)}
    return out


# ------------------------------------------------ location diagnosis -------
def location_diagnosis(scored, model, features, refs):
    """Why our per-pitch pooled leak (0.138) differs from the college check.
    Their check never computes what the v1 gate printed: it is PITCHER-level
    (grade vs mean plate height/side, 100+ pitches, both axes) with a per-pitch
    supplement. Decompose the per-pitch pooled number into cell structure and
    within-cell signal, and attribute the within-cell part to features."""
    d = scored[[f"{model}_pred", "pitcher", "season", "pclass", "stand",
                "plate_z", "plate_x_arm", "csw"] + features].dropna(
        subset=[f"{model}_pred", "plate_z"])
    out = {"note": "college check = pitcher-level grade vs mean height/side; "
                   "v1 gate = per-pitch pooled |r| vs plate_z, no floor, no side"}
    out["verbatim_2026"] = location_dependence(scored, model, 2026)
    out["verbatim_2025"] = location_dependence(scored, model, 2025)
    out["per_pitch_pooled_all_seasons"] = round(
        float(abs(d[f"{model}_pred"].corr(d["plate_z"]))), 3)
    cells = d.groupby(["pclass", "stand"], observed=True)
    out["per_pitch_within_cell"] = {
        f"{a}_vs_{b}": round(float(abs(g[f"{model}_pred"].corr(g["plate_z"]))), 3)
        for (a, b), g in cells if len(g) > 1000}
    cm = d[f"{model}_pred"] - cells[f"{model}_pred"].transform("mean")
    out["per_pitch_cellmean_removed"] = round(float(abs(cm.corr(d["plate_z"]))), 3)
    fb = d[(d.pclass == "FB") & (d.stand == "R")]
    out["feature_vs_plate_z_FB_vs_RHH"] = {
        f: round(float(abs(fb[f].corr(fb["plate_z"]))), 3)
        for f in features + [f"{model}_pred", "csw"]}
    out["target_vs_plate_z_pooled"] = round(float(abs(d["csw"].corr(d["plate_z"]))), 3)
    return out


# ------------------------------------------------------------- one run -----
def run_variant(df, target, features, grade_seasons=tm.GRADE_SEASONS):
    t0 = time.time()
    print(f"\n==== {target} ({len(features)} features) ====")
    bst = tm.train_boosters(df, features, target, mono=True)
    refs = tm.frozen_scale(df, bst, features, target)
    scored, rows = [], []
    for season in grade_seasons:
        sdf = df[df.season == season]
        g, s = tm.season_grades(sdf, target, bst, refs, features)
        rows += g
        scored.append(s)
    scored = pd.concat(scored, ignore_index=True)
    slim = scored[[f"{target}_pred", "pitcher", "season", "pclass", "stand",
                   "plate_z", "plate_x_arm", "csw", "whiff", "rv", "is_k",
                   "pa_taken"]].copy()
    print(f"  fit+score {time.time() - t0:.0f}s")
    return {"boosters": bst, "refs": refs, "rows": rows, "scored": scored,
            "slim": slim}


# ------------------------------------------------------------------ bake ---
def bake(with_physics=False):
    RESULTS.mkdir(exist_ok=True)
    t0 = time.time()
    df = tm.load_features()
    df = build_targets(df)
    print(f"features loaded: {len(df):,} pitches ({time.time() - t0:.0f}s)")
    outs = outcomes(df)
    grades_by_variant, report = {}, {}
    variants = ["csw_norm", "whiff_norm", "rv", "rv_cnorm"]
    if with_physics:
        variants.append("csw_norm_physics")
    slim_by_variant = {}
    for variant in variants:
        feats = list(tm.STUFF_FEATURES)
        if variant.endswith("_physics"):
            target = variant.replace("_physics", "")
            feats = feats + PHYS_FEATURES
        else:
            target = variant
        run = run_variant(df, target, feats)
        g = raw_grades(run["scored"], target, outs)
        grades_by_variant[variant] = g
        slim_by_variant[variant] = run["slim"]
        rep = {
            "target_def": TARGET_DEFS.get(target, target),
            "features": feats,
            "n_pitcher_seasons": int(len(g)),
            "fit": per_pitch_fit(run["scored"], target, target),
            "stickiness": stickiness(g),
            "reliability_2026": reliability(run["scored"], target, 2026),
            "location_2026": location_dependence(run["scored"], target, 2026),
            "location_2025": location_dependence(run["scored"], target, 2025),
        }
        if variant == "csw_norm":
            rep["location_diagnosis"] = location_diagnosis(
                run["scored"], target, feats, run["refs"])
        report[variant] = rep
        del run
        print(f"  {variant}: stickiness {rep['stickiness']} "
              f"reliab@100 {rep['reliability_2026'].get(100)} "
              f"loc(pitcher/height) {rep['location_2026']['pitcher_grade_vs_mean_height']}")
    boot = paired_bootstrap(grades_by_variant, outs)
    report["_bootstrap"] = boot
    report["_meta"] = {
        "splits": {"train": list(tm.TRAIN_SEASONS), "valid": tm.VALID_SEASON,
                   "test": tm.TEST_SEASON},
        "min_pitches": MIN_PITCHES, "stick_min": STICK_MIN, "boot": BOOT,
        "seed": SEED, "learner": tm.LGBM_PARAMS, "mono": tm.MONO,
        "row_sets": TARGET_DEFS,
        "elapsed_s": round(time.time() - t0, 1)}
    out = RESULTS / "bakeoff_targets.json"
    out.write_text(json.dumps(report, indent=1, default=str))
    print(f"\nwrote {out}  ({time.time() - t0:.0f}s total)")
    print_compare(report)
    return report


def print_compare(report):
    print("\n==== comparative table (grades are raw mean preds, 100+ pitches) ====")
    hdr = f"{'variant':22s} {'YoY 25-26':>9s} {'rel@25':>7s} {'rel@100':>8s}"
    for m in METRICS:
        hdr += f" {m + ' 25>26':>12s}"
    print(hdr)
    for variant, rep in report.items():
        if variant.startswith("_"):
            continue
        yoy = rep["stickiness"].get("2025-2026", {}).get("r")
        row = f"{variant:22s} {str(yoy):>9s} {rep['reliability_2026'].get(25)!s:>7s} " \
              f"{rep['reliability_2026'].get(100)!s:>8s}"
        for m in METRICS:
            cell = report["_bootstrap"].get("2025->2026", {}).get(m, {}).get(variant)
            if cell:
                w = "G" if cell["beats_naive"] else "n"
                row += f" {cell['r']:.3f}/{cell['naive_r']:.3f}{w:>1s}"
            else:
                row += f" {'-':>12s}"
        print(row)
    print("\nbeats-naive verdicts (paired pitcher bootstrap, CI lower > 0):")
    for pair, metrics in report["_bootstrap"].items():
        for m, variants in metrics.items():
            if m.startswith("_") or m == "n":
                continue
            line = f"  {pair} {m:6s}: "
            line += "  ".join(f"{v} {c['vs_naive']:+.3f} "
                              f"[{c['vs_naive_ci'][0]:+.3f},{c['vs_naive_ci'][1]:+.3f}]"
                              f"{'*' if c['beats_naive'] else ''}"
                              for v, c in variants.items() if isinstance(c, dict))
            print(line)


# ---------------------------------------------------------------- export ---
def export(target, physics_features=False):
    """One-command reproduction of the shipping design: train, grade, write
    the export JSON with an honest model card. For the gated winner (csw_norm)
    the stuff leg is the v2 design READ FROM pipeline/stuff_v2.py — features
    and per-class constraints are imported, never duplicated here (RESULTS-MLB
    §11) — and the 2026 plate re-referencing (referencing_2026, §10) is applied
    before anything consumes a plate column or hvaa. Any other target keeps
    the v1 bake-off arm (ungated; card stays PROVISIONAL). The pitching leg
    (rv, location features) is train_mlb's, unchanged."""
    MODELS.mkdir(exist_ok=True)
    EXPORT.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    df = tm.load_features()
    v2 = target == "csw_norm" and not physics_features
    if v2:
        import referencing_2026 as ref26
        import stuff_v2 as sv
        affine, _ = ref26.derive_affine()
        df, _ = ref26.apply_2026_reference(df, affine)
        df = sv.prepare(df)
        feats = list(sv.FEATURES)
        print(f"training stuff leg ({target}, v2 design, {len(feats)} features, "
              f"2026 plate re-referenced)...")
        bst = tm.crossfit(df, sv.train_boosters)
        card = {
            "design": "stuff_v2 (RESULTS-MLB §11): A_noev + spin_eff "
                      "(per-class monotone) + velo_x_ivb; target chosen by "
                      "pipeline/bakeoff.py; 2026 plate re-referencing applied "
                      "(§10); see pipeline/RESULTS-MLB.md",
            "mono_stuff": {c: {f: v for f, v in m.items() if v}
                           for c, m in sv.CLASS_MONO.items()},
            "referencing_2026": {
                "note": "season-2026 rows affine-mapped onto the 2023-25 plate "
                        "reference before hvaa/plate features reach any model",
                "params": {c: {"slope": p["slope"], "intercept": p["intercept"],
                               "identity": p["identity"]}
                           for c, p in affine.items()},
            },
            "grades_2023_2024": "out-of-sample: every season is graded cross-fitted "
                                "by pitcher (see crossfit below)",
        }
    else:
        df = tm.build_targets(df)
        feats = list(tm.STUFF_FEATURES) + (PHYS_FEATURES if physics_features else [])
        print(f"training stuff leg ({target}, {len(feats)} features)...")
        bst = tm.crossfit(df, lambda d: tm.train_boosters(d, feats, target, mono=True))
        card = {
            "design": "VT A_noev port; target chosen by pipeline/bakeoff.py; "
                      "see pipeline/RESULTS-MLB.md",
            "mono_stuff": dict(tm.MONO),
        }
    refs = tm.frozen_scale(df, bst, feats, target)
    print("training pitching leg (rv, location features)...")
    pbst = tm.crossfit(df, lambda d: tm.train_boosters(d, tm.LOC_FEATURES, "rv", mono=False))
    prefs = tm.frozen_scale(df, pbst, tm.LOC_FEATURES, "rv")
    rows, pitch_rows = [], []
    for season in tm.GRADE_SEASONS:
        sdf = df[df.season == season]
        r, _ = tm.season_grades(sdf, "stuff", bst, refs, feats)
        p, _ = tm.season_grades(sdf, "pitch", pbst, prefs, tm.LOC_FEATURES)
        rows += r
        pitch_rows += p
    by_key = {(p["mlbam"], p["season"]): p for p in pitch_rows}
    merged = []
    for s in rows:
        p = by_key.get((s["mlbam"], s["season"]))
        merged.append({**{k: v for k, v in s.items()
                          if k not in ("overall_z", "abs_grade", "by_class", "by_type")},
                       "stuff_plus_abs": s["abs_grade"],
                       "stuff_by_class": s["by_class"],
                       "stuff_by_type": s["by_type"],  # per site type, shrunk to class (§38)
                       "pitching_plus": p["grade"] if p else None,
                       "pitching_by_class": p["by_class"] if p else []})
    out = EXPORT / "mlb_pitcher_grades.json"
    out.write_text(json.dumps({
        "model_card": {
            "name": f"GOAT-Pro Stuff+ / Pitching+ v2-MLB ({target})",
            **card,
            "target": target, "target_def": TARGET_DEFS[target],
            "train": list(tm.TRAIN_SEASONS), "valid": tm.VALID_SEASON,
            "test": tm.TEST_SEASON,
            "features_stuff": feats, "features_pitching": tm.LOC_FEATURES,
            "excluded": ["spin_axis (era drift)",
                         "effective_speed (barred: location leak)"],
            "class_key": tm.CLASS_OF,
            "crossfit": "both legs: 4 pitcher folds (crc32(pitcher) % 4); each "
                        "pitcher is graded only by boosters that never saw him. "
                        "Standard training memorizes pitchers (RESULTS-MLB §17)",
            "gate_status": ("descriptive-only" if v2 else "PROVISIONAL"),
            "gate_basis": ("location check passed under college methodology "
                           "(RESULTS-MLB §11); no forecast claims: cross-fitted "
                           "Stuff+ loses to naive on next-season CSW% in every "
                           "pair (§17)") if v2 else
                          ("see RESULTS-MLB.md; no predictiveness gate passes the "
                           "college paired-bootstrap standard on the clean pair"),
        },
        "grades": merged}, indent=1))
    print(f"grades: {len(merged)} pitcher-seasons -> {out} ({time.time() - t0:.0f}s)")
    for old in MODELS.glob(f"stuff_{target}_*.txt"):
        old.unlink()
    for ck, fb in bst.items():  # one file per pitcher fold; score new arms with their mean
        for i, b in enumerate(fb.models):
            b.booster_.save_model(str(MODELS / f"stuff_{target}_{ck}_fold{i}.txt"))
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("bake")
    b.add_argument("--with-physics", action="store_true")
    e = sub.add_parser("export")
    e.add_argument("--target", default="csw_norm", choices=list(TARGET_DEFS))
    e.add_argument("--with-physics", action="store_true")
    a = ap.parse_args()
    if a.cmd == "bake":
        bake(a.with_physics)
    else:
        export(a.target, a.with_physics)
