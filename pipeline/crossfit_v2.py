"""Stuff+ v2 with pitcher-grouped cross-fitting: no pitcher is graded by a model that saw him.

    python crossfit_v2.py

memorization_check.py: v2 per-pitch fit is .38 on training pitchers and .055 on
held-out pitchers in the same seasons -- the boosters recognize pitchers. A
returning pitcher's 2025-26 grade can then replay his own 2023-24 CSW rate.
Fix: K pitcher folds (crc32(pitcher) % K); fold k's pitches, in every season,
are predicted by the booster set trained on the other folds' 2023-24 pitches.
Frozen scale, grading and gates are stuff_v2's own, fed through a lookup
"booster" that returns the cross-fitted prediction for each row.
Writes results/crossfit_v2.json: standard v2 vs cross-fitted v2 on every gate.
"""

import json
import re
import sys
import zlib
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import stuff_v2  # noqa: E402
from physics import add_physics  # noqa: E402
import train_mlb as tm  # noqa: E402
from train_mlb import frozen_scale, load_features  # noqa: E402

RESULTS = Path(__file__).resolve().parent / "results"
K = 4
# --by-type: one booster per Statcast pitch type x batter side instead of per class
TYPE_OF = {"FF": "FF", "SI": "SI", "FC": "FC", "SL": "SL", "ST": "ST", "SW": "ST",
           "CU": "CU", "KC": "CU", "SV": "CU", "CH": "CH", "EP": "CH", "FS": "FS", "FO": "FS"}
TYPES = ("FF", "SI", "FC", "SL", "ST", "CU", "CH", "FS")


def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


# --target: training target (gates are unchanged: next-season CSW%/K%, YoY, leaks);
# --params: JSON overrides of train_mlb.LGBM_PARAMS (tuning, boosted-stump GAM)
# --fe: within-pitcher fixed effects (Resnick, Pitcher Greeks §2.2): backfit one intercept per
#       pitcher x pitch type x season so the booster only learns from each arm's own variation
# --route-fc: slider-shaped cutters go to the BB cells (Pitch Profiler's Stage 0)
# --aaa: P0 step 6 frozen recipe; AAA 2023-25 rows (season + 1000) are scored out of fold and graded.
#        AAA 2026 was sealed for step 6; the seal is spent, so --aaa-hi 2026 adds it for display (aaa_export.py)
TARGET = arg("--target", "csw_norm")
AAA_HI = int(arg("--aaa-hi", 2025))
AAA_SEASONS = tuple(range(3023, AAA_HI + 1001)) if "--aaa" in sys.argv else ()
FE_ITERS = 2
_P = json.loads(arg("--params", "{}"))
BY_CLASS = _P if _P and set(_P) <= {"FB", "BB", "CH"} else {}  # per-class params (T1, tune_pitcher.py)
PARAMS = {**tm.LGBM_PARAMS, **({} if BY_CLASS else _P)}


def train_cells(df):
    """stuff_v2.train_boosters generalized to TARGET, PARAMS and tm.CLASSES (identical to it
    on the defaults); type cells take their class's monotone directions."""
    import lightgbm as lgb
    train = df[df["train_season"] & df[TARGET].notna()]
    out = {}
    for c in tm.CLASSES:
        mono = stuff_v2.CLASS_MONO.get(c) or stuff_v2.CLASS_MONO[tm.CLASS_OF[c]]
        for side in ("R", "L"):
            cell = train[(train["pclass"] == c) & (train["stand"] == side)]
            mk = lambda: lgb.LGBMRegressor(  # noqa: E731
                monotone_constraints=[mono.get(f.removesuffix("_r"), 0) for f in stuff_v2.FEATURES],
                **{**PARAMS, **BY_CLASS.get(tm.CLASS_OF.get(c, c), {})})
            X, y = cell[stuff_v2.FEATURES], cell[TARGET]
            if "--fe" in sys.argv:  # start from the group means: iteration 1 is purely within-pitcher
                keys = [cell["pitcher"], cell["pitch_type"], cell["season"]]
                alpha = y.groupby(keys).transform("mean")
                for _ in range(FE_ITERS):
                    m = mk().fit(X, y - alpha)
                    alpha = (y - m.predict(X)).groupby(keys).transform("mean")
            else:
                m = mk().fit(X, y)
            out[f"{c}_vs_{'LHH' if side == 'L' else 'RHH'}"] = m
    return out


