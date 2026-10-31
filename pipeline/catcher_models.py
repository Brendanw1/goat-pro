"""§108 (RESULTS-MLB): our xCS% and expected WP+PB, pre-registered before any read. Run once.

    python pipeline/catcher_models.py          # fit, gate, write results/catcher_models_SEALED.json + cache/catcher/*_pred.parquet
    python pipeline/catcher_models.py --v2     # §108a-v2 (pre-registered f770c20): LOSO xCS%, writes results/catcher_xcs_v2_SEALED.json
    python pipeline/catcher_models.py --demo   # self-checks of the decile gap, the shrunk baseline and the v2 lead feature

Catcher-grouped 5-fold CV on the training seasons; the last season (2026) held out and scored once by a model fit on
every training season. Baselines and gates exactly as written in §108.
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from lightgbm import LGBMClassifier
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import log_loss, roc_auc_score
from sklearn.model_selection import GroupKFold

PIPE = Path(__file__).resolve().parent
sys.path.insert(0, str(PIPE))
from paths import MART_DIR  # noqa: E402

CACHE, RES = PIPE.parent / "cache" / "catcher", PIPE / "results"
HOLD = 2026
PARAMS = dict(num_leaves=15, n_estimators=300, learning_rate=0.05, min_child_samples=100, random_state=7, n_jobs=4,
              verbose=-1)


def decile_gap(y, p):
    q = pd.qcut(pd.Series(p).rank(method="first"), 10, labels=False)
    g = pd.DataFrame({"y": y, "p": p, "q": q}).groupby("q").mean()
    return float((g["y"] - g["p"]).abs().max())


def shrunk_rate(hits, n, prior, k):
    return (hits + k * prior) / (n + k)


def fit_predict(df, feats, label, train_seasons):
    """OOF on the training seasons (grouped by catcher), then the held-out season from a full-train fit."""
    tr = df[df["season"].isin(train_seasons)].reset_index(drop=True)
    ho = df[df["season"] == HOLD].reset_index(drop=True)
    oof = np.zeros(len(tr))
    for a, b in GroupKFold(n_splits=5).split(tr, tr[label], groups=tr["catcher"]):
        m = LGBMClassifier(**PARAMS).fit(tr.iloc[a][feats], tr.iloc[a][label])
        oof[b] = m.predict_proba(tr.iloc[b][feats])[:, 1]
    m = LGBMClassifier(**PARAMS).fit(tr[feats], tr[label])
    return tr.assign(p=oof), ho.assign(p=m.predict_proba(ho[feats])[:, 1])


def baselines(tr, ho, label, base_keys, k):
    """(i) league rate from the latest training season by base_keys; (ii) catcher's own other-season rate, shrunk."""
    last = tr[tr["season"] == tr["season"].max()]
    lg = last.groupby(base_keys)[label].mean() if base_keys else pd.Series(dtype=float)
    lr = last[label].mean()
    p_lg = ho[base_keys].apply(lambda r: lg.get(tuple(r) if len(base_keys) > 1 else r.iloc[0], lr), axis=1).to_numpy() \
        if base_keys else np.full(len(ho), lr)
    c = tr.groupby("catcher")[label].agg(["sum", "size"])
    p_c = np.array([shrunk_rate(c.loc[i, "sum"], c.loc[i, "size"], lr, k) if i in c.index else lr for i in ho["catcher"]])
    return p_lg, p_c


def credit_gates(pred, label, sav, sav_col, min_n, sign):
    """G3/G4: per catcher-season credit (sign * (label - p)) vs Savant's column; YTY vs theirs on the same pairs."""
    cs = pred.groupby(["catcher", "season"]).agg(n=(label, "size"), y=(label, "sum"), p=("p", "sum")).reset_index()
    cs["credit"] = sign * (cs["y"] - cs["p"])
    cs["rate"] = cs["credit"] / cs["n"]
    j = cs[cs["n"] >= min_n].merge(sav, on=["catcher", "season"])
    per = {int(s): round(float(g["credit"].corr(g[sav_col])), 3) for s, g in j.groupby("season") if len(g) >= 15}
    pooled = float(j["credit"].corr(j[sav_col]))
    j["sav_rate"] = j[sav_col] / j["n"]
    nxt = j.assign(season=j["season"] - 1)
    yy = j.merge(nxt, on=["catcher", "season"], suffixes=("", "_n"))
    ours, theirs = float(yy["rate"].corr(yy["rate_n"])), float(yy["sav_rate"].corr(yy["sav_rate_n"]))
    return cs, {"n_catcher_seasons": int(len(j)), "pooled_r": round(pooled, 3), "per_season_r": per,
                "g3_pass": bool(pooled >= .80 and all(v >= .70 for v in per.values())),
                "yty_pairs": int(len(yy)), "yty_ours": round(ours, 3), "yty_savant": round(theirs, 3),
                "g4_pass": bool(ours >= .75 * theirs)}


