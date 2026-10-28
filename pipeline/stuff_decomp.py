"""Decomposed, location-marginalized Stuff+ (RESULTS-MLB §30, item 3; PitchingBot-style).

    python stuff_decomp.py

v2 asks shape features to explain CSW, so they rebuild location (§29). Here location and
count are model INPUTS, and Stuff+ integrates them out. Per class x batter side, five
LightGBM sub-models on shape (v2 features minus hvaa, which is a function of plate_z) plus
context (plate_x, plate_z, balls, strikes):
  P(swing) | all pitches        P(whiff | swing)       P(foul | contact)
  P(called strike | take)       E[rv | in play]
Expected run value per pitch (pitcher-positive, rv = -delta_run_exp):
  E = (1-Ps)[Pcs RV_cs + (1-Pcs) RV_ball] + Ps[Pw RV_whiff + (1-Pw)(Pf RV_foul + (1-Pf) E_ip)]
with RV_* the TRAIN mean rv of that outcome in that count.
  pitching  E at the pitch's actual location and count
  stuff     E with location and count swapped for one random draw from the TRAIN
            distribution of the same class x batter side x throwing hand; averaged over a
            pitcher's pitches this integrates the league location/count mix
  location  pitching - stuff
  swing     (v1) value GIVEN a swing (whiff, foul, contact branches only), context-averaged like
            stuff: the swing-side Stuff+ candidate of RESULTS-MLB §31
v1 (default; `--v0` reproduces the first run):
  - in-play target is the count-specific linear map of Statcast xwOBA onto rv (TRAIN fit),
    so base-out state and defense luck leave the target (rv where xwOBA is missing)
  - stuff uses common random numbers: the same DRAWS reference contexts per class x stand x
    hand for every pitch, averaged, on <= CAP pitches per pitcher-season-cell; one random
    draw per pitch (v0) adds count noise that rivals the between-pitcher spread
Cross-fit by pitcher (crc32 % 4, as crossfit_v2.py). Grades: 100 + 10 z of the
pitcher-season mean, z from TRAIN pitcher-seasons with >= 100 pitches.
Writes results/stuff_decomp{_v0}.json and results/decomp{_v0}_{stuff,pitching,location}_grades.csv.
"""

import json
import sys
import zlib
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import stuff_v2  # noqa: E402
import train_mlb as tm  # noqa: E402
from physics import add_physics  # noqa: E402

RESULTS = Path(__file__).resolve().parent / "results"
SHAPE = [f for f in stuff_v2.FEATURES if f != "hvaa"]
CTX = ["plate_x", "plate_z", "balls", "strikes"]
X = SHAPE + CTX
PARAMS = dict(n_estimators=500, learning_rate=0.05, num_leaves=31, min_child_samples=500,
              subsample=0.8, subsample_freq=1, colsample_bytree=0.8, n_jobs=5, verbose=-1)
PAIRS = ((2023, 2024), (2024, 2025), (2025, 2026))
V0 = "--v0" in sys.argv
TAG = "_v0" if V0 else ""
DRAWS, CAP = 24, 250


def outcomes(df):
    take = df["swing"] == 0
    cs = take & (df["csw"] == 1)
    contact = (df["swing"] == 1) & (df["whiff"] == 0)
    foul = contact & (df["pa_taken"] == 1)
    in_play = contact & (df["pa_taken"] == 0)
    kind = np.select([take & cs, take, df["whiff"] == 1, foul, in_play],
                     ["cs", "ball", "whiff", "foul", "ip"], "other")
    return df.assign(kind=kind, is_cs=cs.astype(int), is_foul=foul.astype(int))


def fit_cell(c):
    import lightgbm as lgb
    clf = lambda d, y: lgb.LGBMClassifier(**PARAMS).fit(d[X], d[y])  # noqa: E731
    sw = c["swing"] == 1
    con = sw & (c["whiff"] == 0)
    return {"swing": clf(c, "swing"), "whiff": clf(c[sw], "whiff"),
            "foul": clf(c[con], "is_foul"), "cs": clf(c[c["swing"] == 0], "is_cs"),
            "ip": lgb.LGBMRegressor(**PARAMS).fit(c.loc[c["kind"] == "ip", X],
                                                 c.loc[c["kind"] == "ip", "rv_ip"])}


def expected_rv(m, Xd, rv_count):
    p = {k: m[k].predict_proba(Xd)[:, 1] for k in ("swing", "whiff", "foul", "cs")}
    ip = m["ip"].predict(Xd)
    r = {k: rv_count[k].reindex(pd.MultiIndex.from_frame(Xd[["balls", "strikes"]].astype(int))).to_numpy()
         for k in ("cs", "ball", "whiff", "foul")}
    take = p["cs"] * r["cs"] + (1 - p["cs"]) * r["ball"]
    swing = p["whiff"] * r["whiff"] + (1 - p["whiff"]) * (p["foul"] * r["foul"] + (1 - p["foul"]) * ip)
    return (1 - p["swing"]) * take + p["swing"] * swing, swing


def grades(df, col):
    ps = df.groupby(["pitcher", "season"])[col].agg(["mean", "size"]).reset_index()
    ref = ps[ps["season"].isin((2023, 2024)) & (ps["size"] >= 100)]["mean"]
    ps["grade"] = 100 + 10 * (ps["mean"] - ref.mean()) / ref.std()
    return ps.rename(columns={"pitcher": "mlbam"})


