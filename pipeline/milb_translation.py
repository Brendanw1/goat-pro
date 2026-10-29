"""RESULTS-MLB §88: minor-league translations (MLEs), AAA -> MLB and AA -> MLB, from Stats API season lines.

    python pipeline/milb_translation.py          # §88 gate (results/milb_translation.json) + web export
    python pipeline/milb_translation.py --demo   # self-check of the factor and shrink arithmetic

Delta method: each stat as a ratio to its league x season environment (AAA park-adjusted first), factor
f = sum(h * rel_MLB) / sum(h * rel_level) over players with both lines (same season or the next),
h = harmonic mean of the two PA/BF counts; rel shrunk toward the level average with n/(n+k);
MLE = f * rel_shrunk * MLB mean in season S. AAA 2026 is scored for display only, never read as a test.
"""
import json
import sys
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.model_selection import GroupKFold

PIPE = Path(__file__).resolve().parent
ROOT = PIPE.parent
SRC = ROOT / "data" / "milb"
OUT = ROOT / "data" / "export" / "web" / "translation"
FIT_SEASONS = range(2021, 2026)   # level seasons a factor may be fitted on (never AAA/AA 2026)
TEST_SEASONS = (2023, 2024, 2025)  # S -> MLB S+1
FLOOR = {"hitters": (200, 100), "pitchers": (150, 100)}  # level S, MLB S+1
PAIR_MIN = 30
K_GRID = (0, 50, 100, 200, 400, 800, 1600, 3200)
DRAWS, SEED = 2000, 13
W = {"uBB": .69, "HBP": .72, "1B": .89, "2B": 1.27, "3B": 1.62, "HR": 2.10}
STATS = {"hitters": ["kPct", "bbPct", "iso", "babip", "woba"], "pitchers": ["kPct", "bbPct", "hbpPct", "hrPct"]}
N = {"hitters": "PA", "pitchers": "BF"}
# Stats API AAA team id -> Statcast home_team code (stable 2021-2026)
AAA_TEAM = {342: "ABQ", 422: "BUF", 494: "CLT", 445: "COL", 234: "DUR", 4904: "ELP", 431: "GWN", 484: "IND", 451: "IOW",
            564: "JAX", 1410: "LHV", 416: "LOU", 400: "LV", 235: "MEM", 556: "NAS", 568: "NOR", 238: "OKC", 541: "OMA",
            2310: "RNO", 534: "ROC", 102: "RR", 105: "SAC", 561: "SL", 1960: "STP", 5434: "SUG", 531: "SWB", 552: "SYR",
            529: "TAC", 512: "TOL", 533: "WOR"}
COMPS = ["1B", "2B", "3B", "HR", "BB", "SO"]


# ---------- park (AAA) ----------
def aaa_park() -> pd.DataFrame:
    """EB home/road factor per AAA home team and component, 2023-25 (§70 method, no hand split)."""
    sys.path.insert(0, str(PIPE))
    from paths import MART_DIR
    sys.path.insert(0, str(MART_DIR))
    import mart
    import park_factors as pf
    ev = {"1B": "('single')", "2B": "('double')", "3B": "('triple')", "HR": "('home_run')", "BB": "('walk')",
          "SO": "('strikeout','strikeout_double_play')"}
    cols = ", ".join(f"count(*) FILTER (WHERE events IN {e}) AS c_{k}" for k, e in ev.items())
    g = mart.connect().sql(f"""SELECT game_pk, season, home_team, away_team, 'A' AS stand, count(*) AS pa, {cols}
        FROM pitches_aaa WHERE game_type = 'R' AND events IS NOT NULL AND season IN (2023, 2024, 2025)
        GROUP BY 1, 2, 3, 4""").df()
    g["venue_id"] = g["home_team"]
    s = pf.shrink(pf.ratios(g, [2023, 2024, 2025]))
    t = s.pivot(index="team", columns="comp", values="eb")
    return ((1 + np.exp(t)) / 2).fillna(1.0)  # half the games at home


