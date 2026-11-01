"""afl_grades.py — RESULTS-MLB §109: the site's AAA model grades scored on Arizona Fall League pitches.

    GOAT_LO=2020 nice -n 10 python pipeline/afl_grades.py     -> data/afl/grades_{pred,pitchers,types}.parquet,
                                                                  pipeline/results/afl_grades.json
    python pipeline/afl_grades.py --scale-check                -> pipeline/results/afl_scale_check.json (§109, read once)
    python pipeline/afl_grades.py --demo                       # self-check of the fold rule

Inference only: no AFL pitch is in any training set. The model is the s7_aaa recipe (aaa_export.py): s4_bb,
wps target, trained on MLB 2023-24 only, 4 pitcher folds (crc32 % 4). crossfit_v2.py never saved those fold
boosters, so they are refit on the identical MLB 2023-24 rows (same SQL, same row order, LightGBM's default
seed) and cached in cache/afl_folds/; a reproduction gate against the shipped crossfit_v2_s7_aaa_pt.csv must
pass before any AFL pitch is scored. Each AFL pitch is scored by the fold model that never saw its pitcher.
Scale, floors and shrinkage are the AAA path's own functions (whiff_hand, type_grades, p7_export, aaa_p7).
"""
import json
import os
import sys
import zlib
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import aaa_p7  # noqa: E402
import crossfit_v2  # noqa: E402
import stuff_v2  # noqa: E402
import train_mlb as tm  # noqa: E402
import whiff_hand  # noqa: E402
from aaa_translation import union_sql  # noqa: E402
from p7_export import DISPLAY_N, whiff_classes  # noqa: E402
from physics import add_physics  # noqa: E402
from type_grades import type_table  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
RES = ROOT / "pipeline" / "results"
AFL = ROOT / "data" / "afl"
FOLDS = ROOT / "cache" / "afl_folds"
OFFSET = 2000  # AFL seasons coded 4021..4026 in the feature frame (AAA is +1000)
K = 4
REG_MIN = 100  # tracked regular-season pitches for the scale check (afl_export.REG_MIN)
# s4_bb per-class capacity (RESULTS-MLB §47): BB re-tuned, CH = T1b, FB = shipped LGBM_PARAMS
S4_BB = {"BB": {"num_leaves": 7, "min_child_samples": 1000, "learning_rate": 0.1, "n_estimators": 800},
         "CH": {"num_leaves": 63, "min_child_samples": 1000, "learning_rate": 0.1, "n_estimators": 25}}
GAMES = "('R','D','L','W')"  # afl_fetch's finals: regular season + playoffs


def fold_of(pitcher) -> int:
    return zlib.crc32(str(pitcher).encode()) % K  # crossfit_v2's rule, on the int64 id


def feature_sql() -> str:
    """MLB 2023-24 rows exactly as the s7_aaa run read them (union_sql's MLB half, no ORDER BY), then AFL rows
    off the feed parquet with the AAA plate_z map (AFL sz_top = the AAA / MLB 2026 convention, §109)."""
    mlb = union_sql(2026).split("UNION ALL BY NAME")[0]
    train = mlb.replace("season BETWEEN {lo} AND {hi}", "season BETWEEN 2023 AND 2024", 1)
    src = (f"(SELECT *, NULL::DOUBLE AS arm_angle, NULL::DOUBLE AS delta_run_exp, "
           f"NULL::DOUBLE AS estimated_woba_using_speedangle FROM read_parquet('{AFL / 'pitches.parquet'}'))")
    afl = (mlb.replace("SELECT season,", f"SELECT season + {OFFSET} AS season,", 1)
              .replace("plate_x, plate_z,", "plate_x, plate_z * 0.9977 + 0.0763 AS plate_z,", 1)
              .replace("FROM pitches_all", f"FROM {src}", 1)
              .replace("game_type = 'R'", f"game_type IN {GAMES}", 1)
              .replace("season BETWEEN {lo} AND {hi}", "season BETWEEN 2021 AND 2026", 1))
    assert "0.9977" in afl and "read_parquet" in afl and "BETWEEN 2023 AND 2024" in train
    return f"{train}\nUNION ALL BY NAME\n{afl}"


