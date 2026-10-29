"""prospect_model.py — §97 prospect model v0: empirical-Bayes performance + Pipeline/draft prior,
leave-one-list-year-out backtest on the 2011–19 Pipeline lists. Research, not a ship.

    python pipeline/prospect_model.py --fetch   # MiLB 2010-19 + MLB 2011-25 lines -> data/milb/hist_*.parquet
    python pipeline/prospect_model.py           # backtest -> pipeline/results/prospect_97.json

Public data only (Pipeline lists, MLB Stats API). B-Ref WAR is never read.
"""
import argparse
import json
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

import milb_lines

warnings.filterwarnings("ignore")
ROOT = Path(__file__).resolve().parents[1]
MILB = ROOT / "data" / "milb"
OUT = ROOT / "pipeline" / "results" / "prospect_97.json"
LIST_YEARS = range(2011, 2020)
LEVEL_ORD = {"ROK": 0, "A-": 1, "A": 2, "A+": 3, "AA": 4, "AAA": 5}
HIT_STATS = ["k", "bb", "iso", "babip", "sb"]
PIT_STATS = ["k", "bb", "hr", "gb"]


def fetch() -> None:
    milb_lines.LEVELS[15] = "A-"  # short-season A existed through 2020
    for group, name in (("hitting", "hitters"), ("pitching", "pitchers")):
        rows = []
        for season in range(2010, 2020):
            for sid in (11, 12, 13, 14, 15, 16):
                got = milb_lines.fetch(group, season, sid)
                assert len(got) < 10000, "limit hit"
                rows += got
                print(name, season, sid, len(got), flush=True)
        pd.DataFrame(rows).to_parquet(MILB / f"hist_{name}.parquet", compression="zstd")
        rows = []
        for season in range(2011, 2026):
            rows += milb_lines.fetch(group, season, 1)
        pd.DataFrame(rows).to_parquet(MILB / f"hist_mlb_{name}.parquet", compression="zstd")


# ------------------------------------------------------------------ population + outcomes
def population() -> pd.DataFrame:
    lists = json.loads((MILB / "prospects.json").read_text())
    rows = []
    for y in LIST_YEARS:
        L = lists[str(y)]
        top = {r["id"]: r["rank"] for r in L.get("top100", [])}
        for key, recs in L.items():
            if not key.startswith("team:"):
                continue
            for r in recs:
                rows.append({"id": r["id"], "name": r["name"], "year": y, "org": key[5:], "org_rank": r["rank"],
                             "org_len": len(recs), "pos": r["pos"], "top_rank": top.get(r["id"])})
        # top-100 players missing from every org list (rare): keep with org rank NaN
        have = {r["id"] for r in rows if r["year"] == y}
        for r in L.get("top100", []):
            if r["id"] not in have:
                rows.append({"id": r["id"], "name": r["name"], "year": y, "org": "unk", "org_rank": np.nan,
                             "org_len": np.nan, "pos": r["pos"], "top_rank": r["rank"]})
    df = pd.DataFrame(rows).drop_duplicates(["id", "year"])
    df["pitcher"] = df.pos.isin(["RHP", "LHP", "P"])
    ppl = pd.read_parquet(MILB / "people.parquet").set_index("id")
    df["birth"] = pd.to_datetime(df.id.map(ppl.birth), errors="coerce")
    df["debut"] = pd.to_datetime(df.id.map(ppl.debut), errors="coerce")
    df["age"] = (pd.to_datetime(df.year.astype(str) + "-07-01") - df.birth).dt.days / 365.25
    # draft: earliest signed pick in 2011+ data, else any pick
    picks = {}
    for ps in json.loads((MILB / "draft.json").read_text()).values():
        for p in ps:
            if p.get("id"):
                cur = picks.get(p["id"])
                if cur is None or p["year"] > cur["year"]:  # latest draft = the one he signed (bonus is 2017+ only)
                    picks[p["id"]] = p
    df["pick"] = df.id.map(lambda i: picks[i]["pick"] if i in picks and picks[i]["year"] <= 2019 else np.nan)
    df.loc[df.id.map(lambda i: picks.get(i, {}).get("year", 0)) > df.year, "pick"] = np.nan  # drafted after list
    # Y1
    df["y1"] = (df.debut.notna() & (df.debut.dt.year <= df.year + 4)).astype(int)
    # Y2 playing time
    mh = pd.read_parquet(MILB / "hist_mlb_hitters.parquet")
    mp = pd.read_parquet(MILB / "hist_mlb_pitchers.parquet")
    pa = mh.groupby(["mlbam_id", "season"]).PA.sum()
    bf = mp.groupby(["mlbam_id", "season"]).BF.sum()

    def window(s, pid, y):
        try:
            x = s.loc[pid]
        except KeyError:
            return 0.0
        return float(x[(x.index >= y) & (x.index <= y + 4)].sum())
    df["y2"] = [window(bf, i, y) / 700 if p else window(pa, i, y) / 600
                for i, y, p in zip(df.id, df.year, df.pitcher)]
    # Y3 §85 WAR 2020-26 (reported only)
    war = json.loads((ROOT / "data" / "export" / "web" / "war_index.json").read_text())["seasons"]
    tot = {}
    for s in war.values():
        for grp in ("hitters", "pitchers"):
            for r in s.get(grp, []):
                tot[int(r["id"])] = tot.get(int(r["id"]), 0) + (r.get("war") or 0)
    df["y3"] = df.id.map(lambda i: tot.get(i, 0.0))
    df["b0"] = np.where(df.top_rank.notna(), df.top_rank, 100 + 30 * (df.org_rank.fillna(30) - 1) + 15)
    return df.reset_index(drop=True)


