"""RESULTS-MLB §92: timing residual (swing program piece 4). Contact depth vs the depth the pitch should produce.

    python timing_residual.py --demo   # synthetic self-check of the leave-one-game-out offset and split-half
    python timing_residual.py --gate   # §92 gates on 2024-25 -> results/timing_92.json (no 2026 outcomes)
    python timing_residual.py          # bake data/export/web/timing/timing.json (2024-26 traits, descriptive)

Stage 1: league LightGBM of contact depth on pitch + count, hitter-grouped out-of-fold (no hitter info).
Stage 2: the hitter's pitch-adjusted mean from his OTHER games that season and side. Residual e, + = early (out front).
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

OUT = ROOT / "data" / "export" / "web" / "timing"
RES = PIPE / "results"
GROUP = {**dict.fromkeys(("FF", "SI", "FC"), "FB"), **dict.fromkeys(("SL", "ST", "SV", "CU", "KC", "CS"), "BR"),
         **dict.fromkeys(("CH", "FS", "FO"), "OS")}
PT_CODE = {p: i for i, p in enumerate(GROUP)}
BANDS = [("lt92", 0, 92), ("92-95", 92, 95), ("95+", 95, 200)]
FEATS = ["pspeed", "release_speed", "pt", "pfx_xb", "pfx_z", "plate_xb", "plate_z", "same", "balls", "strikes"]
LGB = dict(n_estimators=300, learning_rate=0.05, num_leaves=63, min_child_samples=200, subsample=0.8, subsample_freq=1,
           colsample_bytree=0.8, n_jobs=4, verbose=-1)
FLOOR_HALF = {"FB": 40, "BR": 40, "OS": 40, "lt92": 25, "92-95": 25, "95+": 25, "sd": 100}
PASS_SB = 0.60


def load_swings(seasons, extra=()) -> pd.DataFrame:
    """Tracked regular-season swings with the pitch features every swing-program model uses."""
    sys.path.insert(0, str(MART_DIR))
    import mart
    con = mart.connect()
    con.execute("SET threads TO 4")
    cols = ("game_date", "game_pk", "pitch_type", "release_speed", "p_throws", "balls", "strikes", "plate_x", "plate_z",
            "pfx_x", "pfx_z", "vx0", "vy0", "vz0", "ax", "ay", "az", "swing_length",
            "intercept_ball_minus_batter_pos_y_inches", "estimated_woba_using_speedangle") + tuple(extra)
    d = con.sql(sc.swing_sql(seasons, cols)).df()
    con.close()
    d = d[d["pitch_type"].isin(list(GROUP))].reset_index(drop=True)
    return add_features(d)


def add_features(d: pd.DataFrame) -> pd.DataFrame:
    hand = np.where(d["stand"] == "L", -1.0, 1.0)
    d["pspeed"] = sc.plate_speed(d)
    d["pt"] = d["pitch_type"].map(PT_CODE).astype("int16")
    d["grp"] = d["pitch_type"].map(GROUP)
    d["pfx_xb"], d["plate_xb"] = d["pfx_x"] * hand, d["plate_x"] * hand
    d["same"] = (d["p_throws"] == d["stand"]).astype("int8")
    d["fold"] = d["batter"].map(lambda b: zlib.crc32(str(int(b)).encode()) % 5)
    return d


def oof(d: pd.DataFrame, y: str, feats, seed: int, clf: bool = False) -> np.ndarray:
    """Hitter-grouped out-of-fold LightGBM prediction, fit within each season."""
    import lightgbm as lgb
    out = np.full(len(d), np.nan)
    for _, s in d.groupby("season").groups.items():
        ds = d.loc[s]
        for f in range(5):
            tr, te = ds[ds["fold"] != f], ds[ds["fold"] == f]
            M = (lgb.LGBMClassifier if clf else lgb.LGBMRegressor)(random_state=seed, **LGB)
            M.fit(tr[feats], tr[y], categorical_feature=["pt"])
            out[d.index.get_indexer(te.index)] = M.predict_proba(te[feats])[:, 1] if clf else M.predict(te[feats])
    return out


def logo_offset(d: pd.DataFrame, r: str) -> pd.Series:
    """Mean of r over the hitter's OTHER games in that season and side (leave-one-game-out)."""
    k = [d["batter"], d["season"], d["stand"]]
    g = d.groupby(k + [d["game_pk"]])[r]
    tot_s, tot_n = d.groupby(k)[r].transform("sum"), d.groupby(k)[r].transform("count")
    gs, gn = g.transform("sum"), g.transform("count")
    return (tot_s - gs) / (tot_n - gn).replace(0, np.nan)


