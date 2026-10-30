"""RESULTS-MLB §101: per-pitch-type Prevention+. Forecast if it passes, a descriptive grade if it earns one.

    python pipeline/prevention_pitch.py --make-seal   # write results/prevention_pitch_seal.json (no target read)
    nice -n 10 python pipeline/prevention_pitch.py --dev    # nested CV on dev pitchers, freeze the spec
    nice -n 10 python pipeline/prevention_pitch.py --seal   # read the sealed 20% once on the frozen spec
    python pipeline/prevention_pitch.py --demo        # self-check of the shrink baseline and the bootstrap deltas
    nice -n 10 python pipeline/prevention_pitch.py --score  # site grades: frozen spec fit on ALL pitchers -> results/prevention_pitch_scores.csv

Unit: pitcher x season x Statcast pitch type, MLB regular season. Target: RV/100 of that type in S+1
(100 x mean(-delta_run_exp), pitcher-positive), n >= 150 of the type in S and S+1, S = 2020..2025.
Features in S come from the mart (public Statcast) plus per-pitch Whiff+ (cache/pitch_models.parquet, cross-fit).
xRV/100 v2 (results/xrv_v2_pitch_types.csv) is a baseline only.
"""
import json
import sys
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.linear_model import RidgeCV
from sklearn.model_selection import GroupKFold
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from paths import MART_DIR

sys.path.insert(0, str(MART_DIR))
import mart  # noqa: E402

PIPE = Path(__file__).resolve().parent
RES = PIPE / "results"
CACHE = PIPE.parent / "cache"
SEAL_FILE = RES / "prevention_pitch_seal.json"
SPEC_FILE = RES / "prevention_pitch_spec.json"
MIN_N, MIN_HAND = 150, 100
TYPES = ["FF", "SI", "FC", "SL", "CU", "KC", "SW", "SV", "ST", "CH", "FS", "FO", "EP"]
DRAWS, SEED = 2000, 13

FAMILIES = {
    "shape": ["velo", "ivb", "hb", "spin", "ext", "rz", "rx", "vaa", "arm"],
    "whiff_plus": ["whiff_plus"],
    "usage": ["usage", "log_n"],
    "location": ["zone", "heart", "edge", "chase", "zsw", "cs", "ball"],
    "swing_miss": ["wps", "csw"],
    "putaway": ["putaway", "two"],
    "contact": ["gb", "la", "xwcon", "hh"],
    "results": ["rv100"],
    "platoon": ["rv100_L", "rv100_R", "wps_L", "wps_R", "share_L", "same"],
    "count": ["fp", "ahead", "behind"],
    "context": ["rv_other", "fb_velo", "d_velo", "d_ivb", "d_hb", "n_types", "k_p", "bb_p"],
}
BASE = [f"t_{t}" for t in TYPES] + ["season"]

