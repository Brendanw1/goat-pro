"""Pitching+ v6 engine: targets, pitcher-grouped OOF fits, grades, and the PREREG judge.

Dev pitchers only. Every function that touches outcomes asserts the lockbox is absent.
"""
import json
import os
import zlib
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
CACHE = HERE / "cache"
RESULTS = HERE / "results"
THREADS = int(os.environ.get("OMP_NUM_THREADS", 3))
CLASSES = ["ball", "hbp", "cs", "whiff", "foul", "bip0", "bip1", "bip2", "bip3"]

SHAPE = ["velo", "ivb", "hb_arm", "spin", "ext", "rel_h", "rel_s_arm", "velo_diff", "ivb_diff", "hb_diff_arm",
         "hvaa", "spin_eff"]
LOC = ["plate_x_arm", "plate_z"]
COUNT = ["balls", "strikes"]
PLATOON = ["same_hand"]
CONTEXT = ["ptype", "abs26"]
BASE = SHAPE + LOC + COUNT + PLATOON + CONTEXT
GROUPS = {"shape": SHAPE + ["arm_angle", "ivb_rel", "hb_rel", "vaa_rel", "spin_diff", "rel_h_diff", "rel_s_diff"],
          "location": LOC + ["z_n", "edge", "t2_dx", "t2_dz", "t2_dist", "t3_dx", "t3_dz", "t3_dist"],
          "count": COUNT, "platoon": PLATOON, "context": CONTEXT}

FIXED = dict(learning_rate=0.05, num_leaves=63, min_child_samples=500, colsample_bytree=0.8, subsample=0.8,
             subsample_freq=1, reg_lambda=1.0, verbose=-1)


def load(cols=None, lockbox=False):
    df = pd.read_parquet(CACHE / "frame.parquet", columns=cols)
    lb = pd.read_parquet(CACHE / "frame.parquet", columns=["lockbox"])["lockbox"]
    if not lockbox:
        df = df[~lb.to_numpy()]
        assert "lockbox" not in df or not df["lockbox"].any()
    return df


# ---------------------------------------------------------------- targets
def target(df, name):
    """Per-pitch training target (pitcher-positive runs). T0 realized; T1 BIP at E[rv | xwOBA, count];
    T2 = T1 + called pitches at umpire-neutral p(called strike) value."""
    y = df["rv"].astype("float64").copy()
    if name == "T0":
        return y
    bip = df["is_bip"] == 1
    fit = bip & df["xwoba"].notna() & df["rv"].notna()
    for (b, s), g in df[fit].groupby(["balls", "strikes"]):
        slope, icpt = np.polyfit(g["xwoba"], g["rv"], 1)
        m = fit & (df["balls"] == b) & (df["strikes"] == s)
        y[m] = icpt + slope * df.loc[m, "xwoba"]
    if name == "T1":
        return y
    import lightgbm as lgb
    called = df["cls"].isin([0, 2])  # ball / called strike (HBP stays realized)
    X = df[["plate_x", "plate_z", "z_n", "balls", "strikes", "abs26"]].assign(
        stand=(df["stand"] == "L").astype(int))
    clf = lgb.LGBMClassifier(n_estimators=300, learning_rate=0.1, num_leaves=63, min_child_samples=1000,
                             n_jobs=THREADS, verbose=-1).fit(X[called], (df.loc[called, "cls"] == 2).astype(int))
    p = clf.predict_proba(X[called])[:, 1]
    key = ["season", "balls", "strikes"]
    v_cs = df[df["cls"] == 2].groupby(key)["rv"].mean().rename("v_cs")
    v_b = df[df["cls"] == 0].groupby(key)["rv"].mean().rename("v_b")
    vals = df.loc[called, key].join(v_cs, on=key).join(v_b, on=key)
    y[called] = p * vals["v_cs"].to_numpy() + (1 - p) * vals["v_b"].to_numpy()
    return y


# ---------------------------------------------------------------- fits
def es_split(pitchers):
    return pitchers.map(lambda p: zlib.crc32(f"ppv6-es:{p}".encode()) % 10 == 0)


