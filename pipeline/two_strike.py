"""RESULTS-MLB §93: two-strike adaptation (swing program piece 5).

    python two_strike.py --gate   # §93 gates on 2024-25 -> results/twostrike_93.json
    python two_strike.py          # bake data/export/web/twostrike/twostrike.json (2024-26, descriptive)

Per hitter-season: two-strike minus 0-1-strike mean residual of bat speed, swing length, centred depth and contact,
each residual vs a league LightGBM on the pitch (type, speed, movement, location, hand; no count, no hitter), so a
two-strike pitch mix and location do not pass for adaptation. All non-bunt tracked swings: the competitive-swing
filter drops the slowest 10%, which is where a shortened two-strike swing lives.
"""
import argparse
import json
import sys
import zlib
from pathlib import Path

import numpy as np
import pandas as pd

PIPE = Path(__file__).resolve().parent
ROOT = PIPE.parent
sys.path.insert(0, str(PIPE))
from paths import MART_DIR  # noqa: E402
import swing_common as sc  # noqa: E402
from timing_residual import FEATS, load_swings, oof  # noqa: E402

OUT = ROOT / "data" / "export" / "web" / "twostrike"
RES = PIPE / "results"
PFEATS = [f for f in FEATS if f not in ("balls", "strikes")]
MIN_2K, MIN_OTH = 100, 200
SWING = ("foul", "foul_tip", "hit_into_play", "swinging_strike", "swinging_strike_blocked", "foul_bunt", "missed_bunt",
         "bunt_foul_tip")


def frame(seasons) -> pd.DataFrame:
    d = load_swings(seasons)
    d["comp"] = sc.competitive_mask(d)
    d = d[~sc.is_bunt(d) & d["description"].isin(sc.CONTACT + sc.WHIFF)].dropna(subset=["pspeed"]).reset_index(drop=True)
    d["k2"] = d["strikes"] == 2
    d["ct"] = d["description"].isin(sc.CONTACT).astype(int)
    d["r_bs"] = d["bat_speed"] - oof(d, "bat_speed", PFEATS, 93)
    m = d["swing_length"].notna()
    d.loc[m, "r_sl"] = d.loc[m, "swing_length"] - oof(d[m], "swing_length", PFEATS, 93)
    d["r_ct"] = d["ct"] - oof(d, "ct", PFEATS, 93, clf=True)
    c = (d["ct"] == 1) & d["intercept_ball_minus_batter_pos_y_inches"].notna()
    d["y"] = d["intercept_ball_minus_batter_pos_y_inches"]
    d.loc[c, "r_dp"] = d.loc[c, "y"] - oof(d[c], "y", PFEATS, 93)
    d["r_dp"] -= d.groupby(["batter", "season", "stand"])["r_dp"].transform("mean")
    d["xw"] = d["estimated_woba_using_speedangle"].where(d["description"] == "hit_into_play")
    d = d.sort_values(["batter", "season", "game_date", "game_pk"]).reset_index(drop=True)
    d["half"] = d.groupby(["batter", "season"])["game_pk"].transform(lambda g: pd.factorize(g)[0] % 2)
    return d


def deltas(d: pd.DataFrame, f2k: int = MIN_2K, foth: int = MIN_OTH) -> pd.DataFrame:
    k = ["batter", "season"]
    g = d.groupby(k + ["k2"])
    a = g[["r_bs", "r_sl", "r_dp", "r_ct", "xw"]].mean().unstack("k2")
    out = pd.DataFrame({t: a[(t, True)] - a[(t, False)] for t in ("r_bs", "r_sl", "r_dp", "r_ct", "xw")})
    out.columns = ["dBS", "dSL", "dDP", "dCT", "dXW"]
    n = g.size().unstack("k2").fillna(0)
    out["n2k"], out["nOth"] = n[True], n[False]
    cp = d[d["comp"]].groupby(k + ["k2"])["r_bs"].mean().unstack("k2")
    out["dBScomp"] = cp[True] - cp[False]
    out["bs"] = d[d["comp"]].groupby(k)["bat_speed"].mean()
    return out[(out["n2k"] >= f2k) & (out["nOth"] >= foth)]