def xcs(con):
    th = pd.concat([pd.read_parquet(p) for p in sorted(CACHE.glob("throwing_*.parquet"))], ignore_index=True)
    th = th[(th["is_pitchout"] != 1) & th["target_base"].isin(["2B", "3B"])].drop_duplicates(
        ["game_pk", "at_bat_number", "play_init_seq", "runner_id"]).rename(columns={"catcher_id": "catcher", "year": "season"})
    th = th.reset_index(drop=True)
    pt = con.sql("""SELECT game_pk, at_bat_number, pitch_number AS play_init_seq, pitch_type, plate_x, plate_z, balls, strikes
                    FROM pitches_all WHERE game_type = 'R' AND season >= 2020""").df()
    j = th.merge(pt, on=["game_pk", "at_bat_number", "play_init_seq"], how="left")
    match = float(j["plate_x"].notna().mean())
    feats = ["seasonal_sprint_speed", "r_primary_lead", "base3", "lhp", "is_sba_delayed", "N_prior_pickoffs_with_reset",
             "season"]
    j["base3"] = (j["target_base"] == "3B").astype(int)
    j["lhp"] = (j["pitch_hand"] == "L").astype(int)
    if match >= .95:
        j["fam"] = j["pitch_type"].astype("category")
        feats += ["fam", "plate_x", "plate_z", "balls", "strikes"]
    tr, ho = fit_predict(j, feats, "is_runner_cs", range(2020, HOLD))
    p_lg, p_c = baselines(tr, ho, "is_runner_cs", ["base3"], 30)
    y = ho["is_runner_cs"].to_numpy()
    ll = {"model": log_loss(y, ho["p"]), "league": log_loss(y, p_lg), "catcher_only": log_loss(y, p_c)}
    g1 = ll["model"] <= .97 * ll["league"] and ll["model"] < ll["catcher_only"]
    pred = pd.concat([tr, ho], ignore_index=True)
    gap = decile_gap(tr["is_runner_cs"].to_numpy(), tr["p"].to_numpy())
    sav = pd.concat([con.sql(f"SELECT player_id AS catcher, caught_stealing_above_average AS csaa FROM "
                             f"lb_catcher_throwing_{s}").df().assign(season=s) for s in range(2020, 2027)])
    cs, cg = credit_gates(pred, "is_runner_cs", sav, "csaa", 30, 1)
    pop = pred.groupby(["catcher", "season"])["pop_time"].mean().rename("pop").reset_index()
    q = cs[cs["n"] >= 30].merge(pop, on=["catcher", "season"])
    r_pop = float(q["rate"].corr(q["pop"]))
    out = {"n_train": int(len(tr)), "n_holdout": int(len(ho)), "pitch_join_match": round(match, 4), "features": feats,
           "oof_auc": round(float(roc_auc_score(tr["is_runner_cs"], tr["p"])), 4),
           "holdout_auc": round(float(roc_auc_score(y, ho["p"])), 4),
           "holdout_logloss": {k: round(float(v), 5) for k, v in ll.items()}, "g1_pass": bool(g1),
           "oof_decile_gap": round(gap, 4), "g2_pass": bool(gap <= .03), **cg,
           "pop_r": round(r_pop, 3), "g5_pass": bool(r_pop <= -.40)}
    out["verdict"] = "SHIP" if all(out[g] for g in ("g1_pass", "g2_pass", "g3_pass", "g4_pass", "g5_pass")) else "DESCRIPTIVE"
    pred[["game_pk", "at_bat_number", "play_init_seq", "runner_id", "catcher", "season", "p"]].to_parquet(CACHE / "xcs_pred.parquet")
    return out


