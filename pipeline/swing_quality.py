"""Swing Quality re-attack, RESULTS-MLB §98 (swing program piece 3, after §91/§91b).

    python swing_quality.py --selftest   # synthetic checks only
    python swing_quality.py --dev        # §98 dev: in-season windows 2024 + 2025, wide features, nested selection
    python swing_quality.py --final      # §98a: ONE read, below-floor hitter-seasons S -> S+1 (refuses if spent)
    python swing_quality.py              # bake data/export/web/swingq/swingq.json (descriptive grade + SHAP split)

SQcon = mean over a hitter's balls in play of E[xwOBA | in play, swing + pitch + contact point (+ wide context)],
hitter-grouped cross-fit, so a hitter is always scored by a model that never saw him. No batter id or hitter means.
"""
import json
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

PIPE = Path(__file__).resolve().parent
ROOT = PIPE.parent
sys.path.insert(0, str(PIPE))
from swing_model import (LGB, MARCEL_K, SEED, DRAWS, XCOL, XP, YCOL, con, fold, load_swings,  # noqa: E402
                         loo_centre, oof_ols, outcomes, wr2)

RES = PIPE / "results"
OUT = ROOT / "data" / "export" / "web" / "swingq"
PM = ROOT / "cache" / "pitch_models.parquet"
EXTRA = ("game_pk", "game_date", "at_bat_number", "pitch_number", "pitch_type", "age_bat", "inning", "outs_when_up",
         "on_1b", "on_2b", "on_3b", "bat_score", "fld_score", "sz_top", "sz_bot")
WINDOWS = (25, 50)
REST_MIN = 50
FB = ("FF", "SI", "FC")

# per-swing head families (wide = all; §91 narrow = XP)
HFAM = {"swing": ["bat_speed", "swing_length", "attack_angle", "adp", "swing_path_tilt"],
        "contact": ["depth_c", "lat_c"],
        "pitch": ["spd", "hb_away", "pfx_z", "vaa", "plate_z", "px_away"],
        "quality": ["whiff_plus", "pitching_plus"],
        "state": ["balls", "strikes", "outs_when_up", "inning", "score_diff", "runners"],
        "platoon": ["same", "lhb"],
        "age": ["age_bat"],
        "park": ["park"],
        "plane": ["plane_gap"]}
XW = sum(HFAM.values(), [])
assert set(XP) <= set(XW)
# coach groups for the SHAP split of the shipped head (every feature in exactly one group)
GROUPS = {"batSpeed": ["bat_speed"],
          "plane": ["swing_length", "attack_angle", "adp", "swing_path_tilt", "plane_gap"],
          "contactPoint": ["depth_c", "lat_c"],
          "pitchDiet": ["spd", "hb_away", "pfx_z", "vaa", "plate_z", "px_away", "whiff_plus", "pitching_plus"],
          "context": ["balls", "strikes", "outs_when_up", "inning", "score_diff", "runners", "same", "lhb", "age_bat", "park"]}
assert sorted(sum(GROUPS.values(), [])) == sorted(XW)
DEPTH_X = ["spd", "hb_away", "pfx_z", "vaa", "plate_z", "px_away", "balls", "strikes", "same"]


def make_head(kind):
    if kind == "mono":
        from lightgbm import LGBMRegressor
        return LGBMRegressor(**LGB, monotone_constraints=[1 if c == "bat_speed" else 0 for c in XP])
    if kind == "xgb":
        from xgboost import XGBRegressor
        return XGBRegressor(n_estimators=400, learning_rate=0.05, max_depth=6, min_child_weight=200, subsample=0.8,
                            colsample_bytree=0.8, tree_method="hist", random_state=SEED, n_jobs=4)
    if kind == "spline":
        from sklearn.impute import SimpleImputer
        from sklearn.linear_model import Ridge
        from sklearn.pipeline import make_pipeline
        from sklearn.preprocessing import SplineTransformer
        return make_pipeline(SimpleImputer(strategy="median"), SplineTransformer(n_knots=6, degree=3), Ridge(alpha=1.0))
    from lightgbm import LGBMRegressor
    return LGBMRegressor(**LGB)


