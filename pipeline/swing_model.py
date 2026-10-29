"""Swing quality model, swing program piece 3 (RESULTS-MLB §91, docs/swing-program.md).

    python swing_model.py --selftest   # synthetic checks only
    python swing_model.py --phase1     # baselines, leakage audit, assumption checks, 20% prototype + timing
    python swing_model.py --dev        # phase 2: full hitter-grouped cross-fit on 2024 swings, dev gate vs 2025
    python swing_model.py --final      # ONE read, 2025 swings -> 2026 outcomes; refuses unless dev passed

Per swing: xDamage = P(contact | X) * P(fair | contact, X+) * E[xwOBA | in play, X+] (a hurdle, so whiffs and fouls
are zero damage, not dropped). X = swing + pitch + count; X+ adds contact depth/lateral, leave-one-out centred within
hitter-season-side. Contact head never sees intercepts (projected on whiffs). No batter id or hitter means.
Writes results/swing_91_{baselines,audit,proto,dev,final}.json. Phase 1 never queries 2026 outcomes
(the 2026 stationarity check is per-swing, league level only, as pre-registered).
"""
import json
import sys
import time
import zlib
from pathlib import Path

import numpy as np
import pandas as pd

PIPE = Path(__file__).resolve().parent
sys.path.insert(0, str(PIPE))
from swing_common import (CONTACT, WHIFF, SAVANT_MART, attack_dir_pull, competitive_mask,  # noqa: E402
                          plate_speed, swing_sql, vaa)

RES = PIPE / "results"
SWING = ["bat_speed", "swing_length", "attack_angle", "adp", "swing_path_tilt"]
PITCH = ["spd", "hb_away", "pfx_z", "vaa", "plate_z", "px_away", "same", "balls", "strikes"]
X = SWING + PITCH
XP = X + ["depth_c", "lat_c"]
HMEANS = ["m_bs", "m_sl", "m_aa", "m_tilt", "m_y", "m_x"]
YCOL, XCOL = "intercept_ball_minus_batter_pos_y_inches", "intercept_ball_minus_batter_pos_x_inches"
LGB = dict(n_estimators=400, learning_rate=0.05, num_leaves=63, min_child_samples=200, subsample=0.8,
           subsample_freq=1, colsample_bytree=0.8, random_state=13, n_jobs=4, verbose=-1)
FLOOR = dict(swings=200, bip_s=75, pa_n=150, bip_n=75)
MARCEL_K = 100
SEED, DRAWS = 13, 2000


def fold(ids) -> np.ndarray:
    return np.array([zlib.crc32(str(int(i)).encode()) % 5 for i in ids])


def con():
    sys.path.insert(0, str(SAVANT_MART))
    import mart
    c = mart.connect()
    c.execute("SET threads TO 4")
    c.execute("SET memory_limit = '3GB'")
    return c


def loo_centre(y: pd.Series, keys: list) -> pd.Series:
    """y minus the mean of the OTHER non-null values in its group (NaN where y is NaN or the group has < 2)."""
    g = y.groupby(keys)
    s, n = g.transform("sum"), g.transform("count")
    return (y - (s - y) / (n - 1)).where(n > 1)


def load_swings(c, seasons, extra=()) -> pd.DataFrame:
    cols = tuple(extra) + ("p_throws", "home_team", "swing_length", "attack_angle", "attack_direction", "swing_path_tilt", YCOL, XCOL,
            "estimated_woba_using_speedangle", "woba_denom", "pfx_x", "pfx_z", "plate_x", "plate_z", "balls", "strikes",
            "vx0", "vy0", "vz0", "ax", "ay", "az")
    d = c.sql(swing_sql(seasons, cols)).df()
    d = d[d["description"].isin(CONTACT + WHIFF) | d["is_bunt"]].reset_index(drop=True)
    d["competitive"] = competitive_mask(d)
    d = d[~d["is_bunt"]].reset_index(drop=True)
    away = np.where(d["stand"] == "R", 1.0, -1.0)
    d["spd"], d["vaa"] = plate_speed(d), vaa(d)
    d["hb_away"], d["px_away"] = d["pfx_x"] * away, d["plate_x"] * away
    d["same"] = (d["stand"] == d["p_throws"]).astype(int)
    d["adp"] = attack_dir_pull(d)
    d["contact"] = d["description"].isin(CONTACT)
    d["bip"] = d["description"] == "hit_into_play"
    keys = [d["batter"], d["season"], d["stand"]]
    d["depth_c"] = loo_centre(d[YCOL].where(d["contact"]), keys)
    d["lat_c"] = loo_centre(d[XCOL].where(d["contact"]), keys)
    g = d.groupby(["batter", "season"])
    for m, src in zip(HMEANS, ["bat_speed", "swing_length", "attack_angle", "swing_path_tilt", YCOL, XCOL]):
        d[m] = g[src].transform("mean")
    d["xw"] = d["estimated_woba_using_speedangle"].where(d["bip"])
    for k in X + XP + HMEANS:
        d[k] = d[k].astype("float32")
    return d.drop(columns=["vx0", "vy0", "vz0", "ax", "ay", "az", "pfx_x", "plate_x", "attack_direction"])


