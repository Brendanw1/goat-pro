"""prospect_arrival_diag.py — §99h dev work: why §99f gate (a) failed, and a discrete-time hazard arrival model.

    python pipeline/prospect_arrival_diag.py --fetch      # Stats API June drafts 2000-26 -> data/milb/draft_full.parquet
    python pipeline/prospect_arrival_diag.py --diag       # base rates, coverage drift, post-hoc slices of the spent holdout
    python pipeline/prospect_arrival_diag.py --dev        # hazard model + feature-family ablation, dev arrival years 2015-21

Dev only. The 2022-23 arrival lists are spent (§99f) and are never fitted, tuned or scored here; --diag reads the
already-scored holdout predictions for diagnosis only. Public data only (MLB Stats API draft, the §99 feature store).
"""
import argparse
import json
import time
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

import prospect_backtest as pb

ROOT = Path(__file__).resolve().parents[1]
DRAFT = ROOT / "data" / "milb" / "draft_full.parquet"
LINES = ROOT / "data" / "milb"
OUT = pb.RES / "prospect_99h_dev.json"
THREADS = 3
NON_INTL = {"USA", "Canada", "Puerto Rico"}


# ------------------------------------------------------------------ fetch (27 calls)
def fetch():
    rows = []
    for y in range(2000, 2027):
        with urllib.request.urlopen(f"https://statsapi.mlb.com/api/v1/draft/{y}", timeout=120) as r:
            d = json.load(r)
        for rd in d["drafts"]["rounds"]:
            for p in rd["picks"]:
                per = p.get("person") or {}
                if not per.get("id") or not p.get("isDrafted", True):
                    continue
                rows.append({"id": per["id"], "year": y, "pick": p.get("pickNumber"), "round": p.get("pickRound"),
                             "school": (p.get("school") or {}).get("name"),
                             "school_class": (p.get("school") or {}).get("schoolClass"),
                             "bonus": pd.to_numeric(p.get("signingBonus"), errors="coerce"),
                             "slot": pd.to_numeric(p.get("pickValue"), errors="coerce"),
                             "birth_country": per.get("birthCountry")})   # mlbDebutDate never stored (target)
        print(y, len(rows), flush=True)
        time.sleep(0.5)
    pd.DataFrame(rows).to_parquet(DRAFT, compression="zstd")


# ------------------------------------------------------------------ new point-in-time features
def add_features(S):
    """Entry path, acquisition cost, Rule 5 timing, org depth. All from data available at as_of."""
    D = pd.read_parquet(DRAFT)
    D["round_n"] = pd.to_numeric(D["round"].astype(str).str.extract(r"(\d+)")[0], errors="coerce")
    # only drafts he SIGNED from are knowable as such; use his latest draft whose July 20 precedes the as-of
    S = S.copy()
    S["_r"] = np.arange(len(S))
    m = S[["_r", "id", "as_of"]].merge(D, on="id", how="left")
    m = m[m.year.isna() | (pd.to_datetime(m.year.astype("Int64").astype(str) + "-07-20", errors="coerce") <= m.as_of)]
    m = m.sort_values("year").groupby("_r").tail(1).set_index("_r")
    for c in ("year", "pick", "round_n", "bonus", "slot", "school", "school_class"):
        S["d_" + c] = m[c].reindex(S._r).values
    S["drafted_full"] = S.d_year.notna().astype(float)
    birth = S.as_of - pd.to_timedelta(S.age * 365.25, unit="D")
    S["d_age"] = (pd.to_datetime(S.d_year.astype("Int64").astype(str) + "-06-15", errors="coerce") - birth).dt.days / 365.25
    S["log_pick_full"] = np.log(S.d_pick.astype(float))
    S["bonus_over_slot"] = np.log((S.d_bonus + 1e4) / (S.d_slot + 1e4))       # 2015+ in the API; NaN elsewhere
    S["log_bonus"] = np.log1p(S.d_bonus)
    # entry path: HS / college underclass / college senior / international / other undrafted
    first = _first_lines()
    S["first_league"] = S.id.map(first.league_name)
    S["first_age"] = S.id.map(first.age_s)
    hs = S.d_school.fillna("").str.contains(r"\bHS\b|High School|Academy|Prep", regex=True) | (S.d_age < 19.6)
    sr = (S.d_school_class.fillna("").str.upper().str.startswith("SR")) | (S.d_age >= 21.9)
    intl = (S.drafted_full == 0) & (S.first_league.isin(["DSL", "VSL"]) | (S.first_age < 18.5))
    S["path"] = np.select([S.drafted_full.eq(1) & hs, S.drafted_full.eq(1) & sr, S.drafted_full.eq(1), intl],
                          [1, 3, 2, 4], 0)            # 0 other undrafted (NDFA, indy, older intl)
    S["path_hs"], S["path_col"], S["path_sr"], S["path_intl"] = [(S.path == k).astype(float) for k in (1, 2, 3, 4)]
    # Rule 5: signed at <=18 -> 5th December after signing season, >=19 -> 4th (2006 CBA). Seasons until exposure.
    sign_year = np.where(S.drafted_full == 1, S.d_year, S.first_season)
    sign_age = np.where(S.drafted_full == 1, S.d_age, S.first_age)
    r5 = sign_year + np.where(sign_age >= 19, 3, 4)                    # December of this season
    S["r5_gap"] = r5 - (S.as_of.dt.year - 1)                          # <= 0: already exposed (protected or passed)
    S["r5_exposed"] = (S.r5_gap <= 0).astype(float)
    # org depth ahead (same as-of snapshot, same role; hitters same main position), quality = org-list membership
    S["role_pos"] = np.where(S.pitcher, "P", S.pos_main.fillna("NA"))
    S["dep_n"] = np.nan
    S["dep_listed"] = np.nan
    for (a, org, rp), g in S[S.org_id.notna()].groupby(["as_of", "org_id", "role_pos"]):
        lv = g.lvl.values
        lst = g.org_rank.notna().values
        above = lv[None, :] > lv[:, None]
        S.loc[g.index, "dep_n"] = above.sum(1)
        S.loc[g.index, "dep_listed"] = (above & lst[None, :]).sum(1)
    return S.drop(columns=["_r"])


