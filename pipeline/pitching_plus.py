"""P7 step 7.5 Pitching+ (COLLABORATION.md, row "P7 step 7.5"): all-in pitch value vs next-season RA9.

    GOAT_LO=2020 python pitching_plus.py            fit P_raw and P_adj, dev judge
    GOAT_LO=2020 python pitching_plus.py --seal X    read the sealed pitchers once for variant X

Per-pitch target = location_plus.target. f(shape, location, count [, batter wOBA]) per class x batter
side, pitcher-fold cross-fit on dev pitchers' 2023-24 pitches; value = f - E[y | count]. P_adj scores
every pitch with the batter set to league average. Judge: r(grade in S, -RA9 in S+1) vs the best of
K-BB%, xFIP, SIERA in S (best on dev); clustered pitcher bootstrap.
"""
import json
import sys
import zlib
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import location_plus as lp  # noqa: E402
import stack  # noqa: E402
import stuff_v2  # noqa: E402
from physics import add_physics  # noqa: E402
from train_mlb import TRAIN_SEASONS, load_features, mart  # noqa: E402

PIPE = Path(__file__).resolve().parent
SEAL = sys.argv[sys.argv.index("--seal") + 1] if "--seal" in sys.argv else ""
RA_SQL = """
WITH p AS (SELECT season, pitcher, outs_when_up, post_bat_score - bat_score AS r,
                  lead(outs_when_up) OVER (PARTITION BY game_pk, inning, inning_topbot
                                           ORDER BY at_bat_number, pitch_number) AS nxt
           FROM pitches_all WHERE game_type = 'R' AND season BETWEEN 2020 AND 2026)
SELECT pitcher AS mlbam, season, sum(r) AS runs, sum(greatest(coalesce(nxt, 3) - outs_when_up, 0)) AS outs
FROM p GROUP BY 1, 2
"""
BAT_SQL = """
SELECT batter, season, sum(woba_value) AS wv, sum(woba_denom) AS wd FROM pitches_all
WHERE game_type = 'R' AND woba_denom > 0 GROUP BY 1, 2
"""
KEY = ["game_pk", "at_bat_number", "pitch_number"]


def add_batter(df):
    con = mart.connect()
    b = con.sql(BAT_SQL).df()
    lg = b.groupby("season").apply(lambda d: d["wv"].sum() / d["wd"].sum())
    b["bq"] = (b["wv"] + 200 * b["season"].map(lg)) / (b["wd"] + 200)
    b["season"] += 1  # prior season -> the season it informs
    ids = con.sql("SELECT game_pk, at_bat_number, pitch_number, batter FROM pitches_all "
                  "WHERE game_type = 'R' AND season >= 2020").df().drop_duplicates(KEY)
    df = df.merge(ids, on=KEY, how="left").merge(b[["batter", "season", "bq"]], on=["batter", "season"], how="left")
    df["bq"] = df["bq"].fillna(df["season"].map(lg).fillna(lg.mean()))
    return df, float(lg[list(TRAIN_SEASONS)].mean())


def fit_variant(df, name, lg_bq):
    import lightgbm as lgb
    cols = lp.LOC + stuff_v2.FEATURES + (["bq"] if name == "adj" else [])
    fold = df["pitcher"].map(lambda p: zlib.crc32(str(p).encode()) % 4)
    dev_tr = df["season"].isin(TRAIN_SEASONS) & ~df["pitcher"].map(lp.sealed) & df["y"].notna()
    c_mean = df[dev_tr].groupby(["balls", "strikes"])["y"].mean().rename("c")
    base = df[["balls", "strikes"]].join(c_mean, on=["balls", "strikes"])["c"]
    X = df[cols].copy()
    if name == "adj":
        X_score = X.assign(bq=lg_bq)
    else:
        X_score = X
    val = pd.Series(np.nan, index=df.index)
    for k in range(4):
        for pc in ("FB", "BB", "CH"):
            for side in ("R", "L"):
                cell = (df["pclass"] == pc) & (df["stand"] == side)
                tr, te = cell & dev_tr & (fold != k), cell & (fold == k) & df["plate_x"].notna()
                f = lgb.LGBMRegressor(**lp.LGB).fit(X[tr], df.loc[tr, "y"])
                val[te] = f.predict(X_score[te]) - base[te]
        print(f"{name} fold {k} done", flush=True)
    return val