# ------------------------------------------------------------------ EB performance features
def eb_features(lines: pd.DataFrame, pitcher: bool) -> pd.DataFrame:
    """Per player-season: level×season z-scores shrunk by n/(n+k), weighted across levels."""
    d = lines.copy()
    d = d[d.level.isin(LEVEL_ORD)]
    if pitcher:
        d["n"] = d.BF
        d = d[d.n > 0]
        num = {"k": d.SO, "bb": d.BB + d.HBP, "hr": d.HR, "gb": d.GO}
        den = {"k": d.n, "bb": d.n, "hr": d.n, "gb": d.GO + d.AO}
        stats = PIT_STATS
    else:
        d["n"] = d.PA
        d = d[d.n > 0]
        one_b = d.H - d["2B"] - d["3B"] - d.HR
        num = {"k": d.SO, "bb": d.BB + d.HBP, "iso": d["2B"] + 2 * d["3B"] + 3 * d.HR,
               "babip": d.H - d.HR, "sb": d.SB + d.CS}
        den = {"k": d.n, "bb": d.n, "iso": d.AB, "babip": d.AB - d.SO - d.HR + d.SF,
               "sb": one_b + d.BB + d.HBP}
        stats = HIT_STATS
    d["birth"] = pd.to_datetime(d.birth_date, errors="coerce")
    d["age"] = (pd.to_datetime(d.season.astype(str) + "-07-01") - d.birth).dt.days / 365.25
    grp = [d.season, d.level]
    lvl_age = (d.age * d.n).groupby(grp).transform("sum") / d.n.groupby(grp).transform("sum")
    d["age_rel"] = d.age - lvl_age
    for s in stats:
        x, m = num[s].astype(float), den[s].clip(lower=0).astype(float)
        r = (x / m.replace(0, np.nan))
        # level-season mean and variances, method of moments on players with m >= 100
        g = pd.DataFrame({"r": r, "m": m, "season": d.season, "level": d.level})
        big = g[g.m >= 100]
        mu = (big.r * big.m).groupby([big.season, big.level]).sum() / big.m.groupby([big.season, big.level]).sum()
        tot_var = big.groupby(["season", "level"]).r.var()
        p = mu.reindex(pd.MultiIndex.from_arrays([g.season, g.level])).values
        binom_var = (p * (1 - p) / big.m.groupby([big.season, big.level]).mean()
                     .reindex(pd.MultiIndex.from_arrays([g.season, g.level])).values)
        tv = tot_var.reindex(pd.MultiIndex.from_arrays([g.season, g.level])).values
        between = np.clip(tv - binom_var, 1e-6, None)
        k = p * (1 - p) / between                          # within/between variance ratio, in PA units
        z = (g.r.values - p) / np.sqrt(between)
        w = m.values / (m.values + k)
        d[f"z_{s}"] = np.nan_to_num(z * w)                 # shrunk z; no denominator -> 0
    d["lvl"] = d.level.map(LEVEL_ORD)
    zc = [f"z_{s}" for s in stats]
    d["w"] = d.n
    agg = d.groupby(["mlbam_id", "season"]).apply(lambda x: pd.Series({
        **{c: np.average(x[c], weights=x.w) for c in zc},
        "age_rel": np.average(x.age_rel.fillna(0), weights=x.w * (x.lvl == x.lvl.max())),
        "lvl": x.lvl.max(), "logn": np.log1p(x.n.sum())}))
    return agg


