"""Component-adjusted wOBA vs one 0.45 run-scale park factor: MLB confirmation on Retrosheet pre-2015 seasons.

Pre-registration and results: pipeline/PREREG-component-wrc.md. College dev source (method + decision rule):
vt_baseball research/park-dimensions PLAN-P1-data-layer.md section 2 and RESULTS-P1.md.

The information used here was obtained free of charge from and is copyrighted by Retrosheet. Interested parties may
contact Retrosheet at 20 Sunset Rd., Newark, DE 19711.

Modes:
  extract [SEASONS...]   Retrosheet {season}csvs.zip -> cache/retrosheet/{pa,games}_{season}.parquet (counts only)
  selftest               synthetic league: EB, clip, arms, decision rule
  dev                    every read on the dev block (2001-07); freezes SCALE -> results/component_wrc_dev.json
  sealed                 the one read on the sealed block (2008-14); refuses to run twice or with a changed script
"""
import hashlib
import json
import sys
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
CACHE = Path.home() / "Projects/goat-pro/cache/retrosheet"     # main checkout's gitignored cache (shared by worktrees)
RES = ROOT / "pipeline/results"
DEV = list(range(2001, 2008))
SEALED = list(range(2008, 2015))
W = {"BB": .69, "HBP": .72, "1B": .88, "2B": 1.24, "3B": 1.56, "HR": 1.95}
COMP = ["1B", "2B", "3B", "HR"]
SITE_KEEP = 0.45          # site recipe: PF_used = 1 + 0.45 (pooled run ratio - 1)
MIN_GAMES = 8             # site recipe: team-season needs 8+ home and 8+ road games
CLIP = (0.5, 2.0)         # college P1 handling fix: component multiplier clipped
REPS, SEED = 1000, 1


# ---------------------------------------------------------------- data
def extract(seasons):
    """Slim per-season tables. PA rows: regular season, pa == 1. Nothing but row counts is printed."""
    cols = ["gid", "site", "batteam", "vis_home", "batter", "pa", "single", "double", "triple", "hr", "sh", "hbp",
            "walk", "iw", "k", "xi", "gametype"]
    for s in seasons:
        z = zipfile.ZipFile(CACHE / "raw" / f"{s}csvs.zip")
        p = pd.read_csv(z.open(f"{s}plays.csv"), usecols=cols, dtype={"site": str, "batter": str}, low_memory=False)
        p = p[(p.gametype == "regular") & (p.pa == 1)]
        ev = np.select([p.iw == 1, p.walk == 1, p.hbp == 1, p.k == 1, p.single == 1, p.double == 1, p.triple == 1,
                        p.hr == 1, (p.sh == 1) | (p.xi == 1)],
                       ["IBB", "BB", "HBP", "K", "1B", "2B", "3B", "HR", "SHXI"], "out")
        pa = pd.DataFrame({"gid": p.gid, "season": s, "site": p.site, "home": p.vis_home.astype(int),
                           "batter": p.batter, "ev": ev})
        g = pd.read_csv(z.open(f"{s}gameinfo.csv"), usecols=["gid", "visteam", "hometeam", "site", "gametype",
                                                              "vruns", "hruns"], dtype={"site": str})
        g = g[g.gametype == "regular"]
        npa = pa.groupby("gid").size().rename("pa")
        g = g.join(npa, on="gid").dropna(subset=["pa"])
        games = pd.DataFrame({"gid": g.gid, "season": s, "home": g.hometeam, "away": g.visteam, "stadium": g.site,
                              "r": g.vruns + g.hruns, "rh": g.hruns, "rv": g.vruns, "pa": g.pa.astype(int)})
        pa = pa.merge(games[["gid", "home", "away"]].rename(columns={"home": "hometeam", "away": "visteam"}), on="gid")
        pa.to_parquet(CACHE / f"pa_{s}.parquet", compression="zstd", index=False)
        games.to_parquet(CACHE / f"games_{s}.parquet", compression="zstd", index=False)
        print(s, "PA rows", len(pa), "games", len(games), "sites", games.stadium.nunique())