SQL = f"""
WITH p AS (
  SELECT q.pitcher, q.season, q.pitch_type, q.stand, q.p_throws, q.balls, q.strikes, -q.delta_run_exp AS rv,
         q.description AS d, q.events, q.bb_type, q.launch_angle AS la, q.launch_speed AS ls,
         q.estimated_woba_using_speedangle AS xw, q.release_speed AS velo, 12 * q.pfx_z AS ivb,
         12 * CASE WHEN q.p_throws = 'L' THEN -q.pfx_x ELSE q.pfx_x END AS hb, q.release_spin_rate AS spin,
         q.release_extension AS ext, q.release_pos_z AS rz,
         CASE WHEN q.p_throws = 'L' THEN -q.release_pos_x ELSE q.release_pos_x END AS rx, q.arm_angle AS arm,
         -degrees(atan((q.vz0 + q.az * ((-sqrt(q.vy0 * q.vy0 - 2 * q.ay * (50 - 17 / 12.0)) - q.vy0) / q.ay))
                       / -sqrt(q.vy0 * q.vy0 - 2 * q.ay * (50 - 17 / 12.0)))) AS vaa,
         q.zone BETWEEN 1 AND 9 AS inz, abs(q.plate_x) AS ax, (q.plate_z - q.sz_bot) / nullif(q.sz_top - q.sz_bot, 0) AS zn,
         q.description IN ('swinging_strike','swinging_strike_blocked','foul_tip','foul','hit_into_play') AS sw,
         q.description IN ('swinging_strike','swinging_strike_blocked','foul_tip') AS wh,
         q.description = 'hit_into_play' AS bip, m.whiff_plus,
         row_number() OVER (PARTITION BY q.pitcher, q.season, q.pitch_type
                            ORDER BY q.game_pk, q.at_bat_number, q.pitch_number) % 2 AS half
  FROM pitches_all q
  LEFT JOIN read_parquet('{CACHE / "pitch_models.parquet"}') m USING (game_pk, at_bat_number, pitch_number)
  WHERE q.game_type = 'R' AND q.season BETWEEN 2020 AND 2026 AND q.delta_run_exp IS NOT NULL
    AND q.plate_x IS NOT NULL AND q.release_speed IS NOT NULL
    AND q.pitch_type IN ({",".join(f"'{t}'" for t in TYPES)})
    AND q.description IN ('ball','blocked_ball','called_strike','swinging_strike','swinging_strike_blocked',
                          'foul_tip','foul','hit_by_pitch','hit_into_play')
    AND coalesce(q.events, '') NOT IN ('sac_bunt','sac_bunt_double_play') AND coalesce(q.bb_type, '') <> 'bunt'
)
SELECT {{keys}}, count(*) AS n, 100 * avg(rv) AS rv100, sum(rv) AS rv_sum,
  avg(velo) AS velo, avg(ivb) AS ivb, avg(hb) AS hb, avg(spin) AS spin, avg(ext) AS ext, avg(rz) AS rz, avg(rx) AS rx,
  avg(arm) AS arm, avg(vaa) AS vaa, avg(whiff_plus) AS whiff_plus,
  avg(inz::INT) AS zone, avg((ax <= 0.558 AND zn BETWEEN 0.167 AND 0.833)::INT) AS heart,
  avg((ax <= 1.108 AND zn BETWEEN -0.167 AND 1.167 AND NOT (ax <= 0.558 AND zn BETWEEN 0.167 AND 0.833))::INT) AS edge,
  sum((sw AND NOT inz)::INT) / nullif(sum((NOT inz)::INT), 0) AS chase,
  sum((sw AND inz)::INT) / nullif(sum(inz::INT), 0) AS zsw,
  avg((d = 'called_strike')::INT) AS cs, avg((d IN ('ball','blocked_ball'))::INT) AS ball,
  sum(wh::INT) / nullif(sum(sw::INT), 0) AS wps, avg((wh OR d = 'called_strike')::INT) AS csw,
  avg((strikes = 2)::INT) AS two,
  sum((strikes = 2 AND events IN ('strikeout','strikeout_double_play'))::INT) / nullif(sum((strikes = 2)::INT), 0) AS putaway,
  sum((bb_type = 'ground_ball')::INT) / nullif(sum(bip::INT), 0) AS gb,
  avg(CASE WHEN bip THEN la END) AS la, avg(CASE WHEN bip THEN xw END) AS xwcon,
  sum((bip AND ls >= 95)::INT) / nullif(sum(bip::INT), 0) AS hh,
  avg((balls = 0 AND strikes = 0)::INT) AS fp, avg((strikes > balls)::INT) AS ahead, avg((balls > strikes)::INT) AS behind,
  avg((stand = p_throws)::INT) AS same, sum(sw::INT) AS n_sw, sum(wh::INT) AS n_wh,
  sum((events IN ('strikeout','strikeout_double_play'))::INT) AS k, sum((events IN ('walk','intent_walk'))::INT) AS bb,
  sum((events IS NOT NULL)::INT) AS pa
FROM p GROUP BY ALL
"""
KEY = ["pitcher", "season", "pitch_type"]


def con():
    c = mart.connect()
    c.sql("SET threads = 4")
    return c