def xpbwp(con):
    bl = pd.concat([pd.read_parquet(p) for p in sorted(CACHE.glob("blocking_*.parquet"))], ignore_index=True).drop_duplicates(["play_id"]).rename(
        columns={"catcher_id": "catcher", "year": "season"}).reset_index(drop=True)
    bl = bl[bl["location_x"].notna() & bl["location_z"].notna()]
    bl["typ"] = bl["api_pitch_type_subgroup"].astype("category")
    bl["lhp"], bl["lhb"] = (bl["pitch_hand"] == "L").astype(int), (bl["bat_side"] == "L").astype(int)
    feats = ["location_x", "location_z", "is_pitch_ground", "typ", "lhp", "lhb", "api_plate_time", "season"]
    tr, ho = fit_predict(bl, feats, "is_runner_pbwp", range(2021, HOLD))
    p_lg, p_c = baselines(tr, ho, "is_runner_pbwp", [], 2000)
    y = ho["is_runner_pbwp"].to_numpy()
    ll = {"model": log_loss(y, ho["p"]), "league": log_loss(y, p_lg), "catcher_only": log_loss(y, p_c)}
    g1 = ll["model"] <= .90 * ll["league"] and ll["model"] < ll["catcher_only"]
    pred = pd.concat([tr, ho], ignore_index=True)
    gap = decile_gap(tr["is_runner_pbwp"].to_numpy(), tr["p"].to_numpy())
    sav = pd.concat([con.sql(f"SELECT player_id AS catcher, blocks_above_average AS baa FROM "
                             f"lb_catcher_blocking_{s}").df().assign(season=s) for s in range(2021, 2027)])
    _, cg = credit_gates(pred, "is_runner_pbwp", sav, "baa", 1500, -1)
    out = {"n_train": int(len(tr)), "n_holdout": int(len(ho)), "features": feats,
           "oof_auc": round(float(roc_auc_score(tr["is_runner_pbwp"], tr["p"])), 4),
           "holdout_auc": round(float(roc_auc_score(y, ho["p"])), 4),
           "holdout_logloss": {k: round(float(v), 5) for k, v in ll.items()}, "g1_pass": bool(g1),
           "oof_decile_gap": round(gap, 5), "g2_pass": bool(gap <= .005), **cg}
    out["verdict"] = "SHIP" if all(out[g] for g in ("g1_pass", "g2_pass", "g3_pass", "g4_pass")) else "DESCRIPTIVE"
    pred[["play_id", "catcher", "season", "p"]].to_parquet(CACHE / "xpbwp_pred.parquet")
    return out


# §108a-v2 (RESULTS-MLB, pre-registered f770c20 before any fit or read)
PARAMS_V2 = dict(num_leaves=7, max_depth=3, n_estimators=200, learning_rate=0.05, min_child_samples=200, random_state=7,
                 n_jobs=4, verbose=-1)
K_LEAD = 300
FEATS_V2 = ["seasonal_sprint_speed", "r_primary_lead", "base3", "lhp", "is_sba_delayed", "prior_pk", "season", "lead_gain"]


def lead_other(pitcher, season, t, board, k=K_LEAD):
    """Pitcher's n_init-weighted lead gained over board seasons not in {season, t}, shrunk to the league of the same seasons."""
    b = board.set_index(["pitcher_id", "season"])
    lg = board.groupby("season")[["n", "nx"]].sum()
    pt = board.groupby("pitcher_id")[["n", "nx"]].sum()
    out = np.empty(len(pitcher))
    for i, (pid, s) in enumerate(zip(pitcher, season)):
        excl = {s, t}
        L = lg.drop(index=[e for e in excl if e in lg.index]).sum()
        lmean = L["nx"] / L["n"]
        n, nx = (pt.loc[pid, "n"], pt.loc[pid, "nx"]) if pid in pt.index else (0.0, 0.0)
        for e in excl:
            if (pid, e) in b.index:
                n, nx = n - b.loc[(pid, e), "n"], nx - b.loc[(pid, e), "nx"]
        out[i] = (nx + k * lmean) / (n + k)
    return out


def fit_cal(tr, label):
    """Shallow LightGBM + isotonic fitted on inner OOF (5-fold grouped by catcher) predictions only."""
    oof = np.zeros(len(tr))
    for a, b in GroupKFold(n_splits=5).split(tr, tr[label], groups=tr["catcher"]):
        m = LGBMClassifier(**PARAMS_V2).fit(tr.iloc[a][FEATS_V2], tr.iloc[a][label])
        oof[b] = m.predict_proba(tr.iloc[b][FEATS_V2])[:, 1]
    iso = IsotonicRegression(y_min=0, y_max=1, out_of_bounds="clip").fit(oof, tr[label])
    m = LGBMClassifier(**PARAMS_V2).fit(tr[FEATS_V2], tr[label])
    return lambda X: iso.predict(m.predict_proba(X[FEATS_V2])[:, 1])


