"""prospect_backtest.py — §99 phase 2: pre-registered backtest (RESULTS-MLB §99d) on the §99 feature store.

    python pipeline/prospect_backtest.py --dev            # dev folds: B1, v0u, LightGBM (nested selection), ablation
    python pipeline/prospect_backtest.py --holdout        # reads the frozen spec; ONE read of the holdouts

Models: B1 (Pipeline + draft + age logistic), v0u (§97 v0 spec on the wide universe), LGB (LightGBM hurdle on every
feature family, families selected inside each training window), NPY (prospect_bayes.py predictions, merged if present).
Arrival: debut_k4, forward chained (train lists <= Y-4, eos seasons <= Y-5). Value: control-years FSE if debut within
4 seasons else 0, matured lists <= 2017, train lists < Y minus test-year players. Hitters and pitchers fit apart.
"""
import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
SNAP = ROOT / "data" / "milb" / "prospect_snapshots.parquet"
RES = ROOT / "pipeline" / "results"
FROZEN = RES / "prospect_99_frozen.json"
ARR_DEV, ARR_HOLD = list(range(2015, 2022)), [2022, 2023]
VAL_DEV, VAL_HOLD = [2013, 2014, 2015], [2016, 2017]
THREADS = 2

FAMILIES = {
    "env": ["lvl", "age", "age_rel", "lg_r_bf", "n_last", "n_levels_last", "yrs_since_line", "career_pa", "career_bf",
            "mlb_pa_prior", "mlb_bf_prior"],
    "rates": ["hz_k_l1", "hz_k_2y", "hz_bb_l1", "hz_bb_2y", "hz_iso_l1", "hz_iso_2y", "hz_babip_l1", "hz_babip_2y",
              "hz_sb_l1", "hz_sb_2y", "pz_k_l1", "pz_k_2y", "pz_bb_l1", "pz_bb_2y", "pz_hr_l1", "pz_hr_2y", "pz_gb_l1",
              "pz_gb_2y", "pz_kbb_2y", "gs_share", "ip_career"],
    "promotion": ["lvl_gain_1y", "lvl_per_yr", "yrs_pro"],
    "draft": ["drafted", "pick", "round", "bonus", "yrs_since_draft", "draft_age"],
    "pipeline": ["state_code", "top_rank", "org_rank", "org_frac", "org_list_len", "pos_rank", "eta_gap"],
    "position": ["pos_code", "fld_rf9", "fld_err_rate", "premium_pos_share"],
    "health": ["il_n_365", "il_n_career", "il_60day_365", "health_avail"],
    "org": ["org_code"],
}
# Structurally absent from every training window of this backtest (seasons 2023+/2021+ only): AAA Statcast, §88 MLE.
# Pipeline grades: excluded by the §99b rule (not shown to be point-in-time).
MONO = {"top_rank": -1, "org_frac": -1, "org_rank": -1, "lvl": 1}


def load():
    S = pd.read_parquet(SNAP)
    S["tyear"] = np.where(S.snap == "list", S.as_of.dt.year, S.as_of.dt.year + 1)   # first label season
    S["state_code"] = S.list_state.map({"unlisted": 0, "org": 1, "top100": 2})
    S["pos_code"] = S.pos_main.astype("category").cat.codes
    S["org_code"] = S.org_id.fillna(-1).astype(int)
    fse = np.where(S.pitcher, S.ctrl_bf / 700, S.ctrl_pa / 600)
    S["y_val"] = np.where((S.t_debut >= 0) & (S.t_debut <= 3), np.nan_to_num(fse), 0.0)
    S["y_arr"] = S.debut_k4
    # B1 / v0 helper columns
    S["has_top"] = S.top_rank.notna().astype(float)
    S["log_top"] = np.log(S.top_rank.fillna(150))
    S["on_org"] = S.org_rank.notna().astype(float)
    S["org_frac0"] = S.org_frac.fillna(1.2)
    S["log_pick0"] = np.log(S.pick.fillna(1500))
    S["age0"] = S.age.fillna(S.age.median())
    S["has_line"] = S.n_last.notna().astype(float)
    S["logn"] = np.log1p(S.n_last.fillna(0))
    return S


def arrival_split(S, Y):
    te = S[(S.snap == "list") & (S.tyear == Y) & S.y_arr.notna()]
    tr = S[(S.tyear <= Y - 4) & S.y_arr.notna() & ~S.id.isin(te.id)]
    return tr, te