# ---------- lines -> stats ----------
def stats(c: pd.DataFrame, kind: str) -> pd.DataFrame:
    with np.errstate(divide="ignore", invalid="ignore"):
        if kind == "pitchers":
            return pd.DataFrame({"kPct": c["SO"] / c["BF"], "bbPct": c["BB"] / c["BF"], "hbpPct": c["HBP"] / c["BF"],
                                 "hrPct": c["HR"] / c["BF"]}, index=c.index)
        h = c["1B"] + c["2B"] + c["3B"] + c["HR"]
        ubb = c["BB"] - c["IBB"]
        return pd.DataFrame({
            "kPct": c["SO"] / c["PA"], "bbPct": c["BB"] / c["PA"],
            "iso": (c["2B"] + 2 * c["3B"] + 3 * c["HR"]) / c["AB"],
            "babip": (h - c["HR"]) / (c["AB"] - c["SO"] - c["HR"] + c["SF"]),
            "woba": (W["uBB"] * ubb + W["HBP"] * c["HBP"] + W["1B"] * c["1B"] + W["2B"] * c["2B"] + W["3B"] * c["3B"]
                     + W["HR"] * c["HR"]) / (c["AB"] + ubb + c["SF"] + c["HBP"])}, index=c.index)


def counts_cols(kind):
    return (["PA", "AB", "1B", "2B", "3B", "HR", "BB", "IBB", "HBP", "SF", "SO"] if kind == "hitters"
            else ["BF", "OUTS", "HR", "BB", "HBP", "SO", "ER"])


def level_table(df: pd.DataFrame, kind: str, pf: pd.DataFrame | None) -> pd.DataFrame:
    """Per player x season: raw stats, park-adjusted stats, env (league x season) and rel = adj / env."""
    df = df.copy()
    if kind == "hitters":
        df["1B"] = df["H"] - df["2B"] - df["3B"] - df["HR"]
    raw = df.copy()
    if pf is not None:
        code = df["team_id"].map(AAA_TEAM)
        for c in COMPS:
            if c in df:
                df[c] = df[c] / code.map(pf[c]).fillna(1.0).to_numpy()
    cc = counts_cols(kind)
    lg = stats(df.groupby(["season", "league"])[cc].sum(), kind)
    env = lg.reindex(pd.MultiIndex.from_frame(df[["season", "league"]])).set_axis(df.index)
    n = df[N[kind]]
    key = ["mlbam_id", "season"]
    w_env = (env.mul(n, axis=0)).groupby([df["mlbam_id"], df["season"]]).sum().div(
        n.groupby([df["mlbam_id"], df["season"]]).sum(), axis=0)
    adj = stats(df.groupby(key)[cc].sum(), kind)
    rawc = raw.groupby(key)[cc].sum()
    out = rawc.join(stats(rawc, kind).add_prefix("raw_")).join((adj / w_env).add_prefix("rel_"))
    return out.reset_index()


def mlb_env(m: pd.DataFrame, kind: str) -> pd.DataFrame:
    if kind == "hitters":
        m = m.assign(**{"1B": m["H"] - m["2B"] - m["3B"] - m["HR"]})
    e = stats(m.groupby("season")[counts_cols(kind)].sum(), kind)
    if kind == "pitchers":
        s = m.groupby("season")[["ER", "OUTS", "HR", "BB", "HBP", "SO", "BF"]].sum()
        ip = s["OUTS"] / 3
        e["lgFip"] = 9 * s["ER"] / ip
        e["cfip"] = e["lgFip"] - (13 * s["HR"] + 3 * (s["BB"] + s["HBP"]) - 2 * s["SO"]) / ip
        e["bfPerIp"] = s["BF"] / ip
    return e


def fip(t: pd.DataFrame, cfip, bf_ip, p=""):
    return bf_ip * (13 * t[p + "hrPct"] + 3 * (t[p + "bbPct"] + t[p + "hbpPct"]) - 2 * t[p + "kPct"]) + cfip


