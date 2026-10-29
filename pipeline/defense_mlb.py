"""RESULTS-MLB §75 (D-12 range: OAA + fielding runs) and §76 (D-13 framing), the college defense framework
(baseballDefense/DEFENSE_METHODS.md §3) refit on Statcast: difficulty model -> credit = actual - p -> runs.

    python defense_mlb.py          # fit 2020-26 + the §75/§76 reads once -> results/defense_*.csv + defense_SEALED.json
    python defense_mlb.py --demo   # self-check of the credit split
    python defense_mlb.py --v2     # §80 re-test (isotonic recalibration), writes defense_v2_SEALED.json
    python defense_mlb.py --v3     # §81 re-test (+ Savant start positions, hang time; range only), *_v3 outputs
    python defense_mlb.py --v4     # §96 re-test (+ the responsible fielder's own sprint speed; range only), *_v4 outputs
    python defense_mlb.py --v5     # §97 re-test (lift-corrected hang time, --cl to override the pre-declared 0.24), *_v5 outputs
    python defense_mlb.py --artifacts  # same fits, writes only cache/defense_chances + framing_pitches parquets

Every model is fit WITHIN a season (2026 changed Statcast's plate/zone conventions) and scored out of fold:
range by 5 game-grouped folds, framing by 5 catcher-grouped folds (no catcher in his own fit).
"""
import json
import sys
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import GroupKFold

from paths import MART_DIR  # noqa: E402
sys.path.insert(0, str(MART_DIR))
import mart  # noqa: E402

PIPE = Path(__file__).resolve().parent
RES = PIPE / "results"
SEASONS = range(2020, 2027)
PARAMS = dict(learning_rate=0.05, num_leaves=31, min_child_samples=200, num_threads=4, verbose=-1, seed=13)
ROUNDS = 400
OUTS = ("field_out", "force_out", "grounded_into_double_play", "double_play", "triple_play", "fielders_choice_out",
        "sac_fly", "sac_fly_double_play")
IF_POS, OF_POS = (3, 4, 5, 6), (7, 8, 9)
SAVANT_IF, SAVANT_OF = {"1B", "2B", "3B", "SS"}, {"LF", "CF", "RF"}
FRAMING_MIN = 2000
V5 = "--v5" in sys.argv  # §97: lift-corrected hang time at a fixed C_L (implies V3; v4's f_sprint stays out of X)
CL = 0.24
for _i, _a in enumerate(sys.argv):
    if _a == "--cl":
        CL = float(sys.argv[_i + 1])
V4 = "--v4" in sys.argv  # §96: + the responsible fielder's own sprint speed and the reach split (implies V3)
V3 = "--v3" in sys.argv or V4 or V5  # §81: + Savant average start positions and physics hang time (implies V2)
V2 = "--v2" in sys.argv or V3  # §80: isotonic recalibration of the range model
# a C_L sensitivity run must never touch the primary v5 artifacts
SFX = "_v5_cl%s" % CL if (V5 and CL != 0.24) else "_v5" if V5 else "_v4" if V4 else "_v3" if V3 else ""
POSITIONS = PIPE.parent / "cache" / "fielder_positions.parquet"  # fielder_positions.py
RANGE_SQL = """
SELECT game_pk, game_date, inning, inning_topbot AS half, batter, stand, events, launch_speed AS ev, launch_angle AS la, hit_distance_sc AS dist,
       degrees(atan((hc_x - 125.42) / (198.27 - hc_y))) AS spray, 2.5 * (hc_x - 125.42) AS fx, 2.5 * (198.27 - hc_y) AS fy, hit_location, if_fielding_alignment AS ifa,
       of_fielding_alignment AS ofa, outs_when_up AS outs, (on_1b IS NOT NULL)::INT AS r1, (on_2b IS NOT NULL)::INT AS r2,
       (on_3b IS NOT NULL)::INT AS r3, home_team, delta_run_exp AS drun, (launch_angle >= 10)::INT AS air,
       pitcher AS fielder_1, fielder_2, fielder_3, fielder_4, fielder_5, fielder_6, fielder_7, fielder_8, fielder_9
FROM pitches_all
WHERE game_type = 'R' AND season = {s} AND type = 'X' AND launch_speed IS NOT NULL AND launch_angle IS NOT NULL
  AND hc_x IS NOT NULL AND hc_y < 198.27 AND events IS NOT NULL AND events NOT IN ('home_run', 'sac_bunt', 'sac_bunt_double_play')
  AND coalesce(des, '') NOT ILIKE '%bunt%'
ORDER BY game_pk, at_bat_number, pitch_number
"""
FRAME_SQL = """
SELECT game_pk, game_date, fielder_2 AS catcher, plate_z, (description = 'called_strike')::INT AS cs, plate_x,
       (plate_z - sz_bot) / (sz_top - sz_bot) AS pz, balls, strikes, (stand = 'L')::INT AS lhh, (p_throws = 'L')::INT AS lhp,
       pitch_type, release_speed AS velo, pfx_x, pfx_z, delta_run_exp AS drun
FROM pitches_all
WHERE game_type = 'R' AND season = {s} AND description IN ('called_strike', 'ball', 'blocked_ball')
  AND plate_x IS NOT NULL AND plate_z IS NOT NULL AND sz_top > sz_bot AND fielder_2 IS NOT NULL
ORDER BY game_pk, at_bat_number, pitch_number
"""