def head_feats(kind):
    if kind in ("lgbm", "xgb", "mono", "spline"):
        return XP
    if kind == "wide":
        return XW
    fam = kind.split("-", 1)[1]                      # "wide-<family>": wide minus one family
    return [c for c in XW if c not in HFAM[fam]]


def load(c, s, timing=True):
    d = load_swings(c, (s,), EXTRA).sort_values(["batter", "game_date", "at_bat_number", "pitch_number"])
    d = d.reset_index(drop=True)
    pm = pd.read_parquet(PM, columns=["game_pk", "at_bat_number", "pitch_number", "whiff_plus", "pitching_plus"])
    pm = pm[pm["game_pk"].isin(d["game_pk"].unique())].drop_duplicates(["game_pk", "at_bat_number", "pitch_number"])
    d = d.merge(pm, on=["game_pk", "at_bat_number", "pitch_number"], how="left")
    d["score_diff"] = (d["bat_score"] - d["fld_score"]).astype("float32")
    d["runners"] = (d[["on_1b", "on_2b", "on_3b"]].notna().sum(1)).astype("float32")
    d["lhb"] = (d["stand"] == "L").astype("float32")
    d["plane_gap"] = (d["attack_angle"] + d["vaa"]).astype("float32")
    d["park"] = pd.Categorical(d["home_team"], categories=sorted(d["home_team"].dropna().unique()))
    d["zone"] = ((d["px_away"].abs() <= 0.83) & (d["plate_z"] >= d["sz_bot"]) & (d["plate_z"] <= d["sz_top"]))
    d["fbp"] = d["pitch_type"].isin(FB)
    for k in ("whiff_plus", "pitching_plus", "age_bat", "outs_when_up", "inning"):
        d[k] = d[k].astype("float32")
    d = d.drop(columns=["on_1b", "on_2b", "on_3b", "bat_score", "fld_score", "sz_top", "sz_bot", "game_pk"])
    d["hasxw"] = d["xw"].notna()
    d["bipcum"] = d.groupby("batter")["hasxw"].cumsum()
    # §92 timing proxy: contact depth minus a hitter-grouped cross-fit pitch/count expectation (no hitter terms)
    ct = d["contact"].to_numpy() & d[YCOL].notna().to_numpy()
    f = fold(d["batter"])
    d["tim"] = np.nan
    for j in range(5 if timing else 0):
        m = make_head("lgbm").fit(d.loc[ct & (f != j), DEPTH_X], d.loc[ct & (f != j), YCOL])
        sel = ct & (f == j)
        d.loc[sel, "tim"] = d.loc[sel, YCOL] - m.predict(d.loc[sel, DEPTH_X])
    print(f"  loaded {s}: {len(d):,} swings", flush=True)
    return d


def park_offsets(c, s):
    """S-1 venue xwOBAcon minus the S-1 league mean (all BIP, regular season)."""
    q = c.sql(f"""SELECT home_team, avg(estimated_woba_using_speedangle) AS xw FROM pitches_all
                 WHERE game_type = 'R' AND season = {int(s) - 1} AND description = 'hit_into_play' AND woba_denom = 1
                 GROUP BY 1""").df()
    lg = c.sql(f"""SELECT avg(estimated_woba_using_speedangle) FROM pitches_all WHERE game_type = 'R'
                  AND season = {int(s) - 1} AND description = 'hit_into_play' AND woba_denom = 1""").fetchone()[0]
    off = dict(zip(q["home_team"], q["xw"] - lg))
    off.setdefault("ATH", off.get("OAK", 0.0))  # 2025 relabel: same club, new venue code
    return off


def crossfit_heads(d, kinds):
    """{kind: [model per fold]}: each fold's model is trained on the other folds' hitters' balls in play."""
    f = fold(d["batter"])
    b = d["hasxw"].to_numpy()
    out = {}
    for k in kinds:
        cols = head_feats(k)
        t0 = time.time()
        out[k] = [make_head(k).fit(d.loc[b & (f != j), cols], d.loc[b & (f != j), "xw"]) for j in range(5)]
        print(f"  head {k}: {time.time() - t0:.0f}s", flush=True)
    return out


def score_oof(d, models, cols):
    f, out = fold(d["batter"]), np.full(len(d), np.nan)
    for j in range(5):
        m = f == j
        if m.any():
            out[m] = models[j].predict(d.loc[m, cols])
    return out