def boosters(df, k):
    """Fold k's six cell boosters (trained on the other folds' MLB 2023-24 swings), cached as text models."""
    import lightgbm as lgb
    keys = [f"{c}_vs_{h}" for c in tm.CLASSES for h in ("RHH", "LHH")]
    files = {key: FOLDS / f"s7_aaa_fold{k}_{key}.txt" for key in keys}
    if all(f.exists() for f in files.values()):
        return {key: lgb.Booster(model_file=str(f)) for key, f in files.items()}
    crossfit_v2.TARGET, crossfit_v2.BY_CLASS = "wps", S4_BB
    crossfit_v2.PARAMS = {**tm.LGBM_PARAMS, "n_jobs": 3}
    full = df["train_season"].copy()
    df["train_season"] = full & (df["fold"] != k)
    out = crossfit_v2.train_cells(df)
    df["train_season"] = full
    FOLDS.mkdir(parents=True, exist_ok=True)
    for key, m in out.items():
        m.booster_.save_model(str(files[key]))
    return {key: m.booster_ for key, m in out.items()}


def score():
    tm.FEATURE_SQL = feature_sql()
    df = stuff_v2.prepare(add_physics(tm._load_features()))
    df["wps"] = df["whiff"].where(df["swing"] == 1)
    df["fold"] = df["pitcher"].map(fold_of)
    print("rows by season:", df.groupby("season").size().to_dict(), flush=True)
    pred = pd.Series(np.nan, index=df.index)
    for k in range(K):
        print(f"fold {k}", flush=True)
        for key, b in boosters(df, k).items():
            pclass, side = key.split("_vs_")
            m = (df["fold"] == k) & (df["pclass"] == pclass) & (df["stand"] == ("L" if side == "LHH" else "R"))
            if m.any():
                pred[m] = b.predict(df.loc[m, stuff_v2.FEATURES])
    return df.assign(pred=pred)


def reproduction(df) -> dict:
    """§109 gate: refit OOF means per pitcher x season x type vs the shipped s7_aaa run."""
    mine = (df[df["season"].isin(tm.TRAIN_SEASONS)].groupby(["pitcher", "season", "pitch_type"])["pred"]
            .agg(["mean", "size"]).reset_index())
    ship = pd.read_csv(RES / "crossfit_v2_s7_aaa_pt.csv")
    j = mine.merge(ship, on=["pitcher", "season", "pitch_type"])
    out = {"cells": len(j), "cells_mine": len(mine), "n_equal": float((j["size"] == j["n"]).mean()),
           "r": float(np.corrcoef(j["mean"], j["pred"])[0, 1]), "mean_abs_diff": float((j["mean"] - j["pred"]).abs().mean()),
           "max_abs_diff": float((j["mean"] - j["pred"]).abs().max())}
    out["pass"] = out["r"] >= .999 and out["mean_abs_diff"] <= .002
    return out