def xcs_v2(con):
    th = pd.concat([pd.read_parquet(p) for p in sorted(CACHE.glob("throwing_*.parquet"))], ignore_index=True)
    th = th[(th["is_pitchout"] != 1) & th["target_base"].isin(["2B", "3B"])].drop_duplicates(
        ["game_pk", "at_bat_number", "play_init_seq", "runner_id"]).rename(columns={"catcher_id": "catcher", "year": "season"})
    pk = pd.concat([pd.read_parquet(p) for p in sorted(CACHE.glob("pickoffs_*.parquet"))]).drop_duplicates(["play_id", "runner_id"])
    th = th.merge(pk[["play_id", "runner_id", "prior_pk"]], on=["play_id", "runner_id"], how="left").reset_index(drop=True)
    board = pd.concat([pd.read_parquet(p) for p in sorted(CACHE.glob("pitcher_running_*.parquet"))], ignore_index=True)
    board = board[board["r_sec_minus_prim_lead"].notna() & (board["n_init"] > 0)].assign(
        n=lambda d: d["n_init"].astype(float), nx=lambda d: d["n_init"] * d["r_sec_minus_prim_lead"].astype(float))
    board["pitcher_id"] = board["pitcher_id"].astype(int)
    th["pitcher_id"], th["season"] = th["pitcher_id"].astype(int), th["season"].astype(int)
    board["season"] = board["season"].astype(int)
    th["base3"] = (th["target_base"] == "3B").astype(int)
    th["lhp"] = (th["pitch_hand"] == "L").astype(int)
    same = board.set_index(["pitcher_id", "season"])["r_sec_minus_prim_lead"].astype(float)
    lg_season = board.groupby("season").apply(lambda d: d["nx"].sum() / d["n"].sum())
    th["lead_same"] = [same.get((p, s), np.nan) for p, s in zip(th["pitcher_id"], th["season"])]
    th["lead_same"] = th["lead_same"].fillna(th["season"].map(lg_season))
    th["lead_lg"] = th["season"].map(lg_season)
    y_all = "is_runner_cs"
    parts = []
    for t in range(2020, 2027):
        te = th[th["season"] == t].copy()
        trall = th[th["season"] != t].copy()
        trall["lead_gain"] = lead_other(trall["pitcher_id"].to_numpy(), trall["season"].to_numpy(), t, board)
        te["lead_gain"] = lead_other(te["pitcher_id"].to_numpy(), te["season"].to_numpy(), t, board)
        te["p"], te["p_same"], te["p_lg"] = np.nan, np.nan, np.nan
        for _, b in GroupKFold(n_splits=5).split(te, te[y_all], groups=te["catcher"]):
            idx = te.index[b]
            tr = trall[~trall["catcher"].isin(te.loc[idx, "catcher"].unique())].reset_index(drop=True)
            f = fit_cal(tr, y_all)
            te.loc[idx, "p"] = f(te.loc[idx])
            te.loc[idx, "p_same"] = f(te.loc[idx].assign(lead_gain=te.loc[idx, "lead_same"]))
            te.loc[idx, "p_lg"] = f(te.loc[idx].assign(lead_gain=te.loc[idx, "lead_lg"]))
        near = t - 1 if t > 2020 else 2021
        last = th[th["season"] == near]
        lgb = last.groupby("base3")[y_all].mean()
        te["p_league"] = te["base3"].map(lgb).fillna(last[y_all].mean())
        lr = trall[y_all].mean()
        c = trall.groupby("catcher")[y_all].agg(["sum", "size"])
        te["p_catcher"] = [shrunk_rate(c.loc[i, "sum"], c.loc[i, "size"], lr, 30) if i in c.index else lr
                           for i in te["catcher"]]
        parts.append(te)
        print(f"fold {t} scored ({len(te)} attempts)", flush=True)
    pred = pd.concat(parts, ignore_index=True)
    y = pred[y_all].to_numpy()
    ll = {k: float(log_loss(y, pred[c])) for k, c in (("model", "p"), ("league", "p_league"), ("catcher_only", "p_catcher"))}
    g1 = ll["model"] <= .97 * ll["league"] and ll["model"] < ll["catcher_only"]
    gap = decile_gap(y, pred["p"].to_numpy())
    sav = pd.concat([con.sql(f"SELECT player_id AS catcher, caught_stealing_above_average AS csaa FROM "
                             f"lb_catcher_throwing_{s}").df().assign(season=s) for s in range(2020, 2027)])
    cs, cg = credit_gates(pred, y_all, sav, "csaa", 30, 1)
    pop = pred.groupby(["catcher", "season"])["pop_time"].mean().rename("pop").reset_index()
    q = cs[cs["n"] >= 30].merge(pop, on=["catcher", "season"])
    r_pop = float(q["rate"].corr(q["pop"]))
    pred["pcredit"] = pred["p_same"] - pred["p_lg"]
    pc = pred.groupby(["pitcher_id", "season"]).agg(n=("pcredit", "size"), c=("pcredit", "mean")).reset_index()
    pc = pc[pc["n"] >= 15]
    pp = pc.merge(pc.assign(season=pc["season"] - 1), on=["pitcher_id", "season"], suffixes=("", "_n"))
    r6 = float(pp["c"].corr(pp["c_n"]))
    dec = pd.DataFrame({"y": y, "p": pred["p"], "q": pd.qcut(pred["p"].rank(method="first"), 10, labels=False)}).groupby("q").mean()
    out = {"n": int(len(pred)), "features": FEATS_V2, "params": {k: v for k, v in PARAMS_V2.items() if k != "verbose"},
           "k_lead": K_LEAD, "prior_pk_match": round(float(pred["prior_pk"].notna().mean()), 4),
           "auc": round(float(roc_auc_score(y, pred["p"])), 4),
           "auc_savant_exp_cs": round(float(roc_auc_score(y, pred["exp_cs"].fillna(pred["exp_cs"].mean()))), 4),
           "loso_logloss": {k: round(v, 5) for k, v in ll.items()}, "g1_pass": bool(g1),
           "per_season_logloss": {int(s): round(float(log_loss(g[y_all], g["p"], labels=[0, 1])), 4)
                                  for s, g in pred.groupby("season")},
           "decile_table": {int(i): [round(float(r["p"]), 4), round(float(r["y"]), 4)] for i, r in dec.iterrows()},
           "decile_gap": round(gap, 4), "g2_pass": bool(gap <= .03), **cg,
           "pop_r": round(r_pop, 3), "g5_pass": bool(r_pop <= -.40),
           "g6_pairs": int(len(pp)), "g6_pitcher_credit_yty": round(r6, 3), "g6_pass": bool(r6 >= .30),
           "p_exact_0_or_1": int(((pred["p"] <= 0) | (pred["p"] >= 1)).sum())}
    out["verdict"] = "SHIP" if all(out[f"g{i}_pass"] for i in range(1, 7)) else "DESCRIPTIVE"
    pred[["game_pk", "at_bat_number", "play_init_seq", "runner_id", "catcher", "pitcher_id", "season", "p", "pcredit"]
         ].to_parquet(CACHE / "xcs_v2_pred.parquet")
    return out