def add_targets(df):
    """Candidate targets (RESULTS-MLB §30), all pitcher-positive:
    swstr_norm  whiff / E[whiff | count], every pitch (no called strikes: no zone channel)
    wps         whiff on swings only (NaN on takes)
    rv          -delta_run_exp, every pitch
    xrv         rv with balls in play replaced by E[rv | xwOBA, count] (TRAIN fit)
    rv_resid    rv minus a TRAIN-fitted count + location + handedness model (Shape+ v2 recipe,
                LightGBM instead of OLS because the zone is not linear)"""
    import lightgbm as lgb
    tr = df["train_season"]
    e = df[tr].groupby(["balls", "strikes"])["whiff"].mean().rename("e_whiff")
    df["swstr_norm"] = df["whiff"] / df.join(e, on=["balls", "strikes"])["e_whiff"]
    df["wps"] = df["whiff"].where(df["swing"] == 1)
    # swing_xrv (Pitch Profiler proStuff+ style): run value of what happens on a swing, count-neutral
    # constants from TRAIN; whiff and foul at their league means, contact at a + b * xwOBA
    sw = df["swing"] == 1
    kind = np.select([sw & (df["whiff"] == 1), sw & (df["pa_taken"] == 1), sw], ["whiff", "foul", "ip"], "")
    w = df[tr].groupby(kind[tr.to_numpy()])["rv"].mean()
    ip = tr & (kind == "ip") & df["xwoba"].notna() & df["rv"].notna()
    b, a = np.polyfit(df.loc[ip, "xwoba"], df.loc[ip, "rv"], 1)
    df["swing_xrv"] = np.select([kind == "whiff", kind == "foul", kind == "ip"],
                                [w["whiff"], w["foul"], (a + b * df["xwoba"]).fillna(w["ip"])], np.nan)
    print(f"swing_xrv constants whiff {w['whiff']:.3f} foul {w['foul']:.3f} ip {a:.3f} + {b:.3f}*xwOBA", flush=True)
    # xrv (P7 7.2): rv with balls in play valued by the count-specific xwOBA line fitted on TRAIN (judge.py's)
    xr = df["rv"].copy()
    for (bl, st), g in df[ip].groupby(["balls", "strikes"]):
        cb, ca = np.polyfit(g["xwoba"], g["rv"], 1)
        m = (kind == "ip") & df["xwoba"].notna() & (df["balls"] == bl) & (df["strikes"] == st)
        xr[m] = ca + cb * df.loc[m, "xwoba"]
    df["xrv"] = xr
    ctx = df[["plate_x_arm", "plate_z", "balls", "strikes"]].assign(
        stand=(df["stand"] == "L").astype(int), lhp=(df["p_throws"] == "L").astype(int),
        pclass=df["pclass"].map({"FB": 0, "BB": 1, "CH": 2}))
    fit = tr & df["rv"].notna()
    loc = lgb.LGBMRegressor(n_estimators=400, learning_rate=0.05, num_leaves=63,
                            min_child_samples=500, verbose=-1).fit(ctx[fit], df.loc[fit, "rv"])
    df["rv_resid"] = df["rv"] - loc.predict(ctx)
    return df


class Lookup:
    """Booster stand-in: predict(X) returns the stored cross-fitted value per row."""

    def __init__(self, pred: pd.Series):
        self.pred = pred

    def predict(self, X):
        return self.pred.loc[X.index].to_numpy()


def evaluate(df, bst):
    refs = frozen_scale(df, bst, stuff_v2.FEATURES, "csw_norm")
    rows, scored = stuff_v2.grade_seasons(df, bst, refs, tuple(range(tm.LO, 2027)) + AAA_SEASONS)
    g = stuff_v2.gates(scored, rows, df)
    x = scored[["stuff_pred", "plate_x_arm"]].dropna()  # §29: the plate_z gate missed hhaa
    g["location_leak_x"] = float(abs(np.corrcoef(x["stuff_pred"], x["plate_x_arm"])[0, 1]))
    sub = scored[["season", "stuff_pred", "csw"]].dropna()
    g["fit_by_season"] = {int(s): float(np.corrcoef(x["stuff_pred"], x["csw"])[0, 1])
                          for s, x in sub.groupby("season")}
    return g, rows