def p7(afl_pred: pd.DataFrame, whiff: pd.DataFrame) -> pd.DataFrame:
    """K+ / Prevention+ inputs on AFL lines, the aaa_p7 recipe: AFL history only for Marcel, AFL league K%."""
    px = pd.read_parquet(AFL / "pitches.parquet", columns=["season", "pitcher", "events", "bb_type", "description"])
    ev = px[px["events"].notna()]
    g = ev.groupby(["pitcher", "season"])
    e = pd.DataFrame({"pa": g.size(), "k": g["events"].agg(lambda s: s.isin(["strikeout", "strikeout_double_play"]).sum()),
                      "bb": g["events"].agg(lambda s: s.isin(["walk", "intent_walk"]).sum()),
                      "gb": g["bb_type"].agg(lambda s: (s == "ground_ball").sum()),
                      "bip": g["bb_type"].agg(lambda s: s.notna().sum())}).reset_index().rename(columns={"pitcher": "mlbam"})
    e["marcel"] = aaa_p7.marcel(e)
    e = e.assign(k_s=e["k"] / e["pa"], bb_s=e["bb"] / e["pa"], gb_s=e["gb"] / e["bip"].clip(lower=1),
                 log_pa=np.log(e["pa"].clip(lower=1)))
    taken = (px["description"] != "hit_into_play").groupby([px["pitcher"], px["season"]]).sum()
    e = e.join(taken.rename("n_taken").rename_axis(["mlbam", "season"]), on=["mlbam", "season"])
    sw = afl_pred.groupby(["pitcher", "season"])["whiff"].mean().rename("swstr_s").rename_axis(["mlbam", "season"])
    d = (e.join(sw, on=["mlbam", "season"])
          .merge(whiff.rename(columns={"grade": "whiff"})[["mlbam", "season", "whiff"]], on=["mlbam", "season"]))
    d = d[d["n_taken"] >= 50].dropna(subset=["marcel", "k_s", "swstr_s", "whiff", "log_pa", "bb_s", "gb_s"])
    return aaa_p7.scored(d.reset_index(drop=True))


def main():
    df = score()
    rep = reproduction(df)
    print("reproduction:", rep, flush=True)
    if not rep["pass"]:
        (RES / "afl_grades.json").write_text(json.dumps({"reproduction": rep}, indent=1))
        sys.exit("reproduction gate FAILED: no AFL grade is written (RESULTS-MLB §109)")
    a = df[df["season"] > 4000].assign(season=lambda x: x["season"] - OFFSET)
    a = a[["pitcher", "season", "pitch_type", "stand", "pclass", "pred", "spin_eff", "whiff", "swing", "csw", "pa_taken"]]
    AFL.mkdir(exist_ok=True)
    a.to_parquet(AFL / "grades_pred.parquet")
    del df
    # overall Whiff+: the MLB TRAIN references, each pitch vs its own batter hand (whiff_hand = the AAA file's maker)
    s7 = pd.read_parquet(ROOT / "cache" / "pred_s7_aaa.parquet", columns=["pitcher", "season", "pitch_type", "stand", "pred", "swing"])
    s7 = s7[s7["season"].isin(tm.TRAIN_SEASONS)].assign(pclass=lambda x: x["pitch_type"].map(tm.CLASS_OF))
    w = whiff_hand.grades(a, whiff_hand.refs(s7), quirk=False)
    n = a.groupby(["pitcher", "season"]).size().rename("n_graded").rename_axis(["mlbam", "season"])
    w = w.join(n, on=["mlbam", "season"])
    w = w[w["n_graded"] >= DISPLAY_N]
    # type / class grades: the AAA functions on s7_aaa's pt file + the AFL rows (seasons coded), so the TRAIN scale is theirs
    pt = a.assign(season=a["season"] + OFFSET, wps_real=a["whiff"].where(a["swing"] == 1),
                  csw_real=a["csw"].where(a["pa_taken"] == 1)).groupby(["pitcher", "season", "pitch_type"]).agg(
        n=("pred", "size"), pred=("pred", "mean"), wps=("wps_real", "mean"), n_sw=("wps_real", "count"),
        csw=("csw_real", "mean"), n_tk=("csw_real", "count")).reset_index()
    tmp = ROOT / "cache" / "afl_pt.csv"
    pd.concat([pd.read_csv(RES / "crossfit_v2_s7_aaa_pt.csv"), pt]).to_csv(tmp, index=False)
    t, _ = type_table(str(tmp), DISPLAY_N)
    t = t[t["season"] > 4000].assign(season=lambda x: x["season"] - OFFSET)
    gyro = (1 - a[a["pitch_type"] == "SL"].groupby(["pitcher", "season"])["spin_eff"].mean()).rename("gyro")
    t = t.join(gyro, on=["pitcher", "season"])
    c = whiff_classes(tmp)
    c = c[c["season"] > 4000].assign(season=lambda x: x["season"] - OFFSET)
    proj = p7(a, w)
    pit = w.merge(proj, on=["mlbam", "season"], how="left")
    pit["by_class"] = [json.dumps([{"class": r.pclass, "n": int(r.n), "grade": round(float(r.grade), 1)}
                                   for r in c[(c["pitcher"] == m) & (c["season"] == s)].itertuples()])
                       for m, s in zip(pit["mlbam"], pit["season"])]
    pit.to_parquet(AFL / "grades_pitchers.parquet")
    t[["pitcher", "season", "site", "n", "type_grade", "gyro"]].to_parquet(AFL / "grades_types.parquet")
    # coverage: what was graded, what was not and why
    raw = pd.read_parquet(AFL / "pitches.parquet", columns=["season", "pitch_type", "release_speed", "release_spin_rate",
                                                            "release_extension", "vx0"])
    why = np.select([raw["release_speed"].isna(), raw["release_spin_rate"].isna(),
                     ~raw["pitch_type"].isin(list(tm.CLASS_OF)), raw["release_extension"].isna() | raw["vx0"].isna()],
                    ["untracked", "no spin", "type not graded", "no extension / fit"], "graded-eligible")
    cov = pd.crosstab(raw["season"], why)
    summary = {"reproduction": rep,
               "coverage": {int(s): {k: int(v) for k, v in r.items()} for s, r in cov.iterrows()},
               "graded_pitches": a.groupby("season").size().astype(int).to_dict(),
               "pitchers_whiff_plus": w.groupby("season").size().astype(int).to_dict(),
               "pitchers_k_plus": proj.groupby("season").size().astype(int).to_dict(),
               "means": pit.groupby("season")[["grade", "k_plus", "prevention_plus"]].mean().round(1).to_dict()}
    (RES / "afl_grades.json").write_text(json.dumps(summary, indent=1, default=int))
    print(json.dumps(summary, indent=1, default=int))


