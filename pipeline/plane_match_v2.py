"""§90b swing plane match, refined (swing program piece 2, docs/swing-program.md; §90 failed).

    python pipeline/plane_match_v2.py test       # self-check of the bases, FE solver and contrasts
    python pipeline/plane_match_v2.py explore    # hypotheses A-E on 2024-25 (exploration only)
    python pipeline/plane_match_v2.py confirm    # the §90b pre-registered claims on 2026, read ONCE
    python pipeline/plane_match_v2.py export [dev_cache.parquet]   # bake data/export/web/plane/

s = AA + VAA (degrees; + = the swing is steeper than the pitch's descent). Definitions come from
swing_common (competitive swings, VAA, squared-up, centred depth) and plane_match (FE demeaning, M2).
Every model: linear probability / OLS with hitter-season fixed effects, clustered bootstrap by hitter.
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
import swing_common as sc  # noqa: E402
from plane_match import GROUPS, demean, mismatch  # noqa: E402

RES = Path(__file__).parent / "results"
SEED = 901
GRP = ("FF", "SI", "FC", "SL", "CU", "CH")
# Frozen from the 2024-25 exploration (competitive swings): plate_z terciles, s knots (10/25/50/75/90th pct)
Z_EDGES = (2.08, 2.68)
S_KNOTS = (-8.9, -2.9, 3.8, 10.4, 16.3)
D_KNOTS = (-15.0, -8.0, 0.0, 8.0, 15.0)        # centred depth, inches
MIN_CELL_SWINGS = 20                            # usual-AA cells (leave-game-out / prior season)


# ---------------------------------------------------------------- data
def load(seasons) -> pd.DataFrame:
    sys.path.insert(0, str(sc.SAVANT_MART))
    import mart
    con = mart.connect()
    con.execute("SET threads TO 4"); con.execute("SET memory_limit = '2GB'")
    cols = ("pitcher", "game_pk", "pitch_type", "plate_x", "plate_z", "balls", "strikes", "launch_angle",
            "attack_angle", "attack_direction", "intercept_ball_minus_batter_pos_y_inches", "des",
            "estimated_woba_using_speedangle", "vx0", "vy0", "vz0", "ax", "ay", "az")
    d = sc.competitive_swings(con.sql(sc.swing_sql(seasons, cols)).df())
    d = d[d["description"].isin(sc.CONTACT + sc.WHIFF)].copy()
    d["depth_c"] = sc.depth_centered(d)
    d["vaa"], d["pspeed"] = sc.vaa(d), sc.plate_speed(d)
    d["sq"] = sc.squared_up(d).astype(float).where(d["description"].isin(sc.CONTACT))
    d["grp"] = d["pitch_type"].map(GROUPS)
    d = d.dropna(subset=["attack_angle", "attack_direction", "vaa", "pspeed", "plate_x", "plate_z", "grp"])
    d = d[d["balls"].between(0, 3) & d["strikes"].between(0, 2)].reset_index(drop=True)
    d["ht"] = np.digitize(d["plate_z"], Z_EDGES)                    # 0 low, 1 mid, 2 high
    d["cell"] = d["grp"] + "-" + d["ht"].map({0: "low", 1: "mid", 2: "high"})
    d["s"] = d["attack_angle"] + d["vaa"]
    d["abs_s"] = d["s"].abs()
    d["m2"] = mismatch(d["attack_angle"].values, d["vaa"].values, d["attack_direction"].values)[1]
    d["contact"] = d["description"].isin(sc.CONTACT).astype(float)
    bip = (d["description"] == "hit_into_play") & d["launch_angle"].notna()
    la = d["launch_angle"].where(bip)
    d["la"] = la
    d["ss"] = la.between(8, 32).astype(float).where(bip)
    d["pu"] = (la > 50).astype(float).where(bip)
    d["gb"] = (la < 10).astype(float).where(bip)
    d["xw"] = pd.to_numeric(d["estimated_woba_using_speedangle"], errors="coerce").where(bip)
    d["adc"] = d["depth_c"].abs()
    d["hs"] = d["batter"].astype(str) + "-" + d["season"].astype(str)
    return d.drop(columns=["des", "vx0", "vy0", "vz0", "ax", "ay", "az", "estimated_woba_using_speedangle"])


def pitcher_fb_vaa(seasons) -> pd.DataFrame:
    """Each pitcher-season's primary fastball (most-thrown of FF/SI, all pitches, regular season) and its mean VAA."""
    sys.path.insert(0, str(sc.SAVANT_MART))
    import mart
    con = mart.connect()
    con.execute("SET threads TO 4")
    y = 50.0 - sc.Y_PLATE
    q = f"""
      WITH p AS (SELECT pitcher, season, pitch_type,
                   (-vy0 - sqrt(greatest(vy0*vy0 - 2*ay*{y}, 0))) / ay AS t, vy0, ay, vz0, az
                 FROM pitches_all WHERE game_type = 'R' AND season IN ({", ".join(map(str, seasons))})
                   AND pitch_type IN ('FF', 'SI') AND vy0 IS NOT NULL AND ay <> 0)
      SELECT pitcher, season, pitch_type, count(*) AS n,
             avg(degrees(atan2(vz0 + az*t, -(vy0 + ay*t)))) AS fb_vaa
      FROM p GROUP BY 1, 2, 3"""
    a = con.sql(q).df().sort_values("n").groupby(["pitcher", "season"]).tail(1)
    return a[a["n"] >= 100][["pitcher", "season", "fb_vaa"]]