def fit_oof(df, features, kind="reg", y=None, params=None, frac=0.4, seed=0, cat=("ptype",), folds=range(5),
            return_models=False, mono=None):
    """Pitcher-grouped OOF per-pitch value. kind 'reg' (regress y) or 'mc' (softmax over CLASSES with fixed
    per-(season, count) run constants from the training rows). Returns count-normalized value v."""
    import lightgbm as lgb
    params = {**FIXED, **(params or {})}
    rounds = params.pop("n_estimators", 1500)
    cat = [c for c in cat if c in features]
    pred = pd.Series(np.nan, index=df.index)
    rng = np.random.default_rng(seed)
    models = {}
    lab = y if kind == "reg" else df["cls"]
    for k in folds:
        tr_all = (df["fold"] != k) & lab.notna()
        tr_idx = df.index[tr_all]
        tr_idx = tr_idx[rng.random(len(tr_idx)) < frac]
        es = es_split(df.loc[tr_idx, "pitcher"]).to_numpy()
        fit_i, val_i = tr_idx[~es], tr_idx[es]
        p = dict(params, n_jobs=THREADS, seed=seed)
        if mono:
            p["monotone_constraints"] = [mono.get(f, 0) for f in features]
        if kind == "reg":
            obj = p.pop("objective", "regression")
            p["objective"] = obj
            dtr = lgb.Dataset(df.loc[fit_i, features], lab[fit_i], categorical_feature=cat, free_raw_data=True)
            dva = lgb.Dataset(df.loc[val_i, features], lab[val_i], reference=dtr)
        else:
            p.update(objective="multiclass", num_class=len(CLASSES))
            dtr = lgb.Dataset(df.loc[fit_i, features], lab[fit_i].astype(int), categorical_feature=cat)
            dva = lgb.Dataset(df.loc[val_i, features], lab[val_i].astype(int), reference=dtr)
        bst = lgb.train(p, dtr, rounds, valid_sets=[dva],
                        callbacks=[lgb.early_stopping(50, verbose=False)])
        te = df.index[df["fold"] == k]
        if kind == "reg":
            pred[te] = bst.predict(df.loc[te, features], num_iteration=bst.best_iteration)
        else:
            const = class_constants(df.loc[tr_all[tr_all].index])
            P = bst.predict(df.loc[te, features], num_iteration=bst.best_iteration)
            pred[te] = (P * const_rows(df.loc[te], const)).sum(1)
        models[k] = (bst, const if kind == "mc" else None)
        print(f"  fold {k}: {len(fit_i):,} rows, {bst.best_iteration} rounds", flush=True)
    v = pred - pred.groupby([df["season"], df["balls"], df["strikes"]]).transform("mean")
    return (v, models) if return_models else v


def class_constants(tr):
    """Mean realized run value of each terminal class per (season, balls, strikes), training rows only."""
    c = tr.dropna(subset=["cls"]).groupby(["season", "balls", "strikes", "cls"])["rv"].mean().unstack("cls")
    c.columns = [int(x) for x in c.columns]
    return c.reindex(columns=range(len(CLASSES))).fillna(c.mean())


def const_rows(d, const):
    return const.reindex(pd.MultiIndex.from_frame(d[["season", "balls", "strikes"]])).to_numpy()


# ---------------------------------------------------------------- grades + judge
def grades(meta, v, by=("pitcher", "season")):
    d = meta.assign(v=v).dropna(subset=["v"])
    return d.groupby(list(by))["v"].agg(g="mean", gn="size").reset_index()


def halves(meta):
    """1/2 = first/second half of a pitcher-season by cumulative pitches over games (same rule as outcomes)."""
    gp = meta.groupby(["pitcher", "season", "game_pk"]).agg(d=("game_date", "first"), n=("pitch_number", "size")).reset_index()
    gp = gp.sort_values(["pitcher", "season", "d", "game_pk"])
    gp["cum"] = gp.groupby(["pitcher", "season"])["n"].cumsum()
    gp["tot"] = gp.groupby(["pitcher", "season"])["n"].transform("sum")
    gp["half"] = np.where(gp["cum"] <= gp["tot"] / 2, 1, 2)
    return meta[["pitcher", "season", "game_pk"]].merge(gp[["pitcher", "season", "game_pk", "half"]],
                                                       how="left")["half"].to_numpy()