def contact_frame(seasons) -> pd.DataFrame:
    d = load_swings(seasons)
    d = d[sc.competitive_mask(d) & d["description"].isin(sc.CONTACT)]
    d = d.dropna(subset=["intercept_ball_minus_batter_pos_y_inches", "pspeed"]).reset_index(drop=True)
    d["y"] = d["intercept_ball_minus_batter_pos_y_inches"]
    d["y0"] = oof(d, "y", FEATS, 92)
    d["r0"] = d["y"] - d["y0"]
    d["e"] = d["r0"] - logo_offset(d, "r0")
    d["band"] = np.where(d["grp"] != "FB", None, pd.cut(d["release_speed"], [0, 92, 95, 200], right=False,
                                                         labels=[b[0] for b in BANDS]).astype(object))
    d = d.sort_values(["batter", "season", "game_date", "game_pk"]).reset_index(drop=True)
    gi = d.groupby(["batter", "season"])["game_pk"].transform(lambda g: pd.factorize(g)[0])
    d["half"] = (gi % 2).astype("int8")
    return d


def traits(d: pd.DataFrame, e: str = "e") -> pd.DataFrame:
    """Per hitter-season: bias by group / FB velo band (mean e, n), consistency SD(e)."""
    k = ["batter", "season"]
    out = d.groupby(k)[e].agg(sd="std", n="count")
    for g in ("FB", "BR", "OS"):
        a = d[d["grp"] == g].groupby(k)[e].agg(["mean", "count"])
        out[g], out[f"n_{g}"] = a["mean"], a["count"]
    for b, _, _ in BANDS:
        a = d[d["band"] == b].groupby(k)[e].agg(["mean", "count"])
        out[b], out[f"n_{b}"] = a["mean"], a["count"]
    return out


def sb(r):
    return 2 * r / (1 + r)


def split_half(d: pd.DataFrame, seed=92):
    """Gate (a): each half's traits from that half only (residual vs the half's own pitch-adjusted mean, per side)."""
    d = d.copy()
    d["eh"] = d["r0"] - d.groupby(["batter", "season", "stand", "half"])["r0"].transform("mean")
    h = [traits(d[d["half"] == i], "eh") for i in (0, 1)]
    j = h[0].join(h[1], lsuffix="_a", rsuffix="_b", how="inner").reset_index()
    rng = np.random.default_rng(seed)
    res = {}
    for t in ("FB", "BR", "OS", "lt92", "92-95", "95+", "sd"):
        nk = "n" if t == "sd" else f"n_{t}"
        u = j[(j[f"{nk}_a"] >= FLOOR_HALF[t]) & (j[f"{nk}_b"] >= FLOOR_HALF[t])].dropna(subset=[f"{t}_a", f"{t}_b"])
        r = u[f"{t}_a"].corr(u[f"{t}_b"])
        ids = u["batter"].unique()
        grp = {b: ix for b, ix in u.groupby("batter").indices.items()}
        bs = []
        for _ in range(1000):
            ix = np.concatenate([grp[b] for b in rng.choice(ids, len(ids))])
            bs.append(sb(np.corrcoef(u[f"{t}_a"].to_numpy()[ix], u[f"{t}_b"].to_numpy()[ix])[0, 1]))
        by = {int(s): round(sb(g[f"{t}_a"].corr(g[f"{t}_b"])), 3) for s, g in u.groupby("season")}
        nh = float(pd.concat([u[f"{nk}_a"], u[f"{nk}_b"]]).mean())
        res[t] = {"units": len(u), "r_half": round(r, 3), "sb": round(sb(r), 3),
                  "ci": [round(float(np.percentile(bs, q)), 3) for q in (2.5, 97.5)], "by_season": by,
                  "mean_n_half": round(nh, 1), "k": round(nh * (1 - r) / r, 1) if r > 0 else None,
                  "pass": bool(sb(r) >= PASS_SB)}
    return res


def outcomes(seasons) -> pd.DataFrame:
    """K% and xwOBAcon per hitter-season, all regular-season PAs / balls in play (not only tracked)."""
    sys.path.insert(0, str(MART_DIR))
    import mart
    con = mart.connect()
    q = f"""SELECT batter, season,
              count(*) FILTER (WHERE events IS NOT NULL) AS pa,
              count(*) FILTER (WHERE events IN ('strikeout', 'strikeout_double_play')) AS k,
              count(*) FILTER (WHERE description = 'hit_into_play') AS bip,
              avg(estimated_woba_using_speedangle) FILTER (WHERE description = 'hit_into_play') AS xwcon
            FROM pitches_all WHERE game_type = 'R' AND season IN ({", ".join(map(str, seasons))}) GROUP BY 1, 2"""
    o = con.sql(q).df()
    con.close()
    o["kpct"] = o["k"] / o["pa"]
    return o.set_index(["batter", "season"])