def benchmarks():
    con = mart.connect()
    ra = con.sql(RA_SQL).df()
    ra["ip"] = ra["outs"] / 3
    ra["ra9"] = 9 * ra["runs"] / ra["ip"].where(ra["ip"] > 0)
    ev = con.sql(stack.SQL.replace("sum((bb_type IN ('fly_ball','popup'))::INT) AS fb",
                                   "sum((bb_type = 'fly_ball')::INT) AS fbo, sum((bb_type = 'popup')::INT) AS pu, "
                                   "sum((bb_type IN ('fly_ball','popup'))::INT) AS fb")).df()
    lg = ev.groupby("season")[["hr", "fb"]].sum()
    ev = ev.join((lg["hr"] / lg["fb"]).rename("lg_hrfb"), on="season")
    so, bb, pa = ev["k"], ev["bb"], ev["pa"]
    g = (ev["gb"] - ev["fbo"] - ev["pu"]) / pa
    ev["kbb_s"] = (so - bb) / pa
    ev["xfip_s"] = -(13 * ev["fb"] * ev["lg_hrfb"] + 3 * (bb + ev["hbp"]) - 2 * so) / pa
    siera = (6.145 - 16.986 * so / pa + 11.434 * bb / pa - 1.858 * g + 7.653 * (so / pa) ** 2
             - np.sign(g) * 6.664 * g ** 2 + 10.130 * (so / pa) * g - 5.195 * (bb / pa) * g)
    ev["siera_s"] = -siera  # higher = better, like every other column
    return ra[["mlbam", "season", "ra9", "ip"]], ev[["mlbam", "season", "kbb_s", "xfip_s", "siera_s"]]