# ---------------------------------------------------------------- design
def hinge(x, knots, name):
    x = np.asarray(x, float)
    return {name: x, **{f"{name}_k{i}": np.maximum(0, x - k) for i, k in enumerate(knots)}}


def controls(d, depth=False, plane_add=False):
    c = {f"g_{g}": (d["grp"] == g).values for g in GRP[1:]}
    c["pspeed"] = d["pspeed"].values
    z, x = d["plate_z"].values, d["plate_x"].values
    c.update(z=z, z2=z ** 2, x=x, x2=x ** 2, xz=x * z)
    cnt = d["balls"].astype(int).values * 3 + d["strikes"].astype(int).values
    c.update({f"c{k}": cnt == k for k in range(1, 12)})
    if depth:
        c.update(hinge(d["depth_c"], D_KNOTS, "dc"))
    if plane_add:                                       # the additive steep/flat baseline (§90 B_both)
        aa, v = d["attack_angle"].values, d["vaa"].values
        c.update(aa=aa, aa2=aa ** 2, vaa=v, vaa2=v ** 2)
    return c


def fe_fit(d, y, terms, ctrl, boot=0, rng=None, fe="hs"):
    """OLS with `fe` fixed effects. terms/ctrl: dict name -> array aligned with d. Terms go last.
    Returns names, beta, optional (boot x k) clustered-by-hitter bootstrap draws of every coefficient."""
    cols = {**ctrl, **terms}
    ok = d[y].notna().values.copy()
    for v in cols.values():
        ok &= np.isfinite(np.asarray(v, float))
    s = d[ok]
    g = pd.factorize(s[fe])[0]
    X = demean(np.column_stack([np.asarray(v, float)[ok] for v in cols.values()]), g)
    yv = demean(s[y].values.astype(float), g)[:, 0]
    keep = X.std(0) > 1e-9
    X, names = X[:, keep], [n for n, k in zip(cols, keep) if k]
    beta = np.linalg.lstsq(X, yv, rcond=None)[0]
    out = {"names": names, "beta": beta, "n": int(ok.sum()), "hitters": int(s["batter"].nunique()),
           "ymean": float(s[y].mean())}
    if boot:
        h = pd.factorize(s["batter"])[0]
        o = np.argsort(h, kind="stable")
        parts = np.split(o, np.cumsum(np.bincount(h))[:-1])
        xtx = np.stack([X[i].T @ X[i] for i in parts]); xty = np.stack([X[i].T @ yv[i] for i in parts])
        draws = []
        for _ in range(boot):
            w = rng.multinomial(len(parts), np.full(len(parts), 1 / len(parts))).astype(float)
            draws.append(np.linalg.lstsq(np.einsum("h,hij->ij", w, xtx), w @ xty, rcond=None)[0])
        out["draws"] = np.array(draws)
    return out


def contrast(f, vec: dict):
    """Linear combination sum(w * beta[name]) with a bootstrap 95% CI."""
    w = np.array([vec.get(n, 0.0) for n in f["names"]])
    est = float(f["beta"] @ w)
    r = {"est": est, "n": f["n"], "hitters": f["hitters"]}
    if "draws" in f:
        lo, hi = np.percentile(f["draws"] @ w, [2.5, 97.5])
        r["ci"] = [float(lo), float(hi)]
    return r


def spline_delta(knots, name, lo, hi):
    """Contrast vector f(hi) - f(lo) for a hinge basis."""
    a, b = hinge([lo], knots, name), hinge([hi], knots, name)
    return {k: float(b[k][0] - a[k][0]) for k in a}