def wr2_oof(X, y, w, folds):
    pred = np.empty(len(y))
    for f in np.unique(folds):
        tr = folds != f
        A = np.c_[np.ones(tr.sum()), X[tr]]
        sw = np.sqrt(w[tr])
        beta = np.linalg.lstsq(A * sw[:, None], y[tr] * sw, rcond=None)[0]
        pred[~tr] = np.c_[np.ones((~tr).sum()), X[~tr]] @ beta
    ybar = np.average(y, weights=w)
    return 1 - np.sum(w * (y - pred) ** 2) / np.sum(w * (y - ybar) ** 2)


def gate_b(d: pd.DataFrame, seed=92):
    t = traits(d[d["season"] == 2024])
    bat = d[d["season"] == 2024].groupby("batter")[["bat_speed", "swing_length"]].mean()
    o = outcomes((2024, 2025))
    o24, o25 = o.xs(2024, level="season"), o.xs(2025, level="season")
    t = t.xs(2024, level="season").join(bat)
    rng = np.random.default_rng(seed)
    res = {}
    for tgt, wcol, extra in (("kpct", "pa", None), ("xwcon", "bip", 75)):
        u = t[t["n"] >= 200].join(o24[[tgt]].rename(columns={tgt: "t0"})).join(o25[[tgt, "pa", "bip"]]).dropna()
        u = u[(u["pa"] >= 200) & (u["bip"] >= (extra or 0))]
        y, w, folds = u[tgt].to_numpy(), u[wcol].to_numpy().astype(float), u.index.map(lambda b: zlib.crc32(str(int(b)).encode()) % 5).to_numpy()
        X0, X1 = u[["t0"]].to_numpy(), u[["t0", "sd"]].to_numpy()

        def delta(ix):
            return wr2_oof(X1[ix], y[ix], w[ix], folds[ix]) - wr2_oof(X0[ix], y[ix], w[ix], folds[ix])
        full = delta(np.arange(len(u)))
        bs = [delta(rng.integers(0, len(u), len(u))) for _ in range(2000)]  # one row per hitter: row resample = hitter cluster
        lo, hi = np.percentile(bs, [2.5, 97.5])
        res[tgt] = {"n": len(u), "wr2_base": round(wr2_oof(X0, y, w, folds), 4), "d_wr2": round(full, 4),
                    "ci": [round(lo, 4), round(hi, 4)], "r_sd_t1": round(u["sd"].corr(u[tgt]), 3),
                    "r_base_t1": round(u["t0"].corr(u[tgt]), 3), "r_sd_t0": round(u["sd"].corr(u["t0"]), 3),
                    "pass": bool(full >= 0.005 and lo > 0)}
    res["r_sd_batspeed"] = round(t["sd"].corr(t["bat_speed"]), 3)
    res["r_sd_length"] = round(t["sd"].corr(t["swing_length"]), 3)
    return res


def yoy(d):
    t = traits(d)
    a, b = t.xs(2024, level="season"), t.xs(2025, level="season")
    j = a.join(b, lsuffix="_a", rsuffix="_b", how="inner")
    out = {}
    for tr in ("FB", "BR", "OS", "lt92", "92-95", "95+", "sd"):
        nk, fl = ("n", 200) if tr == "sd" else (f"n_{tr}", 2 * FLOOR_HALF[tr])
        u = j[(j[f"{nk}_a"] >= fl) & (j[f"{nk}_b"] >= fl)]
        out[tr] = {"n": len(u), "r": round(u[f"{tr}_a"].corr(u[f"{tr}_b"]), 3)}
    return out


def gate():
    d = contact_frame((2024, 2025))
    print(f"{len(d):,} competitive contact swings, {d.batter.nunique()} hitters; depth SD {d.y.std():.2f}, "
          f"stage-1 r {np.corrcoef(d.y, d.y0)[0, 1]:.3f}, residual SD {d.e.std():.2f}")
    res = {"n_swings": len(d), "hitters": int(d.batter.nunique()), "stage1_r": round(np.corrcoef(d.y, d.y0)[0, 1], 3),
           "resid_sd": round(d.e.std(), 2), "split_half": split_half(d), "gate_b": gate_b(d), "yoy": yoy(d)}
    lg = {f"{g}_{b}": round(float(x), 2) for (g, b), x in
          d.groupby(["grp", pd.cut(d.release_speed, [0, 80, 85, 90, 92, 95, 98, 200])], observed=True)["r0"].mean().items()}
    res["league_r0_by_group_velo"] = lg
    t = traits(d).join(d.groupby(["batter", "season"])["bat_speed"].mean())
    res["r_FBbias_batspeed"] = round(t[t.n_FB >= 100]["FB"].corr(t[t.n_FB >= 100]["bat_speed"]), 3)
    RES.mkdir(exist_ok=True)
    (RES / "timing_92.json").write_text(json.dumps(res, indent=1, default=str))
    print(json.dumps(res, indent=1, default=str))