def outcomes(c, hi) -> pd.DataFrame:
    """Hitter-season results, regular season, seasons 2022..hi."""
    bip = "description = 'hit_into_play' AND woba_denom = 1"
    return c.sql(f"""
        SELECT batter, season, sum(woba_denom) AS pa, sum(woba_value) AS wsum,
               sum(CASE WHEN {bip} THEN 1 ELSE 0 END) AS bip,
               avg(CASE WHEN {bip} THEN estimated_woba_using_speedangle END) AS xwcon,
               sum(CASE WHEN {bip} THEN woba_value END) AS wconsum
        FROM pitches_all WHERE game_type = 'R' AND season BETWEEN 2022 AND {int(hi)} AND woba_denom IS NOT NULL
        GROUP BY 1, 2""").df().assign(woba=lambda o: o.wsum / o.pa, wcon=lambda o: o.wconsum / o.bip)


# ---------------------------------------------------------------- models
def _fit(kind, Xtr, ytr):
    import lightgbm as lgb
    m = (lgb.LGBMClassifier if kind == "clf" else lgb.LGBMRegressor)(**LGB)
    return m.fit(Xtr, ytr)


def fit_heads(tr):
    ct = tr[tr["contact"]]
    bp = ct[ct["xw"].notna()]
    return (_fit("clf", tr[X], tr["contact"]), _fit("clf", ct[XP], ct["bip"]), _fit("reg", bp[XP], bp["xw"]))


def score(heads, d):
    """pc, pf, xw per swing; non-contact swings scored at depth/lateral 0 (his own average contact point)."""
    xp = d[XP].copy()
    nc = ~d["contact"].to_numpy()
    xp.loc[nc, ["depth_c", "lat_c"]] = 0.0
    return heads[0].predict_proba(d[X])[:, 1], heads[1].predict_proba(xp)[:, 1], heads[2].predict(xp)


def cross_fit(d, frac=1.0, seed=SEED):
    f = fold(d["batter"])
    out = np.full((len(d), 3), np.nan)
    rng, secs = np.random.default_rng(seed), []
    for k in range(5):
        tr = d[f != k]
        if frac < 1:
            tr = tr[rng.random(len(tr)) < frac]
        t0 = time.time()
        heads = fit_heads(tr)
        out[f == k] = np.column_stack(score(heads, d[f == k]))
        secs.append(time.time() - t0)
    d = d.assign(pc=out[:, 0], pf=out[:, 1], px=out[:, 2])
    d["xdmg"] = d["pc"] * d["pf"] * d["px"]
    return d, secs


def head_metrics(d, pc="pc", pf="pf", px="px"):
    from sklearn.metrics import roc_auc_score
    ct, bp = d[d["contact"]], d[d["xw"].notna()]
    return {"contact_auc": float(roc_auc_score(d["contact"], d[pc])),
            "fair_auc": float(roc_auc_score(ct["bip"], ct[pf])),
            "xw_r": float(np.corrcoef(bp["xw"], bp[px])[0, 1]),
            "xw_rmse": float(np.sqrt(((bp["xw"] - bp[px]) ** 2).mean())),
            "calib": {"contact": float(d[pc].mean() - d["contact"].mean()),
                      "fair": float(ct[pf].mean() - ct["bip"].mean()),
                      "xw": float(bp[px].mean() - bp["xw"].mean())},
            "n_swings": int(len(d)), "n_bip": int(len(bp))}


def hitter_sq(d):
    g = d.groupby(["batter", "season"])
    return pd.DataFrame({"sq_con": d["px"].where(d["bip"]).groupby([d["batter"], d["season"]]).mean(),
                         "sq_swing": g["xdmg"].mean()}).reset_index()