def features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["has_top"] = df.top_rank.notna().astype(float)
    df["log_top"] = np.log(df.top_rank.fillna(150))
    df["org_frac"] = (df.org_rank / df.org_len).fillna(0)
    df["org_len_f"] = df.org_len.fillna(30) / 30
    df["drafted"] = df.pick.notna().astype(float)
    df["log_pick"] = np.log(df.pick.fillna(400))
    df["age_c"] = df.age.fillna(df.age.median()) - 21
    df["yrs_since"] = 0.0
    for kind, pit in (("hitters", False), ("pitchers", True)):
        lines = pd.read_parquet(MILB / f"hist_{kind}.parquet")
        eb = eb_features(lines, pit)
        idx = pd.MultiIndex.from_arrays([df.id, df.year - 1])
        sub = eb.reindex(idx)
        sub.index = df.index
        mask = df.pitcher == pit
        for c in sub.columns:
            name = c if c in ("age_rel", "lvl", "logn") else f"{'p' if pit else 'h'}{c}"
            df.loc[mask, name] = sub.loc[mask, c]
    df["has_line"] = df.logn.notna().astype(float)
    for c in [c for c in df.columns if c.startswith(("hz_", "pz_"))] + ["age_rel", "lvl", "logn"]:
        df[c] = df[c].fillna(0.0)
    return df


PRIOR = ["has_top", "log_top", "org_frac", "org_len_f", "drafted", "log_pick", "age_c"]
PERF_H = [f"hz_{s}" for s in HIT_STATS] + ["age_rel", "lvl", "logn", "has_line"]
PERF_P = [f"pz_{s}" for s in PIT_STATS] + ["age_rel", "lvl", "logn", "has_line"]


# ------------------------------------------------------------------ models
def fit_predict(tr, te, cols, groups):
    import statsmodels.api as sm
    from statsmodels.genmod.bayes_mixed_glm import BinomialBayesMixedGLM
    mu, sd = tr[cols].mean(), tr[cols].std().replace(0, 1)
    Xtr = sm.add_constant((tr[cols] - mu) / sd)
    Xte = sm.add_constant((te[cols] - mu) / sd, has_constant="add")
    if groups:
        vc = {g: f"0 + C({g})" for g in groups}
        m = BinomialBayesMixedGLM.from_formula("y1 ~ " + " + ".join(f"Q('{c}')" for c in cols), vc,
                                               tr.assign(**((tr[cols] - mu) / sd)))
        r = m.fit_vb()
        beta = r.fe_mean
        p1 = 1 / (1 + np.exp(-(Xte.values @ beta)))
    else:
        r = sm.GLM(tr.y1, Xtr, family=sm.families.Binomial()).fit_regularized(alpha=1e-3, L1_wt=0)
        p1 = r.predict(Xte)
    reach = tr[tr.y1 == 1]
    g = sm.OLS(np.log1p(reach.y2), sm.add_constant((reach[cols] - mu) / sd)).fit_regularized(alpha=1e-3, L1_wt=0)
    v = np.expm1(np.asarray(g.predict(Xte)))
    return np.asarray(p1), np.asarray(p1) * np.clip(v, 0, None)


def backtest(df):
    out = []
    for y in LIST_YEARS:
        te = df[df.year == y]
        tr = df[(df.year != y) & ~df.id.isin(te.id)]
        for pit, perf in ((False, PERF_H), (True, PERF_P)):
            a, b = tr[tr.pitcher == pit], te[te.pitcher == pit].copy()
            b["b1_p"], b["b1_ev"] = fit_predict(a, b, PRIOR, None)
            b["m_p"], b["m_ev"] = fit_predict(a, b, PRIOR + perf, ["org", "yr"])
            # exploratory (not pre-registered): proximity only, no rate stats
            b["n_p"], b["n_ev"] = fit_predict(a, b, PRIOR + perf[-4:], ["org", "yr"])
            out.append(b)
    return pd.concat(out)