def value_split(S, Y):
    te = S[(S.snap == "list") & (S.tyear == Y) & (S.event != "debuted_before")]
    tr = S[(S.tyear < Y) & (S.event != "debuted_before") & ~S.id.isin(te.id) & (S.tyear <= 2017)]
    return tr, te


def inner_split(tr, seed=0):
    last = tr.tyear.max()
    va = tr[tr.tyear == last]
    it = tr[(tr.tyear < last) & ~tr.id.isin(va.id)]
    if len(it) < 1000:                       # one training year only: player-grouped 70/30
        rng = np.random.default_rng(seed)
        ids = tr.id.unique()
        vid = set(rng.choice(ids, len(ids) * 3 // 10, replace=False))
        va, it = tr[tr.id.isin(vid)], tr[~tr.id.isin(vid)]
    return it, va


# ------------------------------------------------------------------ models
B1_COLS = ["has_top", "log_top", "on_org", "org_frac0", "drafted", "log_pick0", "age0"]
V0_COLS = B1_COLS + ["age_rel", "lvl", "logn", "has_line"]


def v0_cols(pit):
    z = ["pz_k_l1", "pz_bb_l1", "pz_hr_l1", "pz_gb_l1"] if pit else ["hz_k_l1", "hz_bb_l1", "hz_iso_l1", "hz_babip_l1",
                                                                      "hz_sb_l1"]
    return V0_COLS + z


def _lin_fit(tr, cols, y, org=False, kind="logit"):
    from sklearn.linear_model import LogisticRegression, Ridge
    cols = [c for c in cols if tr[c].astype(float).fillna(0).std() > 0]   # constant in training (e.g. no picks before
    X = tr[cols].astype(float).fillna(0)                                   # the 2011 draft) -> no extrapolation
    mu, sd = X.mean(), X.std().replace(0, 1)
    Xs = (X - mu) / sd
    orgs = None
    if org:
        orgs = sorted(tr.org_code.unique())
        Xs = pd.concat([Xs, pd.get_dummies(tr.org_code).reindex(columns=orgs, fill_value=0).astype(float) * 0.5],
                       axis=1)
    m = (LogisticRegression(C=1.0, max_iter=2000) if kind == "logit" else Ridge(alpha=1.0))
    m.fit(Xs.values, tr[y].values if kind == "logit" else np.log1p(tr[y].values))

    def pred(te):
        Z = (te[cols].astype(float).fillna(0) - mu) / sd
        if org:
            Z = pd.concat([Z, pd.get_dummies(te.org_code).reindex(columns=orgs, fill_value=0).astype(float) * 0.5],
                          axis=1)
        return m.predict_proba(Z.values)[:, 1] if kind == "logit" else np.expm1(m.predict(Z.values)).clip(0)
    return pred


def lin_model(name):
    def fit(tr, pit, task):
        cols = B1_COLS if name == "B1" else v0_cols(pit)
        org = name == "v0u"
        pa = _lin_fit(tr, cols, "y_arr", org)
        if task == "arr":
            return pa, None
        reach = tr[tr.y_val > 0]
        pv = _lin_fit(reach, cols, "y_val", org, kind="ridge")
        return pa, pv
    return fit


def lgb_params(leaves, mcs):
    return dict(num_leaves=leaves, min_child_samples=mcs, learning_rate=0.03, n_estimators=2000, subsample=0.8,
                subsample_freq=1, colsample_bytree=0.8, reg_lambda=1.0, n_jobs=THREADS, verbose=-1, random_state=99)


def lgb_fit_one(tr, va, feats, y, kind, leaves=31, mcs=100):
    import lightgbm as lgb
    mono = [MONO.get(f, 0) for f in feats]
    cls = lgb.LGBMClassifier if kind == "clf" else lgb.LGBMRegressor
    m = cls(**lgb_params(leaves, mcs), monotone_constraints=mono, monotone_constraints_method="advanced")
    yt = tr[y].values if kind == "clf" else np.log1p(tr[y].values)
    if va is not None:
        yv = va[y].values if kind == "clf" else np.log1p(va[y].values)
        m.fit(tr[feats], yt, eval_set=[(va[feats], yv)], callbacks=[lgb.early_stopping(100, verbose=False)])
    else:
        m.fit(tr[feats], yt)
    return m


def _feats(fams, pit):
    f = [c for fam in fams for c in FAMILIES[fam]]
    return [c for c in f if not c.startswith("pz_" if not pit else "hz_")]


def brier(y, p):
    return float(np.mean((np.asarray(p) - np.asarray(y)) ** 2))


def lgb_select(tr, pit, task):
    """Wide then select, inside the training window only: start with every family; backward elimination on the
    inner validation year(s); then a 4-point hyper-grid; Platt fitted on inner validation predictions."""
    it, va = inner_split(tr)
    y = "y_arr"

    def score(fams, leaves=31, mcs=100):
        feats = _feats(fams, pit)
        m = lgb_fit_one(it, va, feats, y, "clf", leaves, mcs)
        p = m.predict_proba(va[feats])[:, 1]
        s = brier(va[y], p)
        if task == "val":                    # value folds select on the EV ranking (NDCG@100 on inner val)
            reach = it[it.y_val > 0]
            r = _lgb("reg", {"leaves": leaves, "mcs": mcs}, feats, 300).fit(reach[feats], np.log1p(reach.y_val))
            ev = p * np.expm1(r.predict(va[feats])).clip(0)
            s = -ndcg_at(va.assign(score=ev), "score", 100)
        return s, m, feats
    fams = list(FAMILIES)
    best, _, _ = score(fams)
    log = [("all", best)]
    improved = True
    while improved and len(fams) > 1:
        improved = False
        trial = {f: score([g for g in fams if g != f])[0] for f in fams}
        f, s = min(trial.items(), key=lambda kv: kv[1])
        if s < best - 1e-5:
            fams.remove(f)
            best, improved = s, True
            log.append((f"-{f}", s))
    grid = {(lv, mc): score(fams, lv, mc)[0] for lv in (15, 31) for mc in (50, 200)}
    lv, mc = min(grid, key=grid.get)
    s, m, feats = score(fams, lv, mc)
    pva = m.predict_proba(va[feats])[:, 1]
    platt = fit_platt(pva, va[y].values)
    return dict(fams=fams, leaves=lv, mcs=mc, n_iter=int(m.best_iteration_ or 300), platt=platt, log=log)


def fit_platt(p, y):
    from sklearn.linear_model import LogisticRegression
    lp = np.log(np.clip(p, 1e-4, 1 - 1e-4) / (1 - np.clip(p, 1e-4, 1 - 1e-4)))
    m = LogisticRegression(C=1e6).fit(lp[:, None], y)
    return [float(m.coef_[0, 0]), float(m.intercept_[0])]


def apply_platt(p, ab):
    lp = np.log(np.clip(p, 1e-4, 1 - 1e-4) / (1 - np.clip(p, 1e-4, 1 - 1e-4)))
    return 1 / (1 + np.exp(-(ab[0] * lp + ab[1])))


def _lgb(kind, spec, feats, n):
    import lightgbm as lgb
    cls = lgb.LGBMClassifier if kind == "clf" else lgb.LGBMRegressor
    return cls(**{**lgb_params(spec["leaves"], spec["mcs"]), "n_estimators": n},
               monotone_constraints=[MONO.get(f, 0) for f in feats], monotone_constraints_method="advanced")


def lgb_fit_final(tr, te, pit, task, spec):
    feats = _feats(spec["fams"], pit)
    m = _lgb("clf", spec, feats, max(spec["n_iter"], 50)).fit(tr[feats], tr.y_arr)
    p_raw = m.predict_proba(te[feats])[:, 1]
    out = {"p_raw": p_raw, "p": apply_platt(p_raw, spec["platt"])}
    if task == "val":
        reach = tr[tr.y_val > 0]
        r = _lgb("reg", spec, feats, 300).fit(reach[feats], np.log1p(reach.y_val))
        out["v"] = np.expm1(r.predict(te[feats])).clip(0)
    return out


# ------------------------------------------------------------------ metrics
def ece(y, p, bins=10):
    y, p = np.asarray(y), np.asarray(p)
    q = np.quantile(p, np.linspace(0, 1, bins + 1))
    b = np.clip(np.searchsorted(q, p, side="right") - 1, 0, bins - 1)
    return float(sum(abs(y[b == k].mean() - p[b == k].mean()) * (b == k).mean() for k in range(bins) if (b == k).any()))


def cal_slope(y, p):
    from sklearn.linear_model import LogisticRegression
    lp = np.log(np.clip(p, 1e-4, 1 - 1e-4) / (1 - np.clip(p, 1e-4, 1 - 1e-4)))
    m = LogisticRegression(C=1e6).fit(lp[:, None], y)
    return float(m.coef_[0, 0]), float(m.intercept_[0])


def logloss(y, p):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


def ndcg_at(d, col, k=100):
    g = d.y_val.values
    order = np.argsort(-d[col].values, kind="stable")[:k]
    ideal = np.sort(g)[::-1][:k]
    disc = 1 / np.log2(np.arange(2, k + 2))
    dcg = float((g[order] * disc[:len(order)]).sum())
    idcg = float((ideal * disc[:len(ideal)]).sum())
    return dcg / idcg if idcg > 0 else np.nan


def sleeper_pool(d):
    return d[(d.list_state == "unlisted") | (d.org_rank > 20)]


def prec_at(d, col, k=50):
    pool = sleeper_pool(d)
    top = pool.nlargest(k, col)
    return float((top.y_val >= 1.0).mean())


def arr_metrics(o, cols):
    from sklearn.metrics import roc_auc_score
    r = {}
    for c in cols:
        y, p = o.y_arr.values, o[c].values
        r[c] = {"brier": round(brier(y, p), 5), "logloss": round(logloss(y, p), 5), "ece": round(ece(y, p), 4),
                "slope_int": [round(x, 3) for x in cal_slope(y, p)], "auc": round(roc_auc_score(y, p), 4)}
    return r


def val_metrics(o, cols):
    from scipy.stats import spearmanr
    r = {}
    for c in cols:
        r[c] = {"ndcg100": round(float(np.nanmean([ndcg_at(g, c) for _, g in o.groupby("tyear")])), 4),
                "spearman": round(float(spearmanr(o[c], o.y_val).statistic), 4),
                "prec50_sleeper": round(float(np.mean([prec_at(g, c) for _, g in o.groupby("tyear")])), 4)}
    return r


def boot(o, fn, n=2000, seed=99):
    rng = np.random.default_rng(seed)
    ids = o.id.unique()
    pos = o.groupby("id").indices
    vals = []
    for _ in range(n):
        pick = rng.choice(ids, len(ids))
        idx = np.concatenate([pos[i] for i in pick])
        vals.append(fn(o.iloc[idx]))
    return [round(float(x), 5) for x in np.nanpercentile(vals, [2.5, 97.5])]


# ------------------------------------------------------------------ runs
def run_fold(S, Y, task, models, spec_lgb=None, ablate=False):
    tr, te = (arrival_split if task == "arr" else value_split)(S, Y)
    outs = []
    for pit in (False, True):
        a, b = tr[tr.pitcher == pit], te[te.pitcher == pit].copy()
        for name in models:
            if name in ("B1", "v0u"):
                pa, pv = lin_model(name)(a, pit, task)
                it, va = inner_split(a)
                pa_i, _ = lin_model(name)(it, pit, "arr")
                ab = fit_platt(pa_i(va), va.y_arr.values)
                b[f"{name}_raw"] = pa(b)
                b[name] = apply_platt(b[f"{name}_raw"].values, ab)
                if task == "val":
                    b[f"{name}_ev"] = b[f"{name}_raw"] * pv(b)
            elif name == "LGB":
                spec = spec_lgb[(pit, task)] if spec_lgb else lgb_select(a, pit, task)
                o = lgb_fit_final(a, b, pit, task, spec)
                b["LGB_raw"], b["LGB"] = o["p_raw"], o["p"]
                if task == "val":
                    b["LGB_ev"] = o["p_raw"] * o["v"]
                b.attrs.setdefault("spec", {})[str(pit)] = {k: v for k, v in spec.items()}
        if ablate:
            base = b.attrs["spec"][str(pit)]
            for fam in FAMILIES:
                sp = {**base, "fams": [f for f in FAMILIES if f != fam]}
                o = lgb_fit_final(a, b, pit, task, sp)
                b[f"abl_{fam}"] = o["p"] if task == "arr" else o["p_raw"] * o["v"]
            sp = {**base, "fams": list(FAMILIES)}
            o = lgb_fit_final(a, b, pit, task, sp)
            b["abl_none"] = o["p"] if task == "arr" else o["p_raw"] * o["v"]
        outs.append(b)
    return pd.concat(outs), {str(p): (outs[i].attrs.get("spec")) for i, p in enumerate((False, True))}


def dev():
    S = load()
    res, preds = {"arr": {}, "val": {}}, []
    specs = {}
    for task, years in (("arr", ARR_DEV), ("val", VAL_DEV)):
        parts = []
        for Y in years:
            o, sp = run_fold(S, Y, task, ["B1", "v0u", "LGB"], ablate=True)
            specs[f"{task}{Y}"] = sp
            o["task"] = task
            parts.append(o)
            print(task, Y, len(o), {k: v for k, v in sp.items()}, flush=True)
        o = pd.concat(parts)
        preds.append(o)
        abl = [c for c in o if c.startswith("abl_")]
        if task == "arr":
            res[task]["models"] = arr_metrics(o, ["B1", "v0u", "LGB", "B1_raw", "v0u_raw", "LGB_raw"])
            res[task]["per_year_brier"] = {int(y): {c: round(brier(g.y_arr, g[c]), 5) for c in ("B1", "v0u", "LGB")}
                                           for y, g in o.groupby("tyear")}
            res[task]["ablation_dbrier"] = {c[4:]: round(brier(o.y_arr, o[c]) - brier(o.y_arr, o.abl_none), 5)
                                            for c in abl if c != "abl_none"}
        else:
            res[task]["models"] = val_metrics(o, ["B1_ev", "v0u_ev", "LGB_ev"])
            base = np.nanmean([ndcg_at(g, "abl_none") for _, g in o.groupby("tyear")])
            res[task]["ablation_dndcg"] = {c[4:]: round(float(np.nanmean([ndcg_at(g, c) for _, g in o.groupby("tyear")])
                                                              - base), 4) for c in abl if c != "abl_none"}
    res["lgb_specs"] = specs
    pd.concat(preds).drop(columns=[c for c in pd.concat(preds).columns if c.startswith("abl_")]) \
        .to_parquet(RES / "prospect_99_dev_preds.parquet", compression="zstd")
    (RES / "prospect_99_dev.json").write_text(json.dumps(res, indent=1, default=str))
    print(json.dumps({k: v for k, v in res.items() if k != "lgb_specs"}, indent=1, default=str))


def merge_npy(o, task, years):
    parts = [pd.read_parquet(RES / f"prospect_99_npy_{task}{y}.parquet") for y in years
             if (RES / f"prospect_99_npy_{task}{y}.parquet").exists()]
    if not parts:
        return o
    n = pd.concat(parts)
    return o.merge(n.drop(columns=["tyear", "pitcher"]), on=["id", "as_of"], how="left")


def npy_platt(dev_o, Y):
    """NPY calibration: Platt on NPY dev predictions from list years <= Y - 4 (labels closed by Y's as-of)."""
    d = dev_o[(dev_o.task == "arr") & (dev_o.tyear <= Y - 4) & dev_o.NPY_raw.notna()]
    return fit_platt(d.NPY_raw.values, d.y_arr.values) if len(d) > 1000 else None


def summarize_dev():
    o = pd.read_parquet(RES / "prospect_99_dev_preds.parquet")
    a = merge_npy(o[o.task == "arr"], "arr", ARR_DEV)
    v = merge_npy(o[o.task == "val"], "val", VAL_DEV)
    res = json.loads((RES / "prospect_99_dev.json").read_text())
    if "NPY_raw" in a:
        a = a[a.NPY_raw.notna()]
        a["NPY"] = a.NPY_raw
        for Y in ARR_DEV:
            ab = npy_platt(a.assign(task="arr"), Y)
            if ab:
                m = a.tyear == Y
                a.loc[m, "NPY"] = apply_platt(a.loc[m, "NPY_raw"].values, ab)
        res["arr"]["models_npy_rows"] = arr_metrics(a, ["B1", "v0u", "LGB", "NPY", "B1_raw", "LGB_raw", "NPY_raw"])
        res["arr"]["npy_years"] = sorted(int(x) for x in a.tyear.unique())
    if "NPY_ev" in v:
        v = v[v.NPY_ev.notna()]
        res["val"]["models_npy_rows"] = val_metrics(v, ["B1_ev", "v0u_ev", "LGB_ev", "NPY_ev"])
    (RES / "prospect_99_dev.json").write_text(json.dumps(res, indent=1, default=str))
    print(json.dumps({k: {kk: vv for kk, vv in res[k].items()} for k in ("arr", "val")}, indent=1, default=str))


def holdout():
    spec = json.loads(FROZEN.read_text())
    assert spec.get("frozen"), "freeze the spec first"
    S = load()
    dev_o = pd.read_parquet(RES / "prospect_99_dev_preds.parquet")
    dev_o = merge_npy(dev_o[dev_o.task == "arr"], "arr", ARR_DEV).assign(task="arr")
    res = {"spec": spec}
    parts = []
    for Y in ARR_HOLD:
        o, sp = run_fold(S, Y, "arr", ["B1", "v0u", "LGB"])
        o = merge_npy(o, "arr", [Y])
        if "NPY_raw" in o:
            o["NPY"] = apply_platt(o.NPY_raw.values, npy_platt(dev_o, Y))
        parts.append(o)
    a = pd.concat(parts)
    M = spec["M_arr"]
    cols = [c for c in ("B1", "v0u", "LGB", "NPY") if c in a]
    res["arr"] = arr_metrics(a, cols)
    res["arr"]["n"] = len(a)
    res["arr"]["per_year"] = {int(y): {c: round(brier(g.y_arr, g[c]), 5) for c in cols} for y, g in a.groupby("tyear")}
    res["arr"]["gate_a"] = {"M": M, "dbrier_M_minus_B1": round(brier(a.y_arr, a[M]) - brier(a.y_arr, a.B1), 5),
                            "ci": boot(a, lambda d: brier(d.y_arr, d[M]) - brier(d.y_arr, d.B1)),
                            "ece_M": round(ece(a.y_arr, a[M]), 4),
                            "dbrier_M_minus_LGB": round(brier(a.y_arr, a[M]) - brier(a.y_arr, a.LGB), 5),
                            "ci_vs_LGB": boot(a, lambda d: brier(d.y_arr, d[M]) - brier(d.y_arr, d.LGB))}
    parts = []
    for Y in VAL_HOLD:
        o, _ = run_fold(S, Y, "val", ["B1", "v0u", "LGB"])
        parts.append(merge_npy(o, "val", [Y]))
    v = pd.concat(parts)
    Mv = spec["M_val"]
    cols = [c for c in ("B1_ev", "v0u_ev", "LGB_ev", "NPY_ev") if c in v]
    res["val"] = val_metrics(v, cols)
    res["val"]["n"] = len(v)

    def nd(d, c):
        return np.nanmean([ndcg_at(g, c) for _, g in d.groupby("tyear")])

    def pr(d, c):
        return np.mean([prec_at(g, c) for _, g in d.groupby("tyear")])
    res["val"]["gate_b"] = {"M": Mv, "dndcg_M_minus_B1": round(nd(v, Mv) - nd(v, "B1_ev"), 4),
                            "ci": boot(v, lambda d: nd(d, Mv) - nd(d, "B1_ev")),
                            "dndcg_M_minus_LGB": round(nd(v, Mv) - nd(v, "LGB_ev"), 4),
                            "ci_vs_LGB": boot(v, lambda d: nd(d, Mv) - nd(d, "LGB_ev"))}
    res["val"]["gate_c"] = {"prec50_M": round(pr(v, Mv), 4), "prec50_B1": round(pr(v, "B1_ev"), 4),
                            "dprec_pp": round(100 * (pr(v, Mv) - pr(v, "B1_ev")), 2),
                            "ci_pp": [100 * x for x in boot(v, lambda d: pr(d, Mv) - pr(d, "B1_ev"))]}
    pd.concat([a.assign(task="arr"), v.assign(task="val")]).to_parquet(RES / "prospect_99_holdout_preds.parquet",
                                                                        compression="zstd")
    (RES / "prospect_99_holdout.json").write_text(json.dumps(res, indent=1, default=str))
    print(json.dumps(res, indent=1, default=str))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--dev", action="store_true")
    ap.add_argument("--holdout", action="store_true")
    ap.add_argument("--summary", action="store_true")
    a = ap.parse_args()
    if a.dev:
        dev()
    if a.summary:
        summarize_dev()
    if a.holdout:
        holdout()