# ---------------------------------------------------------------- hypotheses
def usual_aa(d, keys, prior=None):
    """Hitter's usual attack angle per keys from his OTHER swings: leave-game-out within d, or (prior given)
    the prior season's mean. NaN when fewer than MIN_CELL_SWINGS swings back it."""
    if prior is not None:
        a = prior.groupby(keys)["attack_angle"].agg(["sum", "count"]).reset_index()
        m = d[keys].merge(a, on=keys, how="left")
        return (m["sum"] / m["count"]).where(m["count"] >= MIN_CELL_SWINGS).values
    k = keys + ["season"]
    tot = d.groupby(k)["attack_angle"].transform("sum"); n = d.groupby(k)["attack_angle"].transform("count")
    gs = d.groupby(k + ["game_pk"])["attack_angle"].transform("sum")
    gn = d.groupby(k + ["game_pk"])["attack_angle"].transform("count")
    return ((tot - gs) / (n - gn)).where((n - gn) >= MIN_CELL_SWINGS).values


def hyp_A(d, rng, boot):
    """Signed mismatch steers launch (balls in play, depth spline controlled): f(s P75) - f(s P25)."""
    out = {}
    bip = d[d["la"].notna()]
    for nm, sub in [("pooled", bip)] + [(c, bip[bip["cell"] == c]) for c in sorted(bip["cell"].unique())]:
        lo, hi = sub["s"].quantile([.25, .75])
        row = {"s_p25": lo, "s_p75": hi}
        for y in ("la", "ss", "pu", "gb"):
            f = fe_fit(sub, y, hinge(sub["s"], S_KNOTS, "s"), controls(sub, depth=True), boot, rng)
            row[y] = contrast(f, spline_delta(S_KNOTS, "s", lo, hi))
        out[nm] = row
    # pooled curve f(s) - f(median) for la and ss
    f = {y: fe_fit(bip, y, hinge(bip["s"], S_KNOTS, "s"), controls(bip, depth=True), boot, rng) for y in ("la", "ss")}
    med = float(bip["s"].median())
    out["curve"] = {y: {int(v): contrast(f[y], spline_delta(S_KNOTS, "s", med, v)) for v in range(-15, 26, 5)}
                    for y in f}
    # diagnostic: does VAA carry the same weight as AA (the s form), and does depth control move it?
    diag = {}
    for depth in (True, False):
        g = fe_fit(bip, "la", {"aa": bip["attack_angle"].values, "vaa": bip["vaa"].values}, controls(bip, depth),
                   boot, rng)
        diag[f"depth_{depth}"] = {"b_aa": contrast(g, {"aa": 1}), "b_vaa": contrast(g, {"vaa": 1})}
    out["diag_la_aa_vaa"] = diag
    return out


def hyp_B(d, rng, boot):
    """P(contact | competitive swing), whiffs included, no depth. s spline (raw) and |s|, M2 beyond AA+VAA additive."""
    out = {}
    for nm, sub in [("pooled", d)] + [(c, d[d["cell"] == c]) for c in sorted(d["cell"].unique())]:
        lo, hi = sub["s"].quantile([.25, .75])
        row = {"contact_rate": float(sub["contact"].mean())}
        f = fe_fit(sub, "contact", hinge(sub["s"], S_KNOTS, "s"), controls(sub), boot, rng)
        row["s_spline_p75_p25"] = contrast(f, spline_delta(S_KNOTS, "s", lo, hi))
        for m in ("abs_s", "m2"):
            iqr = float(sub[m].quantile(.75) - sub[m].quantile(.25))
            f = fe_fit(sub, "contact", {m: sub[m].values}, controls(sub, plane_add=True), boot, rng)
            row[f"{m}_iqr_beyond_additive"] = contrast(f, {m: iqr})
        out[nm] = row
    return out


def hyp_C(d, rng, boot):
    """Timing forgiveness: does quality fall off with |centred depth| more slowly when |s| is small?
    Interaction |dc| x |s| (and |dc| x s) beyond the depth spline and additive AA/VAA."""
    out = {}
    for y in ("sq", "ss", "xw"):
        sub = d[d[y].notna() & d["depth_c"].notna()]
        iqr = float(sub["abs_s"].quantile(.75) - sub["abs_s"].quantile(.25))
        t = {"abs_s": sub["abs_s"].values, "adc_x_abs_s": (sub["adc"] * sub["abs_s"]).values,
             "adc_x_s": (sub["adc"] * sub["s"]).values}
        f = fe_fit(sub, y, t, controls(sub, depth=True, plane_add=True), boot, rng)
        # slope change per 5 in. of |dc| when |s| goes P25 -> P75; and per 10 deg of signed s
        out[y] = {"adc5_x_abs_s_iqr": contrast(f, {"adc_x_abs_s": 5 * iqr}),
                  "adc5_x_s10": contrast(f, {"adc_x_s": 50.0}),
                  "baseline_slope_per5in": contrast(fe_fit(sub, y, {"adc": sub["adc"].values},
                                                           controls(sub, plane_add=True), boot, rng), {"adc": 5})}
    return out


def plane_fit_terms(d, ua):
    """Usual-plane terms: usual AA (signed, + = steeper than his other cells) and |usual AA + VAA|."""
    return {"ua": ua, "abs_su": np.abs(ua + d["vaa"].values)}


