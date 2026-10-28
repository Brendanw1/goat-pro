"""RESULTS-MLB §74 (D-06): Tunnel+ on MLB, a port of the college compute_tunnel_plus.py (method only, refit on Statcast).

    python tunnel_plus.py          # grade 2020-26 + the §74 read once -> results/tunnel_*.csv + tunnel_SEALED.json
    python tunnel_plus.py --demo   # self-check of the trajectory reconstruction

Unit: consecutive pitches of different site types inside one PA. A per-season chase logistic (out-of-zone second
pitches) on the second pitch's stuff, velo, velo drop, count, platoon, type, plate separation and commit
separation; lift = chase at the actual commit separation minus chase at the separation the plate separation
implies. EB-shrunk per (pitcher, from -> to) and per pitcher (pairing type removed), 100 + 10 per pairing SD.
"""
import json
import sys
import zlib
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score

import stack
from paths import MART_DIR  # noqa: E402
from type_grades import SITE
from web_export import SWING
sys.path.insert(0, str(MART_DIR))
import mart  # noqa: E402

PIPE = Path(__file__).resolve().parent
RES = PIPE / "results"
COMMIT_FT, PLATE_FT, Y0 = 23.8, 17 / 12, 50.0  # BP commit point, front of plate, Statcast fit origin
MIN_PAIRS, MIN_RANK_RELIABILITY, REF_MIN_PAIRS, PITCHER_RANK_PAIRS = 3, 0.25, 15, 150  # the college floors
SEASONS = range(2020, 2027)
SQL = """
SELECT game_pk, at_bat_number, pitch_number, pitcher, p_throws, stand, pitch_type, description, zone, balls, strikes,
       release_speed, plate_x, plate_z, vx0, vy0, vz0, ax, ay, az, release_pos_x, release_pos_y, release_pos_z
FROM pitches_all WHERE game_type = 'R' AND season = {s}
  AND vy0 < 0 AND ay IS NOT NULL AND plate_x IS NOT NULL AND plate_z IS NOT NULL AND release_speed IS NOT NULL
"""
TYPES = ["SI", "SL", "SW", "CT", "CB", "CH", "FS"]


def t_at(vy0, ay, y):
    """Seconds from y = 50 ft to y (negative before 50, e.g. at release)."""
    return (-vy0 - np.sqrt(np.maximum(vy0 ** 2 - 2 * ay * (Y0 - y), 0))) / ay


def positions(df):
    """Adds commit/plate x, z: x0, z0 at y = 50 backed out from plate_x/plate_z, then the fit forward."""
    tp = t_at(df["vy0"], df["ay"], PLATE_FT)
    x0 = df["plate_x"] - df["vx0"] * tp - 0.5 * df["ax"] * tp ** 2
    z0 = df["plate_z"] - df["vz0"] * tp - 0.5 * df["az"] * tp ** 2
    at = lambda t: (x0 + df["vx0"] * t + 0.5 * df["ax"] * t ** 2, z0 + df["vz0"] * t + 0.5 * df["az"] * t ** 2)  # noqa: E731
    df["commit_x"], df["commit_z"] = at(t_at(df["vy0"], df["ay"], COMMIT_FT))
    df["rel_x"], df["rel_z"] = at(t_at(df["vy0"], df["ay"], df["release_pos_y"]))
    return df