def load(seasons):
    pa = pd.concat([pd.read_parquet(CACHE / f"pa_{s}.parquet") for s in seasons], ignore_index=True)
    games = pd.concat([pd.read_parquet(CACHE / f"games_{s}.parquet") for s in seasons], ignore_index=True)
    return pa, games


# ---------------------------------------------------------------- park factors (seasons other than the read's)
def cells(games, pa):
    """Per park: home-game and road-game totals (runs, PA, BIP, 1B/2B/3B/HR), site recipe structure keyed by park.
    A team-season's home park = its modal stadium; neutral-site 'home' games count as road (site recipe)."""
    c = pa.assign(bip=~pa.ev.isin(["BB", "IBB", "HBP", "K", "SHXI"]))
    per_game = pd.crosstab(c.gid, c.ev).reindex(columns=COMP, fill_value=0).join(c.groupby("gid").bip.sum())
    g = games.join(per_game, on="gid")
    modal = g.groupby(["season", "home"]).stadium.agg(lambda s: s.mode().iat[0]).rename("modal")
    g = g.join(modal, on=["season", "home"])
    at = g.stadium == g.modal
    rows = pd.concat([g[at].assign(team=g.home, side="h"), g.assign(team=g.away, side="a"),
                      g[~at].assign(team=g.home, side="a")])
    rows["park"] = rows.join(modal.rename("park"), on=["season", "team"]).park
    vals = ["r", "pa", "bip"] + COMP
    t = rows.groupby(["season", "team", "park", "side"])[vals].sum().join(
        rows.groupby(["season", "team", "park", "side"]).size().rename("n")).unstack("side").dropna()
    t = t[(t[("n", "h")] >= MIN_GAMES) & (t[("n", "a")] >= MIN_GAMES)]
    return t.groupby(level="park").sum()


def eb_log_ratio(nh, bh, na, ba):
    """Results-only EB: y = log home/road rate ratio, v = 1/nh + 1/na (Poisson), shrunk toward 0 with tau2 by
    moments across parks. Returns (shrunk y, w, tau2)."""
    y = np.log((nh / bh) / (na / ba))
    v = 1 / nh + 1 / na
    tau2 = max(0.0, float(np.mean(y ** 2 - v)))
    w = tau2 / (tau2 + v)
    return w * y, w, tau2


def factors(games, pa):
    t = cells(games, pa)
    ratio = (t[("r", "h")] / t[("pa", "h")]) / (t[("r", "a")] / t[("pa", "a")])
    out = pd.DataFrame({"pf_a": 1 + SITE_KEEP * (ratio - 1)})
    meta = {}
    for k in COMP:
        th, w, tau2 = eb_log_ratio(t[(k, "h")], t[("bip", "h")], t[(k, "a")], t[("bip", "a")])
        out[f"m_{k}"] = np.exp(th)
        meta[k] = {"tau2": tau2, "median_w": float(np.median(w)), "sd_raw_log": float(np.log(
            (t[(k, "h")] / t[("bip", "h")]) / (t[(k, "a")] / t[("bip", "a")])).std())}
    meta["parks"] = len(out)
    return out, meta


# ---------------------------------------------------------------- arms per PA
def arms(p, F, shift):
    """raw wOBA weight; (a) w - shift (PF_a - 1); (c) hit weight / clip(m_k). PAs at parks with no cell: factor 1."""
    p = p[~p.ev.isin(["IBB", "SHXI"])].copy()
    p["w"] = p.ev.map(W).fillna(0.0)
    p["bip"] = ~p.ev.isin(["BB", "HBP", "K"])
    f = F.reindex(p.site)
    p["a"] = p.w - shift * (f.pf_a.fillna(1.0).to_numpy() - 1)
    c = p.w.to_numpy().copy(); clips = {}
    for k in COMP:
        m = (p.ev == k).to_numpy()
        mk = f[f"m_{k}"].fillna(1.0).to_numpy()[m]
        clips[k] = int(((mk < CLIP[0]) | (mk > CLIP[1])).sum())
        c[m] = c[m] / np.clip(mk, *CLIP)
    p["c"] = c
    return p, clips