# ---------- delta method ----------
def pairs(lo: pd.DataFrame, hi: pd.DataFrame, kind: str, v2=False) -> pd.DataFrame:
    """v1: same season or next, >= 30 each side. v2 (§88 re-test): next season only, at the gate floors."""
    n = N[kind]
    lag = (1,) if v2 else (0, 1)
    out = []
    for d in lag:
        h = hi.assign(season=hi["season"] - d)
        out.append(lo.merge(h, on=["mlbam_id", "season"], suffixes=("_lo", "_hi")))
    p = pd.concat(out, ignore_index=True)
    lo_min, hi_min = FLOOR[kind] if v2 else (PAIR_MIN, PAIR_MIN)
    p = p[(p[n + "_lo"] >= lo_min) & (p[n + "_hi"] >= hi_min) & p["season"].isin(FIT_SEASONS)]
    return p.assign(h=2 / (1 / p[n + "_lo"] + 1 / p[n + "_hi"]))


def factor(p: pd.DataFrame, stat: str) -> float:
    ok = p[["rel_" + stat + "_lo", "rel_" + stat + "_hi"]].notna().all(1) & np.isfinite(p["rel_" + stat + "_lo"])
    q = p[ok]
    return float((q["h"] * q["rel_" + stat + "_hi"]).sum() / (q["h"] * q["rel_" + stat + "_lo"]).sum())


def mle(rel, n, f, k, mean):
    return f * (1 + (rel - 1) * n / (n + k)) * mean


def pick_k(tr: pd.DataFrame, stat, f, kind, env):
    """k from the grid: PA/BF-weighted MSE on the training rows' own S -> S+1 pairs."""
    n = N[kind]
    best = None
    for k in K_GRID:
        x = mle(tr["rel_" + stat], tr[n], f, k, tr["season"].map(env[stat]))
        ok = x.notna() & tr["y_" + stat].notna()
        e = np.average((x[ok] - tr.loc[ok, "y_" + stat]) ** 2, weights=tr.loc[ok, "w"])
        if best is None or e < best[1]:
            best = (k, e)
    return best[0]


def test_rows(lo: pd.DataFrame, mlb: pd.DataFrame, kind: str, seasons) -> pd.DataFrame:
    n = N[kind]
    f_lo, f_hi = FLOOR[kind]
    nxt = mlb.assign(season=mlb["season"] - 1)
    y = nxt[["mlbam_id", "season", n] + [c for c in nxt if c.startswith("raw_")]]
    y = y.rename(columns={n: "w", **{c: "y_" + c[4:] for c in y if c.startswith("raw_")}})
    t = lo.merge(y, on=["mlbam_id", "season"])
    return t[t["season"].isin(seasons) & (t[n] >= f_lo) & (t["w"] >= f_hi)].reset_index(drop=True)


def cluster_boot(d: pd.DataFrame, cols, rng):
    """Player-clustered bootstrap of weighted mean of each column; returns (draws, len(cols))."""
    ids, inv = np.unique(d["mlbam_id"], return_inverse=True)
    sw = np.bincount(inv, weights=d["w"])
    sums = np.stack([np.bincount(inv, weights=d["w"] * d[c]) for c in cols], 1)
    cnt = rng.multinomial(len(ids), np.full(len(ids), 1 / len(ids)), size=DRAWS)
    return (cnt @ sums) / (cnt @ sw)[:, None]