def agg(extra=()):
    """Feature rows per pitcher x season x type (+ extra keys among 'half', 'stand')."""
    keys = KEY + list(extra)
    a = con().sql(SQL.replace("{keys}", ", ".join(keys))).df()
    pk = ["pitcher", "season"] + [k for k in extra]
    tot = a.groupby(pk)[["n", "rv_sum", "k", "bb", "pa"]].transform("sum")
    a["usage"] = a["n"] / tot["n"]
    a["log_n"] = np.log(a["n"])
    a["rv_other"] = 100 * (tot["rv_sum"] - a["rv_sum"]) / (tot["n"] - a["n"]).replace(0, np.nan)
    a["k_p"], a["bb_p"] = tot["k"] / tot["pa"].clip(lower=1), tot["bb"] / tot["pa"].clip(lower=1)
    a["n_types"] = a.assign(u=a["usage"] >= 0.05).groupby(pk)["u"].transform("sum")
    fb = a[a["pitch_type"].isin(["FF", "SI"])].sort_values("n").drop_duplicates(pk, keep="last")
    prim = a.sort_values("n").drop_duplicates(pk, keep="last")
    prim = pd.concat([fb, prim[~prim.set_index(pk).index.isin(fb.set_index(pk).index)]])
    a = a.merge(prim[pk + ["velo", "ivb", "hb"]].rename(columns={"velo": "fb_velo", "ivb": "fb_ivb", "hb": "fb_hb"}), on=pk)
    a["d_velo"], a["d_ivb"], a["d_hb"] = a["velo"] - a["fb_velo"], a["ivb"] - a["fb_ivb"], a["hb"] - a["fb_hb"]
    if "stand" not in extra:  # platoon family from the hand-split rows
        h = con().sql(SQL.replace("{keys}", ", ".join(keys + ["stand"]))).df()
        pv = h.pivot_table(index=keys, columns="stand", values=["rv100", "n_sw", "n_wh", "n"])
        pl = pd.DataFrame({f"rv100_{s}": pv[("rv100", s)] for s in "LR"})
        for s in "LR":
            pl[f"wps_{s}"] = pv[("n_wh", s)] / pv[("n_sw", s)].replace(0, np.nan)
        pl["share_L"] = pv[("n", "L")].fillna(0) / pv["n"].sum(axis=1)
        a = a.merge(pl.reset_index(), on=keys, how="left")
        for s in "LR":
            a[f"rv100_{s}"] = a[f"rv100_{s}"].fillna(a["rv100"])
            a[f"wps_{s}"] = a[f"wps_{s}"].fillna(a["wps"])
    for t in TYPES:
        a[f"t_{t}"] = (a["pitch_type"] == t).astype(float)
    return a


def with_platoon_from(rows, full):
    """Hand-level rows take the platoon family from the full-season row (it is already split by hand)."""
    pl = FAMILIES["platoon"][:-1]
    return rows.drop(columns=[c for c in pl if c in rows], errors="ignore").merge(full[KEY + pl], on=KEY, how="left")


def pairs(a, keys=KEY, min_n=MIN_N):
    nxt = a[a["n"] >= min_n].assign(season=lambda x: x["season"] - 1)[keys + ["rv100", "n"]].rename(
        columns={"rv100": "rv_next", "n": "n_next"})
    return a[(a["n"] >= min_n) & (a["season"] <= 2025)].merge(nxt, on=keys).reset_index(drop=True)


def xrv_baseline(d):
    x = pd.read_csv(RES / "xrv_v2_pitch_types.csv").rename(columns={"mlbam": "pitcher"})[KEY + ["xrv100"]]
    return d.merge(x, on=KEY, how="left")


# ---------- models ----------
def ridge():
    return make_pipeline(SimpleImputer(strategy="median"), StandardScaler(), RidgeCV(alphas=np.logspace(-2, 4, 13)))


def lgbm():
    return lgb.LGBMRegressor(n_estimators=300, learning_rate=0.03, num_leaves=15, min_child_samples=50, subsample=0.8,
                             subsample_freq=1, colsample_bytree=0.8, reg_lambda=5.0, n_jobs=4, verbose=-1, random_state=13)


def cols(fams):
    return BASE + [c for f in fams for c in FAMILIES[f]]


def cv_mse(d, make, X, k=4):
    err = 0.0
    for tr, te in GroupKFold(k).split(d, groups=d["pitcher"]):
        p = make().fit(d.iloc[tr][X], d.iloc[tr]["rv_next"]).predict(d.iloc[te][X])
        err += ((p - d.iloc[te]["rv_next"]) ** 2).sum()
    return err / len(d)