def agg(p, by):
    return p.groupby(by).agg(pa=("w", "size"), nbip=("bip", "sum"), raw=("w", "mean"), a=("a", "mean"),
                             c=("c", "mean"))


def corr_multi(df, preds, tgt, cl, reps=REPS, seed=SEED):
    """r(pred, target) per arm; differences, hitter-cluster bootstrap (college corr_multi)."""
    gi = df.groupby(cl).indices; keys = np.array(list(gi)); rng = np.random.default_rng(seed)
    Y = df[tgt].to_numpy(); X = {k: df[v].to_numpy() for k, v in preds.items()}
    base = {k: float(np.corrcoef(x, Y)[0, 1]) for k, x in X.items()}
    bs = []
    for _ in range(reps):
        ix = np.concatenate([gi[k] for k in rng.choice(keys, len(keys))])
        bs.append({k: np.corrcoef(x[ix], Y[ix])[0, 1] for k, x in X.items()})
    bs = pd.DataFrame(bs)
    out = {"n": len(df), "hitters": len(keys), "r": base}
    for a_, b_ in [("raw", "a"), ("raw", "c"), ("a", "c")]:
        d = bs[b_] - bs[a_]
        out[f"{b_}-{a_}"] = [base[b_] - base[a_], float(d.quantile(.025)), float(d.quantile(.975)), float(d.std())]
    return out


def decide(H1, H2):
    """College PLAN-P1 section 2 rule with arms (a) and (c) only."""
    elig = {k: all(H[f"{k}-raw"][1] > -.01 for H in (H1, H2)) for k in ("a", "c")}
    d1, d2 = H1["c-a"], H2["c-a"]
    rep = bool(elig["c"] and d1[0] > 0 and d2[0] > 0 and (d1[1] > 0 or d2[1] > 0) and not (d1[2] < 0 or d2[2] < 0))
    return {"eligible_a": elig["a"], "eligible_c": elig["c"], "c_replaces_a": rep, "choice": "c" if rep else "a",
            "verdict": "PASS (component confirmed on MLB)" if rep else "FAIL (keep one run-scale PF)",
            "mde80_c_minus_a": {"H1": 2.8 * d1[3], "H2": 2.8 * d2[3]}}


def lg_rpa(games):
    s = games.groupby("season")[["r", "pa"]].sum()
    return (s.r / s.pa).to_dict()


def fit_scale(pa, games):
    """wOBA scale for the fixed weights: 1 / slope of team-season R/PA on team-season wOBA (dev block only)."""
    p = pa[~pa.ev.isin(["IBB", "SHXI"])].assign(w=lambda d: d.ev.map(W).fillna(0.0))
    p["team"] = np.where(p.home == 1, p.hometeam, p.visteam)
    wo = p.groupby(["season", "team"]).w.mean()
    r = pd.concat([games.groupby(["season", "home"]).rh.sum().rename_axis(["season", "team"]),
                   games.groupby(["season", "away"]).rv.sum().rename_axis(["season", "team"])]).groupby(level=[0, 1]).sum()
    pall = pa.assign(team=np.where(pa.home == 1, pa.hometeam, pa.visteam)).groupby(["season", "team"]).size()
    j = pd.DataFrame({"wo": wo, "rpa": r / pall}).dropna()
    slope = np.polyfit(j.wo, j.rpa, 1)[0]
    return float(1 / slope), len(j)