def marcel(oc, s, ids, num0, den0):
    """§91 Marcel with the season-S term replaced by (num0, den0) = (5*sum xw, 5*BIP) of the window."""
    o = oc[oc["season"] == s]
    lg = (o["xwcon"] * o["bip"]).sum() / o["bip"].sum()
    num, den = pd.Series(num0, index=ids, dtype=float), pd.Series(den0, index=ids, dtype=float)
    for lag, w in ((1, 4), (2, 3)):
        q = oc[oc["season"] == s - lag].set_index("batter").reindex(ids)
        num += w * (q["xwcon"] * q["bip"]).fillna(0).to_numpy()
        den += w * q["bip"].fillna(0).to_numpy()
    return (num + MARCEL_K * lg) / (den + MARCEL_K)


ARCH = None


def arch_means():
    global ARCH
    if ARCH is None:
        a = json.loads((ROOT / "data" / "export" / "web" / "archetypes" / "archetypes.json").read_text())["archetypes"]
        ARCH = [x["mean"] for x in a]
    return ARCH


def hitter_features(w, heads, park_off):
    """Every window-only hitter feature (w = his swings in the window, contact-point centring done inside w)."""
    wb = w[w["hasxw"]]
    g, gw = wb.groupby("batter"), w.groupby("batter")
    t = pd.DataFrame({"nbip": g.size(), "obs": g["xw"].mean(), "sumxw": g["xw"].sum()})
    for k, ms in heads.items():
        t["sq_" + k] = pd.Series(score_oof(wb, ms, head_feats(k)), index=wb.index).groupby(wb["batter"]).mean()
    for c in ("bat_speed", "swing_length", "attack_angle", "adp", "swing_path_tilt", "contact"):
        t["tr_" + c] = gw[c].mean()
    t["bs"] = t["tr_bat_speed"]
    for c in ("bat_speed", "attack_angle", "swing_length", "swing_path_tilt"):
        t["sd_" + c] = gw[c].std()
    cw = w[w["contact"]]
    gc = cw.groupby("batter")
    t["sd_depth"], t["m_depth"], t["m_lat"] = gc[YCOL].std(), gc[YCOL].mean(), gc[XCOL].mean()
    t["m_whiff"], t["m_pplus"], t["m_spd"], t["zone_share"] = (gw["whiff_plus"].mean(), gw["pitching_plus"].mean(),
                                                              gw["spd"].mean(), gw["zone"].mean())
    t["two_share"], t["m_balls"] = (w["strikes"] == 2).groupby(w["batter"]).mean(), gw["balls"].mean()
    t["tim_sd"] = gc["tim"].std()
    t["tim_fbos"] = cw[cw["fbp"]].groupby("batter")["tim"].mean() - cw[~cw["fbp"]].groupby("batter")["tim"].mean()
    two = w["strikes"] == 2
    for c, nm in (("bat_speed", "ts_bs"), ("swing_length", "ts_sl")):
        t[nm] = w[two].groupby("batter")[c].mean() - w[~two].groupby("batter")[c].mean()
    t["plane_abs"] = cw["plane_gap"].abs().groupby(cw["batter"]).mean()
    # §94: nearest published type mean, distance in units of the window traits' spread
    tr = pd.DataFrame({"bs": t["tr_bat_speed"], "sl": t["tr_swing_length"], "aa": t["tr_attack_angle"],
                       "pull": t["tr_adp"], "tilt": t["tr_swing_path_tilt"], "depth": t["m_depth"]})
    sd = tr.std()
    dists = [(((tr - pd.Series(m)) / sd) ** 2).sum(1) for m in arch_means()]
    t["arch"] = (dists[1] < dists[0]).astype(float)
    t["age"] = gw["age_bat"].mean()
    t["park_off"] = wb["home_team"].map(park_off).astype(float).groupby(wb["batter"]).mean()
    t["lhb_share"], t["same_share"] = gw["lhb"].mean(), gw["same"].mean()
    cs = w[w["competitive"]]
    eff = cs["launch_speed"] / (1.23 * cs["bat_speed"] + 0.23 * cs["spd"])
    bl = cs["bip"] & (eff >= 0.8) & (100 * eff + cs["bat_speed"] >= 164)
    t["blast"] = bl.groupby(cs["batter"]).sum() / cs.groupby("batter")["contact"].sum()
    return t