def forward(d):
    chosen, best = [], cv_mse(d, ridge, cols([]))
    while True:
        trial = {f: cv_mse(d, ridge, cols(chosen + [f])) for f in FAMILIES if f not in chosen}
        if not trial or min(trial.values()) >= best:
            return chosen, best
        f = min(trial, key=trial.get)
        chosen, best = chosen + [f], trial[f]


def choose(d):
    """The whole selection procedure, run inside whatever data it is given."""
    allf = list(FAMILIES)
    fw, fw_mse = forward(d)
    cand = {"ridge_all": (cv_mse(d, ridge, cols(allf)), "ridge", allf), "ridge_fwd": (fw_mse, "ridge", fw),
            "lgbm_all": (cv_mse(d, lgbm, cols(allf)), "lgbm", allf)}
    name = min(cand, key=lambda k: cand[k][0])
    return {"name": name, "kind": cand[name][1], "families": cand[name][2],
            "inner_mse": {k: round(v[0], 4) for k, v in cand.items()}}


def fit_spec(d, spec):
    return (ridge if spec["kind"] == "ridge" else lgbm)().fit(d[cols(spec["families"])], d["rv_next"])


def baselines(tr, te):
    """B1 shrunk last RV/100, B2 Whiff+ alone, B3 xRV/100 v2; type intercepts in every arm."""
    m = tr.groupby("pitch_type")["rv_next"].mean()
    mt, mte = tr["pitch_type"].map(m), te["pitch_type"].map(m).fillna(tr["rv_next"].mean())
    ks = [0, 50, 100, 200, 400, 800, 1600, 3200, 1e9]
    k = min(ks, key=lambda k: (((mt + (tr["rv100"] - mt) * tr["n"] / (tr["n"] + k)) - tr["rv_next"]) ** 2).mean())
    out = {"B1": (mte + (te["rv100"] - mte) * te["n"] / (te["n"] + k)).to_numpy()}
    for b, c in (("B2", "whiff_plus"), ("B3", "xrv100")):
        X = BASE + [c]
        out[b] = ridge().fit(tr[X], tr["rv_next"]).predict(te[X])
    return out, k


# ---------- scoring ----------
def cluster_w(ids, rng, draws=DRAWS):
    u, inv = np.unique(np.asarray(ids), return_inverse=True)
    W = rng.multinomial(len(u), np.full(len(u), 1 / len(u)), size=draws)
    return np.vstack([np.ones(len(ids)), W[:, inv]])


def deltas(y, model, base, w):
    """Delta R2 (SSE gain / SST) and delta MAE, positive = model better, per bootstrap row of w."""
    ws = w.sum(1)
    my = (w * y).sum(1) / ws
    sst = (w * (y - my[:, None]) ** 2).sum(1)
    sse_m, sse_b = (w * (model - y) ** 2).sum(1), (w * (base - y) ** 2).sum(1)
    mae_m, mae_b = (w * np.abs(model - y)).sum(1) / ws, (w * np.abs(base - y)).sum(1) / ws
    return (sse_b - sse_m) / sst, mae_b - mae_m, 1 - sse_m / sst


def ci(v):
    return {"est": round(float(v[0]), 5), "ci": [round(float(x), 5) for x in np.percentile(v[1:], [2.5, 97.5])]}


def gate_a(d, pred, base, weighted=False):
    rng = np.random.default_rng(SEED)
    w = cluster_w(d["pitcher"].to_numpy(), rng)
    if weighted:
        w = w * d["n_next"].to_numpy()[None, :]
    y = d["rv_next"].to_numpy()
    out, ok = {}, True
    for b, p in base.items():
        dr2, dmae, r2 = deltas(y, pred, p, w)
        _, _, r2b = deltas(y, p, p, w)
        e = {"r2_model": round(float(r2[0]), 5), "r2_base": round(float(r2b[0]), 5), "d_r2": ci(dr2), "d_mae": ci(dmae)}
        e["beats"] = bool(e["d_r2"]["ci"][0] > 0 or e["d_mae"]["ci"][0] > 0)
        ok &= e["beats"]
        out[b] = e
    return out, ok