# ---------------------------------------------------------------- the read
def read(seasons, scale):
    pa, games = load(seasons)
    lg = lg_rpa(games)
    out = {"seasons": seasons, "scale": scale, "lg_rpa": lg, "pa_rows": len(pa), "clips": {k: 0 for k in COMP}}
    cache = {}

    def fx(excl):
        key = tuple(sorted(excl))
        if key not in cache:
            keep = [s for s in seasons if s not in excl]
            cache[key] = factors(games[games.season.isin(keep)], pa[pa.season.isin(keep)])
        return cache[key]

    h1 = []
    for s in seasons:
        F, meta = fx({s})
        out.setdefault("factor_meta", {})[f"H1_{s}"] = meta
        p, clips = arms(pa[pa.season == s], F, scale * lg[s])
        for k in COMP:
            out["clips"][k] += clips[k]
        g = agg(p, ["batter", "home"])
        j = g.xs(1, level="home").join(g.xs(0, level="home"), lsuffix="_h", rsuffix="_r", how="inner")
        j = j[(j.pa_h + j.pa_r >= 100) & (j.nbip_h >= 30) & (j.nbip_r >= 30)]
        h1.append(j.reset_index().assign(season=s))
        if s == seasons[-1]:           # size of the park term in wRC+ points, last season, hitters 100+ PA
            a_ = agg(p, "batter"); a_ = a_[a_.pa >= 100]
            u = 100 / (scale * lg[s])
            out["park_term_sd_wrc_points"] = {k: float(((a_.raw - a_[k]) * u).std()) for k in ("a", "c")}
            out["park_term_r_a_c"] = float((a_.raw - a_.a).corr(a_.raw - a_.c))
            out["F_last"] = F.round(4).reset_index().to_dict("records")
    h1 = pd.concat(h1, ignore_index=True)
    out["H1"] = corr_multi(h1, {"raw": "raw_h", "a": "a_h", "c": "c_h"}, "raw_r", "batter")
    h2 = []
    for s in seasons[:-1]:
        F, _ = fx({s, s + 1})
        p, _ = arms(pa[pa.season == s], F, scale * lg[s])
        al = agg(p, "batter"); al = al[al.pa >= 100]
        t = pa[(pa.season == s + 1) & (pa.home == 0) & ~pa.ev.isin(["IBB", "SHXI"])]
        t = t.assign(w=t.ev.map(W).fillna(0.0), bip=~t.ev.isin(["BB", "HBP", "K"])).groupby("batter").agg(
            raw_t=("w", "mean"), pa_t=("w", "size"), nbip_t=("bip", "sum"))
        t = t[(t.pa_t >= 30) & (t.nbip_t >= 30)]
        h2.append(al.join(t, how="inner").reset_index().assign(season=s))
    h2 = pd.concat(h2, ignore_index=True)
    out["H2"] = corr_multi(h2, {"raw": "raw", "a": "a", "c": "c"}, "raw_t", "batter")
    out["decision"] = decide(out["H1"], out["H2"])
    return out