def _first_lines():
    H = pd.concat([pd.read_parquet(LINES / f) for f in ("hist_hitters.parquet", "hitters.parquet",
                                                        "hist_pitchers.parquet", "pitchers.parquet")])
    H = H[H.level.isin(["ROK", "A-", "A", "A+", "AA", "AAA"]) & (H.league_name != "MEX")]
    H["age_s"] = (pd.to_datetime(H.season.astype(str) + "-07-01") - pd.to_datetime(H.birth_date, errors="coerce")
                  ).dt.days / 365.25
    return H.sort_values(["season", "level"]).groupby("mlbam_id")[["season", "league_name", "age_s"]].first()


NEW = {"entry": ["path", "path_hs", "path_col", "path_sr", "path_intl", "first_age"],
       "acquisition": ["drafted_full", "log_pick_full", "d_round_n", "log_bonus", "bonus_over_slot"],
       "rule5": ["r5_gap", "r5_exposed"],
       "depth": ["dep_n", "dep_listed"]}
BASE_FAMS = ["env", "rates", "promotion", "draft", "pipeline", "position", "org"]   # health: absent pre-2019


# ------------------------------------------------------------------ hazard model
def person_periods(L, Y, horizon=4):
    """List rows of years < Y expanded to seasons y..y+3, kept only if the season is observed by Y's as-of (<= Y-1)."""
    parts = []
    for t in range(horizon):
        d = L[(L.tyear < Y) & (L.tyear + t <= Y - 1) & ~((L.t_debut >= 0) & (L.t_debut < t))].copy()
        d = d[d.event != "debuted_before"]
        d["t"] = t
        d["h"] = (d.t_debut == t).astype(float)
        parts.append(d)
    return pd.concat(parts)


def hazard_fit_predict(tr_pp, te, feats, pit):
    import lightgbm as lgb
    f = feats + ["t"]
    m = lgb.LGBMClassifier(num_leaves=31, min_child_samples=200, learning_rate=0.05, n_estimators=400, subsample=0.8,
                           subsample_freq=1, colsample_bytree=0.8, reg_lambda=1.0, n_jobs=THREADS, verbose=-1,
                           random_state=99, monotone_constraints=[pb.MONO.get(c, 0) for c in f],
                           monotone_constraints_method="advanced")       # fixed a priori, no tuning
    m.fit(tr_pp[f], tr_pp.h)
    surv = np.ones(len(te))
    for t in range(4):
        surv *= 1 - m.predict_proba(te[feats].assign(t=t)[f])[:, 1]
    return 1 - surv


def feats_for(fams, pit):
    f = pb._feats([x for x in fams if x in pb.FAMILIES], pit)
    return f + [c for x in fams if x in NEW for c in NEW[x]]


FIX_FAMS = [f for f in BASE_FAMS if f != "draft"] + ["acquisition"]   # 2011+ draft cols -> full 2000+ draft
CONFIGS = {"H_base": BASE_FAMS, "H_fix": FIX_FAMS, **{f"H_+{k}": FIX_FAMS + [k] for k in ("entry", "rule5", "depth")},
           "H_all": FIX_FAMS + ["entry", "rule5", "depth"]}


def dev():
    S = add_features(pb.load())
    L = S[S.snap == "list"]
    dp = pd.read_parquet(pb.RES / "prospect_99_dev_preds.parquet")
    dp = dp[dp.task == "arr"][["id", "as_of", "B1", "LGB", "LGB_raw"]]
    out = []
    for Y in pb.ARR_DEV:
        te_all = L[(L.tyear == Y) & L.y_arr.notna()]
        for pit in (False, True):
            te = te_all[te_all.pitcher == pit].copy()
            # no player-grouped removal: training labels close by Y-1, and removing the test list's players keeps
            # mostly those who already debuted or exited (the §99f selection bias)
            pp = person_periods(L[L.pitcher == pit], Y)
            for name, fams in CONFIGS.items():
                te[name] = hazard_fit_predict(pp, te, feats_for(fams, pit), pit)
            out.append(te)
            print(Y, pit, len(pp), len(te), flush=True)
    o = pd.concat(out).merge(dp, on=["id", "as_of"], how="inner")
    keep = ["id", "as_of", "tyear", "pitcher", "y_arr", "list_state", "path", "B1", "LGB", "LGB_raw"] + list(CONFIGS)
    o[keep].to_parquet(pb.RES / "prospect_99h_dev_preds.parquet", compression="zstd")
    summarize(o)


