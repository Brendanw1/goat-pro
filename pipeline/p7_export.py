"""P7 export (COLLABORATION.md, P7 rows): the pitcher model family for the site.

    GOAT_LO=2020 python p7_export.py     -> data/export/mlb_pitcher_models.json

Per pitcher-season 2020-26 (>= 50 taken pitches):
  whiff_plus         Whiff+ (s4_bb, pitcher-fold cross-fit)              validated (RESULTS-MLB §45-49)
  whiff_by_type      shrunk per-type Whiff+ (type_grades, k=150, >= 50)  + sl_gyro label (§48)
  whiff_by_class     class Whiff+ (FB/BB/CH vs that class, >= 50)       the per-type fallback on the site
  pitching_by_class  class Pitching+ (FB/BB/CH vs that class, >= 50)    descriptive, like pitching_plus
  k_plus             next-season K% projection on the 100 / 10 scale    confirmed (§50); k_proj = K/PA
  prevention_plus    next-season RV/100 projection on the 100 / 10 scale  confirmed (§52)
  control_plus       shape-controlled location value (frozen §53)        descriptive only (§54)
  pitching_plus      all-in pitch value (P_raw, §56)                     descriptive only; + runs per 100
  zones              Savant-style attack zones (share of pitches)        descriptive
Projections in season S forecast S+1; the final ridges are refit on every validated pair (dev + sealed;
validation is finished) and the display scales are frozen on pitcher-seasons with >= 100 PA in the fit.
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd

import kproj
import stack
from location_plus import TYPE_CODE  # noqa: F401  (keeps the location_plus import side effects identical)
from train_mlb import CLASS_OF, TRAIN_SEASONS, mart
from type_grades import type_table

PIPE = Path(__file__).resolve().parent
RES = PIPE / "results"
OUT = PIPE.parent / "data" / "export" / "mlb_pitcher_models.json"
MIN_N = 50
DISPLAY_N = 10  # per-type / per-class Whiff+ shown from 10 pitches (split-half r >= .70 for every type, RESULTS-MLB §65)
ZONE_SQL = """
WITH z AS (
  SELECT pitcher AS mlbam, season,
         greatest(abs(plate_x) / 0.83,
                  abs(plate_z - (sz_top + sz_bot) / 2) / ((sz_top - sz_bot) / 2 + 0.12)) AS r
  FROM pitches_all WHERE game_type = 'R' AND season BETWEEN 2020 AND 2026
    AND plate_x IS NOT NULL AND sz_top > sz_bot)
SELECT mlbam, season, count(*) AS n,
       avg((r < 1)::INT) AS zone, avg((r < 0.33)::INT) AS meatball, avg((r >= 0.67 AND r < 1.33)::INT) AS shadow,
       avg((r >= 1.33 AND r < 2)::INT) AS chase, avg((r >= 2)::INT) AS waste