def hyp_D(d, rng, boot, prior=None, label="lgo"):
    """Hitter plane fit from his OTHER swings predicts contact / squared-up / xwOBAcon in that cell.
    Controls: hitter-season FE, cell dummies (group x height), VAA, VAA^2. No swing's own AA."""
    keys = ["batter", "stand", "cell"]
    ua = usual_aa(d, keys, prior)
    cells = {f"cell_{c}": (d["cell"] == c).values for c in sorted(d["cell"].unique())[1:]}
    base = {**controls(d), **cells, "vaa": d["vaa"].values, "vaa2": d["vaa"].values ** 2}
    ok = np.isfinite(ua)
    out = {"label": label, "swings_with_usual": int(ok.sum())}
    sd = float(np.nanstd(ua - pd.Series(ua).groupby(d["hs"].values).transform("mean").values))
    out["within_hitter_sd_usual_aa"] = sd
    for y in ("contact", "sq", "xw"):
        ctrl = {**base, **(hinge(d["depth_c"], D_KNOTS, "dc") if y != "contact" else {})}
        t = plane_fit_terms(d, ua)
        f1 = fe_fit(d, y, {"ua": t["ua"]}, ctrl, boot, rng)
        f2 = fe_fit(d, y, {"abs_su": t["abs_su"]}, {**ctrl, "ua": t["ua"], "ua2": t["ua"] ** 2}, boot, rng)
        out[y] = {"ua_per_sd": contrast(f1, {"ua": sd}), "abs_su_per5deg_beyond_ua": contrast(f2, {"abs_su": 5})}
    # by cell, contact only: does a steeper usual plane in this cell help or hurt?
    out["contact_by_cell"] = {}
    for c in sorted(d["cell"].unique()):
        m = (d["cell"] == c).values
        sub = d[m]
        f = fe_fit(sub, "contact", {"ua": ua[m]}, {**controls(sub), "vaa": sub["vaa"].values}, boot, rng)
        out["contact_by_cell"][c] = contrast(f, {"ua": sd})
    return out


def reliability(d, rng):
    """Split-half (odd/even games) of each hitter's cell-specific usual AA, net of his own mean and the cell mean."""
    t = d[["hs", "batter", "stand", "cell", "game_pk", "attack_angle"]].copy()
    t["half"] = (pd.factorize(t["game_pk"])[0] % 2)
    t["dev"] = (t["attack_angle"] - t.groupby("cell")["attack_angle"].transform("mean")
                - t.groupby("hs")["attack_angle"].transform("mean") + t["attack_angle"].mean())
    a = t.groupby(["hs", "stand", "cell", "half"])["dev"].agg(["mean", "count"]).unstack("half")
    a = a[(a["count"] >= 40).all(1)]
    r = float(np.corrcoef(a["mean"][0], a["mean"][1])[0, 1])
    # the hitter-level scalar: his overall usual AA (between hitters)
    b = t.groupby(["hs", "half"])["attack_angle"].mean().unstack()
    rb = float(b[0].corr(b[1]))
    return {"hitter_cells": len(a), "cell_dev_split_half_r": r, "spearman_brown": 2 * r / (1 + r),
            "overall_aa_split_half_r": rb}


def hyp_E(d, rng, boot, fbv, prior=None, label="lgo"):
    """Whiffs on fastballs: hitter's usual fastball AA (other swings) x pitcher's primary-fastball VAA,
    beyond the pitch's own VAA, the pitcher's VAA and hitter-season FE."""
    fb = d[d["grp"].isin(["FF", "SI"])].copy()
    fb["fbgrp"] = "FB"
    ua = usual_aa(fb, ["batter", "stand", "fbgrp"], None if prior is None else prior.assign(fbgrp="FB")[
        prior["grp"].isin(["FF", "SI"])])
    fb = fb.merge(fbv, on=["pitcher", "season"], how="left")
    fb["whiff"] = 1 - fb["contact"]
    ua_c = ua - np.nanmean(ua)
    pv = fb["fb_vaa"].values - np.nanmean(fb["fb_vaa"].values)
    ctrl = {**controls(fb), "vaa": fb["vaa"].values, "vaa2": fb["vaa"].values ** 2, "pv": pv}
    f = fe_fit(fb, "whiff", {"ua_x_pv": ua_c * pv}, ctrl, boot, rng)
    iqr_u = float(np.nanpercentile(ua, 75) - np.nanpercentile(ua, 25))
    iqr_p = float(np.nanpercentile(fb["fb_vaa"], 75) - np.nanpercentile(fb["fb_vaa"], 25))
    g = fe_fit(fb, "whiff", {}, ctrl, boot, rng)
    return {"label": label, "n": f["n"], "whiff_rate": f["ymean"], "iqr_usual_aa": iqr_u, "iqr_pitcher_vaa": iqr_p,
            "did_iqr_x_iqr": contrast(f, {"ua_x_pv": iqr_u * iqr_p}),
            "pitcher_vaa_alone_per_iqr": contrast(g, {"pv": iqr_p})}