def boot_r(a, b, rng, n=2000):
    ix = rng.integers(0, len(a), (n, len(a)))
    return [np.corrcoef(a[i], b[i])[0, 1] for i in ix]


def rates(seasons) -> pd.DataFrame:
    sys.path.insert(0, str(MART_DIR))
    import mart
    con = mart.connect()
    sw = ", ".join(f"'{s}'" for s in SWING)
    wh = ", ".join(f"'{s}'" for s in sc.WHIFF)
    q = f"""SELECT batter, season,
              count(*) FILTER (WHERE events IS NOT NULL) AS pa,
              count(*) FILTER (WHERE events IN ('strikeout', 'strikeout_double_play')) AS k,
              count(*) FILTER (WHERE strikes < 2) AS p01,
              count(*) FILTER (WHERE strikes < 2 AND description IN ({sw})) AS sw01,
              count(*) FILTER (WHERE strikes < 2 AND description IN ({wh})) AS wh01
            FROM pitches_all WHERE game_type = 'R' AND season IN ({", ".join(map(str, seasons))}) GROUP BY 1, 2"""
    o = con.sql(q).df()
    con.close()
    o["kpct"], o["swing01"], o["whiff01"] = o.k / o.pa, o.sw01 / o.p01, o.wh01 / o.sw01
    return o.set_index(["batter", "season"])


def ols(X, y):
    A = np.c_[np.ones(len(y)), X]
    return np.linalg.lstsq(A, y, rcond=None)[0]