def gate(lo, mlb, kind, fit_lo_hi, env, level):
    """Out-of-fold MLEs on the S -> S+1 rows; fit_lo_hi(train_ids) -> {stat: f}."""
    n = N[kind]
    allrows = test_rows(lo, mlb, kind, FIT_SEASONS)
    t = test_rows(lo, mlb, kind, TEST_SEASONS)
    if len(t) < 60:
        return {"n": int(len(t)), "read": False, "note": "n < 60: not read (pre-registered)"}
    stats_ = STATS[kind]
    oof = pd.DataFrame(index=t.index, columns=[f"mle_{s}" for s in stats_], dtype=float)
    ks = {s: [] for s in stats_}
    for tr_i, te_i in GroupKFold(5).split(t, groups=t["mlbam_id"]):
        test_ids = set(t.loc[te_i, "mlbam_id"])
        f = fit_lo_hi(test_ids)
        tr = allrows[~allrows["mlbam_id"].isin(test_ids)]
        for s in stats_:
            k = pick_k(tr, s, f[s], kind, env)
            ks[s].append(k)
            te = t.loc[te_i]
            oof.loc[te_i, f"mle_{s}"] = mle(te["rel_" + s], te[n], f[s], k, te["season"].map(env[s])).to_numpy()
    t = t.join(oof)
    for s in stats_:
        t[f"lg_{s}"] = t["season"].map(env[s])
    if kind == "pitchers":
        stats_ = stats_ + ["fip"]
        t["mle_fip"] = fip(t, t["season"].map(env["cfip"]), t["season"].map(env["bfPerIp"]), "mle_")
        t["raw_fip"] = t["raw_fip_level"]
        t["lg_fip"] = t["season"].map(env["lgFip"])
        nx = env.copy()
        nx.index = nx.index - 1
        t["y_fip"] = fip(t, t["season"].map(nx["cfip"]), t["w"] / (t["OUTS_y"] / 3), "y_")
    rng = np.random.default_rng(SEED)
    res = {"n": int(len(t)), "n_players": int(t["mlbam_id"].nunique()), "read": True, "k": {s: ks[s] for s in ks}, "stats": {}}
    for s in stats_:
        d = t.dropna(subset=[f"mle_{s}", f"raw_{s}", f"y_{s}"]).copy()
        for b in ("mle", "raw", "lg"):
            d[f"se_{b}"] = (d[f"{b}_{s}"] - d[f"y_{s}"]) ** 2
        d["d_raw"], d["d_lg"] = d["se_raw"] - d["se_mle"], d["se_lg"] - d["se_mle"]
        bt = cluster_boot(d, ["d_raw", "d_lg"], rng)
        pt = [float(np.average(d[c], weights=d["w"])) for c in ("d_raw", "d_lg")]
        per = {}
        for ss, g in d.groupby("season"):
            per[f"{ss}->{ss + 1}"] = {"n": int(len(g)), **{c: round(float(np.average(g[c], weights=g["w"])), 7) for c in ("d_raw", "d_lg")}}
        wins = sum(v["d_raw"] > 0 and v["d_lg"] > 0 for v in per.values())
        ci = np.percentile(bt, [2.5, 97.5], axis=0)
        ok = ci[0, 0] > 0 and ci[0, 1] > 0 and wins >= 2
        rmse = {b: round(float(np.sqrt(np.average(d[f"se_{b}"], weights=d["w"]))), 5) for b in ("mle", "raw", "lg")}
        res["stats"][s] = {
            "n": int(len(d)), "rmse": rmse, "d_raw": round(pt[0], 7), "ci_raw": [round(float(x), 7) for x in ci[:, 0]],
            "d_lg": round(pt[1], 7), "ci_lg": [round(float(x), 7) for x in ci[:, 1]], "pairs": per, "pairs_won": wins,
            "r_mle": round(float(d[f"mle_{s}"].corr(d[f"y_{s}"])), 3), "r_raw": round(float(d[f"raw_{s}"].corr(d[f"y_{s}"])), 3),
            "bias_mle": round(float(np.average(d[f"mle_{s}"] - d[f"y_{s}"], weights=d["w"])), 5),
            "verdict": "PASS" if ok else "FAIL"}
        print(f"{level} {kind} {s}: n={len(d)} rmse {rmse} dRaw {pt[0]:.6f} {ci[:, 0].round(6)} dLg {pt[1]:.6f} "
              f"{ci[:, 1].round(6)} wins {wins} -> {res['stats'][s]['verdict']}", flush=True)
    return res