def confounds(d):
    """Depth leaking into AA, AA coverage on whiffs vs contact (selection), contact share by s."""
    c = d[d["depth_c"].notna()]
    aa_w = c["attack_angle"] - c.groupby("hs")["attack_angle"].transform("mean")
    out = {"within_hitter_r_aa_depth_contact": float(np.corrcoef(aa_w, c["depth_c"])[0, 1]),
           "aa_mean_contact": float(d.loc[d.contact == 1, "attack_angle"].mean()),
           "aa_mean_whiff": float(d.loc[d.contact == 0, "attack_angle"].mean()),
           "aa_sd_contact": float(d.loc[d.contact == 1, "attack_angle"].std()),
           "aa_sd_whiff": float(d.loc[d.contact == 0, "attack_angle"].std())}
    sb = pd.cut(d["s"], [-90, *S_KNOTS, 90])
    out["contact_rate_by_s_bin"] = {str(k): float(v) for k, v in d.groupby(sb, observed=True)["contact"].mean().items()}
    # own AA vs usual (leave-game-out): how much of a swing's AA is the swing, not the hitter?
    ua = usual_aa(d, ["batter", "stand", "cell"])
    ok = np.isfinite(ua)
    out["r_own_aa_vs_usual"] = float(np.corrcoef(d["attack_angle"].values[ok], ua[ok])[0, 1])
    out["own_minus_usual_by_outcome"] = {
        k: float((d["attack_angle"].values[ok & m] - ua[ok & m]).mean())
        for k, m in (("whiff", (d.contact == 0).values), ("foul", (d.description == "foul").values),
                     ("bip_sq", (d.sq == 1).values), ("bip_not_sq", ((d.sq == 0) & (d.description == "hit_into_play")).values))}
    return out


# ---------------------------------------------------------------- the §90b claims (frozen with the pre-registration)
CLAIMS = {"P1": {"min": 0.020, "dir": +1}, "P2": {"min": -0.008, "dir": -1}, "P3": {"min": -0.010, "dir": -1},
          "P4": {"min": 0.70}}
ABS_S_IQR, UA_SD, B_CONFIRM, SEED_CONFIRM = 7.06, 5.39, 1000, 902


def holm(p: dict, alpha=0.05) -> dict:
    """Holm step-down: True where rejected."""
    out, ks = {}, sorted(p, key=p.get)
    for i, k in enumerate(ks):
        if p[k] > alpha / (len(ks) - i):
            out.update({j: False for j in ks[i:]}); break
        out[k] = True
    return out