def outcome_table():
    o = pd.read_parquet(CACHE / "outcomes.parquet")
    o["rv100"] = o["rv"] / o["n"] * 100
    o["kbb"] = (o["k"] - o["bb"]) / o["tbf"].where(o["tbf"] > 0)
    o["ra9"] = o["runs"] / o["outs"].where(o["outs"] > 0) * 27
    raw = (13 * o["hr"] + 3 * (o["bb"] + o["hbp"]) - 2 * o["k"]) / (o["outs"] / 3).where(o["outs"] > 0)
    full = o[o["half"] == 0]
    lg = full.groupby("season").apply(lambda d: d["runs"].sum() / d["outs"].sum() * 27
                                      - (13 * d["hr"].sum() + 3 * (d["bb"].sum() + d["hbp"].sum())
                                         - 2 * d["k"].sum()) / (d["outs"].sum() / 3), include_groups=False)
    o["fip"] = raw + o["season"].map(lg)
    return o


def windows(gs, gh, out):
    """Rows for the pooled predictive windows. gs: pitcher-season grades (cols g, gn); gh: + half."""
    nxt = out[out["half"] == 0].assign(season=lambda d: d["season"] - 1)
    ns = gs.merge(nxt, on=["pitcher", "season"])
    ns = ns[(ns["gn"] >= 200) & (ns["n"] >= 200)].assign(win="NS")
    h1 = gh[gh["half"] == 1].drop(columns="half")
    h2 = out[out["half"] == 2]
    ws = h1.merge(h2, on=["pitcher", "season"])
    ws = ws[(ws["gn"] >= 150) & (ws["n"] >= 150)].assign(win="WS")
    return pd.concat([ns, ws], ignore_index=True)


def wcorr(x, y, w):
    """Weighted Pearson r for each row of weight matrix w (B x n)."""
    sw = w.sum(1, keepdims=True)
    mx, my = (w * x).sum(1, keepdims=True) / sw, (w * y).sum(1, keepdims=True) / sw
    dx, dy = x - mx, y - my
    return (w * dx * dy).sum(1) / np.sqrt((w * dx * dx).sum(1) * (w * dy * dy).sum(1))


def boot_weights(pitchers, B=2000, seed=7):
    u, inv = np.unique(pitchers, return_inverse=True)
    rng = np.random.default_rng(seed)
    return rng.poisson(1.0, size=(B, len(u))).astype("float32")[:, inv]


def delta(rows, a, b, ycol, B=2000):
    """r(b, y) - r(a, y) with pitcher-cluster bootstrap CI. Positive = b better (grades pitcher-positive;
    outcomes RA9/FIP/rv100 sign handled by caller)."""
    d = rows.dropna(subset=[a, b, ycol])
    w = boot_weights(d["pitcher"].to_numpy(), B)
    y = d[ycol].to_numpy()
    ra, rb = np.corrcoef(d[a], y)[0, 1], np.corrcoef(d[b], y)[0, 1]
    bd = wcorr(d[b].to_numpy(), y, w) - wcorr(d[a].to_numpy(), y, w)
    return {"r_a": round(ra, 4), "r_b": round(rb, 4), "d": round(rb - ra, 4),
            "lo": round(float(np.quantile(bd, .025)), 4), "hi": round(float(np.quantile(bd, .975)), 4),
            "p_one": round(float((bd <= 0).mean()), 4), "n": len(d), "pitchers": int(d["pitcher"].nunique()),
            "_boot": bd}


def J(rows, a, b, B=2000):
    """PREREG rung rule: mean of delta r on next RV/100 and next K-BB% (pooled NS + WS), cluster bootstrap."""
    ga = a if isinstance(a, dict) else {"rv100": a, "kbb": a}
    gb = b if isinstance(b, dict) else {"rv100": b, "kbb": b}
    r1, r2 = delta(rows, ga["rv100"], gb["rv100"], "rv100", B), delta(rows, ga["kbb"], gb["kbb"], "kbb", B)
    bj = (r1.pop("_boot") + r2.pop("_boot")) / 2
    return {"J": round((r1["d"] + r2["d"]) / 2, 4), "lo": round(float(np.quantile(bj, .025)), 4),
            "hi": round(float(np.quantile(bj, .975)), 4), "rv100": r1, "kbb": r2}


def split_half(meta, v, by=("pitcher", "season"), min_half=20):
    """Odd/even games reliability and the pitch count where Spearman-Brown r reaches .50."""
    d = meta.assign(v=v).dropna(subset=["v"])
    rank = d.groupby(["pitcher", "season"])["game_pk"].rank(method="dense").astype(int)
    d = d.assign(par=rank % 2)
    g = d.groupby(list(by) + ["par"])["v"].agg(["mean", "size"]).unstack("par")
    g = g[(g[("size", 0)] >= min_half) & (g[("size", 1)] >= min_half)]
    r = float(np.corrcoef(g[("mean", 0)], g[("mean", 1)])[0, 1])
    m = float(np.median(np.minimum(g[("size", 0)], g[("size", 1)])))
    r1 = r / (m - (m - 1) * r)
    return {"r": round(r, 3), "median_half": m, "n50": round((1 - r1) / r1, 0) if r1 > 0 else None,
            "units": len(g)}