FROM z GROUP BY 1, 2
"""
GLOSSARY = {
    "Whiff+": "How well a pitch's shape (velocity, movement, spin, release, and how it differs from the pitcher's "
              "fastball) misses bats: a model of whiffs per swing, on a 100 = average, 10 = one standard deviation scale. "
              "It grades bat-missing, not overall pitch quality: a ground-ball sinker can grade low on Whiff+ and still be "
              "an excellent pitch (see Pitching+). Graded by a model that never saw the pitcher. Pitch-type grades are shown "
              "from 10 pitches of a type (shrunk toward the pitch class) and are stable after about 25.",
    "Gyro slider": "A slider whose spin is mostly 'bullet' spin (gyro share of 75% or more): little sweep, late drop, "
                   "cutter-like out of the hand. A label only; it is graded on the same slider scale.",
    "K+": "Projected strikeout rate for next season on the 100 / 10 scale (100 = the average projection among pitchers "
          "with 100+ batters faced, so short-sample relievers average a little below 100; 10 points is about 3.9 K% points). Combines a Marcel-style three-year K% with this season's K%, swinging-strike rate and "
          "Whiff+. Beat Marcel K% on pitchers held out of every modelling decision.",
    "Prevention+": "Projected run prevention for next season (runs saved per pitch) on the 100 / 10 scale (100 = the "
                   "average projection among pitchers with 100+ batters faced). Built from "
                   "K+, walk rate, ground-ball rate and Whiff+. Beat K-BB%, FIP and xFIP at forecasting next-season run "
                   "value on held-out pitchers.",
    "Control+": "Where a pitcher puts the ball, with the pitch's shape held fixed and umpire/catcher effects removed: "
                "mostly strike-throwing and avoiding non-competitive pitches. Descriptive only; it did not prove it "
                "forecasts runs beyond strikeouts and walks. Blind spot: strike-throwers with hittable stuff can grade "
                "high (it credits the strike, not how hittable it was). Reliable at about 400 pitches.",
    "Pitching+": "All-in value of every pitch (shape, location and count together), umpire- and catcher-neutral, with "
                 "contact valued by exit velocity and launch angle instead of hits. Shown on the 100 / 10 scale and as "
                 "runs saved per 100 pitches versus average. Descriptive: it forecasts next-season runs about as well as "
                 "SIERA, not better.",
    "Attack zones": "Share of pitches by location relative to the batter's zone (Savant-style): Meatball = inner third, "
                    "Zone = in the strike zone, Shadow = the edge band in and out of the zone, Chase = just outside, "
                    "Waste = far outside (non-competitive).",
}


def class_scale(c, val, min_n=MIN_N):
    """c: pitcher, season, pclass, val (mean), n. Scaled vs that class's TRAIN pitcher-seasons with >= 50;
    rows with >= min_n are returned."""
    ref = c[c["season"].isin(TRAIN_SEASONS) & (c["n"] >= MIN_N)].groupby("pclass")[val].agg(["mean", "std"])
    c = c.join(ref, on="pclass")
    return c.assign(grade=100 + 10 * (c[val] - c["mean"]) / c["std"])[c["n"] >= min_n]


def whiff_classes(path=RES / "crossfit_v2_s4_bb_pt.csv", min_n=DISPLAY_N):
    pt = pd.read_csv(path)
    pt = pt[pt["pitch_type"].isin(CLASS_OF)].assign(pclass=lambda x: x["pitch_type"].map(CLASS_OF),
                                                    wp=lambda x: x["pred"] * x["n"])
    c = pt.groupby(["pitcher", "season", "pclass"]).agg(wp=("wp", "sum"), n=("n", "sum")).reset_index()
    return class_scale(c.assign(v=c["wp"] / c["n"]), "v", min_n)


def pitching_classes():
    """Per-class means of the cached Pitching+ pitch values, on pitching_plus.py's frame (same row order)."""
    import location_plus as lp
    import pitching_plus as pp
    import stuff_v2
    from physics import add_physics
    from train_mlb import load_features
    df = stuff_v2.prepare(add_physics(load_features()))
    df["ptype"] = df["pitch_type"].map(lp.TYPE_CODE)
    df, _ = pp.add_batter(lp.target(df))
    v = pd.read_parquet(lp.CACHE / "pitchval_raw.parquet")["v"]
    v.index = df.index
    d = df[["pitcher", "season", "pclass"]].assign(v=v).dropna(subset=["v"])
    c = d.groupby(["pitcher", "season", "pclass"]).agg(v=("v", "mean"), n=("v", "size")).reset_index()
    return class_scale(c, "v")


def by_class(c):
    out = {}
    for r in c.itertuples():
        out.setdefault((int(r.pitcher), int(r.season)), []).append(
            {"class": r.pclass, "n": int(r.n), "grade": round(float(r.grade), 1)})
    return out