# ---------------------------------------------------------------- modes
def selftest():
    # EB: tau2 = 0 when every park is the same -> no shrink beyond 0
    th, w, tau2 = eb_log_ratio(np.full(30, 400.), np.full(30, 1e4), np.full(30, 400.), np.full(30, 1e4))
    assert tau2 == 0 and np.allclose(th, 0)
    # synthetic league: 10 teams, park HR effect, each team plays 81 home / 81 road games
    rng = np.random.default_rng(0)
    teams = [f"T{i}" for i in range(10)]; hr_eff = np.linspace(.6, 1.6, 10)
    pa_rows, game_rows, gid = [], [], 0
    for s in (1, 2, 3):
        for hi, h in enumerate(teams):
            for _ in range(18):
                v = teams[(hi + 1 + _ % 9) % 10]; gid += 1
                for side, bt in ((1, h), (0, v)):
                    for b in range(9):
                        for _pa in range(4):
                            u = rng.random()
                            ev = "HR" if u < .03 * hr_eff[hi] else ("BB" if u < .12 else ("K" if u < .32 else (
                                "1B" if u < .47 else "out")))
                            pa_rows.append((f"g{gid}", s, f"P{hi}", side, f"{bt}b{b}", ev, h, v))
                game_rows.append((f"g{gid}", s, h, v, f"P{hi}", 8, 4, 4, 72))
    pa = pd.DataFrame(pa_rows, columns=["gid", "season", "site", "home", "batter", "ev", "hometeam", "visteam"])
    games = pd.DataFrame(game_rows, columns=["gid", "season", "home", "away", "stadium", "r", "rh", "rv", "pa"])
    F, meta = factors(games[games.season != 3], pa[pa.season != 3])
    m = F["m_HR"].reindex([f"P{i}" for i in range(10)]).to_numpy()
    assert np.corrcoef(m, hr_eff)[0, 1] > .8, m              # recovers the HR park effect
    assert meta["HR"]["tau2"] > 0 and meta["1B"]["median_w"] < .5   # 1B has no park effect -> mostly shrunk
    assert np.allclose(F.pf_a, 1.0)                          # runs constant per game -> run PF 1
    p, clips = arms(pa[pa.season == 3], F, 0.15)
    hr = p[p.ev == "HR"]
    assert np.all(hr.c.between(W["HR"] / 2, W["HR"] * 2)) and np.allclose(p.a, p.w)
    # clip: a factor of 10 is clipped to 2
    F2 = F.copy(); F2["m_HR"] = 10.0
    p2, clips2 = arms(pa[pa.season == 3], F2, 0.15)
    assert clips2["HR"] == (pa[pa.season == 3].ev == "HR").sum() and np.allclose(p2[p2.ev == "HR"].c, W["HR"] / 2)
    # decision rule
    good = {"a-raw": [.001, -.002, .004, 0], "c-raw": [.01, .004, .016, 0], "c-a": [.009, .003, .015, .003]}
    weak = {"a-raw": [.001, -.002, .004, 0], "c-raw": [.003, -.003, .009, 0], "c-a": [.002, -.004, .008, .003]}
    assert decide(good, weak)["c_replaces_a"] and not decide(weak, weak)["c_replaces_a"]
    bad = dict(weak, **{"c-a": [.002, -.004, .008, .003], "c-raw": [-.02, -.03, -.011, 0]})
    assert not decide(good, bad)["eligible_c"]
    # bootstrap returns sane intervals on the synthetic read
    df = pd.DataFrame({"batter": np.repeat(np.arange(200), 2), "raw": rng.normal(size=400)})
    df["a"] = df.raw; df["c"] = df.raw + rng.normal(0, .1, 400); df["y"] = df.raw + rng.normal(size=400)
    r = corr_multi(df, {"raw": "raw", "a": "a", "c": "c"}, "y", "batter", reps=100)
    assert r["a-raw"][0] == 0 and r["c-a"][1] < r["c-a"][0] < r["c-a"][2]
    print("selftest ok")


def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def dev():
    pa, games = load(DEV)
    scale, n = fit_scale(pa, games)
    print(f"SCALE {scale:.4f} from {n} team-seasons (dev block)")
    out = read(DEV, scale)
    out["scale_team_seasons"] = n
    (RES / "component_wrc_dev.json").write_text(json.dumps(out, indent=1, default=float))
    show(out)


def sealed():
    marker = RES / "component_wrc_SEALED.json"
    if marker.exists():
        sys.exit("sealed block already read: " + str(marker))
    pre = (ROOT / "pipeline/PREREG-component-wrc.md").read_text()
    if sha(__file__) not in pre:
        sys.exit("script sha256 not recorded in PREREG-component-wrc.md (changed after the freeze?)")
    scale = json.loads((RES / "component_wrc_dev.json").read_text())["scale"]
    marker.write_text(json.dumps({"status": "opening", "script_sha256": sha(__file__)}))
    out = read(SEALED, scale)
    out["script_sha256"] = sha(__file__)
    marker.write_text(json.dumps(out, indent=1, default=float))
    show(out)


def show(o):
    for H in ("H1", "H2"):
        h = o[H]
        print(H, "n", h["n"], "hitters", h["hitters"], "r", {k: round(v, 4) for k, v in h["r"].items()})
        for k in ("a-raw", "c-raw", "c-a"):
            print(f"   {k}: {h[k][0]:+.4f} [{h[k][1]:+.4f}, {h[k][2]:+.4f}] se {h[k][3]:.4f}")
    print("clips", o["clips"], "park term SD (wRC+ pts)", o["park_term_sd_wrc_points"], "r(a,c)",
          round(o["park_term_r_a_c"], 3))
    print(json.dumps(o["decision"], indent=1, default=float))


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "--selftest"
    if mode in ("--selftest", "selftest"):
        selftest()
    elif mode == "extract":
        extract([int(x) for x in sys.argv[2:]] or DEV + SEALED)
    elif mode == "dev":
        dev()
    elif mode == "sealed":
        sealed()
    else:
        sys.exit(__doc__)