def oof(X, y, groups, objective="binary", num_class=None):
    """Out-of-fold predictions, 5 folds grouped by `groups`."""
    p = dict(PARAMS, objective=objective, **({"num_class": num_class} if num_class else {}))
    out = np.zeros((len(X), num_class) if num_class else len(X))
    for tr, te in GroupKFold(5).split(X, y, groups):
        m = lgb.train(p, lgb.Dataset(X.iloc[tr], y[tr]), ROUNDS)
        out[te] = m.predict(X.iloc[te])
    return out


def recalibrate(y, p, groups):
    """§80: cross-fit isotonic map, fit on the other folds' OOF p, applied to the held-out fold."""
    out = np.empty_like(p)
    for tr, te in GroupKFold(5).split(p, y, groups):
        out[te] = IsotonicRegression(out_of_bounds="clip", y_min=0, y_max=1).fit(p[tr], y[tr]).predict(p[te])
    return out


def max_decile_gap(y, p):
    q = pd.qcut(p, 10, labels=False, duplicates="drop")
    g = pd.DataFrame({"y": y, "p": p, "q": q}).groupby("q").agg(y=("y", "mean"), p=("p", "mean"))
    return float((g["y"] - g["p"]).abs().max())


def credit(out, hit_loc, p, resp):
    """Credit matrix (rows x positions 1-9): an out -> its fielder +(1 - p) (by responsibility if hit_location is
    missing); a non-out -> every position -p x resp."""
    c = -p[:, None] * resp
    oi = np.where(out)[0]
    known = ~np.isnan(hit_loc[oi]) & (hit_loc[oi] >= 1) & (hit_loc[oi] <= 9)
    c[oi] = 0.0
    c[oi[known], hit_loc[oi[known]].astype(int) - 1] = 1 - p[oi[known]]
    c[oi[~known]] = (1 - p[oi[~known]])[:, None] * resp[oi[~known]]
    return c


def sprint(con, s):
    try:
        d = con.sql(f'SELECT player_id, sprint_speed FROM lb_sprint_speed_{s}').df()
        return d.set_index("player_id")["sprint_speed"]
    except Exception:
        return pd.Series(dtype=float)