def clustered_boot(df, fn, n=1000, seed=97):
    rng = np.random.default_rng(seed)
    ids = df.id.unique()
    by = {i: g for i, g in df.groupby("id").groups.items()}
    vals = []
    for _ in range(n):
        pick = rng.choice(ids, len(ids))
        idx = np.concatenate([by[i] for i in pick])
        vals.append(fn(df.loc[idx]))
    return np.percentile(vals, [2.5, 97.5]).tolist()


def score(o):
    from scipy.stats import spearmanr
    from sklearn.metrics import roc_auc_score
    o = o.reset_index(drop=True)
    res = {}

    def auc(d, c):
        return roc_auc_score(d.y1, d[c]) if d.y1.nunique() == 2 else np.nan

    def sp(d, c):
        return spearmanr(d[c], d.y2).statistic
    o["b0_s"] = -o.b0
    for name, sub in (("all", o), ("hitters", o[~o.pitcher]), ("pitchers", o[o.pitcher]),
                      ("top100", o[o.top_rank.notna()]), ("org_only", o[o.top_rank.isna()])):
        res[name] = {"n": len(sub), "y1_rate": round(sub.y1.mean(), 3),
                     **{f"auc_{c}": round(auc(sub, c), 4) for c in ("b0_s", "b1_p", "m_p")},
                     **{f"sp_{c}": round(sp(sub, c), 4) for c in ("b0_s", "b1_ev", "m_ev")}}
    res["d_auc"] = round(auc(o, "m_p") - auc(o, "b1_p"), 4)
    res["d_auc_ci"] = clustered_boot(o, lambda d: auc(d, "m_p") - auc(d, "b1_p"))
    res["d_sp"] = round(sp(o, "m_ev") - sp(o, "b1_ev"), 4)
    res["d_sp_ci"] = clustered_boot(o, lambda d: sp(d, "m_ev") - sp(d, "b1_ev"))
    res["per_year"] = {int(y): {"d_auc": round(auc(g, "m_p") - auc(g, "b1_p"), 4),
                                "d_sp": round(sp(g, "m_ev") - sp(g, "b1_ev"), 4)} for y, g in o.groupby("year")}
    res["years_won_auc"] = sum(v["d_auc"] > 0 for v in res["per_year"].values())
    res["years_won_sp"] = sum(v["d_sp"] > 0 for v in res["per_year"].values())
    y3 = o[o.year >= 2015]
    res["y3_spearman"] = {c: round(spearmanr(y3[c], y3.y3).statistic, 4) for c in ("b0_s", "b1_ev", "m_ev")}
    # (b) sleepers
    o["pct_m"] = o.groupby("year").m_ev.rank(pct=True) * 100
    o["pct_b0"] = o.groupby("year").b0_s.rank(pct=True) * 100
    o["gap"] = o.pct_m - o.pct_b0
    o["dec"] = o.groupby("year").b0_s.transform(lambda s: pd.qcut(s.rank(method="first"), 10, labels=False))

    def lift(d, flag):
        sel = d[flag(d)]
        peers = d[d.gap.abs() < 25].groupby(["year", "dec"]).y1.mean()
        exp = peers.reindex(pd.MultiIndex.from_arrays([sel.year, sel.dec])).values
        return float(np.nanmean(sel.y1.values - exp))
    for name, flag in (("sleepers", lambda d: d.gap >= 25), ("fallers", lambda d: d.gap <= -25)):
        sel = o[flag(o)]
        res[name] = {"n": len(sel), "players": int(sel.id.nunique()), "y1_rate": round(sel.y1.mean(), 3),
                     "lift_pp": round(100 * lift(o, flag), 2),
                     "lift_ci_pp": [round(100 * x, 2) for x in clustered_boot(o, lambda d: lift(d, flag))],
                     "mean_fse": round(sel.y2.mean(), 3)}
    # ---- exploratory, after the pre-registered read
    ex = {"auc_noRates": round(auc(o, "n_p"), 4), "sp_noRates": round(sp(o, "n_ev"), 4),
          "d_auc_rates": round(auc(o, "m_p") - auc(o, "n_p"), 4),
          "d_auc_rates_ci": clustered_boot(o, lambda d: auc(d, "m_p") - auc(d, "n_p"), n=300),
          "d_sp_rates": round(sp(o, "m_ev") - sp(o, "n_ev"), 4),
          "d_sp_rates_ci": clustered_boot(o, lambda d: sp(d, "m_ev") - sp(d, "n_ev"), n=300)}
    o["pct_b1"] = o.groupby("year").b1_ev.rank(pct=True) * 100
    o["gap1"] = o.pct_m - o.pct_b1
    o["dec1"] = o.groupby("year").b1_ev.transform(lambda s: pd.qcut(s.rank(method="first"), 10, labels=False))
    for col in ("y1", "y2", "y3"):
        def lift1(d, col=col):
            dd = d[d.year >= 2015] if col == "y3" else d
            sel = dd[dd.gap1 >= 15]
            peers = dd[dd.gap1.abs() < 15].groupby(["year", "dec1"])[col].mean()
            return float(np.nanmean(sel[col].values - peers.reindex(pd.MultiIndex.from_arrays([sel.year, sel.dec1])).values))
        ex[f"sleeper_vs_b1_{col}"] = {"n": int((o.gap1 >= 15).sum()), "lift": round(lift1(o), 3),
                                      "ci": [round(x, 3) for x in clustered_boot(o, lift1, n=300)]}
    # Y3 lift for the pre-registered sleepers (vs B0 peers), 2015-19 lists
    d3 = o[o.year >= 2015]
    sel = d3[d3.gap >= 25]
    pe = d3[d3.gap.abs() < 25].groupby(["year", "dec"]).y3.mean()
    ex["sleeper_vs_b0_y3_war"] = round(float(np.nanmean(sel.y3.values - pe.reindex(pd.MultiIndex.from_arrays([sel.year, sel.dec])).values)), 3)
    sel = o[o.gap >= 25]
    pe = o[o.gap.abs() < 25].groupby(["year", "dec"]).y2.mean()
    ex["sleeper_vs_b0_y2_fse"] = round(float(np.nanmean(sel.y2.values - pe.reindex(pd.MultiIndex.from_arrays([sel.year, sel.dec])).values)), 3)
    ex["sleeper_profile"] = {c: round(float(o.loc[o.gap >= 25, c].mean() - o.loc[o.gap.abs() < 25, c].mean()), 3)
                             for c in ("age", "lvl", "age_rel", "has_top", "org_frac")}
    o["mdec"] = pd.qcut(o.m_p.rank(method="first"), 10, labels=False)
    ex["calibration"] = o.groupby("mdec").agg(p=("m_p", "mean"), obs=("y1", "mean")).round(3).values.tolist()
    res["exploratory"] = ex
    top = o[o.gap >= 25].sort_values("gap", ascending=False)
    res["sleeper_examples"] = top[["name", "year", "org", "b0", "gap", "y1", "y2"]].head(25).round(2).to_dict("records")
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fetch", action="store_true")
    args = ap.parse_args()
    if args.fetch:
        return fetch()
    df = features(population())
    df["yr"] = df.year.astype(str)
    audit = {"rows": len(df), "players": int(df.id.nunique()), "pitcher_share": round(df.pitcher.mean(), 3),
             "has_line": round(df.has_line.mean(), 3), "drafted_2011plus": round(df.drafted.mean(), 3),
             "age_missing": int(df.age.isna().sum()),
             "by_year": df.groupby("year").agg(n=("id", "size"), y1=("y1", "mean"), line=("has_line", "mean"),
                                               pick=("drafted", "mean")).round(3).to_dict("index")}
    print(json.dumps(audit, indent=1, default=float))
    o = backtest(df)
    res = {"audit": audit, **score(o)}
    OUT.write_text(json.dumps(res, indent=1, default=float))
    print(json.dumps({k: v for k, v in res.items() if k not in ("audit", "sleeper_examples")},
                     indent=1, default=float))


if __name__ == "__main__":
    main()