def main_v2():
    sealed = RES / "catcher_xcs_v2_SEALED.json"
    if sealed.exists():
        raise SystemExit(f"{sealed} exists: §108a-v2 is read once")
    sys.path.insert(0, str(MART_DIR))
    import mart
    con = mart.connect()
    con.execute("SET threads TO 4")
    res = {"prereg": "RESULTS-MLB §108a-v2 (committed f770c20 before any fit or read)", "xcs_v2": xcs_v2(con)}
    sealed.write_text(json.dumps(res, indent=1))
    print(json.dumps(res, indent=1))


def main():
    sealed = RES / "catcher_models_SEALED.json"
    if sealed.exists():
        raise SystemExit(f"{sealed} exists: §108 is read once")
    sys.path.insert(0, str(MART_DIR))
    import mart
    con = mart.connect()
    con.execute("SET threads TO 4")
    res = {"prereg": "RESULTS-MLB §108 (committed 35a7114 before any read)", "xcs": xcs(con), "xpbwp": xpbwp(con)}
    sealed.write_text(json.dumps(res, indent=1))
    print(json.dumps(res, indent=1))


def demo():
    y, p = np.array([0, 1] * 50), np.full(100, 0.5)
    assert decile_gap(y, p) <= 0.5 and shrunk_rate(0, 0, .2, 30) == .2 and shrunk_rate(30, 30, 0, 30) == .5
    bd = pd.DataFrame({"pitcher_id": [1, 1, 1, 2], "season": [2020, 2021, 2022, 2021], "n": [100., 100., 100., 300.],
                       "nx": [200., 400., 600., 1200.]})
    v = lead_other(np.array([1, 1, 9]), np.array([2021, 2020, 2021]), 2022, bd, k=300)
    # p1 in 2021, test 2022: only 2020 left (n 100, x 2) vs league of 2020 (=2): 2.0; p1 in 2020: 2021 only (x 4) shrunk
    # to league 2021 ((400+1200)/400 = 4): 4.0; unknown pitcher gets the league of {2020, 2022}... excl {2021, 2022} -> 2.
    assert np.allclose(v, [2.0, 4.0, 2.0]), v
    print("demo ok")


if __name__ == "__main__":
    demo() if "--demo" in sys.argv else main_v2() if "--v2" in sys.argv else main()