def bake():
    g = json.loads((RES / "timing_92.json").read_text())
    sh, gb = g["split_half"], g["gate_b"]
    shown = [t for t in ("FB", "BR", "OS", "lt92", "92-95", "95+") if sh[t]["pass"]]
    d = contact_frame((2024, 2025, 2026))
    t = traits(d)
    t = t[t["n"] >= 100]
    rows, labels = {}, {}
    for tr in shown:  # shrink toward 0 by n/(n+k); label beyond the season's 20th/80th percentile
        t[f"{tr}_s"] = t[tr] * t[f"n_{tr}"] / (t[f"n_{tr}"] + sh[tr]["k"])
        q = t[t[f"n_{tr}"] >= FLOOR_HALF[tr]].groupby("season")[f"{tr}_s"].quantile([0.2, 0.8]).unstack()
        labels[tr] = q
    sd_pct = t.groupby("season")["sd"].rank(pct=True)
    NAME = {"FB": "fastballs", "BR": "breaking balls", "OS": "offspeed", "lt92": "sub-92 fastballs",
            "92-95": "92–95 fastballs", "95+": "95+"}
    for (b, s), r in t.iterrows():
        tags = []
        for tr in shown:
            v, n = r.get(f"{tr}_s"), r[f"n_{tr}"]
            if pd.isna(v) or n < FLOOR_HALF[tr]:
                continue
            lo, hi = labels[tr].loc[s, 0.2], labels[tr].loc[s, 0.8]
            z = abs(v) / max(hi - lo, 1e-6)
            if v <= lo:
                tags.append((z, f"late on {NAME[tr]}"))
            elif v >= hi:
                tags.append((z, f"early on {NAME[tr]}"))
        tags = [t_ for _, t_ in sorted(tags, reverse=True)]  # strongest first: tags[0] is the /matchup read
        rows[f"{int(b)}-{int(s)}"] = {
            "n": int(r["n"]), "sd": round(r["sd"], 2), "sdPct": round(100 * sd_pct.loc[(b, s)]),
            "bias": {tr: None if pd.isna(r[tr]) else {"v": round(r[tr], 2), "s": round(r[f"{tr}_s"], 2), "n": int(r[f"n_{tr}"])}
                     for tr in shown},
            "tags": tags,
        }
    OUT.mkdir(parents=True, exist_ok=True)
    meta = {"section": "§92", "shown": shown, "sdForecast": bool(gb["kpct"]["pass"] or gb["xwcon"]["pass"]),
            "reliability": {t_: sh[t_]["sb"] for t_ in sh}, "floors": FLOOR_HALF, "residSd": g["resid_sd"]}
    (OUT / "timing.json").write_text(json.dumps({"meta": meta, "rows": rows}, separators=(",", ":")))
    print(f"timing: {len(rows)} hitter-seasons, shown {shown}, {sum(bool(r['tags']) for r in rows.values())} with tags")


def demo():
    rng = np.random.default_rng(0)
    n = 4000
    d = pd.DataFrame({"batter": rng.integers(0, 20, n), "season": 2025, "stand": "R", "game_pk": rng.integers(0, 60, n)})
    true = d["batter"] * 0.5
    d["r0"] = true + rng.normal(0, 3, n)
    off = logo_offset(d, "r0")
    assert (off - true).abs().mean() < 0.6
    one = d[(d.batter == 3) & (d.game_pk == d[d.batter == 3].game_pk.iloc[0])]
    rest = d[(d.batter == 3) & (d.game_pk != one.game_pk.iloc[0])]["r0"].mean()
    assert np.allclose(off[one.index], rest)  # no swing's own game enters its offset
    assert abs(sb(0.5) - 2 / 3) < 1e-9
    print("timing_residual demo: ok")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--demo", action="store_true")
    ap.add_argument("--gate", action="store_true")
    a = ap.parse_args()
    demo() if a.demo else gate() if a.gate else bake()