def hang_time(ev, la, dist, cl=0.0, h0=3.0, dt=0.02, iters=20):
    """§81: flight time of a trajectory whose drag constant is solved per ball (bisection) so the range matches
    dist. §97 adds a FIXED backspin lift: a_lift = (rho*A/2m)*C_L*v^2 perpendicular to velocity, rotated +90 deg
    in the (x, z) plane — an absolute acceleration (the solved drag k is inflated by the missing lift, so the
    lift may not scale with it). ev mph, la deg, dist ft. A monotone proxy, not a measured hang time."""
    v0, a = np.asarray(ev, float) * 1.4667, np.radians(np.asarray(la, float))
    lift_k = 5.45e-3 * cl  # (rho*A/2m) = 5.45e-3 /ft: rho 1.21 kg/m^3, r 1.459 in, m 5.125 oz
    lo, hi = np.zeros(len(v0)), np.full(len(v0), 0.01)

    def fly(k):
        vx, vz, x, z, t = v0 * np.cos(a), v0 * np.sin(a), np.zeros(len(k)), np.full(len(k), h0), np.zeros(len(k))
        for _ in range(int(12 / dt)):
            up = z > 0
            if not up.any():
                break
            v = np.hypot(vx, vz)
            vx, vz = vx - up * (k * v * vx + lift_k * v * vz) * dt, vz - up * (k * v * vz - lift_k * v * vx + 32.17) * dt
            x, z, t = x + up * vx * dt, z + up * vz * dt, t + up * dt
        return x, t

    for _ in range(iters):
        k = (lo + hi) / 2
        far = fly(k)[0] > dist  # still too far -> more drag
        lo, hi = np.where(far, k, lo), np.where(far, hi, k)
    return fly((lo + hi) / 2)[1]


def f_sprint_feature(d, sf, sp):
    """§96: the responsible fielder = the position achieving the min of the §81 distances (d_of for air balls,
    d_if otherwise); his own lb_sprint_speed, median-filled like the batter's."""
    air = d["la"].to_numpy() >= 10
    idx = np.where(air, 4 + sf[["d7", "d8", "d9"]].to_numpy().argmin(1),
                   sf[["d3", "d4", "d5", "d6"]].to_numpy().argmin(1))
    F = np.stack([d[f"fielder_{k}"].to_numpy() for k in range(3, 10)], 1)
    fill = sp.median() if len(sp) else 27.0
    return pd.Series(F[np.arange(len(d)), idx]).map(sp).fillna(fill).to_numpy()


def start_features(d, s):
    """§81: each fielder's Savant average start (hand x runner on first x shifted cell; league mean of the cell
    when the fielder has < 10 plays in it) -> OF distance to the fielded point, IF lateral distance to the path."""
    P = pd.read_parquet(POSITIONS).query("season == @s")
    P = P[P["n"] > 0]
    lg = (P.assign(wx=P["x"] * P["n"], wy=P["y"] * P["n"]).groupby(["pos", "stand", "r1", "shifted"])[["n", "wx", "wy"]]
          .sum().pipe(lambda g: pd.DataFrame({"lx": g["wx"] / g["n"], "ly": g["wy"] / g["n"]})))
    me = P[P["n"] >= 10].set_index(["mlbam", "pos", "stand", "r1", "shifted"])[["x", "y"]]
    cell = pd.DataFrame({"stand": d["stand"].astype(str).to_numpy(), "r1": d["r1"].to_numpy(),
                         "shifted": (d["ifa"].astype(str) == "Infield shift").astype(int).to_numpy()})
    out = {}
    for k in range(3, 10):
        c = cell.assign(mlbam=d[f"fielder_{k}"].to_numpy(), pos=k)
        j = c.join(me, on=["mlbam", "pos", "stand", "r1", "shifted"]).join(lg, on=["pos", "stand", "r1", "shifted"])
        x, y = j["x"].fillna(j["lx"]).to_numpy(), j["y"].fillna(j["ly"]).to_numpy()
        if k >= 7:
            out[f"d{k}"] = np.hypot(d["fx"].to_numpy() - x, d["fy"].to_numpy() - y)
        else:
            ang = np.radians(np.degrees(np.arctan2(x, y)) - d["spray"].to_numpy())
            out[f"d{k}"] = np.hypot(x, y) * np.abs(np.sin(ang))
    f = pd.DataFrame(out, index=d.index)
    f["d_of"], f["d_if"] = f[["d7", "d8", "d9"]].min(axis=1), f[["d3", "d4", "d5", "d6"]].min(axis=1)
    air = d["la"].to_numpy() >= 10
    f["hang"] = np.nan
    f.loc[air, "hang"] = hang_time(d.loc[air, "ev"], d.loc[air, "la"], d.loc[air, "dist"].fillna(0).clip(lower=1),
                                   cl=CL if V5 else 0.0)
    f["req_speed"] = f["d_of"] / f["hang"]
    return f