# ---------------------------------------------------------------- hitter tables + evaluation
def predictors(d, oc, s):
    ds = d[d["season"] == s]
    cs = ds[ds["competitive"]]
    # Savant squared-up / blast (swing_common definitions) from the stored plate speed
    eff = cs["launch_speed"] / (1.23 * cs["bat_speed"] + 0.23 * cs["spd"])
    sq = cs["bip"] & (eff >= 0.8)
    bl = sq & (100 * eff + cs["bat_speed"] >= 164)
    gb = cs.groupby("batter")
    p = pd.DataFrame({"bat_speed": gb["bat_speed"].mean(), "sq_rate": sq.groupby(cs["batter"]).sum() / gb["contact"].sum(),
                      "blast_rate": bl.groupby(cs["batter"]).sum() / gb["contact"].sum(),
                      "contact_rate": gb["contact"].mean(),
                      "n_swings": ds.groupby("batter").size()})
    o = oc[oc["season"] == s].set_index("batter")
    p = p.join(o[["xwcon", "woba", "bip", "pa", "wcon"]].rename(columns=lambda c: c + "_s"), how="inner")
    # Marcel xwOBAcon: S, S-1, S-2 weighted 5/4/3 by BIP, plus MARCEL_K BIP of the S league mean
    lg = (o["xwcon"] * o["bip"]).sum() / o["bip"].sum()
    num, den = pd.Series(0.0, index=p.index), pd.Series(0.0, index=p.index)
    for lag, w in ((0, 5), (1, 4), (2, 3)):
        q = oc[oc["season"] == s - lag].set_index("batter").reindex(p.index)
        num += w * (q["xwcon"] * q["bip"]).fillna(0)
        den += w * q["bip"].fillna(0)
    p["marcel_xwcon"] = (num + MARCEL_K * lg) / (den + MARCEL_K)
    return p


def pairs(d, oc, s):
    p = predictors(d, oc, s)
    n = oc[oc["season"] == s + 1].set_index("batter")[["xwcon", "wcon", "woba", "bip", "pa"]].rename(columns=lambda c: c + "_n")
    t = p.join(n, how="inner")
    t = t[(t["n_swings"] >= FLOOR["swings"]) & (t["bip_s"] >= FLOOR["bip_s"])
          & (t["pa_n"] >= FLOOR["pa_n"]) & (t["bip_n"] >= FLOOR["bip_n"])]
    return t.dropna(subset=["xwcon_s", "xwcon_n", "bat_speed"]).reset_index()


TARGETS = {"xwcon_n": "bip_n", "wcon_n": "bip_n", "woba_n": "pa_n"}
BASELINES = ["xwcon_s", "woba_s", "bat_speed", "sq_rate", "blast_rate", "marcel_xwcon"]


def oof_ols(t, cols, y, w):
    f, pred = fold(t["batter"]), np.zeros(len(t))
    A = np.column_stack([np.ones(len(t))] + [t[c].to_numpy(float) for c in cols])
    for k in range(5):
        tr, sw = f != k, np.sqrt(t[w].to_numpy(float)[f != k])
        beta = np.linalg.lstsq(A[tr] * sw[:, None], t[y].to_numpy(float)[tr] * sw, rcond=None)[0]
        pred[f == k] = A[f == k] @ beta
    return pred


def wr2(y, p, w):
    """Weighted R2; y, p (n,), w (..., n)."""
    yb = (w * y).sum(-1, keepdims=True) / w.sum(-1, keepdims=True)
    return 1 - (w * (y - p) ** 2).sum(-1) / (w * (y - yb) ** 2).sum(-1)


def evaluate(t, col, y):
    w = t[TARGETS[y]].to_numpy(float)
    p = oof_ols(t, [col], y, TARGETS[y])
    yy = t[y].to_numpy(float)
    return {"r": float(np.corrcoef(t[col], yy)[0, 1]), "rmse": float(np.sqrt((w * (yy - p) ** 2).sum() / w.sum())),
            "wr2": float(wr2(yy, p, w))}


def baseline_table(t):
    return {y: {b: evaluate(t, b, y) for b in BASELINES} for y in TARGETS}