def confirm():
    out_p = RES / "plane_v2_confirm.json"
    assert not out_p.exists(), "§90b 2026 confirmation already read once"
    rng = np.random.default_rng(SEED_CONFIRM)
    cache = Path(sys.argv[2]) if len(sys.argv) > 2 else None
    if cache and cache.exists():                       # 2024-25 exploration frame; only 2025 is used (priors)
        d25 = pd.read_parquet(cache).query("season == 2025")
        d25["cell"] = d25["grp"] + "-" + pd.Series(np.digitize(d25["plate_z"], Z_EDGES), d25.index).map(
            {0: "low", 1: "mid", 2: "high"})
    else:
        d25 = load((2025,))
    d = load((2026,))
    res = {"n_swings": len(d), "hitters": int(d["batter"].nunique()), "claims": {}}
    draws = {}
    # P1: inverted U in sweet-spot rate around s = 0
    bip = d[d["la"].notna()]
    f = fe_fit(bip, "ss", hinge(bip["s"], S_KNOTS, "s"), controls(bip, depth=True), B_CONFIRM, rng)
    w = [np.array([spline_delta(S_KNOTS, "s", v, 0.0).get(n, 0.0) for n in f["names"]]) for v in (15.0, -10.0)]
    est = min(float(f["beta"] @ w[0]), float(f["beta"] @ w[1]))
    draws["P1"] = np.minimum(f["draws"] @ w[0], f["draws"] @ w[1])
    res["claims"]["P1"] = {"est": est, "ss0_minus_ss15": float(f["beta"] @ w[0]),
                           "ss0_minus_ssm10": float(f["beta"] @ w[1]), "n": f["n"]}
    # P2: timing forgiveness on xwOBAcon
    sub = d[d["xw"].notna() & d["depth_c"].notna()]
    t = {"abs_s": sub["abs_s"].values, "adc_x_abs_s": (sub["adc"] * sub["abs_s"]).values,
         "adc_x_s": (sub["adc"] * sub["s"]).values}
    f = fe_fit(sub, "xw", t, controls(sub, depth=True, plane_add=True), B_CONFIRM, rng)
    wv = np.array([5 * ABS_S_IQR if n == "adc_x_abs_s" else 0.0 for n in f["names"]])
    draws["P2"] = f["draws"] @ wv
    res["claims"]["P2"] = {"est": float(f["beta"] @ wv), "n": f["n"]}
    # P3: prior-season (2025) cell plane -> 2026 contact, beyond his 2025 cell contact rate
    k = ["batter", "stand", "cell"]
    pr = d25.groupby(k).agg(n=("contact", "size"), pc=("contact", "mean")).reset_index().merge(
        d25[d25["contact"] == 1].groupby(k)["attack_angle"].mean().rename("ua").reset_index(), on=k, how="left")
    m = d[k].merge(pr, on=k, how="left")
    ok = (m["n"] >= MIN_CELL_SWINGS).values
    ua, pc = np.where(ok, m["ua"].values, np.nan), np.where(ok, m["pc"].values, np.nan)
    cells = {f"cell_{c}": (d["cell"] == c).values for c in sorted(d["cell"].unique())[1:]}
    ctrl = {**controls(d), **cells, "vaa": d["vaa"].values, "vaa2": d["vaa"].values ** 2, "pc": pc}
    f = fe_fit(d, "contact", {"ua": ua}, ctrl, B_CONFIRM, rng)
    wv = np.array([UA_SD if n == "ua" else 0.0 for n in f["names"]])
    draws["P3"] = f["draws"] @ wv
    res["claims"]["P3"] = {"est": float(f["beta"] @ wv), "n": f["n"], "hitters": f["hitters"]}
    # P4: reliability of the cell-specific plane trait
    rel = reliability(d, rng)
    res["claims"]["P4"] = {"est": rel["spearman_brown"], **rel}
    # verdicts
    p = {}
    for c in ("P1", "P2", "P3"):
        dr, dirn = draws[c], CLAIMS[c]["dir"]
        p[c] = float(((dr * dirn) <= 0).mean())
        res["claims"][c].update(ci=np.percentile(dr, [2.5, 97.5]).tolist(), p_one_sided=p[c])
    rej = holm(p)
    for c in ("P1", "P2", "P3"):
        e, mn = res["claims"][c]["est"], CLAIMS[c]["min"]
        size_ok = e >= mn if CLAIMS[c]["dir"] > 0 else e <= mn
        res["claims"][c].update(holm_reject=rej[c], size_ok=bool(size_ok), pass_=bool(rej[c] and size_ok))
    res["claims"]["P4"]["pass_"] = bool(rel["spearman_brown"] >= CLAIMS["P4"]["min"])
    out_p.write_text(json.dumps(_round(res), indent=1))
    print(json.dumps(_round(res), indent=1))