def range_season(con, s):
    d = con.sql(RANGE_SQL.format(s=s)).df()
    sp = sprint(con, s)
    d["sprint"] = d["batter"].map(sp).fillna(sp.median() if len(sp) else 27.0)
    for c in ("ifa", "ofa", "home_team", "stand"):
        d[c] = d[c].astype("category")
    X = d[["ev", "la", "dist", "spray", "stand", "ifa", "ofa", "outs", "r1", "r2", "r3", "sprint", "home_team"]]
    sf, fs = None, None
    if V3:
        sf = start_features(d, s)
        X = pd.concat([X, sf], axis=1)
        if V4 or V5:  # §96 schema: f_sprint/reach emitted for the descriptive split; X takes it only under v4
            fs = f_sprint_feature(d, sf, sp)
            if V4:
                X["f_sprint"] = fs
    y = d["events"].isin(OUTS).to_numpy().astype(int)
    p = oof(X, y, d["game_pk"])
    if V2:
        p = recalibrate(y, p, d["game_pk"])
    o = (y == 1) & d["hit_location"].between(1, 9).to_numpy()
    resp = np.full((len(d), 9), 1 / 9)
    if o.sum():
        rx = oof(X[o].reset_index(drop=True), d.loc[o, "hit_location"].astype(int).to_numpy() - 1,
                 d.loc[o, "game_pk"].to_numpy(), "multiclass", 9)
        # responsibility: out-of-fold on outs; a fit on every out for the non-outs (it apportions blame, never grades)
        m = lgb.train(dict(PARAMS, objective="multiclass", num_class=9),
                      lgb.Dataset(X[o], d.loc[o, "hit_location"].astype(int) - 1), ROUNDS)
        resp = m.predict(X)
        resp[np.where(o)[0]] = rx
    c = credit(y == 1, d["hit_location"].to_numpy(dtype=float), p, resp)
    rv = d.assign(out=y).groupby(["air", "out"])["drun"].mean().unstack()
    rv_diff = d["air"].map(rv[0] - rv[1]).to_numpy()  # batter runs of a non-out minus an out
    extra = {}
    if V4 or V5:
        air = d["la"].to_numpy() >= 10
        # §96 schema (not model): per-play reach class of the responsible OFer; NaN where there is no flight time
        extra = {"hang": sf["hang"].to_numpy(), "req_speed": sf["req_speed"].to_numpy(), "f_sprint": fs,
                 "reach": np.where(air, (fs >= sf["req_speed"].to_numpy()).astype(float), np.nan)}
    rows = []
    for k in range(3, 10):
        rows.append(pd.DataFrame({"mlbam": d[f"fielder_{k}"].to_numpy(), "pos": k, "game_pk": d["game_pk"].to_numpy(),
                                  "chances": resp[:, k - 1], "oaa": c[:, k - 1], "runs": c[:, k - 1] * rv_diff,
                                  # detail for the profile drill (not used by any gate)
                                  "p": p, "made": (y == 1) & (d["hit_location"].to_numpy() == k), "ev": d["ev"].to_numpy(),
                                  "la": d["la"].to_numpy(), "spray": d["spray"].to_numpy(), "fx": d["fx"].to_numpy(),
                                  "fy": d["fy"].to_numpy(), "stand": d["stand"].astype(str).to_numpy(),
                                  "date": d["game_date"].astype(str).to_numpy(), "inning": d["inning"].to_numpy(),
                                  "half": d["half"].to_numpy(), "outs": d["outs"].to_numpy(), "event": d["events"].to_numpy(),
                                  **extra}))
    meta = {"auc": round(float(roc_auc_score(y, p)), 4), "decile_gap": round(max_decile_gap(y, p), 4),
            "n": int(len(d)), "out_rate": round(float(y.mean()), 4), "rv_diff": {int(a): round(float(v), 4) for a, v in (rv[0] - rv[1]).items()}}
    print(s, "range", meta, flush=True)
    return pd.concat(rows).assign(season=s), meta