# ---------------------------------------------------------------- phase 1 checks
def identity_gap(d24):
    """Stuff+ memorization mirror on the in-play head: seen vs unseen hitters, with and without hitter means."""
    from lightgbm import LGBMRegressor
    b = d24[d24["xw"].notna()].reset_index(drop=True)
    unseen = fold(b["batter"]) == 0
    rng = np.random.default_rng(SEED)
    tr = ~unseen & (rng.random(len(b)) < 0.8)
    te_seen = ~unseen & ~tr
    te_un = np.flatnonzero(unseen)
    te_un = rng.choice(te_un, min(len(te_un), int(te_seen.sum())), replace=False)
    out = {}
    for name, cols in (("model_features", XP), ("plus_hitter_means", XP + HMEANS)):
        m = LGBMRegressor(**LGB).fit(b.loc[tr, cols], b.loc[tr, "xw"])
        r_s = np.corrcoef(m.predict(b.loc[te_seen, cols]), b.loc[te_seen, "xw"])[0, 1]
        r_u = np.corrcoef(m.predict(b.loc[te_un, cols]), b.loc[te_un, "xw"])[0, 1]
        out[name] = {"r_seen": float(r_s), "r_unseen": float(r_u), "gap": float(r_s - r_u)}
    out["n"] = {"train": int(tr.sum()), "seen_test": int(te_seen.sum()), "unseen_test": int(len(te_un))}
    return out


def stationarity(d):
    """2024-fit heads (20% subsample, fold != 0 hitters) on fold-0 hitters' swings of 2025 and 2026, vs a 2025 fit."""
    rng = np.random.default_rng(SEED)
    f = fold(d["batter"])
    out = {}
    for fit_s in (2024, 2025):
        tr = d[(d["season"] == fit_s) & (f != 0)]
        heads = fit_heads(tr[rng.random(len(tr)) < 0.2])
        for ev in (2024, 2025, 2026):
            te = d[(d["season"] == ev) & (f == 0)]
            if fit_s == 2025 and ev != 2025:
                continue
            pc, pf, px = score(heads, te)
            out[f"fit{fit_s}_eval{ev}"] = head_metrics(te.assign(pc=pc, pf=pf, px=px))
    feat = d.groupby("season")[["bat_speed", "swing_length", "attack_angle", "plate_z", "spd"]].mean().round(3)
    out["feature_means"] = {int(k): v for k, v in feat.T.to_dict().items()}
    return out


def venue(d):
    out = {}
    cs = d[d["competitive"] & d["season"].isin([2024, 2025])].copy()
    keys = [cs["batter"], cs["season"], cs["stand"]]
    cs["dep"] = cs[YCOL].where(cs["contact"])
    for col in ("bat_speed", "attack_angle", "dep"):
        cs["res"] = cs[col] - cs[col].groupby(keys).transform("mean")
        g = cs.groupby(["season", "home_team"])["res"].agg(["mean", "var", "count"])
        per = {}
        for s in (2024, 2025):
            x = g.loc[s]
            per[s] = {"sd_offsets": float(x["mean"].std()), "sd_noise": float(np.sqrt((x["var"] / x["count"]).mean())),
                      "max_abs": float(x["mean"].abs().max()), "max_park": str(x["mean"].abs().idxmax())}
        j = g.loc[2024, "mean"].to_frame("a").join(g.loc[2025, "mean"].rename("b"), how="inner")
        out[col] = {**{str(k): v for k, v in per.items()}, "r_2024_2025": float(j["a"].corr(j["b"])), "parks": int(len(j))}
    return out


def selection(c, d):
    q = c.sql("""SELECT season, description, count(*) AS n, count(bat_speed) AS tracked FROM pitches_all
                 WHERE game_type = 'R' AND season IN (2024, 2025) AND description IN
                 ('swinging_strike','swinging_strike_blocked','foul_tip','foul','hit_into_play')
                 GROUP BY 1, 2 ORDER BY 1, 2""").df()
    q["share"] = q["tracked"] / q["n"]
    d24 = d[d["season"] == 2024]
    h = d24.groupby("batter").agg(n=("contact", "size"), contact=("contact", "mean"), bs=("bat_speed", "mean"),
                                  xw=("xw", "mean"))
    h = h[h["n"] >= FLOOR["swings"]]
    return {"tracked_share": q.round(4).to_dict("records"),
            "hitters_2024": int(len(h)),
            "r_contact_rate_vs_xwcon": float(h["contact"].corr(h["xw"])),
            "r_contact_rate_vs_bat_speed": float(h["contact"].corr(h["bs"])),
            "r_bat_speed_vs_xwcon": float(h["bs"].corr(h["xw"]))}


