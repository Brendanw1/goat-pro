"""RESULTS-MLB §87: role conversion. (A) which relievers could start, (B) which starters play up in relief.

    python pipeline/role_conversion.py         # read the §87 gates once -> results/roles_87.json + data/export/web/roles/
    python pipeline/role_conversion.py --demo  # self-check of the shrink + clustered bootstrap, no data

Natural experiment: MLB pitcher-seasons that changed role S -> S+1 (2020-26). Outcome is xwOBA allowed per PA.
A0 = relief line shrunk + league SP penalty; A1 = A0 + ridge on pre-change traits.
B0 = full starter line shrunk + converter change; B1 = first-TTO line shrunk + converter change; B2 = B1 + fade/TTO ridge.
Player-grouped folds, pitcher-clustered bootstrap. A failed gate ships the naive line, labelled descriptive.
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.linear_model import RidgeCV
from sklearn.model_selection import GroupKFold
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

PIPE = Path(__file__).resolve().parent
ROOT = PIPE.parent
sys.path.insert(0, str(PIPE))
from paths import MART_DIR  # noqa: E402
sys.path.insert(0, str(MART_DIR))
import mart  # noqa: E402
from web_export import official_gs, role_of  # noqa: E402

WEB = ROOT / "data" / "export" / "web"
OUT = WEB / "roles"
RES = PIPE / "results" / "roles_87.json"
K = 300          # shrink BF for every xwOBA line (pre-registered)
K_PLAT = 150     # per platoon side
FB = ("FF", "SI")
TYPES = ("FF", "SI", "FC", "SL", "ST", "SV", "SW", "CU", "KC", "CS", "CH", "FS", "FO", "SC", "KN")
TRAITS_A = ["depth", "graded_depth", "eff_types", "platoon_gap", "fade_in_outing", "rest_velo", "pitching_plus",
            "k_plus", "control_plus", "max_pitches", "mean_pitches", "pro_gs"]
TRAITS_B = ["fade_by_inning", "tto_pen"]
NB = 2000


def shrink(x, n, lg, k=K):
    return (np.nan_to_num(x) * n + k * lg) / (n + k)


def boot_diff(pid, w, e0, e1, nb=NB, seed=87):
    """Weighted MSE(e0) - MSE(e1), point and 95% CI from resampling pitchers."""
    d = pd.DataFrame({"p": pid, "w": w, "a": w * e0 ** 2, "b": w * e1 ** 2}).groupby("p").sum()
    W, A, B = d["w"].to_numpy(), d["a"].to_numpy(), d["b"].to_numpy()
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, len(d), (nb, len(d)))
    draws = (A[idx].sum(1) - B[idx].sum(1)) / W[idx].sum(1)
    return {"mse0": A.sum() / W.sum(), "mse1": B.sum() / W.sum(), "diff": (A.sum() - B.sum()) / W.sum(),
            "lo": float(np.percentile(draws, 2.5)), "hi": float(np.percentile(draws, 97.5)), "n": int(len(e0)),
            "pitchers": int(len(d))}


def ridge():
    return make_pipeline(SimpleImputer(strategy="median"), StandardScaler(), RidgeCV(alphas=np.logspace(-1, 3, 13)))


def oof(df, base_col, y_col, w_col, traits=None, folds=5):
    """Out-of-fold predictions: base + training-fold mean offset (+ ridge on the residual when traits given)."""
    pred = np.full(len(df), np.nan)
    for tr, te in GroupKFold(folds).split(df, groups=df["pid"]):
        a, b = df.iloc[tr], df.iloc[te]
        off = np.average(a[y_col] - a[base_col], weights=a[w_col])
        p = b[base_col].to_numpy() + off
        if traits:
            m = ridge().fit(a[traits], a[y_col] - a[base_col] - off, ridgecv__sample_weight=a[w_col])
            p = p + m.predict(b[traits])
        pred[te] = p
    return pred


def load(con):
    """PA lines and pitch traits per pitcher-season, split by start / relief appearance."""
    con.execute("""
        CREATE TEMP TABLE p AS
        SELECT pitcher AS pid, season, game_pk, inning_topbot, inning, at_bat_number, pitch_number, pitch_type,
               release_speed AS velo, description, stand, p_throws, n_thruorder_pitcher AS tto,
               pitcher_days_since_prev_game AS rest, woba_denom,
               COALESCE(estimated_woba_using_speedangle, woba_value) AS xw
        FROM pitches_all WHERE game_type = 'R' AND season BETWEEN 2020 AND 2026 AND pitcher IS NOT NULL""")
    con.execute("""
        CREATE TEMP TABLE app AS
        WITH f AS (SELECT game_pk, inning_topbot, arg_min(pid, at_bat_number * 1000 + pitch_number) AS starter
                   FROM p GROUP BY 1, 2)
        SELECT p.pid, p.game_pk, p.inning_topbot, any_value(p.season) AS season, any_value(p.pid = f.starter) AS st,
               count(*) AS np, any_value(p.rest) AS rest
        FROM p JOIN f USING (game_pk, inning_topbot) GROUP BY 1, 2, 3""")
    pa = con.sql("""
        SELECT p.pid, p.season, a.st, p.tto, p.stand, p.p_throws, p.xw
        FROM p JOIN app a USING (pid, game_pk, inning_topbot) WHERE p.woba_denom = 1 AND p.xw IS NOT NULL""").df()
    fb = con.sql(f"""
        SELECT p.pid, p.season, p.game_pk, a.st, a.np, a.rest, p.inning, p.velo,
               row_number() OVER (PARTITION BY p.pid, p.game_pk ORDER BY p.at_bat_number, p.pitch_number) AS seq
        FROM p JOIN app a USING (pid, game_pk, inning_topbot)
        WHERE p.pitch_type IN {FB} AND p.velo BETWEEN 70 AND 105""").df()
    mix = con.sql(f"""
        SELECT pid, season, pitch_type AS t, count(*) AS n,
               sum(CASE WHEN description IN ('swinging_strike','swinging_strike_blocked','foul_tip') THEN 1 ELSE 0 END) AS wh,
               sum(CASE WHEN description IN ('swinging_strike','swinging_strike_blocked','foul_tip','foul','hit_into_play',
                    'foul_bunt','missed_bunt','bunt_foul_tip') THEN 1 ELSE 0 END) AS sw
        FROM p WHERE pitch_type IN {TYPES} GROUP BY 1, 2, 3""").df()
    apps = con.sql("SELECT pid, season, st, np FROM app").df()
    return pa, fb, mix, apps


def lines(pa):
    """xwOBA and BF per pitcher-season: starts, relief, first TTO in starts, TTO3+ in starts, platoon sides."""
    pa = pa.assign(same=pa["stand"] == pa["p_throws"])

    def agg(d, name):
        g = d.groupby(["pid", "season"])["xw"].agg(["mean", "size"])
        return g.rename(columns={"mean": f"x_{name}", "size": f"bf_{name}"})
    st = pa[pa["st"]]
    parts = [agg(st, "sp"), agg(pa[~pa["st"]], "rp"), agg(st[st["tto"] == 1], "t1"), agg(st[st["tto"] >= 3], "t3"),
             agg(pa[pa["same"]], "same"), agg(pa[~pa["same"]], "opp"), agg(pa, "all")]
    lg = {"sp": st.groupby("season")["xw"].mean(), "rp": pa[~pa["st"]].groupby("season")["xw"].mean(),
          "t1": st[st["tto"] == 1].groupby("season")["xw"].mean(), "t3": st[st["tto"] >= 3].groupby("season")["xw"].mean(),
          "same": pa[pa["same"]].groupby("season")["xw"].mean(), "opp": pa[~pa["same"]].groupby("season")["xw"].mean()}
    L = pd.concat(parts, axis=1).reset_index()
    for c in ["sp", "rp", "t1", "t3", "same", "opp", "all"]:
        L[f"bf_{c}"] = L[f"bf_{c}"].fillna(0)
    for c in ["sp", "rp", "t1", "t3"]:
        L[f"s_{c}"] = shrink(L[f"x_{c}"], L[f"bf_{c}"], L["season"].map(lg[c]))
    L["platoon_gap"] = (shrink(L["x_opp"], L["bf_opp"], L["season"].map(lg["opp"]), K_PLAT)
                        - shrink(L["x_same"], L["bf_same"], L["season"].map(lg["same"]), K_PLAT))
    L["tto_pen"] = L["s_t3"] - L["s_t1"]
    return L, {k: {int(s): round(float(v), 4) for s, v in ser.items()} for k, ser in lg.items()}


def traits(fb, mix, apps):
    out = []
    # within-outing fade: outing-demeaned FB velo on pitch sequence, outings of 15+ pitches; slope per 10 pitches
    f = fb[fb["np"] >= 15].copy()
    f["dv"] = f["velo"] - f.groupby(["pid", "game_pk"])["velo"].transform("mean")
    f["ds"] = f["seq"] - f.groupby(["pid", "game_pk"])["seq"].transform("mean")
    g = f.assign(xy=f["dv"] * f["ds"], xx=f["ds"] ** 2).groupby(["pid", "season"])[["xy", "xx"]].sum()
    out.append((10 * g["xy"] / g["xx"].where(g["xx"] > 0)).rename("fade_in_outing"))
    # across outings: FB velo on 0-1 days rest minus 2+
    r = fb.dropna(subset=["rest"]).assign(short=lambda d: d["rest"] <= 1).groupby(["pid", "season", "short"])["velo"].mean().unstack()
    out.append((r.get(True) - r.get(False)).rename("rest_velo"))
    # per-inning fade in starts: inning 1 minus innings 5+
    s = fb[fb["st"]]
    v1 = s[s["inning"] == 1].groupby(["pid", "season"])["velo"].mean()
    v5 = s[s["inning"] >= 5].groupby(["pid", "season"])["velo"].mean()
    out.append((v1 - v5).rename("fade_by_inning"))
    out.append(s.groupby(["pid", "season"])["velo"].mean().rename("velo_sp"))
    out.append(fb[~fb["st"]].groupby(["pid", "season"])["velo"].mean().rename("velo_rp"))
    # arsenal depth
    m = mix.copy()
    m["u"] = m["n"] / m.groupby(["pid", "season"])["n"].transform("sum")
    m["wps"] = m["wh"] / m["sw"].where(m["sw"] > 0)
    med = m[m["sw"] >= 20].groupby(["season", "t"])["wps"].median().rename("med")
    m = m.join(med, on=["season", "t"])
    real = m[m["u"] >= 0.10]
    out.append(real.groupby(["pid", "season"]).size().rename("depth"))
    out.append(real.assign(gd=real["wps"] >= real["med"]).groupby(["pid", "season"])["gd"].sum().rename("graded_depth"))
    out.append(m.groupby(["pid", "season"])["u"].apply(lambda u: float(np.exp(-(u * np.log(u)).sum()))).rename("eff_types"))
    # pitch counts
    a = apps.groupby(["pid", "season"])["np"]
    out.append(a.max().rename("max_pitches"))
    out.append(a.mean().rename("mean_pitches"))
    return pd.concat(out, axis=1).reset_index()


def pro_gs():
    """(pid, season) -> MLB + MiLB games started through that season (MiLB lines from 2021)."""
    rows = [pd.read_parquet(ROOT / "data" / "milb" / f, columns=["mlbam_id", "season", "GS"])
            for f in ("pitchers.parquet", "mlb_pitchers.parquet")]
    d = pd.concat(rows).groupby(["mlbam_id", "season"])["GS"].sum().reset_index().sort_values("season")
    full = d.set_index(["mlbam_id", "season"])["GS"].unstack(fill_value=0).reindex(columns=range(2018, 2027), fill_value=0)
    return full.cumsum(axis=1).stack().rename("pro_gs").rename_axis(["pid", "season"]).reset_index()


def grades():
    rows = json.load(open(WEB / "pitchers.json"))
    return pd.DataFrame([{"pid": int(r["id"]), "season": r["season"], "name": r["name"], "team": r["team"],
                          "throws": r["throws"], "pitching_plus": r.get("pitchingPlus"), "k_plus": r.get("kPlus"),
                          "control_plus": r.get("controlPlus")} for r in rows])


def r3(x):
    return None if x is None or pd.isna(x) else round(float(x), 3)


def r1(x):
    return None if x is None or pd.isna(x) else round(float(x), 1)


def main():
    con = mart.connect()
    pa, fb, mix, apps = load(con)
    L, lg = lines(pa)
    T = traits(fb, mix, apps)
    D = L.merge(T, on=["pid", "season"], how="left").merge(pro_gs(), on=["pid", "season"], how="left")
    D = D.merge(grades(), on=["pid", "season"], how="left")
    gs = official_gs("mlb")
    D["role"] = [role_of(*(gs.get((int(p), int(s))) or (None, None))) for p, s in zip(D["pid"], D["season"])]
    nxt = D.assign(season=D["season"] - 1).set_index(["pid", "season"])
    P = D.join(nxt[["role", "x_sp", "bf_sp", "x_rp", "bf_rp", "velo_rp", "velo_sp"]], on=["pid", "season"], rsuffix="_n")

    res = {"section": 87, "k": K, "league": lg}
    # ---- (A) RP -> SP
    A = P[(P["role"] == "RP") & (P["role_n"] == "SP") & (P["bf_rp"] >= 100) & (P["bf_sp_n"] >= 100)
          & (P["season"] <= 2025)].reset_index(drop=True)
    A["base"] = A["s_rp"]
    A["p0"] = oof(A, "base", "x_sp_n", "bf_sp_n")
    A["p1"] = oof(A, "base", "x_sp_n", "bf_sp_n", TRAITS_A)
    res["GA"] = boot_diff(A["pid"], A["bf_sp_n"], A["x_sp_n"] - A["p0"], A["x_sp_n"] - A["p1"])
    res["GA"]["pass"] = res["GA"]["lo"] > 0
    pen = np.average(A["x_sp_n"] - A["base"], weights=A["bf_sp_n"])
    res["A_penalty"] = round(float(pen), 4)
    # univariate trait reads on the A0 residual (exploratory, not gates)
    resid = A["x_sp_n"] - A["p0"]
    res["A_traits"] = {t: round(float(pd.Series(A[t]).corr(resid)), 3) for t in TRAITS_A}
    sens = A[A["season"] != 2022]
    res["GA_no2223"] = boot_diff(sens["pid"], sens["bf_sp_n"], sens["x_sp_n"] - sens["p0"], sens["x_sp_n"] - sens["p1"])

    # ---- (B) SP -> RP
    B = P[(P["role"] == "SP") & (P["role_n"] == "RP") & (P["bf_sp"] >= 200) & (P["bf_rp_n"] >= 60)
          & (P["season"] <= 2025)].reset_index(drop=True)
    B["p0"] = oof(B, "s_sp", "x_rp_n", "bf_rp_n")
    B["p1"] = oof(B, "s_t1", "x_rp_n", "bf_rp_n")
    B["p2"] = oof(B, "s_t1", "x_rp_n", "bf_rp_n", TRAITS_B)
    res["GB1"] = boot_diff(B["pid"], B["bf_rp_n"], B["x_rp_n"] - B["p0"], B["x_rp_n"] - B["p1"])
    res["GB2"] = boot_diff(B["pid"], B["bf_rp_n"], B["x_rp_n"] - B["p1"], B["x_rp_n"] - B["p2"])
    res["GB1"]["pass"] = res["GB1"]["lo"] > 0
    res["GB2"]["pass"] = res["GB2"]["lo"] > 0
    sB = B[B["season"] != 2022]
    res["GB1_no2223"] = boot_diff(sB["pid"], sB["bf_rp_n"], sB["x_rp_n"] - sB["p0"], sB["x_rp_n"] - sB["p1"])
    off1 = np.average(B["x_rp_n"] - B["s_t1"], weights=B["bf_rp_n"])
    off0 = np.average(B["x_rp_n"] - B["s_sp"], weights=B["bf_rp_n"])
    res["B_offset_t1"], res["B_offset_full"] = round(float(off1), 4), round(float(off0), 4)
    vb = B.dropna(subset=["velo_rp_n", "velo_sp"])
    bump = (vb["velo_rp_n"] - vb["velo_sp"]).to_numpy()
    rng = np.random.default_rng(87)
    ids = vb["pid"].to_numpy()
    u = np.unique(ids)
    by = {p: bump[ids == p] for p in u}
    draws = [np.concatenate([by[p] for p in rng.choice(u, len(u))]).mean() for _ in range(NB)]
    res["velo_bump"] = {"mean": round(float(bump.mean()), 2), "lo": round(float(np.percentile(draws, 2.5)), 2),
                        "hi": round(float(np.percentile(draws, 97.5)), 2), "n": int(len(bump))}
    # noise floor: weighted MSE expected from PA sampling alone (per-PA xwOBA variance / BF)
    v = float(pa["xw"].var())
    res["pa_var"] = round(v, 4)
    res["noise_A"] = len(A) * v / A["bf_sp_n"].sum()
    res["noise_B"] = len(B) * v / B["bf_rp_n"].sum()
    RES.write_text(json.dumps(res, indent=1, default=float))
    print(json.dumps({k: v for k, v in res.items() if k != "league"}, indent=1, default=float))

    # ---- boards (2026)
    OUT.mkdir(parents=True, exist_ok=True)
    cur = D[D["season"] == 2026]
    ra = cur[(cur["role"] == "RP") & (cur["bf_rp"] >= 100)].copy()
    ra["proj"] = ra["s_rp"] + pen
    if res["GA"]["pass"]:
        m = ridge().fit(A[TRAITS_A], A["x_sp_n"] - A["base"] - pen, ridgecv__sample_weight=A["bf_sp_n"])
        ra["proj"] += m.predict(ra[TRAITS_A])
    ra = ra.sort_values("proj")
    board_a = [{"id": str(int(r.pid)), "name": r.name, "team": r.team, "throws": r.throws, "bf": int(r.bf_rp),
                "xwoba": r3(r.x_rp), "xwobaShrunk": r3(r.s_rp), "projSp": r3(r.proj), "depth": int(r.depth or 0),
                "gradedDepth": int(r.graded_depth or 0), "effTypes": r1(r.eff_types), "platoonGap": r3(r.platoon_gap),
                "fadeInOuting": r1(r.fade_in_outing), "restVelo": r1(r.rest_velo), "pitchingPlus": r1(r.pitching_plus),
                "kPlus": r1(r.k_plus), "controlPlus": r1(r.control_plus), "maxPitches": int(r.max_pitches or 0),
                "proGs": int(r.pro_gs or 0)} for r in ra.itertuples()]
    rb = cur[(cur["role"] == "SP") & (cur["bf_sp"] >= 300)].copy()
    use_b1 = res["GB1"]["pass"]
    # B0 gives every starter the same gain (off0), so the board always ranks on the first-TTO line;
    # the label says whether that line passed GB1 (deviation logged in §87).
    rb["relief"] = rb["s_t1"] + off1
    rb["gain"] = rb["s_sp"] - rb["relief"]
    rb = rb.sort_values("gain", ascending=False)
    board_b = [{"id": str(int(r.pid)), "name": r.name, "team": r.team, "throws": r.throws, "bf": int(r.bf_sp),
                "xwoba": r3(r.x_sp), "xwobaShrunk": r3(r.s_sp), "tto1": r3(r.x_t1), "tto1Shrunk": r3(r.s_t1),
                "ttoPen": r3(r.tto_pen), "fadeByInning": r1(r.fade_by_inning), "veloSp": r1(r.velo_sp),
                "veloRelief": r1(r.velo_sp + res["velo_bump"]["mean"]) if not pd.isna(r.velo_sp) else None,
                "projRelief": r3(r.relief), "gain": r3(r.gain)} for r in rb.itertuples()]
    verdict_a = "forecast (§87 GA passed)" if res["GA"]["pass"] else "descriptive, not a forecast (§87 GA failed)"
    verdict_b = ("first-TTO projection (§87 GB1 passed)" if use_b1 else "descriptive, not a forecast (§87 GB1 failed)")
    doc = {"_comment": "generated by pipeline/role_conversion.py — do not hand-edit", "season": 2026,
           "gates": {k: res[k] for k in ("GA", "GB1", "GB2")}, "penaltySp": res["A_penalty"],
           "offsetT1": res["B_offset_t1"], "offsetFull": res["B_offset_full"], "veloBump": res["velo_bump"],
           "nA": res["GA"]["n"], "nB": res["GB1"]["n"], "verdictA": verdict_a, "verdictB": verdict_b,
           "rpToSp": board_a, "spToRp": board_b}
    (OUT / "roles.json").write_text(json.dumps(doc, default=float, separators=(",", ":")))
    print(f"wrote {OUT / 'roles.json'}: {len(board_a)} RP, {len(board_b)} SP")


def demo():
    assert abs(shrink(np.array([0.4]), np.array([300]), 0.3)[0] - 0.35) < 1e-9
    e0, e1 = np.array([0.1, 0.1, 0.1, 0.1]), np.array([0.0, 0.0, 0.0, 0.0])
    b = boot_diff(np.array([1, 1, 2, 2]), np.ones(4), e0, e1, nb=200)
    assert abs(b["diff"] - 0.01) < 1e-12 and b["lo"] > 0 and b["pitchers"] == 2
    b = boot_diff(np.array([1, 2]), np.ones(2), np.array([0.1, 0.0]), np.array([0.0, 0.1]), nb=500)
    assert b["lo"] < 0 < b["hi"]
    print("demo ok")


if __name__ == "__main__":
    demo() if "--demo" in sys.argv else main()