def boot_mean(v: pd.Series, groups: pd.Series, draws=2000, seed=13) -> list:
    """Mean of v with a pitcher-clustered bootstrap 95% CI (§109)."""
    g = pd.DataFrame({"v": v.to_numpy(), "g": groups.to_numpy()}).groupby("g")["v"].agg(["sum", "count"])
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, len(g), (draws, len(g)))
    b = g["sum"].to_numpy()[idx].sum(1) / g["count"].to_numpy()[idx].sum(1)
    return [round(float(v.mean()), 3), round(float(np.quantile(b, .025)), 3), round(float(np.quantile(b, .975)), 3), int(len(g))]


ERAS = {"2021-23": (2021, 2022, 2023), "2024": (2024,), "2025-26": (2025, 2026), "pooled": tuple(range(2021, 2027))}
INPUTS = ("velo", "ivb", "hb_arm", "ext", "rel_h")


def scale_check():
    """§109 scale check, read once: AFL vs his same-season tracked MLB + AAA pitches (inputs per class, Whiff+ gap)."""
    from paths import MART_DIR
    sys.path.insert(0, str(MART_DIR))
    import mart
    a = pd.read_parquet(AFL / "pitches.parquet")
    a = a[a["release_speed"].notna() & a["pitch_type"].isin(list(tm.CLASS_OF))]
    con = mart.connect()
    cols = ("pitcher, season, p_throws, pitch_type, release_speed, pfx_x, pfx_z, release_extension, release_pos_z")
    ids = ",".join(str(int(x)) for x in a["pitcher"].unique())
    reg = pd.concat([con.sql(f"SELECT {cols}, '{lvl}' AS level FROM {v} WHERE game_type = 'R' AND season BETWEEN 2021 "
                             f"AND 2026 AND release_speed IS NOT NULL AND pitcher IN ({ids})").df()
                     for v, lvl in (("pitches_all", "MLB"), ("pitches_aaa", "AAA"))], ignore_index=True)
    reg = reg[reg["pitch_type"].isin(list(tm.CLASS_OF))]

    def per_class(d):
        d = d.assign(pclass=d["pitch_type"].map(tm.CLASS_OF), ivb=12 * d["pfx_z"],
                     hb_arm=12 * d["pfx_x"] * np.where(d["p_throws"] == "L", 1.0, -1.0),
                     velo=d["release_speed"], ext=d["release_extension"], rel_h=d["release_pos_z"])
        return d.groupby(["pitcher", "season", "pclass"]).agg(n=("velo", "size"), **{f: (f, "mean") for f in INPUTS})
    n_reg = reg.groupby(["pitcher", "season"]).size()
    ok = set(n_reg[n_reg >= REG_MIN].index)
    j = per_class(a).join(per_class(reg), lsuffix="_afl", rsuffix="_reg", how="inner")
    j = j[(j["n_afl"] >= 10) & (j["n_reg"] >= 10)].reset_index()
    j = j[[(p, s) in ok for p, s in zip(j["pitcher"], j["season"])]]
    pit = pd.read_parquet(AFL / "grades_pitchers.parquet")
    j = j[[(p, s) in set(zip(pit["mlbam"], pit["season"])) for p, s in zip(j["pitcher"], j["season"])]]
    out = {"inputs": {}, "pairs": int(len(j))}
    for era, ss in ERAS.items():
        e = j[j["season"].isin(ss)]
        out["inputs"][era] = {c: {f: boot_mean(g[f"{f}_afl"] - g[f"{f}_reg"], g["pitcher"]) for f in INPUTS}
                              for c, g in [("all", e), *e.groupby("pclass")]} if len(e) else {}
    # grade gap vs his regular-season Whiff+ at the level where he threw more graded pitches
    lv = []
    for f, lvl in (("mlb_pitcher_models.json", "MLB"), ("aaa_pitcher_models.json", "AAA")):
        m = pd.DataFrame(json.loads((ROOT / "data" / "export" / f).read_text())["pitchers"])
        m = m[m["whiff_plus"].notna()]
        lv.append(m.assign(level=lvl, n=[sum(c["n"] for c in (x if isinstance(x, list) else [])) for x in m["whiff_by_class"]])
                  [["mlbam", "season", "whiff_plus", "n", "level"]])
    rg = pd.concat(lv).sort_values("n").drop_duplicates(["mlbam", "season"], keep="last")
    g = pit.merge(rg, on=["mlbam", "season"])
    g = g[[(p, s) in ok for p, s in zip(g["mlbam"], g["season"])]]
    out["grade_gap"] = {era: boot_mean(e["grade"] - e["whiff_plus"], e["mlbam"]) if len(e) else None
                        for era, ss in ERAS.items() for e in [g[g["season"].isin(ss)]]}
    out["grade_gap_by_level (reported)"] = {lvl: boot_mean(e["grade"] - e["whiff_plus"], e["mlbam"])
                                            for lvl, e in g.groupby("level")}
    out["grade_r"] = round(float(np.corrcoef(g["grade"], g["whiff_plus"])[0, 1]), 3)
    pe, ph = out["inputs"]["pooled"]["all"]["ext"], out["inputs"]["pooled"]["all"]["rel_h"]
    gg = out["grade_gap"]["pooled"]
    excl = lambda b: b[1] > 0 or b[2] < 0  # noqa: E731
    out["material"] = {"ext": abs(pe[0]) >= .15 and excl(pe), "rel_h": abs(ph[0]) >= .10 and excl(ph),
                       "grade_gap": abs(gg[0]) >= 3 and excl(gg)}
    out["verdict"] = "MATERIAL: caveat on the page" if any(out["material"].values()) else "NOT MATERIAL"
    (RES / "afl_scale_check.json").write_text(json.dumps(out, indent=1))
    print(json.dumps(out, indent=1))


def demo():
    assert fold_of(605141) == zlib.crc32(b"605141") % 4  # str of the int id, as crossfit_v2 does it
    sql = feature_sql()
    assert sql.count("UNION ALL BY NAME") == 1 and f"season + {OFFSET}" in sql and "ORDER BY" not in sql
    print("afl_grades demo ok")


if __name__ == "__main__":
    demo() if "--demo" in sys.argv else scale_check() if "--scale-check" in sys.argv else main()