def summarize(o=None):
    o = pd.read_parquet(pb.RES / "prospect_99h_dev_preds.parquet") if o is None else o
    cols = ["B1", "LGB", "LGB_raw"] + list(CONFIGS)
    res = {"n": len(o), "years": sorted(int(x) for x in o.tyear.unique()), "metrics": pb.arr_metrics(o, cols)}
    res["mean_p_by_year"] = o.groupby("tyear")[["y_arr", "B1", "LGB", "H_base", "H_fix", "H_all"]].mean().round(4) \
        .to_dict("index")
    b = lambda d, c, r: pb.brier(d.y_arr, d[c]) - pb.brier(d.y_arr, d[r])   # noqa: E731
    res["vs"] = {f"{c}-{r}": {"d": round(b(o, c, r), 5), "ci": pb.boot(o, lambda d, c=c, r=r: b(d, c, r), n=1000)}
                 for c, r in [("H_base", "LGB"), ("H_base", "B1"), ("H_fix", "LGB"), ("H_all", "LGB"),
                              ("H_all", "B1"), ("H_fix", "H_base"), ("H_all", "H_fix")]
                 + [(f"H_+{k}", "H_fix") for k in ("entry", "rule5", "depth")]}
    res["vs_ece"] = {c: round(pb.ece(o.y_arr, o[c]), 4) for c in cols}
    (OUT).write_text(json.dumps(res, indent=1, default=str))
    print(json.dumps(res, indent=1, default=str))


# ------------------------------------------------------------------ diagnosis
def diag():
    S = add_features(pb.load())
    L = S[(S.snap == "list") & S.y_arr.notna() & (S.tyear <= 2023)]
    r = {}
    r["k4_by_list_year"] = L.groupby("tyear").y_arr.mean().round(4).to_dict()
    r["k4_by_year_state"] = L.groupby(["tyear", "list_state"]).y_arr.mean().round(3).unstack().to_dict("index")
    r["coverage_by_list_year"] = L.groupby("tyear").agg(drafted_2011plus=("drafted", "mean"),
                                                        drafted_full=("drafted_full", "mean"),
                                                        org_rows=("on_org", "sum")).round(3).to_dict("index")
    r["k4_by_year_drafted_2011plus"] = L.groupby(["tyear", "drafted"]).y_arr.mean().round(3).unstack() \
        .to_dict("index")
    r["k4_by_year_path"] = L.groupby(["tyear", "path"]).y_arr.mean().round(3).unstack().to_dict("index")
    r["n_by_year_path"] = L.groupby(["tyear", "path"]).size().unstack().to_dict("index")
    r["k4_by_era_path_state"] = L.assign(era=np.where(L.tyear >= 2021, "2021-23", np.where(L.tyear >= 2015,
                                                                                          "2015-20", "2011-14")),
                                         listed=L.list_state != "unlisted") \
        .groupby(["era", "path", "listed"]).y_arr.mean().round(3).rename(lambda k: k, axis=0).reset_index() \
        .assign(k=lambda d: "path" + d.path.astype(str) + ("_listed" if False else "") + np.where(d.listed, "_listed", "_unlisted")) \
        .pivot(index="era", columns="k", values="y_arr").to_dict("index")
    # spent holdout + dev predictions, mean predicted vs observed (POST-HOC, diagnosis only)
    dp = pd.concat([pd.read_parquet(pb.RES / "prospect_99_dev_preds.parquet"),
                    pd.read_parquet(pb.RES / "prospect_99_holdout_preds.parquet")])
    dp = dp[dp.task == "arr"]
    r["calibration_in_the_large_posthoc"] = dp.groupby("tyear")[["y_arr", "B1_raw", "B1", "LGB_raw", "LGB"]].mean() \
        .round(3).to_dict("index")
    # training-window covariate drift for the 2022 holdout fold (train lists <= 2018) vs the 2022 list
    tr, te = pb.arrival_split(S, 2022)
    r["train_vs_test_2022"] = {c: [round(float(tr[c].astype(float).mean()), 3), round(float(te[c].astype(float).mean()), 3)]
                               for c in ("y_arr", "drafted", "drafted_full", "on_org", "org_frac0", "log_pick0")}
    print(json.dumps(r, indent=1, default=str))
    (pb.RES / "prospect_99h_diag.json").write_text(json.dumps(r, indent=1, default=str))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    for f in ("fetch", "diag", "dev", "summary"):
        ap.add_argument(f"--{f}", action="store_true")
    a = ap.parse_args()
    if a.fetch:
        fetch()
    if a.diag:
        diag()
    if a.dev:
        dev()
    if a.summary:
        summarize()