def build_pairs(df):
    df = df.sort_values(["game_pk", "at_bat_number", "pitch_number"]).reset_index(drop=True)
    prev = df.shift(1)
    m = ((df["game_pk"] == prev["game_pk"]) & (df["at_bat_number"] == prev["at_bat_number"])
         & (df["pitch_number"] == prev["pitch_number"] + 1) & (df["pitcher"] == prev["pitcher"])
         & (df["site"] != prev["site"])).to_numpy()
    d, pv = df[m], prev[m]
    return pd.DataFrame({
        "game": d["game_pk"].to_numpy(), "pitcher": d["pitcher"].to_numpy(), "throws": d["p_throws"].to_numpy(),
        "stand": d["stand"].to_numpy(), "from_code": pv["site"].to_numpy(), "to_code": d["site"].to_numpy(),
        "velo1": pv["release_speed"].to_numpy(), "velo2": d["release_speed"].to_numpy(),
        "balls": d["balls"].to_numpy(), "strikes": d["strikes"].to_numpy(), "stuff": d["stuff"].to_numpy(),
        "swing": d["description"].isin(SWING).to_numpy(), "ooz": d["zone"].between(11, 14).to_numpy(),
        "commit_d": 12 * np.hypot(d["commit_x"].to_numpy() - pv["commit_x"].to_numpy(),
                                  d["commit_z"].to_numpy() - pv["commit_z"].to_numpy()),
        "plate_d": 12 * np.hypot(d["plate_x"].to_numpy() - pv["plate_x"].to_numpy(),
                                 d["plate_z"].to_numpy() - pv["plate_z"].to_numpy()),
    }).dropna(subset=["stuff", "commit_d", "plate_d"])


def design(f, commit):
    X = pd.DataFrame({"stuff": f["stuff"].to_numpy(), "velo2": f["velo2"].to_numpy(),
                      "velo_drop": (f["velo1"] - f["velo2"]).to_numpy(), "balls": f["balls"].to_numpy(),
                      "strikes": f["strikes"].to_numpy(), "platoon": (f["throws"] != f["stand"]).astype(int).to_numpy()})
    for c in TYPES:
        X[f"to_{c}"] = (f["to_code"] == c).astype(int).to_numpy()
    X["plate_d"], X["commit_d"] = f["plate_d"].to_numpy(), commit
    return X


def tier(r):
    return "HIGH" if r >= 0.75 else "MEDIUM" if r >= 0.50 else "LOW"