def save(name, obj):
    RESULTS.mkdir(exist_ok=True)
    path = RESULTS / "results.json"
    allr = json.loads(path.read_text()) if path.exists() else {}
    allr[name] = obj
    path.write_text(json.dumps(allr, indent=1, default=float))


# ---------------------------------------------------------------- scope tables
META = ["pitcher", "season", "game_pk", "game_date", "pitch_number", "pitch_type", "stand", "rv", "fold"]
SCOPES = {"P": [], "T": ["pitch_type"], "TH": ["pitch_type", "stand"]}
FLOORS = {"P": (200, 150), "T": (75, 50), "TH": (50, 40)}  # (next season, each half)


def table(meta, vs, scope="P", out=None):
    """Pooled NS + WS rows: one grade column per name in vs (per-pitch value Series), outcomes attached.
    P uses the full outcome table (rv100, kbb, ra9, fip); T/TH use rv100 of that pitch type from the frame."""
    keys = ["pitcher", "season"] + SCOPES[scope]
    if "half" not in meta:
        meta = meta.assign(half=halves(meta))
    fs, fh = FLOORS[scope]
    if scope == "P":
        o = out if out is not None else outcome_table()
    else:
        o = pd.concat([meta.groupby(keys)["rv"].agg(rv="sum", n="size").reset_index().assign(half=0),
                       meta.groupby(keys + ["half"])["rv"].agg(rv="sum", n="size").reset_index()])
        o["rv100"] = o["rv"] / o["n"] * 100
    nxt = o[o["half"] == 0].assign(season=lambda d: d["season"] - 1)
    rows = []
    for win in ("NS", "WS"):
        base = None
        for name, v in vs.items():
            d = meta.assign(v=v).dropna(subset=["v"])
            if win == "NS":
                g = d.groupby(keys)["v"].agg(**{name: "mean", f"{name}_n": "size"}).reset_index()
            else:
                g = (d[d["half"] == 1].groupby(keys)["v"].agg(**{name: "mean", f"{name}_n": "size"})
                     .reset_index())
            base = g if base is None else base.merge(g, on=keys, how="outer")
        ncols = [f"{n}_n" for n in vs]
        base["gn"] = base[ncols].max(1)
        base = base.drop(columns=ncols)
        tgt = nxt if win == "NS" else o[o["half"] == 2]
        m = base.merge(tgt, on=keys)
        m = m[(m["gn"] >= (fs if win == "NS" else fh)) & (m["n"] >= (fs if win == "NS" else fh))]
        rows.append(m.assign(win=win))
    return pd.concat(rows, ignore_index=True)


def same_season(meta, vs, out=None, min_n=200):
    """Descriptive: grade vs same-season RV/100 and RA9 (P scope)."""
    o = (out if out is not None else outcome_table())
    o = o[o["half"] == 0]
    res = {}
    for name, v in vs.items():
        g = meta.assign(v=v).dropna(subset=["v"]).groupby(["pitcher", "season"])["v"].agg(["mean", "size"])
        m = g.reset_index().merge(o, on=["pitcher", "season"])
        m = m[(m["size"] >= min_n)]
        ra = m[m["outs"] >= 120]
        res[name] = {"r_rv100": round(float(np.corrcoef(m["mean"], m["rv100"])[0, 1]), 3),
                     "r_neg_ra9": round(float(np.corrcoef(ra["mean"], -ra["ra9"])[0, 1]), 3), "n": len(m)}
    return res


def blend(rows, cols, y, folds):
    """OOF ridge-free OLS of outcome y on grade cols, weights fit on the other pitcher folds."""
    from sklearn.linear_model import LinearRegression
    d = rows[cols + [y]]
    ok = d.notna().all(1)
    pred = pd.Series(np.nan, index=rows.index)
    for k in range(5):
        tr, te = ok & (folds != k), ok & (folds == k)
        pred[te] = LinearRegression().fit(d.loc[tr, cols], d.loc[tr, y]).predict(d.loc[te, cols])
    return pred