def _round(o):
    if isinstance(o, dict):
        return {str(k): _round(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_round(v) for v in o]
    if isinstance(o, (float, np.floating)):
        return round(float(o), 5)
    if isinstance(o, np.integer):
        return int(o)
    return o


def explore():
    rng = np.random.default_rng(SEED)
    boot = 200
    cache = Path(sys.argv[2]) if len(sys.argv) > 2 else None
    if cache and cache.exists():
        d = pd.read_parquet(cache)
        d["ht"] = np.digitize(d["plate_z"], Z_EDGES)
        d["cell"] = d["grp"] + "-" + d["ht"].map({0: "low", 1: "mid", 2: "high"})
    else:
        d = load((2024, 2025))
        if cache:
            d.to_parquet(cache, compression="zstd")
    print(f"loaded {len(d):,} swings; s quantiles {d['s'].quantile([.1, .25, .5, .75, .9]).round(1).tolist()}; "
          f"plate_z terciles {d['plate_z'].quantile([1/3, 2/3]).round(2).tolist()}", flush=True)
    res = {"n_swings": len(d), "hitters": int(d["batter"].nunique()), "confounds": confounds(d)}
    print(json.dumps(_round(res["confounds"]), indent=0), flush=True)
    for k, fn in (("A", hyp_A), ("B", hyp_B), ("C", hyp_C)):
        res[k] = fn(d, rng, boot); print(k, "done", flush=True)
    res["D_lgo"] = hyp_D(d, rng, boot)
    d25 = d[d["season"] == 2025].reset_index(drop=True)
    d24 = d[d["season"] == 2024]
    res["D_prior"] = hyp_D(d25, rng, boot, prior=d24, label="2024 usual -> 2025 outcomes")
    res["D_reliability"] = reliability(d, rng)
    print("D done", flush=True)
    fbv = pitcher_fb_vaa((2024, 2025))
    res["E_lgo"] = hyp_E(d, rng, boot, fbv)
    res["E_prior"] = hyp_E(d25, rng, boot, fbv, prior=d24, label="2024 usual -> 2025 outcomes")
    (RES / "plane_v2_explore.json").write_text(json.dumps(_round(res), indent=1))
    print("wrote results/plane_v2_explore.json")


# ---------------------------------------------------------------- bake (§90b passed 4/4; descriptive + contact read)
OUT = Path(__file__).resolve().parents[1] / "data" / "export" / "web" / "plane"
BAKE_SEASONS = (2024, 2025, 2026)
HITTER_MIN_SWINGS, CELL_MIN_SWINGS, CELL_MIN_CONTACT, PITCHER_MIN = 150, 20, 10, 200
PP_PER_DEG = -100 * 0.02034 / UA_SD              # §90b P3 on 2026: contact pp per degree of steeper cell plane
S_GRID = list(range(-15, 26, 5))
ADC_BINS = [0, 2, 4, 6, 8, 10, 13, 99]
CELLS = [f"{g}-{h}" for g in GRP for h in ("low", "mid", "high")]


def pitcher_cells(seasons) -> pd.DataFrame:
    """Each pitcher-season's pitch share by cell (all regular-season pitches), as GROUPS x Z_EDGES."""
    sys.path.insert(0, str(sc.SAVANT_MART))
    import mart
    con = mart.connect()
    con.execute("SET threads TO 4")
    grp = " ".join(f"WHEN '{k}' THEN '{v}'" for k, v in GROUPS.items())
    q = f"""SELECT pitcher, season, CASE pitch_type {grp} END AS grp,
              CASE WHEN plate_z < {Z_EDGES[0]} THEN 'low' WHEN plate_z < {Z_EDGES[1]} THEN 'mid' ELSE 'high' END AS ht,
              count(*) AS n
            FROM pitches_all WHERE game_type = 'R' AND season IN ({", ".join(map(str, seasons))}) AND plate_z IS NOT NULL
            GROUP BY 1, 2, 3, 4"""
    return con.sql(q).df().dropna(subset=["grp"])


def league_doc(d: pd.DataFrame) -> dict:
    bip = d[d["la"].notna()]
    p1 = {}
    for nm, sub in [("all", bip)] + [(c, bip[bip["cell"] == c]) for c in CELLS]:
        f = fe_fit(sub, "ss", hinge(sub["s"], S_KNOTS, "s"), controls(sub, depth=True))
        lo, hi = sub["s"].quantile([.05, .95])
        p1[nm] = {"n": f["n"], "ss": round(f["ymean"] * 100, 1), "sRange": [round(lo, 1), round(hi, 1)],
                  "curve": [{"s": v, "pp": round(100 * contrast(f, spline_delta(S_KNOTS, "s", 0.0, v))["est"], 1)}
                            for v in S_GRID if lo - 2.5 <= v <= hi + 2.5]}
    sub = d[d["xw"].notna() & d["depth_c"].notna()].copy()
    sub["xw_w"] = sub["xw"] - sub.groupby("hs")["xw"].transform("mean") + sub["xw"].mean()
    lo, hi = sub["abs_s"].quantile([.25, .75])
    sub["plane"] = np.where(sub["abs_s"] <= lo, "matched", np.where(sub["abs_s"] >= hi, "mismatched", None))
    sub["bin"] = pd.cut(sub["adc"], ADC_BINS, right=False, labels=[f"{a}-{b}" for a, b in zip(ADC_BINS, ADC_BINS[1:])])
    p2 = {k: [{"bin": str(b), "xw": round(r["mean"], 3), "n": int(r["size"])}
              for b, r in g.groupby("bin", observed=True)["xw_w"].agg(["mean", "size"]).iterrows()]
          for k, g in sub[sub["plane"].notna()].groupby("plane")}
    con = d[d["contact"] == 1]
    cell_aa = {str(s): {c: {"aa": round(x["mean"], 1), "n": int(x["size"])} for c, x in
                        g.groupby("cell")["attack_angle"].agg(["mean", "size"]).iterrows()}
               for s, g in con.groupby("season")}
    ver = json.loads((RES / "plane_v2_confirm.json").read_text())["claims"]
    return {"seasons": list(BAKE_SEASONS), "zEdges": list(Z_EDGES), "groups": list(GRP), "p1": p1,
            "p2": {"curves": p2, "absS": [round(lo, 2), round(hi, 2)]}, "cellAA": cell_aa,
            "ppPerDeg": round(PP_PER_DEG, 3),
            "verdict": {k: {"est": v["est"], "ci": v.get("ci"), "pass": v["pass_"]} for k, v in ver.items()},
            "label": "descriptive, not a forecast; the hitter read is a contact read, not damage (RESULTS-MLB §90b)"}


def hitter_docs(d: pd.DataFrame, lg: dict) -> int:
    import gzip
    OUT.mkdir(parents=True, exist_ok=True)
    n = 0
    for (pid, season), g in d.groupby(["batter", "season"]):
        if len(g) < HITTER_MIN_SWINGS:
            continue
        side = g["stand"].mode().iloc[0]
        g = g[g["stand"] == side]
        lc = lg["cellAA"][str(season)]
        rows = []
        for c, x in g.groupby("cell"):
            con = x[x["contact"] == 1]
            if len(x) < CELL_MIN_SWINGS or len(con) < CELL_MIN_CONTACT or c not in lc:
                continue
            aa = float(con["attack_angle"].mean())
            rows.append({"cell": c, "n": int(len(x)), "nContact": int(len(con)), "aa": round(aa, 1),
                         "lgAA": lc[c]["aa"], "delta": round(aa - lc[c]["aa"], 1), "contact": round(100 * float(x["contact"].mean()), 1)})
        if not rows:
            continue
        w = np.array([r["n"] for r in rows], float)
        off = float(np.average([r["delta"] for r in rows], weights=w))   # his overall steepness vs league
        for r in rows:
            r["rel"] = round(r["delta"] - off, 1)                          # cell-specific plane (what §90b P3 tested)
            r["contactPp"] = round(r["rel"] * PP_PER_DEG, 1)
        doc = {"id": str(pid), "season": int(season), "side": side, "n": int(len(g)),
               "aa": round(float(g.loc[g["contact"] == 1, "attack_angle"].mean()), 1), "offset": round(off, 1),
               "cells": rows, "ppPerDeg": lg["ppPerDeg"]}
        with gzip.open(OUT / f"{pid}-{season}.json.gz", "wt", compresslevel=9) as fh:
            json.dump(doc, fh, separators=(",", ":"))
        n += 1
    return n


def export():
    cache = Path(sys.argv[2]) if len(sys.argv) > 2 else None
    dev = pd.read_parquet(cache) if cache and cache.exists() else load((2024, 2025))
    dev["ht"] = np.digitize(dev["plate_z"], Z_EDGES)
    dev["cell"] = dev["grp"] + "-" + dev["ht"].map({0: "low", 1: "mid", 2: "high"})
    d = pd.concat([dev, load((2026,))], ignore_index=True)
    lg = league_doc(d)
    nh = hitter_docs(d, lg)
    pc = pitcher_cells(BAKE_SEASONS)
    pc["cell"] = pc["grp"] + "-" + pc["ht"]
    for season, g in pc.groupby("season"):
        tot = g.groupby("pitcher")["n"].sum()
        g = g[g["pitcher"].map(tot) >= PITCHER_MIN]
        out = {str(int(p)): {"n": int(tot[p]), "cells": {r.cell: round(100 * r.n / tot[p], 1) for r in x.itertuples()}}
               for p, x in g.groupby("pitcher")}
        (OUT / f"pitchers-{int(season)}.json").write_text(json.dumps(out, separators=(",", ":")))
    (OUT / "league.json").write_text(json.dumps(_round(lg), separators=(",", ":")))
    print(f"plane bake: {nh} hitter-season files + league.json + pitchers-{{season}}.json -> {OUT}")


def test():
    h = hinge([0.0, 10.0], (5.0,), "s")
    assert h["s_k0"].tolist() == [0.0, 5.0]
    dv = spline_delta((5.0,), "s", 0.0, 10.0)
    assert dv == {"s": 10.0, "s_k0": 5.0}
    rng = np.random.default_rng(0)
    n = 30000
    d = pd.DataFrame({"batter": rng.integers(0, 60, n), "season": 2025})
    d["hs"] = d["batter"].astype(str)
    d["x"] = rng.normal(0, 3, n)
    d["y"] = 0.01 * d["batter"] + np.where(d["x"] > 5, 0.2 * (d["x"] - 5), 0) + rng.normal(0, .3, n)
    f = fe_fit(d, "y", hinge(d["x"], (5.0,), "x"), {}, boot=50, rng=rng)
    c = contrast(f, spline_delta((5.0,), "x", 0.0, 10.0))
    assert abs(c["est"] - 1.0) < 0.1 and c["ci"][0] > 0.8, c
    assert holm({"a": .001, "b": .02, "c": .04}) == {"a": True, "b": True, "c": True}
    assert holm({"a": .001, "b": .03, "c": .04}) == {"a": True, "b": False, "c": False}
    print("plane_match_v2: self-check passes")


if __name__ == "__main__":
    {"test": test, "explore": explore, "confirm": lambda: confirm(), "export": export}[sys.argv[1]]()