# ---------- build ----------
def load(kind, pf):
    lines = pd.read_parquet(SRC / f"{kind}.parquet").rename(columns={"league_name": "league"})
    mlb = pd.read_parquet(SRC / f"mlb_{kind}.parquet").assign(league="MLB")
    lv = {L: level_table(lines[lines["level"] == L], kind, pf if L == "AAA" else None) for L in ("AAA", "AA")}
    m = level_table(mlb, kind, None)
    env = mlb_env(mlb, kind)
    if kind == "pitchers":  # raw level FIP (level constant) for baseline (a); MLB outcome needs OUTS
        for L, t in lv.items():
            src = lines[lines["level"] == L]
            s = src.groupby("season")[["ER", "OUTS", "HR", "BB", "HBP", "SO"]].sum()
            ip = s["OUTS"] / 3
            c = 9 * s["ER"] / ip - (13 * s["HR"] + 3 * (s["BB"] + s["HBP"]) - 2 * s["SO"]) / ip
            ipp = t["OUTS"] / 3
            t["raw_fip_level"] = (13 * t["HR"] + 3 * (t["BB"] + t["HBP"]) - 2 * t["SO"]) / ipp + t["season"].map(c)
    return lv, m, env


def run(kind, pf, v2=False):
    lv, m, env = load(kind, pf)
    if kind == "pitchers":  # carry MLB OUTS into the S+1 outcome rows
        mo = m[["mlbam_id", "season", "OUTS"]].rename(columns={"OUTS": "OUTS_y"}).assign(season=lambda x: x["season"] - 1)
        for L in lv:
            lv[L] = lv[L].merge(mo, on=["mlbam_id", "season"], how="left")
    aaa_mlb = pairs(lv["AAA"], m, kind, v2)
    aa_mlb = pairs(lv["AA"], m, kind, v2)
    aa_aaa = pairs(lv["AA"], lv["AAA"], kind, v2)
    chain = len(aa_mlb) < 100
    st = STATS[kind]

    def fit(L, drop=frozenset()):
        a = aaa_mlb[~aaa_mlb["mlbam_id"].isin(drop)]
        if L == "AAA":
            return {s: factor(a, s) for s in st}
        if chain:
            b = aa_aaa[~aa_aaa["mlbam_id"].isin(drop)]
            return {s: factor(b, s) * factor(a, s) for s in st}
        b = aa_mlb[~aa_mlb["mlbam_id"].isin(drop)]
        return {s: factor(b, s) for s in st}

    res = {"pairs": {"AAA->MLB": int(len(aaa_mlb)), "AA->MLB": int(len(aa_mlb)), "AA->AAA": int(len(aa_aaa))},
           "aa_method": "chain AA->AAA x AAA->MLB" if chain else "direct AA->MLB", "levels": {}}
    rows = []
    for L in ("AAA", "AA"):
        g = gate(lv[L], m, kind, lambda ids, L=L: fit(L, frozenset(ids)), env, L)
        f = fit(L)
        allrows = test_rows(lv[L], m, kind, FIT_SEASONS)
        k = {s: pick_k(allrows, s, f[s], kind, env) for s in st}
        res["levels"][L] = {"gate": g, "factor": {s: round(f[s], 4) for s in st}, "k": k}
        t = lv[L]
        out = pd.DataFrame({"id": t["mlbam_id"].astype(str), "season": t["season"], "level": L, "n": t[N[kind]]})
        for s in st:
            out[s] = mle(t["rel_" + s], t[N[kind]], f[s], k[s], t["season"].map(env[s]))
        if kind == "pitchers":
            out["fip"] = fip(out, t["season"].map(env["cfip"]), t["season"].map(env["bfPerIp"]))
            out["hr9"] = 9 * out["hrPct"] * t["season"].map(env["bfPerIp"])
        rows.append(out[out["n"] > 0])
    return res, pd.concat(rows, ignore_index=True), env