FAM = {"sq": ["sq_wide"], "traits": [f"tr_{c}" for c in ("bat_speed", "swing_length", "attack_angle", "adp",
                                                          "swing_path_tilt", "contact")],
       "variability": ["sd_bat_speed", "sd_attack_angle", "sd_swing_length", "sd_swing_path_tilt", "sd_depth"],
       "diet": ["m_whiff", "m_pplus", "m_spd", "zone_share"], "count": ["two_share", "m_balls"],
       "contactpt": ["m_depth", "m_lat"], "timing": ["tim_sd", "tim_fbos"], "twostrike": ["ts_bs", "ts_sl"],
       "plane": ["plane_abs"], "archetype": ["arch"], "age": ["age"], "park": ["park_off"],
       "platoon": ["lhb_share", "same_share"], "blast": ["blast"], "obs": ["obs"]}


def window_table(d, oc, s, heads, n, park_off):
    win = (d["bipcum"] < n) | ((d["bipcum"] == n) & d["hasxw"])
    w = d[win].copy()
    keys = [w["batter"], w["stand"]]
    w["depth_c"] = loo_centre(w[YCOL].where(w["contact"]), keys)
    w["lat_c"] = loo_centre(w[XCOL].where(w["contact"]), keys)
    t = hitter_features(w, heads, park_off)
    rest = d[d["hasxw"] & (d["bipcum"] > n)].groupby("batter")["xw"].agg(["mean", "size"])
    t = t.join(rest.rename(columns={"mean": "tgt", "size": "rest_n"}), how="inner")
    t = t[(t["nbip"] == n) & (t["rest_n"] >= REST_MIN)].copy()
    t["marcel"] = marcel(oc, s, t.index, 5 * t["sumxw"].to_numpy(), 5 * t["nbip"].to_numpy()).to_numpy()
    t["season"] = s
    return t.reset_index()


def delta_pred(t, pa, pb, W, y="tgt", w="rest_n"):
    yy, ww = t[y].to_numpy(float), t[w].to_numpy(float)
    d2 = wr2(yy, pb, W * ww) - wr2(yy, pa, W * ww)
    lo, hi = np.percentile(d2[1:], [2.5, 97.5])
    return {"d": float(d2[0]), "ci": [float(lo), float(hi)], "wr2_base": float(wr2(yy, pa, ww)), "wr2": float(wr2(yy, pb, ww))}


def delta(t, base, add, W, y="tgt", w="rest_n"):
    return delta_pred(t, oof_ols(t, base, y, w), oof_ols(t, base + add, y, w), W, y, w)