def reliability(d, reps=20):
    """Split-half (Spearman-Brown) of the per-hitter means of a per-unit value at N units per half."""
    rng = np.random.default_rng(SEED)
    sets = {"sq_swing": (d, "xdmg", (50, 100, 150, 200, 300)),
            "sq_con": (d[d["bip"]], "px", (25, 50, 75, 100, 150)),
            "xwcon_actual": (d[d["xw"].notna()], "xw", (25, 50, 75, 100, 150))}
    out = {}
    for name, (x, col, ns) in sets.items():
        grp = {b: g[col].to_numpy() for b, g in x.groupby("batter")}
        out[name] = {}
        for n in ns:
            vs = [v for v in grp.values() if len(v) >= 2 * n]
            if len(vs) < 30:
                continue
            rs = []
            for _ in range(reps):
                h = np.array([rng.choice(v, 2 * n, replace=False) for v in vs])
                r = np.corrcoef(h[:, :n].mean(1), h[:, n:].mean(1))[0, 1]
                rs.append(2 * r / (1 + r))
            out[name][n] = {"sb": float(np.mean(rs)), "hitters": len(vs)}
    return out


# ---------------------------------------------------------------- gates
def gate(t, sq_by_target):
    from judge import _r, cluster_w
    rng = np.random.default_rng(SEED)
    W = cluster_w([t["batter"].to_numpy()], rng, DRAWS)[0]
    bt = baseline_table(t)
    out = {"n": int(len(t)), "baselines": bt}
    for y, sq in sq_by_target.items():
        best = max(BASELINES, key=lambda b: bt[y][b]["r"])
        yy = t[y].to_numpy(float)
        bc = lambda v: np.broadcast_to(np.asarray(v, float), W.shape)  # noqa: E731
        dr = _r(bc(t[sq]), bc(yy), W) - _r(bc(t[best]), bc(yy), W)
        w = t[TARGETS[y]].to_numpy(float)
        pa, pb = oof_ols(t, [best], y, TARGETS[y]), oof_ols(t, [best, sq], y, TARGETS[y])
        d2 = wr2(yy, pb, W * w) - wr2(yy, pa, W * w)
        ci = lambda v: [float(x) for x in np.percentile(v[1:], [2.5, 97.5])]  # noqa: E731
        g1, g2 = ci(dr)[0] > 0, d2[0] >= 0.005 and ci(d2)[0] > 0
        out[y] = {"sq": sq, "best_baseline": best, "sq_eval": evaluate(t, sq, y),
                  "G1_dr": float(dr[0]), "G1_ci": ci(dr), "G1": bool(g1),
                  "G2_dwr2": float(d2[0]), "G2_ci": ci(d2), "G2": bool(g2), "pass": bool(g1 and g2)}
    # reported: wOBAcon for both, the swing-vs-result split
    out["reported"] = {"wcon_n": {sq: evaluate(t, sq, "wcon_n") for sq in ("sq_con", "sq_swing")},
                       "split_resid_vs_next_change": float(np.corrcoef(t["xwcon_s"] - t["sq_con"],
                                                                       t["xwcon_n"] - t["xwcon_s"])[0, 1]),
                       "r_sq_con_vs_bat_speed": float(t["sq_con"].corr(t["bat_speed"])),
                       "r_sq_con_vs_xwcon_s": float(t["sq_con"].corr(t["xwcon_s"]))}
    return out


def dump(name, obj):
    RES.mkdir(exist_ok=True)
    (RES / f"swing_91_{name}.json").write_text(json.dumps(obj, indent=1, default=float))
    print(f"wrote results/swing_91_{name}.json")


