"""Minors Phase 2: Whiff+ on AAA pitchers (MLB model on AAA data) for the site.

    P='<s4_bb per-class params>' GOAT_LO=2020 python crossfit_v2.py --aaa --aaa-hi 2026 --params "$P" \\
        --target wps --name s7_aaa --save-pred
    python aaa_export.py     -> data/export/aaa_pitcher_models.json

The s4_bb recipe trained on MLB 2023-24 only, pitcher-fold cross-fit; AAA rows (seasons coded +1000) are scored
out of fold with the frozen §44 adjustments, on the MLB scale (TRAIN-season refs). Same fields as
mlb_pitcher_models.json's Whiff+ block: whiff_plus, whiff_by_type (+ sl_gyro), whiff_by_class, plus K+ / k_proj /
Prevention+ (frozen MLB ridges on AAA inputs, MLB scale; confirmed on AAA by frozen transfer, RESULTS-MLB §66,
aaa_p7.py; >= 50 taken AAA pitches). Control+ and Pitching+ are not exported for AAA.
"""
import json

import pandas as pd

import aaa_p7
from p7_export import DISPLAY_N, OUT as MLB_OUT, PIPE, RES, by_class, whiff_classes
from type_grades import type_table

OUT = MLB_OUT.with_name("aaa_pitcher_models.json")
TAG = "s7_aaa"
AAA = 1000  # aaa_translation.AAA_OFFSET


def aaa(df, col="season"):
    """AAA rows only, season decoded."""
    return df[df[col] > 3000].assign(**{col: lambda x: x[col] - AAA})


def main():
    pt = pd.read_csv(RES / f"crossfit_v2_{TAG}_pt.csv")
    n = pt.groupby(["pitcher", "season"])["n"].sum().rename_axis(["mlbam", "season"]).rename("n_graded")
    g = pd.read_csv(RES / f"crossfit_v2_{TAG}_grades.csv").join(n, on=["mlbam", "season"])
    g = aaa(g[g["n_graded"] >= DISPLAY_N])  # p7_export's Whiff+ floor: 10 graded pitches
    t, _ = type_table(str(RES / f"crossfit_v2_{TAG}_pt.csv"), DISPLAY_N)
    t = aaa(t)
    pr = aaa(pd.read_parquet(PIPE.parent / "cache" / f"pred_{TAG}.parquet",
                             columns=["pitcher", "season", "pitch_type", "spin_eff"]))
    gyro = (1 - pr[pr["pitch_type"] == "SL"].groupby(["pitcher", "season"])["spin_eff"].mean()).rename("gyro")
    t = t.join(gyro, on=["pitcher", "season"])
    by_type = {}
    for r in t.itertuples():
        e = {"grade": round(float(r.type_grade), 1), "n": int(r.n)}
        if r.site == "SL" and pd.notna(r.gyro):
            e["gyro_share"], e["sl_gyro"] = round(float(r.gyro), 3), bool(r.gyro >= .75)
        by_type.setdefault((int(r.pitcher), int(r.season)), {})[r.site] = e
    wcls = by_class(aaa(whiff_classes(RES / f"crossfit_v2_{TAG}_pt.csv")))
    proj = aaa_p7.scored().set_index(["mlbam", "season"])
    rows = []
    for r in g.itertuples():
        key = (int(r.mlbam), int(r.season))
        row = {"mlbam": key[0], "season": key[1], "whiff_plus": round(float(r.grade), 2),
               "whiff_by_type": by_type.get(key, {}), "whiff_by_class": wcls.get(key, [])}
        if key in proj.index:
            p = proj.loc[key]
            row.update(k_proj=round(float(p.k_proj), 4), k_plus=round(float(p.k_plus), 1),
                       prevention_plus=round(float(p.prevention_plus), 1))
        rows.append(row)
    card = {"generated": pd.Timestamp.now().isoformat(timespec="seconds"), "level": "AAA",
            "label": "MLB model on AAA data",
            "status": {"whiff_plus": "validated on MLB (RESULTS-MLB §45-49); on AAA the grade-to-next-season "
                                     "check confirmed the strikeout gain only (P0 step 6)",
                       "k_plus": "confirmed on AAA by frozen transfer (RESULTS-MLB §66): beat AAA Marcel K% in 3 of 3 pairs",
                       "prevention_plus": "confirmed on AAA by frozen transfer (RESULTS-MLB §66): beat AAA K-BB% on next "
                                          "RV/100 and xRV/100 in 3 of 3 pairs"},
            "recipe": "s4_bb trained on MLB 2023-24, pitcher-fold cross-fit; AAA ext +0.10 ft, release height "
                      "-0.06 ft, plate_z x0.9977 +0.0763 ft, five high-altitude parks dropped (§44); MLB scale"}
    OUT.write_text(json.dumps({"model_card": card, "pitchers": rows}, separators=(",", ":")))
    s = pd.DataFrame(rows)
    print(f"wrote {OUT} ({len(rows)} pitcher-seasons)")
    print(s.groupby("season")[["whiff_plus", "k_plus", "prevention_plus"]].agg(["count", "mean", "std"]).round(1).to_string())
    assert set(s.season) == {2023, 2024, 2025, 2026} and s.whiff_plus.between(20, 180).all()


if __name__ == "__main__":
    main()