def add_candidates(df):
    """Physics candidates for the feature study (never read unless named in --feature-set):
    nm_ivb/nm_hb  non-Magnus movement, measured break minus physics.py's Magnus-implied break
                  (inches; the seam-shifted-wake residual in movement units, cf. §20's angle)
    hhaa          horizontal approach angle at the plate, residualized on plate_x per class on
                  TRAIN rows (hvaa's recipe, so location choice is not re-imported)"""
    df["nm_ivb"] = df["ivb"] - df["mag_ivb"]
    df["nm_hb"] = df["hb"] - df["mag_hb"]
    vx = df["vx0"] + df["ax"] * df["t"]
    vy = df["vy0"] + df["ay"] * df["t"]
    haa = np.degrees(np.arctan2(vx, -vy))
    df["hhaa"] = np.nan
    for pc in ("FB", "BB", "CH"):
        c = df["pclass"] == pc
        m = c & df["train_season"] & df["plate_x"].notna() & haa.notna()
        slope, intercept = np.polyfit(df.loc[m, "plate_x"], haa[m], 1)
        df.loc[c, "hhaa"] = haa[c] - (intercept + slope * df.loc[c, "plate_x"])
    # §33 velocity candidates. The 9-parameter fit is constant-acceleration, so "late break" and
    # raw accelerations are functions of movement and flight time already in the model; these
    # instead express how fast the pitch reaches the hitter.
    #   t_flight   release-to-plate time: time from y=50 to the plate plus release (60.5 - ext) to y=50
    #   eff_velo   perceived velocity, mph to cover 60.5 ft in t_flight (velo + extension + drag)
    #   plate_speed  speed at the front of the plate, mph
    t_flight = df["t"] + (10.5 - df["ext"]) / (-df["vy0"])
    df["eff_velo"] = 0.6818 * 60.5 / t_flight
    vz = df["vz0"] + df["az"] * df["t"]
    df["plate_speed"] = 0.6818 * np.sqrt(vx ** 2 + vy ** 2 + vz ** 2)
    # usage anchor: diffs against the pitcher-season's most-thrown fastball TYPE (FanGraphs'
    # primary-fastball definition) instead of the p95-velo band
    fb = df[df["pclass"] == "FB"]
    prim = fb.groupby(["pitcher", "season"])["pitch_type"].agg(lambda s: s.value_counts().index[0])
    ref = (fb.join(prim.rename("prim"), on=["pitcher", "season"]).query("pitch_type == prim")
           .groupby(["pitcher", "season"])[["velo", "ivb", "hb"]].mean().add_suffix("_ref"))
    j = df.join(ref, on=["pitcher", "season"])
    for f in ("velo", "ivb", "hb"):
        df[f"{f}_diff_u"] = df[f] - j[f"{f}_ref"].fillna(df[f])
    # program 2026-10-26 item 2, movement relative to the arm slot (Resnick "surprise", tjStuff
    # "expected movement given slot", Pitch Profiler "difference from arm angle"):
    #   ivb_slot/hb_slot  break minus E[break | arm angle, release height/side, extension] per pitch
    #                     type, fitted on TRAIN; hb arm-side positive
    #   ax_arm/az_ind     acceleration in place of break (ft/s^2, arm-side positive; gravity removed)
    #   dir_dev           movement direction minus arm angle, degrees
    sign = np.where(df["p_throws"] == "L", 1.0, -1.0)
    df["hb_arm"] = df["hb"] * sign
    df["ax_arm"] = df["ax"] * sign
    df["az_ind"] = df["az"] + 32.174
    df["dir_dev"] = np.degrees(np.arctan2(df["ivb"], df["hb_arm"])) - df["arm_angle"]
    if any("slot" in a for a in sys.argv):
        import lightgbm as lgb
        slot = df[["arm_angle", "rel_h", "ext"]].assign(rel_s_arm=df["rel_s"] * sign)
        typ = df["pitch_type"].map(TYPE_OF)
        for f in ("ivb", "hb_arm"):
            df[f.replace("_arm", "") + "_slot"] = np.nan
            for t in TYPES:
                m = typ == t
                fit = m & df["train_season"] & df[f].notna()
                mdl = lgb.LGBMRegressor(n_estimators=200, learning_rate=0.1, num_leaves=31,
                                        min_child_samples=1000, n_jobs=4, verbose=-1)
                mdl.fit(slot[fit], df.loc[fit, f])
                df.loc[m, f.replace("_arm", "") + "_slot"] = df.loc[m, f] - mdl.predict(slot[m])
        print("slot residuals: sd ivb", round(df["ivb"].std(), 2), "->", round(df["ivb_slot"].std(), 2),
              "hb", round(df["hb_arm"].std(), 2), "->", round(df["hb_slot"].std(), 2), flush=True)
    return df