def phase1():
    c = con()
    t0 = time.time()
    d = load_swings(c, (2024, 2025, 2026))
    oc = outcomes(c, 2025)  # no 2026 outcomes in phase 1
    print(f"loaded {len(d):,} swings in {time.time() - t0:.0f}s; mem {d.memory_usage(deep=True).sum() / 1e9:.2f} GB")
    t = pairs(d, oc, 2024)
    bt = baseline_table(t)
    dump("baselines", {"pair": "2024->2025", "n": int(len(t)), "floor": FLOOR, "marcel_k": MARCEL_K, "table": bt,
                       "best": {y: max(BASELINES, key=lambda b: bt[y][b]["r"]) for y in TARGETS}})
    d24 = d[d["season"] == 2024].reset_index(drop=True)
    audit = {"identity_gap": identity_gap(d24)}
    print("identity", audit["identity_gap"])
    audit["selection"] = selection(c, d)
    audit["venue"] = venue(d)
    audit["stationarity"] = stationarity(d)
    print("stationarity done")
    p, secs = cross_fit(d24, frac=0.2)
    rows_full = int((fold(d24["batter"]) != 0).sum())
    audit["reliability"] = reliability(p)
    dump("audit", audit)
    h = hitter_sq(p).merge(oc[oc["season"] == 2024], on=["batter", "season"])
    h = h[h["bip"] >= FLOOR["bip_s"]]
    proto = {"frac": 0.2, "heads": head_metrics(p), "fold_secs": secs, "fit_secs_total": float(sum(secs)),
             "train_rows_per_fold_full": rows_full,
             "est_full_crossfit_min": float(sum(secs) * 5 / 60),
             "same_season_r_sq_con_vs_xwcon": float(h["sq_con"].corr(h["xwcon"])),
             "same_season_r_sq_swing_vs_woba": float(h["sq_swing"].corr(h["woba"])), "hitters": int(len(h))}
    dump("proto", proto)


def run_gate(fit_season, name):
    c = con()
    d = load_swings(c, (fit_season,))
    oc = outcomes(c, fit_season + 1)
    t0 = time.time()
    p, secs = cross_fit(d)
    t = pairs(d, oc, fit_season).merge(hitter_sq(p).drop(columns="season"), on="batter")
    out = {"pair": f"{fit_season}->{fit_season + 1}", "heads": head_metrics(p), "fit_min": (time.time() - t0) / 60,
           **gate(t, {"xwcon_n": "sq_con", "woba_n": "sq_swing"})}
    dump(name, out)


def selftest():
    y = pd.Series([1.0, 2.0, 6.0, np.nan, 5.0])
    k = pd.Series([0, 0, 0, 0, 1])
    c = loo_centre(y, [k])
    assert np.allclose(c[:3], [1 - 4, 2 - 3.5, 6 - 1.5]) and np.isnan(c[3]) and np.isnan(c[4]), c
    assert set(np.unique(fold(range(1000)))) == set(range(5))
    yy, p = np.array([1.0, 2, 3]), np.array([1.0, 2, 3])
    assert wr2(yy, p, np.ones(3)) == 1.0
    print("swing_model selftest pass")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
    elif "--phase1" in sys.argv:
        phase1()
    elif "--dev" in sys.argv:
        run_gate(2024, "dev")
    elif "--final" in sys.argv:
        dev = json.loads((RES / "swing_91_dev.json").read_text())
        if not any(dev[y]["pass"] for y in ("xwcon_n", "woba_n")) or (RES / "swing_91_final.json").exists():
            sys.exit("final read refused: dev did not pass, or the final read is already spent")
        run_gate(2025, "final")


def final_91b():
    """§91b: one read, 2025 swings -> 2026 xwOBAcon, Marcel + SQcon vs Marcel (frozen §91 spec)."""
    if (RES / "swing_91_91b_final.json").exists():
        sys.exit("§91b read already spent")
    c = con()
    d = load_swings(c, (2025,))
    oc = outcomes(c, 2026)
    p, _ = cross_fit(d)
    t = pairs(d, oc, 2025).merge(hitter_sq(p).drop(columns="season"), on="batter")
    BASELINES[:] = ["marcel_xwcon"]  # the frozen comparator
    g = gate(t, {"xwcon_n": "sq_con"})["xwcon_n"]
    span = c.sql("SELECT min(game_date), max(game_date) FROM pitches_all WHERE game_type = 'R' AND season = 2026").fetchone()
    out = {"pair": "2025->2026", "n": int(len(t)), "game_dates_2026": [str(x) for x in span],
           "dwr2": g["G2_dwr2"], "ci": g["G2_ci"], "pass": bool(g["G2_dwr2"] > 0 and g["G2_ci"][0] > 0),
           "dr_reported": g["G1_dr"], "dr_ci": g["G1_ci"], "sq_eval": g["sq_eval"]}
    dump("91b_final", out)
    print(out)


if __name__ == "__main__" and "--final91b" in sys.argv:
    final_91b()