def nested_lasso(t, cols, y="tgt", w="rest_n", halves=10, seed=SEED):
    """Outer hitter folds -> LassoCV with inner hitter-grouped folds. Returns OOF predictions and keep-frequency."""
    from sklearn.linear_model import LassoCV
    from sklearn.model_selection import GroupKFold
    X = t[cols].to_numpy(float)
    X = np.where(np.isnan(X), np.nanmedian(X, 0), X)
    yy, ww, ids = t[y].to_numpy(float), t[w].to_numpy(float), t["batter"].to_numpy()
    f, pred = fold(ids), np.zeros(len(t))
    keep = np.zeros(len(cols))
    nfit = 0
    rng = np.random.default_rng(seed)

    def fit(idx):
        mu, sd = X[idx].mean(0), X[idx].std(0) + 1e-12
        Z = (X[idx] - mu) / sd
        cv = list(GroupKFold(5).split(Z, groups=ids[idx]))
        m = LassoCV(cv=cv, n_alphas=40, max_iter=5000, random_state=seed).fit(Z, yy[idx], sample_weight=ww[idx])
        return m, mu, sd

    for k in range(5):
        tr = np.flatnonzero(f != k)
        m, mu, sd = fit(tr)
        te = f == k
        pred[te] = m.predict((X[te] - mu) / sd)
        keep += m.coef_ != 0
        nfit += 1
        u = np.unique(ids[tr])
        for _ in range(halves):
            half = np.isin(ids[tr], rng.choice(u, len(u) // 2, replace=False))
            mh = fit(tr[half])[0]
            keep += mh.coef_ != 0
            nfit += 1
    return pred, dict(zip(cols, (keep / nfit).round(3).tolist()))


def dev():
    from judge import cluster_w
    c = con()
    kinds = ["lgbm", "mono", "spline", "wide"] + [f"wide-{f}" for f in HFAM]
    tabs, per_bip = {n: [] for n in WINDOWS}, {}
    for s in (2024, 2025):
        t0 = time.time()
        d = load(c, s)
        oc = outcomes(c, s)  # seasons <= S only: the in-season dev never touches S+1
        heads = crossfit_heads(d, kinds)
        bp = d[d["hasxw"]]
        per_bip[s] = {k: float(np.corrcoef(score_oof(bp, ms, head_feats(k)), bp["xw"])[0, 1]) for k, ms in heads.items()}
        po = park_offsets(c, s)
        for n in WINDOWS:
            tabs[n].append(window_table(d, oc, s, heads, n, po))
        print(f"{s}: {len(d):,} swings, {time.time() - t0:.0f}s, per-BIP r {json.dumps(per_bip[s])}", flush=True)
        del d, heads
    out = {"per_bip_r": per_bip, "windows": {}}
    rng = np.random.default_rng(SEED)
    for n in WINDOWS:
        t = pd.concat(tabs[n], ignore_index=True)
        t["s25"] = (t["season"] == 2025).astype(float)
        for c_ in sum(FAM.values(), []):
            t[c_] = t[c_].fillna(t[c_].median())
        W = cluster_w([t["batter"].to_numpy()], rng, DRAWS)[0]
        base = ["marcel", "s25"]
        r = {"n": int(len(t)), "hitters": int(t["batter"].nunique()),
             "r_vs_target": {c_: float(t[c_].corr(t["tgt"])) for c_ in ["obs", "marcel", "bs", "blast"] +
                             [f"sq_{k}" for k in kinds]},
             "r_sq_wide_bs": float(t["sq_wide"].corr(t["bs"]))}
        r["heads_vs_marcel"] = {k: delta(t, base, [f"sq_{k}"], W) for k in kinds}
        r["family_alone"] = {f: delta(t, base, cols, W) for f, cols in FAM.items()}
        r["beyond_bat_speed"] = {k: delta(t, base + ["bs"], [f"sq_{k}"], W) for k in ("lgbm", "wide")}
        allc = ["marcel", "s25"] + sum(FAM.values(), [])
        pa = oof_ols(t, base, "tgt", "rest_n")
        pl, freq = nested_lasso(t, allc)
        r["nested_lasso_all"] = {**delta_pred(t, pa, pl, W), "keep": freq}
        r["nested_lasso_minus"] = {}
        for f in FAM:
            pm_, _ = nested_lasso(t, [c_ for c_ in allc if c_ not in FAM[f]], halves=0)
            r["nested_lasso_minus"][f] = delta_pred(t, pm_, pl, W)  # what the family adds on top of the rest
        for s in (2024, 2025):
            ts = t[t["season"] == s].reset_index(drop=True)
            Ws = cluster_w([ts["batter"].to_numpy()], rng, DRAWS)[0]
            r[f"wide_vs_marcel_{s}"] = delta(ts, ["marcel"], ["sq_wide"], Ws)
        out["windows"][n] = r
        print(f"N={n} n={r['n']}  r: {json.dumps({k: round(v, 3) for k, v in r['r_vs_target'].items()})}", flush=True)
        for sec in ("heads_vs_marcel", "family_alone", "beyond_bat_speed", "nested_lasso_minus"):
            for k, v in r[sec].items():
                print(f"  {sec} {k}: {v['d']:+.4f} [{v['ci'][0]:+.4f}, {v['ci'][1]:+.4f}]  base {v['wr2_base']:.3f}")
        v = r["nested_lasso_all"]
        print(f"  nested lasso all: {v['d']:+.4f} [{v['ci'][0]:+.4f}, {v['ci'][1]:+.4f}] keep {v['keep']}", flush=True)
    RES.mkdir(exist_ok=True)
    (RES / "swingq_98_dev.json").write_text(json.dumps(out, indent=1, default=float))
    print("wrote results/swingq_98_dev.json")


# ---------------------------------------------------------------- §98a: the single holdout read
FROZEN = {"head": "spline", "base": ["marcel"], "add": ["sq_spline"], "s_min_bip": 25, "s_bip_below": 75, "s_swings_below": 200,
          "n1_min_bip": 30, "bar": "ΔwR² > 0 with hitter-clustered 95% CI lower bound > 0"}


def final():
    from judge import cluster_w
    path = RES / "swingq_98a_final.json"
    if path.exists():
        sys.exit("§98a read already spent")
    c = con()
    tabs = []
    for s in (2024, 2025):
        d = load(c, s)
        oc = outcomes(c, s + 1)
        heads = crossfit_heads(d, [FROZEN["head"]])
        t = hitter_features(d, heads, park_offsets(c, s))
        t["n_swings"] = d.groupby("batter").size()
        t["marcel"] = marcel(oc, s, t.index, 5 * t["sumxw"].to_numpy(), 5 * t["nbip"].to_numpy()).to_numpy()
        n1 = oc[oc["season"] == s + 1].set_index("batter")[["xwcon", "bip"]].rename(columns={"xwcon": "tgt", "bip": "bip_n"})
        t = t.join(n1, how="inner")
        below = (t["nbip"] < FROZEN["s_bip_below"]) | (t["n_swings"] < FROZEN["s_swings_below"])
        t = t[below & (t["nbip"] >= FROZEN["s_min_bip"]) & (t["bip_n"] >= FROZEN["n1_min_bip"])].copy()
        t["season"] = s
        tabs.append(t.reset_index())
        del d
    t = pd.concat(tabs, ignore_index=True).dropna(subset=["tgt"] + FROZEN["base"] + FROZEN["add"])
    t["s25"] = (t["season"] == 2025).astype(float)
    W = cluster_w([t["batter"].to_numpy()], np.random.default_rng(SEED), DRAWS)[0]
    res = delta(t, FROZEN["base"] + ["s25"], FROZEN["add"], W, y="tgt", w="bip_n")
    rep = {"vs_bat_speed_base": delta(t, FROZEN["base"] + ["s25", "bs"], FROZEN["add"], W, y="tgt", w="bip_n"),
           "bat_speed_alone_vs_marcel": delta(t, FROZEN["base"] + ["s25"], ["bs"], W, y="tgt", w="bip_n"),
           "traits_vs_marcel": delta(t, FROZEN["base"] + ["s25"], FAM["traits"], W, y="tgt", w="bip_n"),
           "by_season": {int(k): delta(g.reset_index(drop=True), FROZEN["base"], FROZEN["add"],
                                       cluster_w([g["batter"].to_numpy()], np.random.default_rng(SEED), DRAWS)[0],
                                       y="tgt", w="bip_n") for k, g in t.groupby("season")},
           "r": {k: float(t[k].corr(t["tgt"])) for k in ("marcel", "obs", "bs") + tuple(FROZEN["add"])}}
    out = {"frozen": FROZEN, "n": int(len(t)), "hitters": int(t["batter"].nunique()),
           "n_by_season": {int(k): int(v) for k, v in t["season"].value_counts().items()},
           **res, "pass": bool(res["d"] > 0 and res["ci"][0] > 0), "reported": rep}
    RES.mkdir(exist_ok=True)
    path.write_text(json.dumps(out, indent=1, default=float))
    print(json.dumps(out, indent=1, default=float))


# ---------------------------------------------------------------- bake (descriptive grade; ships whatever §98a says)
BAKE_SEASONS = (2024, 2025, 2026)
FLOOR_BIP, QUAL_BIP = 25, 100
PART_WORD = {"batSpeed": "bat speed", "plane": "swing plane", "contactPoint": "contact point",
             "pitchDiet": "pitch diet", "context": "count and hand"}


def rel_label(n):
    return "high" if n >= 100 else "good" if n >= 50 else "fair"


def story(g, parts, gap):
    lead = max(parts, key=lambda k: parts[k])
    drag = min(parts, key=lambda k: parts[k])
    s = f"Swing grades {g}: "
    up = f"{PART_WORD[lead]} adds {parts[lead]:.0f}" if parts[lead] >= 1.5 else ""
    down = f"{PART_WORD[drag]} costs {abs(parts[drag]):.0f}" if parts[drag] <= -1.5 and drag != lead else ""
    if g >= 100:
        s += (f"{PART_WORD[lead]} carries it (+{parts[lead]:.0f})" if up else "no single part carries it")
        s += f"; {down}" if down else ""
    else:
        s += (f"{PART_WORD[drag]} holds it down (−{abs(parts[drag]):.0f})" if down else "nothing stands out, all a bit light")
        s += f"; {up}" if up else ""
    if abs(gap) >= 15:
        s += f". Results {'run ahead of' if gap > 0 else 'trail'} the swing by {abs(gap)} points of xwOBAcon."
    else:
        s += ". Results match the swing."
    return s


def spline_contrib(model, X, Xtr):
    """Exact additive split of the spline-ridge head: per feature, its spline terms times their ridge weights, centred on
    the fold's training mean; the last column is the base value. Rows sum to model.predict(X)."""
    imp, spl, rdg = model.named_steps.values()
    k = spl.n_features_out_ // X.shape[1]

    def parts(Z):
        B = spl.transform(imp.transform(Z)) * rdg.coef_
        return B.reshape(len(Z), X.shape[1], k).sum(2)
    mu = parts(Xtr).mean(0)
    P = parts(X) - mu
    return np.column_stack([P, np.full(len(X), rdg.intercept_ + mu.sum())])


def bake(kind="spline"):
    c = con()
    rows, scale = {}, {}
    for s in BAKE_SEASONS:
        t0 = time.time()
        d = load(c, s)
        cols = head_feats(kind)
        models = crossfit_heads(d, [kind])[kind]
        b = d[d["hasxw"]].copy()
        f = fold(b["batter"])
        contrib = np.zeros((len(b), len(cols) + 1))
        for j in range(5):
            m = f == j
            if kind == "spline":
                contrib[m] = spline_contrib(models[j], b.loc[m, cols], b.loc[~m, cols])
                assert np.allclose(contrib[m].sum(1), models[j].predict(b.loc[m, cols]), atol=1e-6)
            else:
                contrib[m] = models[j].predict(b.loc[m, cols], pred_contrib=True)
        b["px"] = contrib.sum(1)
        lg = float(b["px"].mean())
        for gname, gcols in GROUPS.items():
            b["p_" + gname] = contrib[:, [cols.index(x) for x in gcols if x in cols]].sum(1)
        b["p_context"] += contrib[:, -1] - lg          # each fold's base value vs the league mean (tiny)
        g = b.groupby("batter")
        h = pd.DataFrame({"n": g.size(), "sq": g["px"].mean(), "xwcon": g["xw"].mean(),
                          **{k: g["p_" + k].mean() for k in GROUPS}})
        sd = float(h.loc[h["n"] >= QUAL_BIP, "sq"].std())
        h["g"] = 100 + 10 * (h["sq"] - lg) / sd
        qual = np.sort(h.loc[h["n"] >= QUAL_BIP, "g"].to_numpy())
        scale[str(s)] = {"league_xwcon": round(lg, 4), "sd": round(sd, 4), "qualified": int(len(qual))}
        for pid, r in h[h["n"] >= FLOOR_BIP].iterrows():
            parts = {k: round(10 * r[k] / sd, 1) for k in GROUPS}
            gi, gap = int(round(r["g"])), int(round(1000 * (r["xwcon"] - r["sq"])))
            rows[f"{int(pid)}-{s}"] = {"g": gi, "pct": int(round(100 * np.searchsorted(qual, r["g"]) / len(qual))),
                                       "sq": round(float(r["sq"]), 3), "xwcon": round(float(r["xwcon"]), 3),
                                       "gap": gap, "nbip": int(r["n"]), "rel": rel_label(r["n"]),
                                       "parts": parts, "story": story(gi, parts, gap)}
        print(f"bake {s}: {int((h['n'] >= FLOOR_BIP).sum())} hitters, {time.time() - t0:.0f}s", flush=True)
        del d, b
    fin = RES / "swingq_98a_final.json"
    verdict = "forecast" if fin.exists() and json.loads(fin.read_text()).get("pass") else "descriptive"
    meta = {"section": "§98", "verdict": verdict, "head": kind, "floorBip": FLOOR_BIP, "qualBip": QUAL_BIP,
            "scale": scale, "groups": {k: v for k, v in GROUPS.items()},
            "note": NOTE[verdict]}
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "swingq.json").write_text(json.dumps({"meta": meta, "rows": rows}, sort_keys=True, separators=(",", ":")))
    print(f"wrote {OUT / 'swingq.json'}: {len(rows)} rows, verdict {verdict}")


NOTE = {"descriptive": "Descriptive, not a forecast. It settles fast (reliable from about 25 BIP) and on 2024-25 in-season samples "
                       "it improved Marcel's read of the rest of the season, but the one clean out-of-sample test (§98a, 114 "
                       "part-time hitter-seasons) could not confirm it, and for full-time hitters it does not beat their own "
                       "xwOBAcon (§91, §91b).",
        "forecast": "Tested (§98a): for hitters with 25-74 BIP, Marcel pulled toward this grade forecast next season's "
                    "xwOBAcon better than Marcel alone."}


def dev_xgb():
    """XGBoost and LightGBM cannot share a process on this machine (two OpenMP runtimes deadlock / segfault),
    so the XGBoost arm of the model-class comparison runs alone: narrow §91 features, same folds and windows."""
    from judge import cluster_w
    c = con()
    tabs, per_bip = {n: [] for n in WINDOWS}, {}
    for s in (2024, 2025):
        d = load(c, s, timing=False)
        oc = outcomes(c, s)
        heads = crossfit_heads(d, ["xgb"])
        bp = d[d["hasxw"]]
        per_bip[s] = float(np.corrcoef(score_oof(bp, heads["xgb"], XP), bp["xw"])[0, 1])
        po = park_offsets(c, s)
        for n in WINDOWS:
            tabs[n].append(window_table(d, oc, s, heads, n, po)[["batter", "season", "tgt", "rest_n", "marcel", "sq_xgb"]])
    out = {"per_bip_r": per_bip, "windows": {}}
    rng = np.random.default_rng(SEED)
    for n in WINDOWS:
        t = pd.concat(tabs[n], ignore_index=True)
        t["s25"] = (t["season"] == 2025).astype(float)
        W = cluster_w([t["batter"].to_numpy()], rng, DRAWS)[0]
        out["windows"][n] = {"n": int(len(t)), "xgb_vs_marcel": delta(t, ["marcel", "s25"], ["sq_xgb"], W)}
    (RES / "swingq_98_dev_xgb.json").write_text(json.dumps(out, indent=1, default=float))
    print(json.dumps(out, indent=1, default=float))


def selftest():
    assert story(86, {"batSpeed": -19.6, "plane": 7.6, "contactPoint": 0, "pitchDiet": 0, "context": 0}, -27) == (
        "Swing grades 86: bat speed holds it down (−20); swing plane adds 8. Results trail the swing by 27 points of xwOBAcon.")
    d = pd.DataFrame({"batter": [1] * 6, "xw": [np.nan, .3, np.nan, .5, .7, np.nan]})
    d["hasxw"] = d["xw"].notna()
    d["bipcum"] = d.groupby("batter")["hasxw"].cumsum()
    win = (d["bipcum"] < 2) | ((d["bipcum"] == 2) & d["hasxw"])
    assert win.tolist() == [True, True, True, True, False, False], win.tolist()
    oc = pd.DataFrame({"batter": [1, 2], "season": [2025, 2025], "xwcon": [.4, .3], "bip": [100, 100]})
    m = marcel(oc, 2025, pd.Index([1]), [5 * .5 * 10], [50])
    assert abs(m.iloc[0] - (25 + 100 * .35) / 150) < 1e-9, m
    # nested lasso recovers a planted signal and drops noise
    rng = np.random.default_rng(0)
    t = pd.DataFrame({"batter": np.arange(600), "a": rng.normal(size=600), "z": rng.normal(size=600),
                      "rest_n": 100.0})
    t["tgt"] = t["a"] + 0.5 * rng.normal(size=600)
    p, keep = nested_lasso(t, ["a", "z"], halves=2)
    assert np.corrcoef(p, t["tgt"])[0, 1] > 0.8 and keep["a"] == 1.0, keep
    print("swing_quality selftest pass")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
    elif "--dev-xgb" in sys.argv:
        dev_xgb()
    elif "--dev" in sys.argv:
        dev()
    elif "--final" in sys.argv:
        final()
    else:
        bake()