def add_dml(df, base="csw_norm"):
    """Double ML (RESULTS-MLB §32): partial location + count out of the target AND every shape
    input. Per class, a LightGBM on context only (plate_x_arm, plate_z, balls, strikes, batter
    side, throwing hand) fitted on TRAIN rows; context carries no pitcher identity, so no
    pitcher cross-fit is needed for these nuisance models. Inputs become f_r = f - E[f | ctx],
    the target <base>_dml = base - E[base | ctx] (csw_norm, or wps fitted on swings only)."""
    import lightgbm as lgb
    ctx = df[["plate_x_arm", "plate_z", "balls", "strikes"]].assign(
        stand=(df["stand"] == "L").astype(int), lhp=(df["p_throws"] == "L").astype(int))
    nuis = dict(n_estimators=200, learning_rate=0.1, num_leaves=31, min_child_samples=1000,
                n_jobs=4, verbose=-1)
    cols = stuff_v2.FEATURES + [base]
    for c in cols:
        df[f"{c}_r"] = np.nan
    for pc in ("FB", "BB", "CH"):
        m = df["pclass"] == pc
        for c in cols:
            fit = m & df["train_season"] & df[c].notna()
            mdl = lgb.LGBMRegressor(**nuis).fit(ctx[fit], df.loc[fit, c])
            df.loc[m, f"{c}_r"] = df.loc[m, c] - mdl.predict(ctx[m])
        print(f"dml nuisance {pc} done", flush=True)
    df[TARGET] = df[f"{base}_r"]
    stuff_v2.FEATURES = [f"{f}_r" for f in stuff_v2.FEATURES]
    return df


def id_probe(df, n=200):
    """Pitcher-identity probe (Tom Kim's tjStuff+ test, via Resnick §5.1): how well do the model's
    inputs name the pitcher? 15-NN on standardized inputs, FB class, fit on 2024 and scored on
    2025, pitchers with >= 300 FB in both, 200 pitches each. Lower = less to memorize."""
    from sklearn.neighbors import KNeighborsClassifier
    fb = df[(df["pclass"] == "FB") & df["season"].isin([2024, 2025])].dropna(subset=stuff_v2.FEATURES)
    cnt = fb.groupby(["pitcher", "season"]).size().unstack()
    keep = cnt[(cnt[2024] >= 300) & (cnt[2025] >= 300)].index
    fb = fb[fb["pitcher"].isin(keep)].groupby(["pitcher", "season"]).sample(n, random_state=13)
    tr, te = fb[fb["season"] == 2024], fb[fb["season"] == 2025]
    mu, sd = tr[stuff_v2.FEATURES].mean(), tr[stuff_v2.FEATURES].std()
    knn = KNeighborsClassifier(15, n_jobs=4).fit((tr[stuff_v2.FEATURES] - mu) / sd, tr["pitcher"])
    hit = knn.predict((te[stuff_v2.FEATURES] - mu) / sd) == te["pitcher"].to_numpy()
    vote = te.assign(p=knn.predict((te[stuff_v2.FEATURES] - mu) / sd)).groupby("pitcher")["p"].agg(
        lambda s: s.mode().iloc[0])
    print(f"id probe: {len(keep)} pitchers, per-pitch {hit.mean():.3f}, per-season "
          f"{(vote.index == vote.to_numpy()).mean():.3f} (chance {1 / len(keep):.4f})", flush=True)