def gate():
    rng = np.random.default_rng(93)
    d = frame((2024, 2025))
    t = deltas(d)
    print(f"{len(d):,} swings; {len(t)} hitter-seasons over floors; league ΔBS mean {t.dBS.mean():+.2f} SD {t.dBS.std():.2f}")
    res = {"n_swings": len(d), "units": len(t),
           "league": {c: {"mean": round(t[c].mean(), 3), "sd": round(t[c].std(), 3)} for c in ("dBS", "dSL", "dDP", "dCT", "dXW", "dBScomp")},
           "raw_2k_minus_other_bs": round(d[d.k2].bat_speed.mean() - d[~d.k2].bat_speed.mean(), 2)}
    a, b = t.xs(2024, level="season"), t.xs(2025, level="season")
    j = a.join(b, lsuffix="_a", rsuffix="_b", how="inner")
    yo = {}
    for c in ("dBS", "dSL", "dDP", "dCT", "dBScomp"):
        u = j[[f"{c}_a", f"{c}_b"]].dropna()
        bs = boot_r(u.iloc[:, 0].to_numpy(), u.iloc[:, 1].to_numpy(), rng)
        yo[c] = {"n": len(u), "r": round(u.iloc[:, 0].corr(u.iloc[:, 1]), 3),
                 "ci": [round(float(np.percentile(bs, q)), 3) for q in (2.5, 97.5)]}
    yo["dBS"]["pass"] = bool(yo["dBS"]["r"] >= 0.50 and yo["dBS"]["ci"][0] >= 0.30)
    res["gate_a_yoy"] = yo
    h = [deltas(d[d.half == i], MIN_2K // 2, MIN_OTH // 2) for i in (0, 1)]  # half the season floors per half
    sh = h[0][["dBS"]].join(h[1][["dBS"]], lsuffix="_a", rsuffix="_b", how="inner").dropna()
    r = sh.iloc[:, 0].corr(sh.iloc[:, 1])
    res["split_half_dBS"] = {"units": len(sh), "r": round(r, 3), "sb": round(2 * r / (1 + r), 3)}

    o = rates((2024, 2025))
    u = t.join(o).dropna(subset=["dBS", "kpct", "whiff01", "swing01", "bs"])
    u = u[u.pa >= 200].reset_index()
    cols = ["whiff01", "swing01", "bs", "dBS"]
    X, y = u[cols].to_numpy(), u["kpct"].to_numpy()
    beta = ols(X, y)
    grp = {k_: v for k_, v in u.groupby("batter").indices.items()}
    ids = np.array(list(grp))
    bb, bx, bc = [], [], []
    for _ in range(2000):
        ix = np.concatenate([grp[i] for i in rng.choice(ids, len(ids))])
        bb.append(ols(X[ix], y[ix])[-1])
        bc.append(ols(u.loc[ix, ["dBS"]].to_numpy(), u.loc[ix, "dCT"].to_numpy())[-1])
        bx.append(ols(u.loc[ix, ["dBS"]].dropna().to_numpy(), u.loc[ix, "dXW"].to_numpy())[-1])
    lo, hi = np.percentile(bb, [2.5, 97.5])
    eff = beta[-1] * u["dBS"].std()
    res["gate_b"] = {"n": len(u), "hitters": len(ids), "beta_dBS": round(beta[-1], 5), "ci": [round(lo, 5), round(hi, 5)],
                     "effect_pp_per_sd": round(100 * eff, 2), "coefs": dict(zip(cols, np.round(beta[1:], 5))),
                     "pass": bool(lo > 0 and 100 * abs(eff) >= 0.5)}
    res["buys_costs"] = {
        "slope_dCT_on_dBS": round(ols(u[["dBS"]].to_numpy(), u["dCT"].to_numpy())[-1], 5),
        "ci_dCT": [round(float(np.percentile(bc, q)), 5) for q in (2.5, 97.5)],
        "slope_dXW_on_dBS": round(ols(u[["dBS"]].to_numpy(), u["dXW"].to_numpy())[-1], 5),
        "ci_dXW": [round(float(np.percentile(bx, q)), 5) for q in (2.5, 97.5)],
        "r_dBS_dCT": round(u.dBS.corr(u.dCT), 3), "r_dBS_dXW": round(u.dBS.corr(u.dXW), 3),
        "r_dBS_bs": round(u.dBS.corr(u.bs), 3), "r_dBS_kpct": round(u.dBS.corr(u.kpct), 3)}
    RES.mkdir(exist_ok=True)
    (RES / "twostrike_93.json").write_text(json.dumps(res, indent=1, default=float))
    print(json.dumps(res, indent=1, default=float))


def bake():
    g = json.loads((RES / "twostrike_93.json").read_text())
    if not g["gate_a_yoy"]["dBS"]["pass"]:
        print("§93 gate (a) failed: nothing to bake")
        return
    t = deltas(frame((2024, 2025, 2026)))
    t["pct"] = t.groupby("season")["dBS"].rank(pct=True)
    rows = {f"{int(b)}-{int(s)}": {
        "dBS": round(r.dBS, 2), "dSL": None if pd.isna(r.dSL) else round(r.dSL, 3),
        "dDP": None if pd.isna(r.dDP) else round(r.dDP, 2), "dCT": round(100 * r.dCT, 1),
        "n2k": int(r.n2k), "nOth": int(r.nOth), "pct": round(100 * r.pct)} for (b, s), r in t.iterrows()}
    lg = {int(s): {"dBS": round(x.dBS.mean(), 2), "dSL": round(x.dSL.mean(), 3), "dDP": round(x.dDP.mean(), 2),
                   "dCT": round(100 * x.dCT.mean(), 1), "n": len(x)} for s, x in t.groupby(level="season")}
    meta = {"section": "§93", "yoy": g["gate_a_yoy"]["dBS"]["r"], "kClaim": g["gate_b"]["pass"],
            "floors": {"twoStrike": MIN_2K, "other": MIN_OTH}, "league": lg}
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "twostrike.json").write_text(json.dumps({"meta": meta, "rows": rows}, separators=(",", ":")))
    print(f"twostrike: {len(rows)} hitter-seasons")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--gate", action="store_true")
    gate() if ap.parse_args().gate else bake()