def grade_season(con, s, stuff):
    df = con.sql(SQL.format(s=s)).df()
    df["site"] = df["pitch_type"].map(SITE)
    chase = (df[df["zone"].between(11, 14)].assign(sw=lambda x: x["description"].isin(SWING))
             .groupby("pitcher")["sw"].agg(["mean", "size"]).rename(columns={"mean": "chase", "size": "n_ooz"}))
    df = df.dropna(subset=["site"]).join(stuff.loc[s], on=["pitcher", "site"])
    df = positions(df)
    ex = float(np.nanmedian(np.abs(df["rel_x"] - df["release_pos_x"]))) * 12
    ez = float(np.nanmedian(np.abs(df["rel_z"] - df["release_pos_z"]))) * 12
    if ex > 2 or ez > 2:
        sys.exit(f"{s}: reconstruction off at release ({ex:.2f}, {ez:.2f} in), refusing to grade")
    oz = build_pairs(df)
    oz = oz[oz["ooz"]].reset_index(drop=True)
    y = oz["swing"].to_numpy().astype(int)
    X = design(oz, oz["commit_d"].to_numpy())
    test = np.array([zlib.crc32(str(g).encode()) % 10 < 3 for g in oz["game"]])

    def fit(Xm):
        mu, sd = Xm[~test].mean(), Xm[~test].std().replace(0, 1)
        mdl = LogisticRegression(max_iter=3000).fit(((Xm - mu) / sd)[~test], y[~test])
        return mdl, mu, sd, roc_auc_score(y[test], mdl.predict_proba(((Xm - mu) / sd)[test])[:, 1])
    model, mu, sd, auc = fit(X)
    auc_base = fit(X.drop(columns=["commit_d"]))[3]
    slope, icpt = np.polyfit(oz["plate_d"], oz["commit_d"], 1)
    p_act = model.predict_proba((X - mu) / sd)[:, 1]
    p_neu = model.predict_proba((design(oz, slope * oz["plate_d"].to_numpy() + icpt) - mu) / sd)[:, 1]
    oz["lift"] = p_act - p_neu

    agg = (oz.groupby(["pitcher", "from_code", "to_code"])
           .agg(n=("lift", "size"), lift=("lift", "mean"), commit=("commit_d", "mean"), plate=("plate_d", "mean"))
           .reset_index())
    agg = agg[agg["n"] >= MIN_PAIRS].copy()
    within = oz["lift"].var()
    ref = agg[agg["n"] >= REF_MIN_PAIRS]
    ref_mean = np.average(ref["lift"], weights=ref["n"])
    true_var = max(np.average((ref["lift"] - ref_mean) ** 2, weights=ref["n"]) - within / ref["n"].mean(), 1e-9)
    k, true_sd = within / true_var, np.sqrt(true_var)
    grand = np.average(agg["lift"], weights=agg["n"])
    agg["reliability"] = agg["n"] / (agg["n"] + k)
    agg["shrunk"] = grand + agg["reliability"] * (agg["lift"] - grand)
    agg["tunnel_plus"] = np.clip(np.round(100 + 10 * (agg["shrunk"] - grand) / true_sd), 70, 130).astype(int)
    agg["rankable"] = agg["reliability"] >= MIN_RANK_RELIABILITY
    agg["confidence"] = agg["reliability"].map(tier)

    # pitcher level: cell lift relative to its pairing type's league mean, pooled raw, shrunk once on its own k
    agg["lift_dev"] = agg["lift"] - agg.groupby(["from_code", "to_code"])["lift"].transform(
        lambda x: np.average(x, weights=agg.loc[x.index, "n"]))
    pp = (agg.assign(w=agg["lift_dev"] * agg["n"]).groupby("pitcher")
          .agg(w=("w", "sum"), n_pairs=("n", "sum"), pairings=("n", "size")).reset_index())
    pp["lift"] = pp["w"] / pp["n_pairs"]
    pref = pp[pp["n_pairs"] >= REF_MIN_PAIRS]
    pm = np.average(pref["lift"], weights=pref["n_pairs"])
    p_var = max(np.average((pref["lift"] - pm) ** 2, weights=pref["n_pairs"]) - within / pref["n_pairs"].mean(), 1e-9)
    k_p = within / p_var
    pp["reliability"] = pp["n_pairs"] / (pp["n_pairs"] + k_p)
    pp["tunnel_plus"] = np.clip(np.round(100 + 10 * pp["reliability"] * pp["lift"] / true_sd), 70, 130).astype(int)
    pp["rankable"] = pp["n_pairs"] >= PITCHER_RANK_PAIRS
    pp["confidence"] = pp["reliability"].map(tier)
    pp = pp.join(chase, on="pitcher").assign(season=s)
    meta = {"auc": round(auc, 4), "auc_base": round(auc_base, 4), "inc_auc": round(auc - auc_base, 4),
            "k": round(float(k), 1), "k_pitcher": round(float(k_p), 1), "sd_pts": round(float(true_sd) * 100, 3),
            "centre_pts": round(float(grand) * 100, 3), "recon_in": [round(ex, 3), round(ez, 3)],
            "geometry": [round(float(slope), 4), round(float(icpt), 3)], "pairs_ooz": int(len(oz))}
    print(s, meta, flush=True)
    return agg.assign(season=s), pp, meta


def demo():
    # a pitch thrown from (x0, 50, z0) with constant acceleration; positions() must recover its path
    vx0, vy0, vz0, ax, ay, az, x0, z0 = 5.0, -130.0, -4.0, -10.0, 28.0, -20.0, -1.5, 5.5
    t = lambda y: t_at(vy0, ay, y)  # noqa: E731
    px = lambda tt: (x0 + vx0 * tt + .5 * ax * tt ** 2, z0 + vz0 * tt + .5 * az * tt ** 2)  # noqa: E731
    (plx, plz), (cx, cz), (rx, rz) = px(t(PLATE_FT)), px(t(COMMIT_FT)), px(t(54.0))
    d = positions(pd.DataFrame({"vx0": [vx0], "vy0": [vy0], "vz0": [vz0], "ax": [ax], "ay": [ay], "az": [az],
                                "plate_x": [plx], "plate_z": [plz], "release_pos_y": [54.0]}))
    assert np.allclose(d[["commit_x", "commit_z", "rel_x", "rel_z"]].iloc[0], [cx, cz, rx, rz]), d
    assert np.isclose(px(0)[0], x0) and 0 < t(COMMIT_FT) < t(PLATE_FT)
    print("demo ok")