def judge(ps, which):
    ra, ev = benchmarks()
    oc = pd.read_parquet(PIPE.parent / "cache" / "outcomes_2020.parquet")[["mlbam", "season", "n_taken", "rv100"]]
    nxt = ra.assign(season=ra["season"] - 1).rename(columns={"ra9": "ra9_next", "ip": "ip_next"})
    nrv = oc.assign(season=oc["season"] - 1)[["mlbam", "season", "rv100"]].rename(columns={"rv100": "rv_next"})
    d = (ps[["mlbam", "season", "grade"]].merge(oc[["mlbam", "season", "n_taken"]], on=["mlbam", "season"])
         .merge(ev, on=["mlbam", "season"]).merge(ra.rename(columns={"ra9": "ra9_s"})[["mlbam", "season", "ra9_s"]],
                                                   on=["mlbam", "season"])
         .merge(nxt, on=["mlbam", "season"]).merge(nrv, on=["mlbam", "season"]))
    d = d[(d["n_taken"] >= 50) & (d["ip_next"] >= 20) & (d["season"] <= 2025)].dropna()
    d = d.assign(neg_ra9_next=-d["ra9_next"], neg_ra9_s=-d["ra9_s"], sealed=d["mlbam"].map(lp.sealed))
    dev, sl = d[~d["sealed"]], d[d["sealed"]]
    bench = {b: float(np.mean([np.corrcoef(g[b], g["neg_ra9_next"])[0, 1] for _, g in dev.groupby("season")]))
             for b in ("kbb_s", "xfip_s", "siera_s", "neg_ra9_s")}
    best = max(("kbb_s", "xfip_s", "siera_s"), key=bench.get)
    tgt = dev if which == "dev" else sl
    # reported: does Pitching+ add to Prevention+ (stack.py) on next-season RA9?
    from sklearn.model_selection import GroupKFold
    import kproj
    sf = stack.frame().merge(d[["mlbam", "season", "grade", "neg_ra9_next"]], on=["mlbam", "season"])
    sdev, ssl = sf[~sf["sealed"]].reset_index(drop=True), sf[sf["sealed"]].reset_index(drop=True)
    stack.add_kplus(sdev, ssl)
    for nm, cols in (("prev", stack.S_COLS), ("prev_p", stack.S_COLS + ["grade"])):
        sdev[nm] = 0.0
        for tr, te in GroupKFold(5).split(sdev, groups=sdev["mlbam"]):
            sdev.loc[te, nm] = kproj.model().fit(sdev.loc[tr, cols], sdev.loc[tr, "neg_ra9_next"]).predict(sdev.loc[te, cols])
        ssl[nm] = kproj.model().fit(sdev[cols], sdev["neg_ra9_next"]).predict(ssl[cols])
    added = stack.pooled_dr(sdev if which == "dev" else ssl, "prev", "prev_p", "neg_ra9_next")
    return {"added_to_prevention_ra9": added,"bench_mean_r_dev": {k: round(v, 4) for k, v in bench.items()}, "best": best,
            "grade_mean_r": round(float(np.mean([np.corrcoef(g["grade"], g["neg_ra9_next"])[0, 1]
                                                 for _, g in tgt.groupby("season")])), 4),
            "claim_vs_best": stack.pooled_dr(tgt, best, "grade", "neg_ra9_next"),
            "vs_ra9_s": stack.pooled_dr(tgt, "neg_ra9_s", "grade", "neg_ra9_next"),
            "vs_kbb_on_rv_next": stack.pooled_dr(tgt, "kbb_s", "grade", "rv_next")}


def main():
    df = stuff_v2.prepare(add_physics(load_features()))
    df["ptype"] = df["pitch_type"].map(lp.TYPE_CODE)
    df = lp.target(df)
    df, lg_bq = add_batter(df)
    res = {}
    for name in ([SEAL] if SEAL else ["raw", "adj"]):
        path = lp.CACHE / f"pitchval_{name}.parquet"
        if path.exists():
            val = pd.read_parquet(path)["v"]
            val.index = df.index
        else:
            val = fit_variant(df, name, lg_bq)
            val.rename("v").to_frame().to_parquet(path)
        ps = lp.grades(df, val)
        ps.to_csv(PIPE / "results" / f"pitching_plus_{name}_grades.csv", index=False)
        res[name] = {"judge": judge(ps, "sealed" if SEAL else "dev")}
        if not SEAL:
            x = df.assign(v=val)
            res[name]["split_half"] = lp.extras(df, val, ps.assign(), pd.DataFrame({"loc": [0, 1], "whiff": [0, 1]}))["split_half"]
            nx = ps.assign(season=ps["season"] - 1)
            j = ps.merge(nx, on=["mlbam", "season"], suffixes=("", "_n"))
            res[name]["yoy_300"] = round(float(j[(j["n"] >= 300) & (j["n_n"] >= 300)][["grade", "grade_n"]].corr().iloc[0, 1]), 3)
            for other, f in (("whiff", "crossfit_v2_s4_bb_grades.csv"), ("control", "location_plus_ctrl_grades.csv")):
                o = pd.read_csv(PIPE / "results" / f)[["mlbam", "season", "grade"]]
                m = ps.merge(o, on=["mlbam", "season"], suffixes=("", "_o"))
                res[name][f"r_with_{other}"] = round(float(m["grade"].corr(m["grade_o"])), 3)
            del x
        print(name, json.dumps(res[name]), flush=True)
    (PIPE / "results" / f"pitching_plus{'_SEALED_' + SEAL if SEAL else '_dev'}.json").write_text(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