def framing_season(con, s):
    d = con.sql(FRAME_SQL.format(s=s)).df()
    d["pitch_type"] = d["pitch_type"].astype("category")
    X = d[["plate_x", "pz", "balls", "strikes", "lhh", "lhp", "pitch_type", "velo", "pfx_x", "pfx_z"]]
    y = d["cs"].to_numpy()
    p = oof(X, y, d["catcher"])
    rv = d.groupby(["balls", "strikes", "cs"])["drun"].mean().unstack()
    val = (rv[0] - rv[1]).rename("v")  # a ball minus a called strike, batter runs
    v = d.join(val, on=["balls", "strikes"])["v"].to_numpy()
    out = pd.DataFrame({"mlbam": d["catcher"].to_numpy(), "game_pk": d["game_pk"].to_numpy(), "runs": (y - p) * v,
                        "x": d["plate_x"].to_numpy(), "z": d["plate_z"].to_numpy(), "pz": d["pz"].to_numpy(), "cs": y, "p": p,
                        "lhh": d["lhh"].to_numpy(), "date": d["game_date"].astype(str).to_numpy()})
    meta = {"auc": round(float(roc_auc_score(y, p)), 4), "decile_gap": round(max_decile_gap(y, p), 4), "n": int(len(d))}
    print(s, "framing", meta, flush=True)
    return out.assign(season=s), meta


def split_half_k(per_game, n_col, v_col, min_n):
    """Odd/even game split-half reliability (Spearman-Brown) and k = mean n x (1 - rel) / rel, per season pooled."""
    h = per_game.assign(half=per_game["game_pk"] % 2).groupby(["mlbam", "season", "half"])[[n_col, v_col]].sum().unstack()
    h = h[(h[(n_col, 0)] >= min_n / 2) & (h[(n_col, 1)] >= min_n / 2)]
    r = float(np.corrcoef(h[(v_col, 0)] / h[(n_col, 0)], h[(v_col, 1)] / h[(n_col, 1)])[0, 1])
    rel = 2 * r / (1 + r)
    n = float((h[(n_col, 0)] + h[(n_col, 1)]).mean())
    return {"split_half_r": round(r, 4), "rel": round(rel, 4), "k": round(n * (1 - rel) / rel, 1), "n_players": int(len(h))}


def boot_r(a, b, ids, draws=2000, seed=13):
    """r and a player-clustered 95% CI."""
    a, b, ids = np.asarray(a, float), np.asarray(b, float), np.asarray(ids)
    uniq = np.unique(ids)
    idx = {u: np.where(ids == u)[0] for u in uniq}
    rng = np.random.default_rng(seed)
    rs = []
    for _ in range(draws):
        ix = np.concatenate([idx[u] for u in rng.choice(uniq, len(uniq))])
        rs.append(np.corrcoef(a[ix], b[ix])[0, 1])
    return {"r": round(float(np.corrcoef(a, b)[0, 1]), 4), "ci": [round(float(x), 4) for x in np.percentile(rs, [2.5, 97.5])],
            "n": int(len(a))}


def yoy(df, ids, cols):
    n = df.assign(season=df["season"] - 1)[[ids, "season", *cols]]
    j = df.merge(n, on=[ids, "season"], suffixes=("", "_next"))
    return {c: round(float(j[c].corr(j[c + "_next"])), 4) for c in cols} | {"n": int(len(j))}


def reach_split(ofc, sv):
    """§96 reported (descriptive, OF): credit split by whether the responsible fielder's own speed covers the
    required one. Classes are approximate: average starts and a drag-only hang time."""
    out = {"n_chances": int(len(ofc))}
    for name, val in (("within", 1.0), ("beyond", 0.0)):
        cc = ofc[ofc["reach"] == val]
        fp = cc.groupby(["mlbam", "season"])[["chances", "oaa", "runs"]].sum().reset_index()
        pg = cc.groupby(["mlbam", "season", "game_pk"])[["chances", "oaa"]].sum().reset_index()
        j = fp.merge(sv, on=["mlbam", "season"])
        rel = None
        try:  # the beyond class qualifies few players; a 2-point split-half can be exactly -1 -> skip, not crash
            rel = split_half_k(pg, "chances", "oaa", 100)
        except ZeroDivisionError:
            pass
        yy = yoy(fp, "mlbam", ["oaa"])["oaa"]
        rb = boot_r(j["oaa"], j["outs_above_average"], j["mlbam"])["r"]
        out[name] = {"share": round(float(len(cc)) / len(ofc), 4), "made_rate": round(float(cc["made"].mean()), 4),
                     "mean_p": round(float(cc["p"].mean()), 4), "reliability": rel,
                     "yoy_oaa": yy if np.isfinite(yy) else None,
                     "r_oaa": rb if np.isfinite(rb) else None}
    return out