def main() -> None:
    if tm.LO < 2023:  # holdout: 2021-22 are scored out of fold, never trained on (TRAIN_SEASONS)
        stuff_v2.PAIRS = tuple((s, s + 1) for s in range(tm.LO, 2026))
    if AAA_SEASONS:  # frozen recipe (RESULTS-MLB §44): §27 adjustments + MLB 2026 plate_z map on AAA rows
        from aaa_translation import union_sql
        mlb, aaa = union_sql(AAA_HI).split("UNION ALL BY NAME")
        aaa = aaa.replace("plate_x, plate_z,", "plate_x, plate_z * 0.9977 + 0.0763 AS plate_z,", 1)
        assert "0.9977" in aaa and f"BETWEEN 2023 AND {AAA_HI}" in aaa
        tm.FEATURE_SQL = mlb + "UNION ALL BY NAME" + aaa
        raw = tm._load_features()  # uncached: load_features() would evict the MLB cache
        print("rows by season:", raw.groupby("season").size().to_dict(), flush=True)
    else:
        raw = load_features()
    df = add_candidates(stuff_v2.prepare(add_physics(raw)))
    if TARGET not in ("csw_norm", "csw_dml"):
        df = add_targets(df)
    if arg("--key") == "topo":  # C5: topo Level-1 class per pitch (pipeline/topo_keys.py); unassigned keep Statcast's
        k = pd.read_parquet(RESULTS.parent / "cache" / "topo_keys.parquet",
                            columns=["game_pk", "at_bat_number", "pitch_number", "l1"])
        l1 = k.set_index(["game_pk", "at_bat_number", "pitch_number"])["l1"]
        new = pd.Series(pd.MultiIndex.from_frame(df[["game_pk", "at_bat_number", "pitch_number"]]).map(l1),
                        index=df.index)
        ok = new.isin(["FB", "BB", "CH"])
        print(f"topo key: {ok.mean():.3%} matched; class changed on {(ok & (new != df['pclass'])).mean():.2%}", flush=True)
        df.loc[ok, "pclass"] = new[ok]
    if "--route-fc" in sys.argv:  # FC pitcher-season mean velo_diff <= -7.5 (slider q90) or ivb <= 4 in
        fc = df[df["pitch_type"] == "FC"].groupby(["pitcher", "season"])[["velo_diff", "ivb"]].mean()
        slid = fc[(fc["velo_diff"] <= -7.5) | (fc["ivb"] <= 4)].index
        r = (df["pitch_type"] == "FC") & pd.MultiIndex.from_frame(df[["pitcher", "season"]]).isin(slid)
        df.loc[r, "pclass"] = "BB"
        print(f"route-fc: {len(slid)} of {len(fc)} FC pitcher-seasons, {int(r.sum())} pitches -> BB", flush=True)
    # candidate feature sets, each judged against the cross-fitted v2 baseline
    fset = sys.argv[sys.argv.index("--feature-set") + 1] if "--feature-set" in sys.argv else (
        "axis" if "--axis" in sys.argv else "")  # "base": fresh cross-fit baseline only
    if fset == "axis":  # program item 1: v2 + axis_dev
        from ssw_test import add_axis_dev
        df = add_axis_dev(df)
        stuff_v2.FEATURES = stuff_v2.FEATURES + ["axis_dev"]
    elif fset == "arm":  # measured (Hawk-Eye pose) arm angle
        stuff_v2.FEATURES = stuff_v2.FEATURES + ["arm_angle"]
    elif fset == "arm_swap":  # arm angle in place of the release-point fingerprint
        stuff_v2.FEATURES = [f for f in stuff_v2.FEATURES if f not in ("rel_h", "rel_s")] + ["arm_angle"]
    elif fset and fset[0] in "+-":  # generic edit, e.g. "-rel_h-rel_s+a_drag" (feature study)
        for op, f in re.findall(r"([+-])(\w+)", fset):
            stuff_v2.FEATURES = ([x for x in stuff_v2.FEATURES if x != f] if op == "-"
                                 else stuff_v2.FEATURES + [f])
    if TARGET.endswith("_dml"):  # after the feature edits, so every chosen input is residualized
        df = add_dml(df, "csw_norm" if TARGET == "csw_dml" else TARGET.removesuffix("_dml"))
    id_probe(df)
    train = train_cells
    if "--by-type" in sys.argv:
        df["pclass"] = df["pitch_type"].map(TYPE_OF)
        tm.CLASSES = TYPES
        fset = f"{fset}_bytype"
    fset = arg("--name", fset)  # label for --target / --params runs
    if fset:
        std, std_rows = None, None
    else:
        print("standard v2...", flush=True)
        std, std_rows = evaluate(df, stuff_v2.train_boosters(df))

    fold = df["pitcher"].map(lambda p: zlib.crc32(str(p).encode()) % K)
    full_train = df["train_season"].copy()
    pred = pd.Series(np.nan, index=df.index)
    # --shap: TreeSHAP of each held-out pitch from the same fold booster that predicts it (never the
    # pitcher's own fold, so the explanation carries no memorization); columns = features + bias
    shap = np.full((len(df), len(stuff_v2.FEATURES) + 1), np.nan, dtype=np.float32) if "--shap" in sys.argv else None
    for k in range(K):
        print(f"fold {k}: training on the other {K - 1} pitcher folds...", flush=True)
        df["train_season"] = full_train & (fold != k)
        bst = train(df)
        for key, b in bst.items():
            pclass, side = key.split("_vs_")
            m = (fold == k) & (df["pclass"] == pclass) & (df["stand"] == ("L" if side == "LHH" else "R"))
            pred[m] = b.predict(df.loc[m, stuff_v2.FEATURES])
            if shap is not None and m.any():
                shap[m.to_numpy()] = b.predict(df.loc[m, stuff_v2.FEATURES], pred_contrib=True)
    df["train_season"] = full_train
    cf, cf_rows = evaluate(df, {f"{c}_vs_{h}": Lookup(pred)
                                for c in tm.CLASSES for h in ("RHH", "LHH")})
    out = {"standard_v2": std, "crossfit_v2": cf, "k": K, "features": stuff_v2.FEATURES,
           "target": TARGET, "params": PARAMS}
    for name, g in (("standard", std), ("crossfit", cf)):
        if g is None:
            continue
        print(f"{name:9} fit {{{', '.join(f'{s}: {r:.3f}' for s, r in g['fit_by_season'].items())}}} "
              f"leak {g['location_leak']:.3f} leak_x {g.get('location_leak_x', float('nan')):.3f}")
        print("          yoy " + ", ".join(f"{k} {v:.3f}" for k, v in g["yoy"].items()))
        print("          grade vs naive " + ", ".join(
            f"{k} {v['grade']:.3f}/{v['naive']:.3f}" for k, v in g["predictiveness_vs_naive"].items()))
    RESULTS.mkdir(exist_ok=True)
    tag = f"_{re.sub(r'[^A-Za-z0-9_]+', '', fset.replace('+', 'P').replace('-', 'M')).strip('_')}" if fset else ""
    (RESULTS / f"crossfit_v2{tag}.json").write_text(json.dumps(out, indent=1, default=lambda o: o.item()))
    pd.DataFrame([{"mlbam": r["mlbam"], "season": r["season"], "grade": r["grade"]} for r in cf_rows]
                 ).to_csv(RESULTS / f"crossfit_v2{tag}_grades.csv", index=False)
    # pitcher x pitch type x season: out-of-fold prediction and realized outcomes (change_test.py)
    df.assign(pred=pred, wps_real=df["whiff"].where(df["swing"] == 1),
              csw_real=df["csw"].where(df["pa_taken"] == 1)).groupby(
        ["pitcher", "season", "pitch_type"]).agg(
        n=("pred", "size"), pred=("pred", "mean"), wps=("wps_real", "mean"), n_sw=("wps_real", "count"),
        csw=("csw_real", "mean"), n_tk=("csw_real", "count")).reset_index().to_csv(
        RESULTS / f"crossfit_v2{tag}_pt.csv", index=False)
    if shap is not None:  # per-pitch TreeSHAP (whiff_shap.py scales it to Whiff+ points), untracked cache
        sd = pd.DataFrame(shap, columns=[*stuff_v2.FEATURES, "bias"], index=df.index)
        sd[["pitcher", "season", "pitch_type", "stand", "swing"]] = df[["pitcher", "season", "pitch_type", "stand", "swing"]]
        sd.assign(pred=pred).to_parquet(RESULTS.parent.parent / "cache" / f"shap{tag}.parquet")
    if "--save-pred" in sys.argv:  # per-pitch out-of-fold predictions (step5.py), untracked cache
        df.assign(pred=pred)[["pitcher", "season", "pitch_type", "stand", "pred", "spin_eff",
                              "whiff", "swing"]].to_parquet(RESULTS.parent.parent / "cache" / f"pred{tag}.parquet")


if __name__ == "__main__":
    main()