def load():
    """The shared frame plus Statcast xwOBA; SQL swapped in-process, cache untouched."""
    if "AS xwoba" not in tm.FEATURE_SQL:  # train_mlb carries xwoba since 2026-10-26
        tm.FEATURE_SQL = tm.FEATURE_SQL.replace(
            "vx0, vy0", "estimated_woba_using_speedangle AS xwoba, vx0, vy0", 1)
    return tm._load_features()


def main() -> None:
    df = outcomes(stuff_v2.prepare(add_physics(load() if not V0 else tm.load_features())))
    df = df[df["kind"] != "other"].dropna(subset=SHAPE + CTX + ["rv"])
    tr = df["train_season"]
    if not V0:  # denoised in-play target: rv ~ count + xwOBA, fitted on TRAIN in-play rows
        ip = df[tr & (df["kind"] == "ip") & df["xwoba"].notna()]
        fit = {bs: np.polyfit(g["xwoba"], g["rv"], 1) for bs, g in ip.groupby(["balls", "strikes"])}
        slope = pd.Series({k: v[0] for k, v in fit.items()})
        icpt = pd.Series({k: v[1] for k, v in fit.items()})
        bs = pd.MultiIndex.from_frame(df[["balls", "strikes"]])
        x_rv = icpt.reindex(bs).to_numpy() + slope.reindex(bs).to_numpy() * df["xwoba"].to_numpy()
        df["rv_ip"] = np.where((df["kind"] == "ip") & df["xwoba"].notna(), x_rv, df["rv"])
    else:
        df["rv_ip"] = df["rv"]
    rv_count = {k: df[tr & (df["kind"] == k)].groupby(["balls", "strikes"])["rv"].mean()
                for k in ("cs", "ball", "whiff", "foul")}
    rng = np.random.default_rng(13)
    groups = df.groupby(["pclass", "stand", "p_throws"]).groups
    pools = {k: df.loc[idx[tr[idx].to_numpy()], CTX].to_numpy() for k, idx in groups.items()}
    if V0:  # one reference context per pitch
        ref = df[CTX].copy()
        for k, idx in groups.items():
            ref.loc[idx, CTX] = pools[k][rng.integers(0, len(pools[k]), len(idx))]
    else:  # common random numbers: DRAWS shared contexts per group; capped pitch sample
        grid = {k: p[rng.integers(0, len(p), DRAWS)] for k, p in pools.items()}
        df["in_stuff"] = (df.groupby(["pitcher", "season", "pclass", "stand"])["velo"]
                          .transform(lambda s: rng.permutation(len(s)) < CAP)) if CAP else True
    fold = df["pitcher"].map(lambda p: zlib.crc32(str(p).encode()) % 4)
    df["e_pitching"] = np.nan
    df["e_stuff"] = np.nan
    df["e_swing"] = np.nan
    for k in range(4):
        for pc in ("FB", "BB", "CH"):
            for side in ("R", "L"):
                cell = (df["pclass"] == pc) & (df["stand"] == side)
                m = fit_cell(df[cell & tr & (fold != k)])
                hold = cell & (fold == k)
                df.loc[hold, "e_pitching"] = expected_rv(m, df.loc[hold, X], rv_count)[0]
                if V0:
                    df.loc[hold, "e_stuff"] = expected_rv(m, pd.concat(
                        [df.loc[hold, SHAPE], ref.loc[hold, CTX]], axis=1)[X], rv_count)[0]
                    continue
                for hand in ("R", "L"):
                    h = hold & df["in_stuff"] & (df["p_throws"] == hand)
                    if not h.any():
                        continue
                    acc, acc_sw = np.zeros(int(h.sum())), np.zeros(int(h.sum()))
                    for ctx in grid[(pc, side, hand)]:
                        Xd = df.loc[h, SHAPE].assign(**dict(zip(CTX, ctx)))[X]
                        total, swing = expected_rv(m, Xd, rv_count)
                        acc += total
                        acc_sw += swing
                    df.loc[h, "e_stuff"] = acc / DRAWS
                    df.loc[h, "e_swing"] = acc_sw / DRAWS  # value given a swing (§31)
        print(f"fold {k} done", flush=True)
    df["e_location"] = df["e_pitching"] - df["e_stuff"]

    out = {"shape_features": SHAPE, "context": CTX, "params": PARAMS}
    for col in ("e_stuff", "e_pitching", "e_location") + (() if V0 else ("e_swing",)):
        g = grades(df.dropna(subset=[col]), col)
        w = g[g["size"] >= 100].pivot_table(index="mlbam", columns="season", values="grade")
        out[col] = {
            "yoy": {f"{a}->{b}": round(float(w[[a, b]].dropna().corr().iloc[0, 1]), 3) for a, b in PAIRS},
            **{name: round(float(abs(np.corrcoef(d[col], d[ref_col])[0, 1])), 4)
               for d in [df.dropna(subset=[col])]
               for name, ref_col in (("per_pitch_fit_rv", "rv"), ("per_pitch_fit_csw", "csw"),
                                     ("leak_z", "plate_z"), ("leak_x", "plate_x_arm"))}}
        print(col, out[col], flush=True)
        g[["mlbam", "season", "grade"]].to_csv(
            RESULTS / f"decomp{TAG}_{col.removeprefix('e_')}_grades.csv", index=False)
    (RESULTS / f"stuff_decomp{TAG}.json").write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
