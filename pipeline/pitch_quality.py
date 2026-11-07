"""Pitch Quality (PQ), 20-80 per pitch type, MLB + AAA. Pre-registration: pipeline/PREREG-pitch-quality.md.

    nice -n 10 python pitch_quality.py fit     # cross-fit the §78 xRV design on MLB, score MLB + AAA -> cache/pq_pitches.parquet
    python pitch_quality.py read               # gates + unit grades -> results/pitch_quality_gates.json, _units.csv
    python pitch_quality.py --demo             # self-check, no data

Per pitch PQ = 100 x xRV (pitcher-positive) from the xrv_model.py legs, every pitch scored by a fold model that
never saw its pitcher (AAA too). Unit = level x pitcher x season x site type; grade = 50 + 10 z, rounded to 5.
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.model_selection import GroupKFold

import xrv_model as X
from web_export import SC_TO_SITE, SITE_TYPES

PIPE = Path(__file__).resolve().parent
ROOT = PIPE.parent
CACHE = ROOT / "cache" / "pq_pitches.parquet"
GATES = PIPE / "results" / "pitch_quality_gates.json"
UNITS = PIPE / "results" / "pitch_quality_units.csv"
MODELS = {"mlb": ROOT / "data/export/mlb_pitcher_models.json", "aaa": ROOT / "data/export/aaa_pitcher_models.json"}
FEATS = [*X.FEATS, "season"] if "season" not in X.FEATS else X.FEATS
B, SEED, HALF_MIN, PAIR_MIN, SIDE_PAIR_MIN, CAP = 2000, 13, 25, 50, 25, 200


# ---------------------------------------------------------------- fit
def load(con, tbl: str) -> pd.DataFrame:
    sql = X.SQL.replace("SELECT pitcher,", "SELECT game_pk, pitcher, (stand = 'L')::INT AS bat_left,") \
               .replace("FROM pitches_all", f"FROM {tbl}")
    d = con.sql(sql).df()
    d["site"] = d["pitch_type"].map(SC_TO_SITE)
    d = d[d["site"].notna()].reset_index(drop=True)
    for c in ("balls", "strikes", "y", "same", "bat_left"):
        d[c] = d[c].astype("int8")
    for c in FEATS:
        if d[c].dtype == "float64":
            d[c] = d[c].astype("float32")
    return d


def fit():
    sys.path.insert(0, str(X.MART_DIR))
    import mart
    con = mart.connect()
    mlb, aaa = load(con, "pitches_all"), load(con, "pitches_aaa")
    print(f"{len(mlb):,} MLB, {len(aaa):,} AAA pitches", flush=True)
    folds = np.empty(len(mlb), int)
    for k, (_, te) in enumerate(GroupKFold(5).split(mlb, groups=mlb["pitcher"])):
        folds[te] = k
    of = pd.Series(folds).groupby(mlb["pitcher"].to_numpy()).first()
    afold = aaa["pitcher"].map(of).fillna(aaa["pitcher"] % 5).astype(int).to_numpy()
    rng = np.random.default_rng(SEED)
    pq = {"mlb": np.zeros(len(mlb)), "aaa": np.zeros(len(aaa))}
    import lightgbm as lgb
    for k in range(5):
        trm = folds != k
        tr = np.flatnonzero(trm)
        bv = X.bip_value(mlb, trm)
        fit_ix = tr if len(tr) <= X.FIT_CAP else rng.choice(tr, X.FIT_CAP, replace=False)
        m = lgb.train(X.P_CLS, lgb.Dataset(mlb.iloc[fit_ix][FEATS], mlb.iloc[fit_ix]["y"]), X.ROUNDS_CLS)
        b = tr[mlb["y"].to_numpy()[tr] == X.BIP]
        mc = lgb.train(X.P_BIP, lgb.Dataset(mlb.iloc[b][FEATS], bv[b]), X.ROUNDS_BIP)
        t = mlb.iloc[tr]
        tab = t.groupby(["balls", "strikes", "y"])["rv"].mean().unstack().reindex(columns=range(6))
        for lvl, d, te in (("mlb", mlb, np.flatnonzero(~trm)), ("aaa", aaa, np.flatnonzero(afold == k))):
            q = d.iloc[te]
            idx = pd.MultiIndex.from_arrays([q["balls"], q["strikes"]])
            pq[lvl][te] = 100 * X.combine(m.predict(q[FEATS]), tab.reindex(idx).fillna(0).to_numpy(), mc.predict(q[FEATS]))
        print(f"fold {k + 1}/5", flush=True)
    out = []
    for lvl, d in (("mlb", mlb), ("aaa", aaa)):
        allm = np.ones(len(d), bool)
        obs = np.where(d["y"] == X.BIP, X.bip_value(d, allm), d["rv"])  # target: RV with BIP valued by xwOBA, per level
        out.append(pd.DataFrame({"level": lvl, "pitcher": d["pitcher"].astype("int32"), "season": d["season"].astype("int16"),
                                 "site": d["site"], "game_pk": d["game_pk"].astype("int32"), "same": d["same"],
                                 "bat_left": d["bat_left"], "pq": pq[lvl].astype("float32"),
                                 "obs": (100 * obs).astype("float32")}))
    pd.concat(out, ignore_index=True).to_parquet(CACHE)
    print(f"wrote {CACHE}", flush=True)


# ---------------------------------------------------------------- statistics
def sb_count(r_half: float, n_half: float, target: float) -> float | None:
    """Spearman-Brown: pitches at which the unit mean reaches reliability `target`, from a split-half r at n_half."""
    if not np.isfinite(r_half) or r_half <= 0:
        return None
    return float(n_half * target * (1 - r_half) / (r_half * (1 - target)))


def zs(x: pd.Series, by) -> pd.Series:
    g = x.groupby(by)
    return (x - g.transform("mean")) / g.transform("std")


def wcorr(x, y, w):
    """Weighted Pearson r; w is (draws, n) bootstrap weights -> (draws,)."""
    sw = w.sum(1)
    mx, my = (w * x).sum(1) / sw, (w * y).sum(1) / sw
    dx, dy = x - mx[:, None], y - my[:, None]
    return (w * dx * dy).sum(1) / np.sqrt((w * dx * dx).sum(1) * (w * dy * dy).sum(1))


def boot_w(pids: np.ndarray, seed: int = SEED) -> np.ndarray:
    """Pitcher-cluster bootstrap weights (B, n): each row weighted by how often its pitcher is drawn."""
    u, inv = np.unique(pids, return_inverse=True)
    c = np.random.default_rng(seed).multinomial(len(u), np.full(len(u), 1 / len(u)), size=B)
    return c[:, inv].astype(float)


def ci(v):
    return [round(float(np.percentile(v, 2.5)), 4), round(float(np.percentile(v, 97.5)), 4)]


def holm(ps: dict) -> dict:
    """Holm step-down at .05: {key: reject}."""
    out, m = {}, len(ps)
    for i, (k, p) in enumerate(sorted(ps.items(), key=lambda kv: kv[1])):
        if p > .05 / (m - i):
            break
        out[k] = True
    return {k: out.get(k, False) for k in ps}


def split_half(p: pd.DataFrame, keys) -> dict:
    """Game-half split-half over units (25+ pitches per half), z within season; Spearman-Brown counts."""
    h = ((p["game_pk"].to_numpy().astype(np.uint64) * np.uint64(2654435761) + p["pitcher"].to_numpy().astype(np.uint64))
         >> np.uint64(7)) & np.uint64(1)
    g = p.assign(h=h.astype("int8")).groupby([*keys, "h"])["pq"].agg(["mean", "size"]).unstack("h")
    g = g[(g[("size", 0)] >= HALF_MIN) & (g[("size", 1)] >= HALF_MIN)]
    if len(g) < 30:
        return {"units": int(len(g)), "r": None}
    s = g.index.get_level_values("season")
    a, b = zs(g[("mean", 0)], s), zs(g[("mean", 1)], s)
    r = float(np.corrcoef(a, b)[0, 1])
    nh = float((g[("size", 0)] + g[("size", 1)]).mean() / 2)
    return {"units": int(len(g)), "mean_half": round(nh, 1), "r": round(r, 4),
            **{f"n{int(t * 100)}": (None if (c := sb_count(r, nh, t)) is None else round(c, 1)) for t in (.7, .6, .5)}}


def pairs(u: pd.DataFrame, keys, nmin: int) -> pd.DataFrame:
    """Unit in S joined to the same unit in S+1, both with nmin+ pitches; z within season for x and y."""
    u = u[u["n"] >= nmin]
    nx = u.assign(season=u["season"] - 1)[[*keys, "obs"]].rename(columns={"obs": "y"})
    pr = u.merge(nx, on=keys).reset_index(drop=True)
    pr["zx"], pr["zy"] = zs(pr["pq"], pr["season"]), zs(pr["y"], pr["season"] + 1)
    return pr


def next_r(pr: pd.DataFrame) -> dict:
    if len(pr) < 30:
        return {"units": int(len(pr)), "r": None, "pass": False}
    r = float(np.corrcoef(pr["zx"], pr["zy"])[0, 1])
    c = ci(wcorr(pr["zx"].to_numpy(), pr["zy"].to_numpy(), boot_w(pr["pitcher"].to_numpy())))
    return {"units": int(len(pr)), "pitchers": int(pr["pitcher"].nunique()), "r": round(r, 4), "ci": c, "pass": c[0] > 0}


def adds(pr: pd.DataFrame) -> dict:
    """Rule 4: OOF OLS of next RV on z Whiff+ vs z Whiff+ + z PQ; Δr with a paired pitcher bootstrap."""
    pr = pr[pr["wplus"].notna()].reset_index(drop=True)
    if len(pr) < 50:
        return {"units": int(len(pr)), "dr": None, "p": 1.0}
    pr["zw"] = zs(pr["wplus"], pr["season"])
    y = pr["zy"].to_numpy()
    p1, p2 = np.zeros(len(pr)), np.zeros(len(pr))
    for tr, te in GroupKFold(5).split(pr, groups=pr["pitcher"]):
        for cols, out in ((["zw"], p1), (["zw", "zx"], p2)):
            A = np.c_[np.ones(len(tr)), pr.loc[tr, cols].to_numpy()]
            beta = np.linalg.lstsq(A, y[tr], rcond=None)[0]
            out[te] = np.c_[np.ones(len(te)), pr.loc[te, cols].to_numpy()] @ beta
    w = boot_w(pr["pitcher"].to_numpy())
    d = wcorr(p2, y, w) - wcorr(p1, y, w)
    p = float(min(1.0, 2 * min((d <= 0).mean(), (d >= 0).mean()) + 1 / B))
    r1, r2 = float(np.corrcoef(p1, y)[0, 1]), float(np.corrcoef(p2, y)[0, 1])
    return {"units": int(len(pr)), "r_whiff": round(r1, 4), "r_joint": round(r2, 4), "dr": round(r2 - r1, 4),
            "ci": ci(d), "p": round(p, 4)}


def tier(n: int, rule: dict | None) -> str | None:
    """Display tier for a unit of n pitches under a type/side rule (None: no grade)."""
    if not rule:
        return None
    if rule.get("full") is not None and n >= rule["full"]:
        return "limited" if rule["claim"] == "limited data" else "full"
    if n >= rule["first"]:
        return "limited" if rule["claim"] == "limited data" else "provisional"
    if rule.get("low") is not None and n >= rule["low"]:
        return "low"
    return None


def to2080(x, mean, sd):
    if x is None or not np.isfinite(x) or not np.isfinite(sd) or not sd:  # one-unit season: no scale
        return None
    return int(5 * round(float(np.clip(50 + 10 * (x - mean) / sd, 20, 80)) / 5))


def rule_of(rel: dict) -> dict | None:
    """Rule 1 tiers: full at the r .70 count <= 200, else provisional at the r .60 count <= 200."""
    n70, n60, n50 = rel.get("n70"), rel.get("n60"), rel.get("n50")
    if n70 is not None and n70 <= CAP:
        return {"first": int(np.ceil(n70)), "full": int(np.ceil(n70)), "low": int(np.ceil(n50))}
    if n60 is not None and n60 <= CAP:
        return {"first": int(np.ceil(n60)), "full": int(np.ceil(n70)) if n70 <= 2 * CAP else None, "low": int(np.ceil(n50))}
    return None


# ---------------------------------------------------------------- read
def whiff_by_type(level: str) -> dict:
    d = json.loads(MODELS[level].read_text())["pitchers"]
    return {(int(p["mlbam"]), int(p["season"]), t): e["grade"] for p in d for t, e in (p.get("whiff_by_type") or {}).items()}


def read():
    p = pd.read_parquet(CACHE)
    p["pitcher"], p["season"] = p["pitcher"].astype(int), p["season"].astype(int)
    keys = ["pitcher", "season"]
    gates, unit_frames = {"prereg": "pipeline/PREREG-pitch-quality.md", "levels": {}}, []
    refs = {}
    for lvl in ("mlb", "aaa"):
        P = p[p["level"] == lvl]
        wp = whiff_by_type(lvl)
        units = P.groupby([*keys, "site"]).agg(n=("pq", "size"), pq=("pq", "mean"), obs=("obs", "mean")).reset_index()
        units["wplus"] = [wp.get((a, b, c)) for a, b, c in zip(units["pitcher"], units["season"], units["site"])]
        hand = (P["same"] == P["bat_left"]).groupby([P["pitcher"], P["season"]]).mean() > .5  # throws left
        side = P.groupby([*keys, "site", "same"]).agg(n=("pq", "size"), pq=("pq", "mean"), obs=("obs", "mean")).reset_index()
        L, ps = {}, {}
        for t in SITE_TYPES:
            Pt, ut = P[P["site"] == t], units[units["site"] == t]
            rel = split_half(Pt, keys)
            rule = rule_of(rel) if rel.get("r") is not None else None
            g = {"pitches": int(len(Pt)), "1_reliability": rel, "1_pass": rule is not None}
            if rule:
                at = ut[ut["n"] >= rule["first"]]
                ok = at["wplus"].notna()
                r2 = float(np.corrcoef(at.loc[ok, "pq"], at.loc[ok, "wplus"])[0, 1]) if ok.sum() > 30 else None
                g["2_distinct"] = {"units": int(ok.sum()), "r_whiff": None if r2 is None else round(r2, 4)}
                g["2_pass"] = r2 is not None and r2 < .90
                pr = pairs(ut, [*keys, "site"], PAIR_MIN)
                g["3_next"] = next_r(pr)
                g["4_adds"] = adds(pr)
                if g["2_pass"] and g["3_next"]["pass"] and g["4_adds"]["dr"] is not None:
                    ps[t] = g["4_adds"]["p"]
            L[t] = g
        rej = holm(ps)
        for t, g in L.items():
            g["4_holm_reject"] = bool(rej.get(t, False))
            rule = rule_of(g["1_reliability"]) if g["1_pass"] else None
            if not (rule and g.get("2_pass")):
                g["display"] = None
                continue
            if g["3_next"]["pass"]:
                claim = "adds to Whiff+" if g["4_holm_reject"] and g["4_adds"]["ci"][0] > 0 else "describes"
            else:
                claim = "limited data"
            g["display"] = {**rule, "claim": claim, "tier": "full" if rule["full"] == rule["first"] else "provisional"}
            g["sides"] = {}
            for sh, s in ((1, "same"), (0, "opposite")):
                Ps = P[(P["site"] == t) & (P["same"] == sh)]
                rs = split_half(Ps, keys)
                sr = rule_of(rs) if rs.get("r") is not None else None
                us = side[(side["site"] == t) & (side["same"] == sh)]
                nr = next_r(pairs(us, [*keys, "site", "same"], SIDE_PAIR_MIN))
                g["sides"][s] = {"A1": rs, "A2": nr, "display": ({**sr, "claim": "describes"} if sr and nr["pass"] else None)}
        gates["levels"][lvl] = L

        # unit grades, own scale (level x season x type at the first display count)
        out = []
        for t, g in L.items():
            rule = g.get("display")
            if not rule:
                continue
            ut = units[units["site"] == t].copy()
            ref = ut[ut["n"] >= rule["first"]].groupby("season")["pq"].agg(["mean", "std"])
            refs[(lvl, t)] = ref
            ut["tier"] = [tier(n, rule) for n in ut["n"]]
            ut = ut[ut["tier"].notna()]
            ut["grade"] = [to2080(x, *ref.loc[s]) if s in ref.index else None for x, s in zip(ut["pq"], ut["season"])]
            ut["claim"] = rule["claim"]
            ut["need"] = rule["first"]
            for sh, s in ((1, "same"), (0, "opposite")):
                sr = g["sides"][s]["display"]
                us = side[(side["site"] == t) & (side["same"] == sh)].set_index(keys)
                sref = us[us["n"] >= sr["first"]].groupby("season")["pq"].agg(["mean", "std"]) if sr else None
                vals = []
                for pid, season in zip(ut["pitcher"], ut["season"]):
                    row = us.loc[(pid, season)] if (pid, season) in us.index else None
                    n = int(row["n"]) if row is not None else 0
                    tr = tier(n, sr) if (sr and row is not None) else None
                    gr = to2080(row["pq"], *sref.loc[season]) if (tr and season in sref.index) else None
                    vals.append((n, gr, tr if gr is not None else None))
                ut[f"n_{s}"], ut[f"grade_{s}"], ut[f"tier_{s}"] = zip(*vals) if vals else ([], [], [])
            left = ut.set_index(keys).index.map(hand)
            for k in ("n", "grade", "tier"):  # same/opposite -> vs LHH / vs RHH by the pitcher's hand
                ut[f"{k}_LHH"] = np.where(left, ut[f"{k}_same"], ut[f"{k}_opposite"])
                ut[f"{k}_RHH"] = np.where(left, ut[f"{k}_opposite"], ut[f"{k}_same"])
            ut["level"] = lvl
            out.append(ut)
        unit_frames.append(pd.concat(out) if out else pd.DataFrame())

    # AAA on the MLB scale: same pitcher, same season, the type's display count at both levels
    check = {}
    U = {lvl: f.set_index(["pitcher", "season", "site"]) for lvl, f in zip(("mlb", "aaa"), unit_frames) if len(f)}
    for t in SITE_TYPES:
        ra, rm = gates["levels"]["aaa"][t].get("display"), gates["levels"]["mlb"][t].get("display")
        if not (ra and rm) or "aaa" not in U:
            continue
        fa = U["aaa"].xs(t, level="site")
        fm = U["mlb"].xs(t, level="site")
        fa, fm = fa[fa["n"] >= ra["first"]], fm[fm["n"] >= rm["first"]]
        j = fa[["pq"]].join(fm[["pq"]], rsuffix="_m", how="inner").reset_index()
        if len(j) < 30:
            check[t] = {"pitchers": int(len(j)), "valid": False}
            continue
        sd = np.array([refs[("mlb", t)].loc[s, "std"] for s in j["season"]])
        gap = ((j["pq"] - j["pq_m"]) / sd).to_numpy()
        w = boot_w(j["pitcher"].to_numpy())
        bm = (w * gap).sum(1) / w.sum(1)
        c = ci(bm)
        check[t] = {"pitchers": int(len(j)), "gap_sd": round(float(gap.mean()), 4), "ci": c,
                    "valid": bool(abs(gap.mean()) <= .25 and c[0] >= -.5 and c[1] <= .5)}
    gates["aaa_mlb_scale"] = check
    units = pd.concat([f for f in unit_frames if len(f)], ignore_index=True)
    units["grade_mlb"] = None
    for t, c in check.items():
        if c["valid"]:
            m = (units["level"] == "aaa") & (units["site"] == t) & units["tier"].isin(["full", "provisional", "limited"])
            ref = refs[("mlb", t)]
            units.loc[m, "grade_mlb"] = [to2080(x, *ref.loc[s]) if s in ref.index else None
                                         for x, s in zip(units.loc[m, "pq"], units.loc[m, "season"])]
    GATES.write_text(json.dumps(gates, indent=1, default=float))
    cols = ["level", "pitcher", "season", "site", "n", "pq", "grade", "tier", "claim", "need", "grade_mlb",
            "n_LHH", "grade_LHH", "tier_LHH", "n_RHH", "grade_RHH", "tier_RHH"]
    units[cols].round({"pq": 3}).to_csv(UNITS, index=False)
    print(json.dumps({lvl: {t: (g.get("display") or {}).get("claim") for t, g in L.items()}
                      for lvl, L in gates["levels"].items()}, indent=1))


# ---------------------------------------------------------------- demo
def demo():
    assert abs(sb_count(.5, 100, .5) - 100) < 1e-9 and abs(sb_count(.5, 100, .7) - 233.333) < 1e-3
    assert sb_count(-.1, 100, .7) is None
    r = rule_of({"n70": 150, "n60": 96, "n50": 64.3})
    assert r == {"first": 150, "full": 150, "low": 65}, r
    r = rule_of({"n70": 260, "n60": 167, "n50": 111})
    assert r["first"] == 167 and r["full"] == 260
    assert rule_of({"n70": 500, "n60": 321, "n50": 214}) is None
    r = {**r, "claim": "describes"}
    assert [tier(n, r) for n in (100, 120, 170, 300)] == [None, "low", "provisional", "full"]
    assert tier(170, {**r, "claim": "limited data"}) == "limited"
    assert to2080(1.0, 0.0, 1.0) == 60 and to2080(9, 0, 1) == 80 and to2080(0.26, 0, 1) == 55
    x, y = np.arange(10.0), np.arange(10.0) ** 2
    w = np.ones((2, 10))
    assert np.allclose(wcorr(x, y, w), np.corrcoef(x, y)[0, 1])
    assert holm({"a": .001, "b": .02, "c": .04}) == {"a": True, "b": True, "c": True}
    assert holm({"a": .001, "b": .04, "c": .2}) == {"a": True, "b": False, "c": False}
    rng = np.random.default_rng(1)
    skill = rng.normal(0, 1, 200)  # 200 units, 40 games x 10 pitches, true sd 1, noise sd 5 per pitch
    p = pd.DataFrame([(u, 2025, g, skill[u] + rng.normal(0, 5)) for u in range(200) for g in range(40) for _ in range(10)],
                     columns=["pitcher", "season", "game_pk", "pq"])
    s = split_half(p, ["pitcher", "season"])
    assert .85 < s["r"] < .97 and s["n70"] < 100, s  # theory: r(200 pitches) = 200/(200+25) = .89
    print("demo ok")


if __name__ == "__main__":
    {"fit": fit, "read": read}.get(sys.argv[1] if len(sys.argv) > 1 else "", demo)()