def main():
    con = mart.connect()
    pr = pd.read_parquet(PIPE.parent / "cache" / "pred_s4_bb.parquet", columns=["pitcher", "season", "pitch_type", "pred"])
    stuff = (pr.assign(site=pr["pitch_type"].map(SITE)).dropna(subset=["site"])
             .groupby(["season", "pitcher", "site"])["pred"].mean().rename("stuff"))
    pairs, pitchers, meta = [], [], {}
    for s in SEASONS:
        a, p, m = grade_season(con, s, stuff)
        pairs.append(a)
        pitchers.append(p)
        meta[s] = m
    pairs, pitchers = pd.concat(pairs), pd.concat(pitchers)
    pairs.rename(columns={"pitcher": "mlbam", "commit": "commit_sep_in", "plate": "plate_sep_in"}).assign(
        chase_lift_pts=lambda x: 100 * x["shrunk"])[
        ["mlbam", "season", "from_code", "to_code", "tunnel_plus", "n", "commit_sep_in", "plate_sep_in",
         "chase_lift_pts", "reliability", "rankable", "confidence"]].round(3).to_csv(RES / "tunnel_pairs.csv", index=False)
    pitchers.rename(columns={"pitcher": "mlbam"})[
        ["mlbam", "season", "tunnel_plus", "lift", "n_pairs", "pairings", "reliability", "rankable", "confidence"]
    ].round(5).to_csv(RES / "tunnel_pitchers.csv", index=False)

    # §74 read
    pc = pitchers.rename(columns={"pitcher": "mlbam"})
    pc = pc.assign(shrunk_lift=pc["reliability"] * pc["lift"])
    nxt = pc.assign(season=pc["season"] - 1)[["mlbam", "season", "n_pairs", "chase", "shrunk_lift"]]
    d = pc.merge(nxt, on=["mlbam", "season"], suffixes=("", "_next"))
    d = d[(d["n_pairs"] >= PITCHER_RANK_PAIRS) & (d["n_pairs_next"] >= PITCHER_RANK_PAIRS) & d["season"].between(2021, 2025)]
    d = d.dropna(subset=["chase", "chase_next"]).sort_values(["season", "mlbam"]).reset_index(drop=True)
    d["resid"] = np.nan
    for s, g in d.groupby("season"):
        b = np.polyfit(g["chase"], g["chase_next"], 1)
        d.loc[g.index, "resid"] = g["chase_next"] - np.polyval(b, g["chase"])
    claim = stack.pooled_dr(d, "chase", "shrunk_lift", "resid")
    claim["verdict"] = "CONFIRMED" if claim["ci"][0] > 0 else "NOT CONFIRMED"
    pa = pairs.rename(columns={"pitcher": "mlbam"})
    pn = pa.assign(season=pa["season"] - 1)[["mlbam", "season", "from_code", "to_code", "n", "shrunk"]]
    pj = pa.merge(pn, on=["mlbam", "season", "from_code", "to_code"], suffixes=("", "_next"))
    pj = pj[(pj["n"] >= REF_MIN_PAIRS) & (pj["n_next"] >= REF_MIN_PAIRS)]
    res = {"claim": claim, "n": int(len(d)), "meta": meta, "reported": {
        "head_on": stack.pooled_dr(d, "chase", "shrunk_lift", "chase_next"),
        "yoy_tunnel": round(float(d["shrunk_lift"].corr(d["shrunk_lift_next"])), 4),
        "yoy_chase": round(float(d["chase"].corr(d["chase_next"])), 4),
        "yoy_pairing": round(float(pj["shrunk"].corr(pj["shrunk_next"])), 4), "n_pairing": int(len(pj))}}
    print(json.dumps({k: v for k, v in res.items() if k != "meta"}, indent=1))
    (RES / "tunnel_SEALED.json").write_text(json.dumps(res, indent=1))


if __name__ == "__main__":
    demo() if "--demo" in sys.argv else main()
