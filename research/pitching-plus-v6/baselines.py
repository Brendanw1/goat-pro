"""Step 1: baselines (Stuff+ cross-fit, Command+ analogue, their dev-fit blend) and the FanGraphs sanity check.

    OMP_NUM_THREADS=3 nice -n 10 python research/pitching-plus-v6/baselines.py
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lib  # noqa: E402

PM = Path.home() / "Projects/goat-pro/cache/pitch_models.parquet"


def baseline_values(df):
    pm = pd.read_parquet(PM)
    s = df[["game_pk", "at_bat_number", "pitch_number"]].merge(pm, how="left", on=["game_pk", "at_bat_number",
                                                                                    "pitch_number"])
    stuff = pd.Series(s["whiff_plus"].to_numpy(), index=df.index, dtype="float64")
    old_pp = pd.Series(s["pitching_plus"].to_numpy(), index=df.index, dtype="float64")
    d = df["t2_dist"]
    cmd = -(d - d.groupby(df["pitch_type"]).transform("mean")) / d.groupby(df["pitch_type"]).transform("std")
    return {"stuff": stuff, "command": cmd, "pp_v5": old_pp}


def main():
    df = lib.load(lib.META + ["at_bat_number", "t2_dist"])
    vs = baseline_values(df)
    pd.DataFrame(vs).astype("float32").to_parquet(lib.CACHE / "baseline_values.parquet")
    print({k: round(float(v.notna().mean()), 4) for k, v in vs.items()})
    out = lib.outcome_table()
    rows = lib.table(df, vs, "P", out)
    fmap = df.groupby("pitcher")["fold"].first()
    folds = rows["pitcher"].map(fmap)
    for y in ("rv100", "kbb"):
        rows[f"blend_{y}"] = lib.blend(rows, ["stuff", "command"], y, folds)
    res = {"coverage": {k: float(v.notna().mean()) for k, v in vs.items()}, "levels": {}}
    for c in ("stuff", "command", "pp_v5", "blend_rv100", "blend_kbb"):
        res["levels"][c] = {y: round(float(rows[[c, y]].dropna().corr().iloc[0, 1]), 4) for y in ("rv100", "kbb")}
    res["blend_vs_stuff"] = {k: v for k, v in lib.J(rows, "stuff", {"rv100": "blend_rv100",
                                                                   "kbb": "blend_kbb"}).items()}
    # FanGraphs sanity check: next-season RA9 / FIP, NS window, common sample
    fg = pd.read_csv(lib.HERE / "data" / "fg_pitch_models.csv").rename(columns={"xMLBAMID": "pitcher",
                                                                                 "Season": "season"})
    ns = rows[rows["win"] == "NS"].merge(fg, on=["pitcher", "season"], how="inner")
    ns = ns[ns["outs"] >= 120]
    ns["blend_ra"] = lib.blend(ns, ["stuff", "command"], "ra9", ns["pitcher"].map(fmap))
    cols = ["stuff", "command", "blend_ra", "pp_v5", "sp_stuff", "sp_location", "sp_pitching", "pb_overall",
            "pb_stuff", "pb_command", "SIERA", "xFIP", "FIP", "K-BB%", "ERA"]
    neg = {"SIERA", "xFIP", "FIP", "ERA", "blend_ra"}  # lower = better pitcher (blend_ra predicts RA9)
    fgres = {}
    for y in ("ra9", "fip"):
        sub = ns.dropna(subset=cols + [y])
        fgres[y] = {c: round(float(np.corrcoef(np.where(c in neg, -1, 1) * sub[c], -sub[y])[0, 1]), 4)
                    for c in cols}
        fgres[y]["n"] = len(sub)
    res["fangraphs_next_season"] = fgres
    res["fg_delta_ra9"] = {}
    sub = ns.dropna(subset=cols + ["ra9"]).assign(nra=lambda d: -d["ra9"], bl=lambda d: -d["blend_ra"])
    for c in ("sp_pitching", "pb_overall", "pp_v5"):
        r = lib.delta(sub, "bl", c, "nra")
        r.pop("_boot")
        res["fg_delta_ra9"][f"{c}_vs_blend"] = r
    rows.to_parquet(lib.CACHE / "rows_baselines.parquet")
    lib.save("baselines", res)
    print(json.dumps(res, indent=1, default=float))


if __name__ == "__main__":
    main()