def main():
    # K+ and Prevention+: final ridges on every validated pair, applied to every pitcher-season
    tr = stack.frame()
    allf = stack.frame(with_next=False)
    kp = kproj.model().fit(tr[kproj.X_COLS], tr["k_next"])
    tr["kplus"], allf["kplus"] = kp.predict(tr[kproj.X_COLS]), kp.predict(allf[kproj.X_COLS])
    kmean, ksd = (lambda p: (float(p.mean()), float(p.std())))(kp.predict(tr.loc[tr["pa"] >= 100, kproj.X_COLS]))
    pv = kproj.model().fit(tr[stack.S_COLS], tr["rv_next"])
    pp = pv.predict(tr.loc[tr["pa"] >= 100, stack.S_COLS])
    pmean, psd = float(pp.mean()), float(pp.std())
    allf["k_proj"] = allf["kplus"]
    allf["k_plus"] = 100 + 10 * (allf["kplus"] - kmean) / ksd
    allf["prevention_plus"] = 100 + 10 * (pv.predict(allf[stack.S_COLS]) - pmean) / psd
    d = allf[allf["n_taken"] >= 50][["mlbam", "season", "whiff", "k_proj", "k_plus", "prevention_plus"]].rename(
        columns={"whiff": "whiff_plus"})
    # pitcher-seasons under 50 taken pitches: Whiff+ alone from 10 graded pitches (no projection is shown on them)
    pt = pd.read_csv(RES / "crossfit_v2_s4_bb_pt.csv").groupby(["pitcher", "season"])["n"].sum()
    g = pd.read_csv(RES / "crossfit_v2_s4_bb_grades.csv").join(pt.rename_axis(["mlbam", "season"]), on=["mlbam", "season"])
    g = g[(g["n"] >= DISPLAY_N) & ~g.set_index(["mlbam", "season"]).index.isin(d.set_index(["mlbam", "season"]).index)]
    d = pd.concat([d, g[["mlbam", "season", "grade"]].rename(columns={"grade": "whiff_plus"})], ignore_index=True)

    ctrl = pd.read_csv(RES / "location_plus_ctrl_grades.csv")[["mlbam", "season", "grade"]].rename(columns={"grade": "control_plus"})
    pit = pd.read_csv(RES / "pitching_plus_raw_grades.csv")
    pit = pit.assign(pitching_runs_per100=100 * pit["v"])[["mlbam", "season", "grade", "pitching_runs_per100"]].rename(
        columns={"grade": "pitching_plus"})
    zones = mart.connect().sql(ZONE_SQL).df()
    d = d.merge(ctrl, on=["mlbam", "season"], how="left").merge(pit, on=["mlbam", "season"], how="left").merge(
        zones.drop(columns="n"), on=["mlbam", "season"], how="left")

    t, _ = type_table(str(RES / "crossfit_v2_s4_bb_pt.csv"), DISPLAY_N)
    pr = pd.read_parquet(PIPE.parent / "cache" / "pred_s4_bb.parquet", columns=["pitcher", "season", "pitch_type", "spin_eff"])
    gyro = (1 - pr[pr["pitch_type"] == "SL"].groupby(["pitcher", "season"])["spin_eff"].mean()).rename("gyro")
    t = t.join(gyro, on=["pitcher", "season"])
    by_type = {}
    for r in t.itertuples():
        e = {"grade": round(float(r.type_grade), 1), "n": int(r.n)}
        if r.site == "SL" and pd.notna(r.gyro):
            e["gyro_share"], e["sl_gyro"] = round(float(r.gyro), 3), bool(r.gyro >= .75)
        by_type.setdefault((int(r.pitcher), int(r.season)), {})[r.site] = e

    wcls, pcls = by_class(whiff_classes()), by_class(pitching_classes())
    rows = []
    for r in d.itertuples(index=False):
        x = {k: (None if pd.isna(v) else round(float(v), 4 if k in ("k_proj", "zone", "meatball", "shadow", "chase", "waste")
                                               else 2)) for k, v in r._asdict().items() if k not in ("mlbam", "season")}
        x.update(mlbam=int(r.mlbam), season=int(r.season), whiff_by_type=by_type.get((int(r.mlbam), int(r.season)), {}),
                 whiff_by_class=wcls.get((int(r.mlbam), int(r.season)), []),
                 pitching_by_class=pcls.get((int(r.mlbam), int(r.season)), []))
        rows.append(x)
    card = {"generated": pd.Timestamp.now().isoformat(timespec="seconds"),
            "scales": {"k_plus": {"proj_mean": kmean, "proj_sd": ksd}, "prevention_plus": {"proj_mean": pmean, "proj_sd": psd}},
            "status": {"whiff_plus": "validated (RESULTS-MLB §45-49)", "k_plus": "confirmed (§50)",
                       "prevention_plus": "confirmed (§52)", "control_plus": "descriptive (§53-54)",
                       "pitching_plus": "descriptive (§56)", "zones": "descriptive"},
            "projections": "a season-S row projects season S+1",
            "floors": {"whiff_plus": DISPLAY_N, "projections_taken": MIN_N, "whiff_by_type": DISPLAY_N, "whiff_by_class": DISPLAY_N, "pitching_by_class": MIN_N,
                       "whiff_type_stable_at": 25}, "glossary": GLOSSARY}
    OUT.write_text(json.dumps({"model_card": card, "pitchers": rows}, separators=(",", ":")))
    print(f"wrote {OUT} ({len(rows)} pitcher-seasons)")
    s = pd.DataFrame(rows)
    print(s.groupby("season")[["whiff_plus", "k_plus", "prevention_plus", "control_plus", "pitching_plus"]].mean().round(1).to_string())
    print(s[["whiff_plus", "k_plus", "prevention_plus", "control_plus", "pitching_plus"]].corr().round(2).to_string())


if __name__ == "__main__":
    main()