def partial_r(d, score, draws=DRAWS):
    """Partial r(score, next RV | Whiff+ per pitch, type), pitcher-clustered bootstrap."""
    X = np.column_stack([np.ones(len(d)), d["whiff_plus"].fillna(d["whiff_plus"].median()), d[BASE[:-1]].to_numpy()])
    w = cluster_w(d["pitcher"].to_numpy(), np.random.default_rng(SEED), draws)
    vals = []
    for wi in w:
        sw = np.sqrt(wi)
        Xw = X * sw[:, None]

        def res(v):
            beta = np.linalg.lstsq(Xw, v * sw, rcond=None)[0]
            return v - X @ beta
        a, b = res(score), res(d["rv_next"].to_numpy())
        vals.append(np.sum(wi * a * b) / np.sqrt(np.sum(wi * a * a) * np.sum(wi * b * b)))
    return ci(np.array(vals))


def split_half(model, X, halves, min_half=MIN_N // 2):
    h = [x[x["n"] >= min_half] for x in halves]
    keys = [c for c in KEY + ["stand"] if c in h[0]]
    m = h[0].merge(h[1], on=keys, suffixes=("_0", "_1"))
    s0 = model.predict(m[[c + "_0" if c + "_0" in m else c for c in X]].set_axis(X, axis=1))
    s1 = model.predict(m[[c + "_1" if c + "_1" in m else c for c in X]].set_axis(X, axis=1))
    r = float(np.corrcoef(s0, s1)[0, 1])
    return {"n": len(m), "median_half_n": float(np.median(m["n_0"])), "r": round(r, 4), "sb": round(2 * r / (1 + r), 4)}


def gate_b(d, score, model, X, halves, all_rows, scale):
    sb = split_half(model, X, halves)
    s_all = all_rows.assign(score=model.predict(all_rows[X]))
    nxt = s_all.assign(season=s_all["season"] - 1)[KEY + ["score"]].rename(columns={"score": "score_next"})
    yy = d.assign(score=score).merge(nxt, on=KEY)
    r_wp = float(np.corrcoef(score, d["whiff_plus"].fillna(d["whiff_plus"].median()))[0, 1])
    pr = partial_r(d, score)
    sd = float(np.std(score))
    true_sd = sd * np.sqrt(max(sb["sb"], 0))
    out = {"split_half": sb, "yoy_r": round(float(np.corrcoef(yy["score"], yy["score_next"])[0, 1]), 4),
           "r_with_whiff_plus": round(r_wp, 4), "partial_r_next_rv_beyond_whiff": pr,
           "sd_runs100": round(sd, 4), "true_sd_runs100": round(float(true_sd), 4),
           "r_score_next_rv": round(float(np.corrcoef(score, d["rv_next"])[0, 1]), 4),
           "r_last_rv_next_rv": round(float(np.corrcoef(d["rv100"], d["rv_next"])[0, 1]), 4),
           "grade_scale": scale}
    out["pass"] = {"reliable": sb["sb"] >= 0.5, "distinct": pr["ci"][0] > 0 and r_wp < 0.8, "spread": bool(true_sd >= 0.25)}
    return out


def hand_cut(model, X, full, hand_rows, hand_halves):
    hr = with_platoon_from(hand_rows, full)
    hh = [with_platoon_from(h, full) for h in hand_halves]
    p = pairs(hr, KEY + ["stand"], MIN_HAND)
    out = {}
    for s in "LR":
        g = p[p["stand"] == s]
        sc = model.predict(g[X])
        allr = hr[(hr["stand"] == s) & (hr["n"] >= MIN_HAND)]
        sa = allr.assign(score=model.predict(allr[X]))
        nx = sa.assign(season=sa["season"] - 1)[KEY + ["score"]].rename(columns={"score": "score_next"})
        yy = g.assign(score=sc).merge(nx, on=KEY)
        out[f"vs_{s}HH"] = {"n": len(g), "r_score_next_rv": round(float(np.corrcoef(sc, g["rv_next"])[0, 1]), 4),
                            "r_last_rv_next_rv": round(float(np.corrcoef(g["rv100"], g["rv_next"])[0, 1]), 4),
                            "yoy_r": round(float(np.corrcoef(yy["score"], yy["score_next"])[0, 1]), 4),
                            "split_half": split_half(model, X, [h[h["stand"] == s] for h in hh], MIN_HAND // 2)}
    return out


# ---------- runs ----------
def make_seal():
    a = agg()
    ids = np.sort(pairs(a)["pitcher"].unique())
    perm = np.random.default_rng(101).permutation(ids)
    sealed = sorted(int(x) for x in perm[: int(round(0.2 * len(ids)))])
    SEAL_FILE.write_text(json.dumps({"rule": "default_rng(101).permutation(sorted eligible ids)[:20%]",
                                     "n_eligible": len(ids), "sealed": sealed}))
    print(f"sealed {len(sealed)} of {len(ids)} pitchers -> {SEAL_FILE.name}")


def load():
    a = agg()
    d = xrv_baseline(pairs(a))
    sealed = set(json.loads(SEAL_FILE.read_text())["sealed"])
    d["sealed"] = d["pitcher"].isin(sealed)
    return a, d


def run_dev():
    a, d = load()
    dev = d[~d["sealed"]].reset_index(drop=True)
    pred = np.zeros(len(dev))
    base = {b: np.zeros(len(dev)) for b in ("B1", "B2", "B3")}
    picks = []
    for i, (tr, te) in enumerate(GroupKFold(5).split(dev, groups=dev["pitcher"])):
        t, v = dev.iloc[tr].reset_index(drop=True), dev.iloc[te]
        spec = choose(t)
        picks.append(spec)
        pred[te] = fit_spec(t, spec).predict(v[cols(spec["families"])])
        bo, _ = baselines(t, v)
        for b in base:
            base[b][te] = bo[b]
        print(f"outer fold {i + 1}/5: {spec['name']} {spec['families']}", flush=True)
    res = {"n_dev": len(dev), "n_dev_pitchers": int(dev["pitcher"].nunique()), "outer_picks": picks}
    res["gate_a_dev"], res["gate_a_dev_pass"] = gate_a(dev, pred, base)
    res["gate_a_dev_weighted"], _ = gate_a(dev, pred, base, weighted=True)
    spec = choose(dev)
    X = cols(spec["families"])
    res["frozen_spec"] = spec
    # leave-one-family-out ablation of the frozen spec (outer-CV MSE, dev)
    full_mse = cv_mse(dev, ridge if spec["kind"] == "ridge" else lgbm, X, k=5)
    res["ablation_mse_increase"] = {
        f: round(cv_mse(dev, ridge if spec["kind"] == "ridge" else lgbm, cols([g for g in spec["families"] if g != f]), k=5)
                 - full_mse, 5) for f in spec["families"]}
    model = fit_spec(dev, spec)
    if spec["kind"] == "ridge":
        res["coef_std"] = dict(sorted(((c, round(float(v), 4)) for c, v in zip(X, model[-1].coef_) if not c.startswith("t_")),
                                      key=lambda kv: -abs(kv[1])))
    else:
        res["gain"] = dict(sorted(((c, int(v)) for c, v in zip(X, model.booster_.feature_importance("gain"))),
                                  key=lambda kv: -kv[1])[:20])
    scale = {"mean": float(np.mean(pred)), "sd": float(np.std(pred))}
    halves = [agg(("half",)).query(f"half == {h}") for h in (0, 1)]
    allr = a[a["n"] >= MIN_N]
    res["gate_b_dev"] = gate_b(dev, pred, model, X, halves, allr, scale)
    SPEC_FILE.write_text(json.dumps({"spec": spec, "scale": scale}, indent=1))
    (RES / "prevention_pitch_dev.json").write_text(json.dumps(res, indent=1, default=str))
    print(json.dumps({k: res[k] for k in ("gate_a_dev", "gate_a_dev_pass", "frozen_spec", "gate_b_dev")}, indent=1, default=str))


def run_seal():
    out_path = RES / "prevention_pitch_SEALED.json"
    assert not out_path.exists(), "the seal is read once"
    a, d = load()
    dev, sl = d[~d["sealed"]].reset_index(drop=True), d[d["sealed"]].reset_index(drop=True)
    fz = json.loads(SPEC_FILE.read_text())
    spec, scale = fz["spec"], fz["scale"]
    X = cols(spec["families"])
    model = fit_spec(dev, spec)
    pred = model.predict(sl[X])
    bo, k = baselines(dev, sl)
    res = {"n_sealed": len(sl), "n_sealed_pitchers": int(sl["pitcher"].nunique()), "spec": spec, "b1_k": k}
    res["gate_a"], res["gate_a_pass"] = gate_a(sl, pred, bo)
    res["gate_a_weighted"], _ = gate_a(sl, pred, bo, weighted=True)
    halves = [agg(("half",)).query(f"half == {h}") for h in (0, 1)]
    sp = set(sl["pitcher"])
    res["gate_b"] = gate_b(sl, pred, model, X, [h[h["pitcher"].isin(sp)] for h in halves],
                           a[(a["n"] >= MIN_N) & a["pitcher"].isin(sp)], scale)
    hand = agg(("stand",))
    hh = [agg(("half", "stand")).query(f"half == {h}") for h in (0, 1)]
    res["by_hand_dev"] = hand_cut(model, X, a, hand[~hand["pitcher"].isin(sp)], [h[~h["pitcher"].isin(sp)] for h in hh])
    # example pitches: 2026 grades on the frozen scale
    cur = a[(a["season"] == 2026) & (a["n"] >= MIN_N)].copy()
    cur["grade"] = 100 + 10 * (model.predict(cur[X]) - scale["mean"]) / scale["sd"]
    names = con().sql("SELECT DISTINCT try_cast(key_mlbam AS BIGINT) AS pitcher, name_first || ' ' || name_last AS name FROM register WHERE try_cast(key_mlbam AS BIGINT) IS NOT NULL").df().drop_duplicates("pitcher")
    cur = cur.merge(names, on="pitcher", how="left")
    show = ["name", "pitch_type", "n", "grade", "rv100", "whiff_plus"]
    res["examples_2026"] = {"top": cur.nlargest(8, "grade")[show].round(1).to_dict("records"),
                            "bottom": cur.nsmallest(5, "grade")[show].round(1).to_dict("records")}
    out_path.write_text(json.dumps(res, indent=1, default=str))
    print(json.dumps(res, indent=1, default=str))


def run_score():
    """Ship step (seal spent): the frozen spec refit on every pitcher's pairs, scored on every 2020-26 season row
    with n >= 150 on the frozen scale; per-hand values (n >= 100 vs that hand) are descriptive."""
    a, d = load()
    fz = json.loads(SPEC_FILE.read_text())
    spec, scale = fz["spec"], fz["scale"]
    X = cols(spec["families"])
    model = fit_spec(d, spec)
    g = lambda rows: (100 + 10 * (model.predict(rows[X]) - scale["mean"]) / scale["sd"]).round(1)  # noqa: E731
    cur = a[a["n"] >= MIN_N].copy()
    cur["prev_plus"] = g(cur)
    hand = with_platoon_from(agg(("stand",)), a)
    hand = hand[hand["n"] >= MIN_HAND].copy()
    hand["g"] = g(hand)
    hp = hand.pivot_table(index=KEY, columns="stand", values="g").rename(columns={"L": "prev_L", "R": "prev_R"})
    out = cur[KEY + ["n", "prev_plus"]].merge(hp.reset_index(), on=KEY, how="left")
    out.to_csv(RES / "prevention_pitch_scores.csv", index=False)
    print(f"{len(out)} rows, {out['pitcher'].nunique()} pitchers, seasons {sorted(out['season'].unique())}")


def demo():
    y = np.array([1.0, 2.0, 3.0, 4.0])
    w = np.ones((1, 4))
    dr2, dmae, r2 = deltas(y, y.copy(), y + 1, w)
    assert abs(r2[0] - 1) < 1e-12 and abs(dmae[0] - 1) < 1e-12 and abs(dr2[0] - 4 / 5) < 1e-12
    w = cluster_w(np.array([7, 7, 9]), np.random.default_rng(0), 50)
    assert (w[0] == 1).all() and (w[1:, 0] == w[1:, 1]).all()
    print("demo ok")


if __name__ == "__main__":
    {"--make-seal": make_seal, "--dev": run_dev, "--seal": run_seal, "--demo": demo, "--score": run_score}[sys.argv[1]]()