def demo():
    p = np.array([.7, .4])
    resp = np.zeros((2, 9))
    resp[0, 5] = 1
    resp[1, 4] = resp[1, 5] = .5
    c = credit(np.array([True, False]), np.array([6.0, np.nan]), p, resp)
    assert np.isclose(c[0, 5], .3) and np.isclose(c[0].sum(), .3), c[0]
    assert np.isclose(c[1, 4], -.2) and np.isclose(c[1, 5], -.2) and np.isclose(c[1].sum(), -.4), c[1]
    t = hang_time([90.0, 100.0], [30.0, 30.0], [300.0, 380.0])
    assert 3.0 < t[0] < t[1] < 6.5, t  # MLB fly balls hang ~4-6 s
    print("demo ok")


def main(sealed=True):
    con = mart.connect()
    res = {"meta": {}}
    rg, fr = [], []
    for s in SEASONS:
        a, ma = range_season(con, s)
        b, mb = (pd.DataFrame(), {}) if V3 else framing_season(con, s)
        rg.append(a)
        fr.append(b)
        res["meta"][s] = {"range": ma, "framing": mb}
    rg, fr = pd.concat(rg, ignore_index=True), pd.concat(fr, ignore_index=True)
    # per-chance / per-pitch detail for the profile views (cache/, not committed: large)
    rg[rg["chances"] >= 0.05].to_parquet(PIPE.parent / "cache" / f"defense_chances{SFX}.parquet")
    if not V3:
        fr.to_parquet(PIPE.parent / "cache" / "framing_pitches.parquet")
    if not sealed:
        return

    # range: per fielder-season-position, then player-season (group = most chances)
    fp = rg.groupby(["mlbam", "season", "pos"])[["chances", "oaa", "runs"]].sum().reset_index()
    fp.round(3).to_csv(RES / f"defense_fielders{SFX}.csv", index=False)
    grp = fp.assign(g=np.where(fp["pos"].isin(IF_POS), "IF", "OF"))
    main_g = grp.sort_values("chances", ascending=False).drop_duplicates(["mlbam", "season"]).set_index(["mlbam", "season"])["g"]
    pl = grp.groupby(["mlbam", "season"])[["chances", "oaa", "runs"]].sum().join(main_g).reset_index()
    res["range"] = {}
    for g in ("IF", "OF"):
        pos = IF_POS if g == "IF" else OF_POS
        pg = rg[rg["pos"].isin(pos)].groupby(["mlbam", "season", "game_pk"])[["chances", "oaa"]].sum().reset_index()
        kk = split_half_k(pg, "chances", "oaa", 100)
        sv = []
        for s in SEASONS:
            t = con.sql(f"SELECT player_id, outs_above_average, fielding_runs_prevented, primary_pos_formatted "
                        f"FROM lb_outs_above_average_{s}").df().assign(season=s)
            sv.append(t[t["primary_pos_formatted"].isin(SAVANT_IF if g == "IF" else SAVANT_OF)])
        sv = pd.concat(sv).rename(columns={"player_id": "mlbam"})
        if g == "OF":
            sv_of, j_of = sv.copy(), pl.merge(sv, on=["mlbam", "season"])
        j = pl.merge(sv, on=["mlbam", "season"])
        ext = boot_r(j["oaa"], j["outs_above_average"], j["mlbam"])
        ext["verdict_ext"] = "PASS" if ext["ci"][0] > .50 else "FAIL"
        calib = all(m["range"]["decile_gap"] <= .03 for m in res["meta"].values())
        res["range"][g] = {"external_oaa": ext, "calibration_pass": calib,
                           "verdict": "CONFIRMED" if calib and ext["ci"][0] > .50 else "NOT CONFIRMED",
                           "reliability": kk, "r_frp": round(float(j["runs"].corr(j["fielding_runs_prevented"])), 4),
                           "yoy": yoy(j, "mlbam", ["oaa", "outs_above_average"])}
        pl.loc[pl["g"] == g, "k"] = kk["k"]
    if V4:
        ofc = rg[(rg["pos"].isin(OF_POS)) & rg["reach"].notna()]
        res["range"]["OF"]["reach"] = reach_split(ofc, sv_of)
        key = pd.MultiIndex.from_arrays([pl["mlbam"], pl["season"]])
        for name in ("within", "beyond"):
            cc = ofc[ofc["reach"] == (1.0 if name == "within" else 0.0)].groupby(["mlbam", "season"])["runs"].sum()
            pl[f"runs_{name}_reach"] = key.map(cc)
    if V5:  # §97 reported: the compression check this re-test exists for
        names = dict(con.sql("SELECT CAST(key_mlbam AS BIGINT), name_first || ' ' || name_last FROM register "
                             "WHERE TRY_CAST(key_mlbam AS BIGINT) IS NOT NULL").fetchall())
        cf = j_of[(j_of["primary_pos_formatted"] == "CF") & (j_of["season"] == 2025)].nlargest(10, "outs_above_average")
        res["range"]["OF"]["compression"] = {
            "sd_runs_ours": round(float(j_of["runs"].std()), 2),
            "sd_oaa_savant": round(float(j_of["outs_above_average"].std()), 2),
            "top10_cf_2025": [{"name": names.get(int(r.mlbam), str(r.mlbam)),
                               "savant": round(float(r.outs_above_average), 1), "ours": round(float(r.oaa), 1)}
                              for r in cf.itertuples()]}
    pl["oaa_shrunk"] = pl["oaa"] * pl["chances"] / (pl["chances"] + pl["k"])
    pl["runs_shrunk"] = pl["runs"] * pl["chances"] / (pl["chances"] + pl["k"])
    pl.round(3).to_csv(RES / f"defense_players{SFX}.csv", index=False)

    if V3:
        print(json.dumps({k: v for k, v in res.items() if k != "meta"}, indent=1))
        (RES / f"defense{SFX}_SEALED.json").write_text(json.dumps(res, indent=1, default=str))
        return

    # framing
    cg = fr.assign(n=1).groupby(["mlbam", "season", "game_pk"])[["n", "runs"]].sum().reset_index()
    kf = split_half_k(cg, "n", "runs", FRAMING_MIN)
    cc = cg.groupby(["mlbam", "season"])[["n", "runs"]].sum().reset_index()
    cc["runs_shrunk"] = cc["runs"] * cc["n"] / (cc["n"] + kf["k"])
    cc["per100"] = 100 * cc["runs_shrunk"] / cc["n"]
    q = cc[cc["n"] >= FRAMING_MIN].groupby("season")["per100"].agg(["mean", "std"])
    cc = cc.join(q, on="season")
    cc["framing_plus"] = 100 + 10 * (cc["per100"] - cc["mean"]) / cc["std"]
    cc.drop(columns=["mean", "std"]).round(3).to_csv(RES / "defense_framing.csv", index=False)
    sv = pd.concat([con.sql(f"SELECT id AS mlbam, rv_tot FROM lb_catcher_framing_{s}").df().assign(season=s) for s in SEASONS])
    j = cc.merge(sv, on=["mlbam", "season"])
    ext = boot_r(j["runs"], j["rv_tot"], j["mlbam"])
    res["framing"] = {"external_rv": ext, "verdict": "CONFIRMED" if ext["ci"][0] > .80 else "NOT CONFIRMED",
                      "reliability": kf, "yoy": yoy(j, "mlbam", ["runs", "rv_tot"])}
    print(json.dumps({k: v for k, v in res.items() if k != "meta"}, indent=1))
    (RES / ("defense_v2_SEALED.json" if V2 else "defense_SEALED.json")).write_text(json.dumps(res, indent=1, default=str))


if __name__ == "__main__":
    demo() if "--demo" in sys.argv else main(sealed="--artifacts" not in sys.argv)