def verdict_of(res, L, s):
    g = res["levels"][L]["gate"]
    return g["stats"][s]["verdict"] if g.get("read") and s in g.get("stats", {}) else "NOT READ"


# display stat -> gated stat
GATE_STAT = {"hitters": {s: s for s in STATS["hitters"]}, "pitchers": {"kPct": "kPct", "bbPct": "bbPct", "hr9": "hrPct", "fip": "fip"}}
PCT = {"kPct", "bbPct"}


def main():
    warnings.filterwarnings("ignore")
    pf = aaa_park()
    OUT.mkdir(parents=True, exist_ok=True)
    allres = {"method": "RESULTS-MLB §88", "park_aaa": {t: {c: round(float(v), 3) for c, v in r.items()} for t, r in pf.iterrows()}}
    factors = {"method": "RESULTS-MLB §88", "levels": {}, "aa_method": {}}
    for kind in ("hitters", "pitchers"):
        out = {}
        for ver, v2 in (("v1", False), ("v2", True)):
            print(f"--- {ver}", flush=True)
            res, rows, _ = run(kind, pf, v2)
            allres.setdefault(ver, {})[kind] = res
            out[ver] = rows.set_index(["id", "season", "level"])
        ship = out["v2"].copy()
        for L in ("AAA", "AA"):
            fac = {"factor": {}, "k": {}, "verdict": {}, "verdict_from": {}, "shipped_factor": "v2"}
            for disp, gs in GATE_STAT[kind].items():
                p1, p2 = (verdict_of(allres[v][kind], L, gs) == "PASS" for v in ("v1", "v2"))
                lv = allres["v2"][kind]["levels"][L]  # v2 factors ship everywhere (owner/lead 2026-10-29)
                fac["factor"][disp] = lv["factor"].get(gs)
                fac["k"][disp] = lv["k"].get(gs)
                # tested = passed the pre-registered v1 read; provisional = passed only the post-hoc v2 re-test
                fac["verdict"][disp] = "tested" if p1 else "provisional" if p2 else "descriptive"
                fac["verdict_from"][disp] = "v1" if p1 else "v2" if p2 else None
            factors["levels"].setdefault(L, {})[kind] = fac
        factors["aa_method"][kind] = allres["v2"][kind]["aa_method"]
        ship = ship.reset_index()
        keep = list(GATE_STAT[kind])
        for season, sub in ship.groupby("season"):
            recs = []
            for r in sub.itertuples():
                rec = {"id": r.id, "level": r.level}
                for k in keep:
                    v = getattr(r, k)
                    rec[k] = None if not np.isfinite(v) else round(float(100 * v if k in PCT else v), 1 if k in PCT else 2 if k in ("fip", "hr9") else 3)
                recs.append(rec)
            (OUT / f"{kind}-{season}.json").write_text(json.dumps({"season": int(season), "rows": recs}, separators=(",", ":")))
    factors["park_aaa"] = allres["park_aaa"]
    factors["seasons"] = sorted(int(p.stem.split("-")[1]) for p in OUT.glob("hitters-*.json"))
    (OUT / "factors.json").write_text(json.dumps(factors, indent=1))
    (PIPE / "results" / "milb_translation.json").write_text(json.dumps(allres, indent=1, default=str))
    print(json.dumps(factors["levels"], indent=1))


def demo():
    p = pd.DataFrame({"h": [100.0, 300.0], "rel_x_lo": [1.0, 1.2], "rel_x_hi": [0.8, 1.0]})
    assert abs(factor(p, "x") - (100 * .8 + 300 * 1.0) / (100 * 1.0 + 300 * 1.2)) < 1e-12
    assert abs(mle(1.5, 100, 0.9, 100, 0.2) - 0.9 * 1.25 * 0.2) < 1e-12  # half-way to the level mean
    assert mle(1.5, 100, 1.0, 0, 0.2) == 1.5 * 0.2
    print("demo ok")


if __name__ == "__main__":
    demo() if "--demo" in sys.argv else main()
