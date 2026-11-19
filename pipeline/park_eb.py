"""PREREG-park-eb.md: park factor per venue x season x batter hand, results shrunk toward a physics prior (carry + wall)
in one empirical-Bayes (Fay-Herriot) model, forecast = gamma x theta_hat. Public data only (Statcast, Stats API, Savant).

    python park_eb.py demo                 # estimator + physics self-checks, no data
    python park_eb.py savant               # fetch Savant park factors (3-yr rolling, by hand) 2015-2025 -> cache/park_eb/
    python park_eb.py dev WORK             # 2020-26 (spent, development): frame, every read, constants -> results/park_eb_dev.json
    python park_eb.py freeze               # results/park_eb_FROZEN.json: dev constants + sha256 of this file and inputs
    python park_eb.py sealed WORK          # ONCE: 2015-19 sealed bank, the frozen recipe -> results/park_eb_SEALED.json

Frame per batted ball (regular season, no bunts, EV/LA/spray present): A = launch-only out/1B/2B/3B/HR model
(EV, LA, spray, hand; batter/pitcher-fold cross-fit, fit within the era); per-ball park effect = G(actual park) -
G(neutral park, carry removed), G = flight model on (EV, LA, spray, hand, distance, P(clears), wall - landing).
Clearing uses dong.py's drag flight (C_D solved to land at hit_distance_sc in the venue's air) against
data/park_dims.csv + park_offsets.csv. Carry = visiting batters' mean log(distance / D-hat(EV, LA, spray, hand)) per
venue-season, centred per season, shrunk with K. Every model is fit inside one era; no era pooling (AGENTS rule 6).
"""
import hashlib
import json
import os
import sys
import urllib.request
import zlib
from pathlib import Path

os.environ.setdefault("OMP_NUM_THREADS", "3")
import numpy as np
import pandas as pd

PIPE = Path(__file__).resolve().parent
ROOT = PIPE.parent
sys.path.insert(0, str(PIPE))
CACHE = ROOT / "cache" / "park_eb"
RES = PIPE / "results"
SEALED = ROOT / "cache" / "sealed" / "statcast"
DEV_SEASONS, SEALED_SEASONS = list(range(2020, 2027)), list(range(2015, 2020))
W = np.array([0, .88, 1.24, 1.56, 1.95])                    # wOBA weights out/1B/2B/3B/HR (college G4/G5)
YMAP = {"single": 1, "double": 2, "triple": 3, "home_run": 4, "field_out": 0, "force_out": 0, "double_play": 0,
        "grounded_into_double_play": 0, "triple_play": 0, "fielders_choice": 0, "fielders_choice_out": 0,
        "field_error": 0, "sac_fly": 0, "sac_fly_double_play": 0}
PARAMS = dict(objective="multiclass", num_class=5, learning_rate=0.05, num_leaves=63, min_child_samples=200,
              feature_fraction=1.0, bagging_fraction=0.8, bagging_freq=1, num_threads=3, verbose=-1, seed=7)
ROUNDS = 400                                                  # = college explore_fit / G4
FA = ["ev", "la", "spray", "side"]
KGRID = [25, 50, 100, 200, 400, 800]                          # carry K grid (G4)
SIG_FT = 5.0                                                  # clearing softness, ft (G4 tracked sigma)
STATS = {"w": ("w", "res", "e_eff"), "hr": ("hr", "res_hr", "e_hr"), "xbh": ("xbh", "res_xbh", "e_xbh")}
WINDOW = 3                                                    # predictor seasons t-3..t-1 (Savant / §70 window)
N_PRED, N_TARG = 500, 300                                     # venue x hand floors: pooled predictor, target season
N_TOT = 2000                                                  # totals: venue balls over the era
# First season the data/park_dims.csv (2026) configuration holds. dong.CONFIG_FROM (2020-26) plus the pre-2020 changes
# known before any sealed read: loanDepot 2020, Oracle 2020 (bullpens/RCF), Dodger 2020 (renovation; excluded as
# uncertain), Daikin/Minute Maid 2017 (Tal's Hill removed). Venues without dims (Turner, Globe Life Park, Coliseum,
# neutral sites) have no physics and no cell.
VALID_FROM = {2: 2025, 2394: 2023, 14: 2023, 7: 2026, 2529: 2025, 4169: 2020, 2395: 2020, 22: 2020, 2392: 2017}


# ------------------------------------------------------------------ the G5 estimator (frozen in college METHOD-G5)
def fh(r, g, n, s2, iters=50):
    """Fay-Herriot hyperparameters: beta by WLS (1/(tau2 + s2/n)), tau2 by moments (floor 1e-8)."""
    r, g, n = (np.asarray(x, float) for x in (r, g, n))
    beta, tau2 = 0.0, max(np.var(r) - np.mean(s2 / n), 1e-8)
    for _ in range(iters):
        wv = 1 / (tau2 + s2 / n)
        beta = float((wv * g * r).sum() / (wv * g * g).sum()) if np.any(g != 0) else 0.0
        tau2 = max(float(np.mean((r - beta * g) ** 2 - s2 / n)), 1e-8)
    return beta, tau2


def theta(r, g, n, beta, tau2, s2, g_out=None):
    w = n / (n + s2 / tau2)
    return beta * (g if g_out is None else g_out) + w * (r - beta * g)


# ------------------------------------------------------------------ data
def venues_pre2020():
    f = CACHE / "venues_2015_2019.parquet"
    if not f.exists():
        rows = []
        for s in SEALED_SEASONS:
            url = f"https://statsapi.mlb.com/api/v1/schedule?sportId=1&season={s}&gameType=R"
            with urllib.request.urlopen(url, timeout=60) as r:
                for day in json.load(r).get("dates", []):
                    for g in day["games"]:
                        rows.append({"game_pk": g["gamePk"], "season": s, "venue_id": g["venue"]["id"]})
        CACHE.mkdir(parents=True, exist_ok=True)
        pd.DataFrame(rows).drop_duplicates("game_pk").to_parquet(f)
    return pd.read_parquet(f)


SQL = """SELECT {season} season, game_pk, home_team, away_team,
           CASE WHEN inning_topbot = 'Bot' THEN home_team ELSE away_team END bat_team, batter, pitcher, stand,
           launch_speed ev, launch_angle la, hit_distance_sc dist, degrees(atan2(hc_x - 125.42, 198.27 - hc_y)) spray,
           events, bb_type, coalesce(des ILIKE '%bunt%', false) bunt
         FROM {src} WHERE type = 'X' AND game_type = 'R' {where}"""
PA_SQL = """SELECT {season} season, batter, pitcher, count(*) pa FROM {src}
            WHERE game_type = 'R' AND events IS NOT NULL {where} GROUP BY ALL"""
C70_SQL = """SELECT game_pk, {season} season, home_team, away_team, stand, count(*) pa, {cols} FROM {src}
             WHERE game_type = 'R' AND events IS NOT NULL {where} GROUP BY 1, 2, 3, 4, 5"""


def pull(era):
    """-> (balls, pa, §70 counts) for an era. Sealed: the frozen recipe's only read of cache/sealed/statcast."""
    from park_factors import COMP
    cols = ", ".join(f"count(*) FILTER (WHERE events IN {ev}) AS c_{k}" for k, ev in COMP.items())
    if era == "dev":
        from paths import MART_DIR
        sys.path.insert(0, str(MART_DIR))
        import mart
        con = mart.connect(); src, season = "pitches_all", "season"
        where = f"AND season BETWEEN {DEV_SEASONS[0]} AND {DEV_SEASONS[-1]}"
        from park_factors import venues
        ven = venues(DEV_SEASONS)
    else:
        import duckdb
        con = duckdb.connect(); con.execute("set threads=3")
        src = "read_parquet([" + ",".join(f"'{SEALED / f'{s}.parquet'}'" for s in SEALED_SEASONS) + "])"
        season, where = "game_year", ""
        ven = venues_pre2020()
    b = con.sql(SQL.format(season=season, src=src, where=where)).df()
    pa = con.sql(PA_SQL.format(season=season, src=src, where=where)).df()
    c70 = con.sql(C70_SQL.format(season=season, src=src, where=where, cols=cols)).df()
    b = b.merge(ven[["game_pk", "venue_id"]], on="game_pk", how="left")
    c70 = c70.merge(ven[["game_pk", "venue_id"]], on="game_pk")
    y = b.events.map(YMAP)
    keep = y.notna() & ~b.bunt & b[["ev", "la", "spray"]].notna().all(axis=1) & b.stand.isin(["L", "R"]) & b.venue_id.notna()
    b = b[keep].copy(); b["y"] = y[keep].astype(int); b["venue_id"] = b.venue_id.astype(int)
    b["side"] = (b.stand == "L").astype(int)
    crc = lambda s: np.array([zlib.crc32(str(x).encode()) % 4 for x in s])  # noqa: E731
    b["fb"], b["fp"] = crc(b.batter), crc(b.pitcher)
    b["half"] = np.array([zlib.crc32(str(g).encode()) % 2 for g in b.game_pk])
    return b.reset_index(drop=True), pa, c70


# ------------------------------------------------------------------ physics prior
def lgb_fit(X, y, params=PARAMS, rounds=ROUNDS):
    import lightgbm as lgb
    return lgb.train(params, lgb.Dataset(X, y), rounds)


def carry(b, phys, K=None):
    """Cross-fit delta on carry balls; c per ball from visiting balls of other batter folds, centred per season."""
    cb = (b.bb_type.isin(["fly_ball", "line_drive"]) & b.la.between(15, 50) & (b.ev >= 80) & (b.dist > 0)).to_numpy()
    dl = np.full(len(b), np.nan); y = np.log(b.dist.where(cb))
    reg = {k: v for k, v in PARAMS.items() if k != "num_class"} | {"objective": "regression"}
    for k in range(4):
        tr, te = cb & (b.fb != k).to_numpy(), cb & (b.fb == k).to_numpy()
        dl[te] = y[te] - lgb_fit(b.loc[tr, FA], y[tr], reg).predict(b.loc[te, FA])
    vis = cb & (b.bat_team != b.home_team).to_numpy()
    v = b[vis].assign(delta=dl[vis])
    v["delta"] -= v.groupby("season").delta.transform("mean")
    curve = None
    if K is None:                                             # outcome-free K: game halves (G4)
        h = v.groupby(["venue_id", "season", "half"]).delta.agg(["sum", "size"]).unstack("half")
        h = h[(h["size"] >= 20).all(axis=1)]
        curve = {}
        for Kc in KGRID:
            e = sum((h["size"][q] * (h["sum"][q] / h["size"][q] - h["sum"][p] / (h["size"][p] + Kc)) ** 2).sum()
                    for p, q in [(0, 1), (1, 0)])
            curve[Kc] = float(e / (2 * h["size"].to_numpy().sum()))
        K = min(curve, key=curve.get)
    S = v.groupby(["venue_id", "season", "fb"]).delta.agg(["sum", "size"]); T = S.groupby(level=[0, 1]).sum()
    p = b.loc[phys]
    key = pd.MultiIndex.from_arrays([p.venue_id, p.season])
    fs = S.reindex(pd.MultiIndex.from_arrays([p.venue_id, p.season, p.fb]))
    c = (T["sum"].reindex(key).fillna(0).to_numpy() - fs["sum"].fillna(0).to_numpy()) / \
        (T["size"].reindex(key).fillna(0).to_numpy() - fs["size"].fillna(0).to_numpy() + K)
    full = (T["sum"] / (T["size"] + K)).rename("c").reset_index().assign(n=T["size"].to_numpy())
    return c, K, curve, full


def geometry():
    import dong
    meta, knots = dong.parks()
    grid = np.arange(-45, 46)
    RH = np.array([[dong.fence(knots, v, grid)[i] for v in meta.venue_id] for i in (0, 1)])   # 2 x parks x grid
    neu = np.median(RH, axis=1)                                                              # 2 x grid
    return dong, meta, knots, grid, neu


def flights(p, c):
    """Per physics ball: G features at the actual park, the neutral park, and the neutral park with carry removed."""
    from scipy.special import ndtr
    dong, meta, knots, grid, neu = geometry()
    elev = dict(zip(meta.venue_id, meta.elev)) | dong.OTHER_ELEV
    s = np.exp(-np.nan_to_num(c))
    out = {k: np.zeros(len(p)) for k in ["pi_a", "m_a", "pi_n", "m_n", "pi_c", "m_c"]}
    for st in range(0, len(p), 50_000):
        q = p.iloc[st:st + 50_000]; ss = s[st:st + 50_000]; sl = slice(st, st + len(q))
        sp = q.spray.to_numpy(); v, la, d = q.ev.to_numpy() * 1.4667, q.la.to_numpy(), q.dist.to_numpy()
        ro = dong.rho(q.venue_id.map(elev).fillna(0).to_numpy())
        Ra, Ha = np.empty(len(q)), np.empty(len(q))
        for vid, ix in q.groupby("venue_id").indices.items():
            Ra[ix], Ha[ix] = dong.fence(knots, vid, sp[ix])
        Rn, Hn = np.interp(sp, grid, neu[0]), np.interp(sp, grid, neu[1])
        cd = dong.fit_cd(v, la, d, ro)
        _, h = dong.simulate(v, la, cd * ro, dong.CL * ro, np.column_stack([Ra, Rn, Rn / ss]))
        for k, j, H, m in [("a", 0, Ha, Ra - d), ("n", 1, Hn, Rn - d), ("c", 2, Hn, Rn - ss * d)]:
            out[f"pi_{k}"][sl] = np.where(np.isfinite(h[:, j]), ndtr((h[:, j] - H) / SIG_FT), 0.0)
            out[f"m_{k}"][sl] = m
        print(f"  flights {st + len(q):,}/{len(p):,}", flush=True)
    base = p[FA].reset_index(drop=True)
    X = {k: base.assign(dist=p.dist.to_numpy() * (s if k == "c" else 1), pi=out[f"pi_{k}"], m=out[f"m_{k}"])
         for k in "anc"}
    return X


def frame(b, K=None):
    """A OOF, carry, G OOF, per-ball effects (eff/hr/xbh; wall and carry parts). Valid venue-seasons only get physics."""
    A = np.full((len(b), 5), np.nan)
    for k in range(4):
        tr, te = ((b.fb != k) & (b.fp != k)).to_numpy(), (b.fb == k).to_numpy()
        A[te] = lgb_fit(b.loc[tr, FA], b.y[tr]).predict(b.loc[te, FA])
    print("A done", flush=True)
    import dong
    dims = set(dong.parks()[0].venue_id)
    b["valid"] = b.venue_id.isin(dims) & (b.season >= b.venue_id.map(VALID_FROM).fillna(0))
    phys = (b.valid & b.bb_type.isin(["fly_ball", "line_drive", "popup"]) & (b.dist >= 250) & (b.la >= 10)
            & b.spray.between(-45, 45)).to_numpy()
    c, K, curve, full = carry(b, phys, K)
    print("carry K", K, flush=True)
    p = b[phys].reset_index(drop=True)
    X = flights(p, c)
    P = {k: np.full((len(p), 5), np.nan) for k in "anc"}
    for k in range(4):
        tr, te = ((p.fb != k) & (p.fp != k)).to_numpy(), (p.fb == k).to_numpy()
        m = lgb_fit(X["a"][tr], p.y[tr])
        for nm in "anc":
            P[nm][te] = m.predict(X[nm][te])
        print("G fold", k, flush=True)
    y = b.y.to_numpy()
    f = b[["season", "game_pk", "venue_id", "home_team", "bat_team", "batter", "pitcher", "side", "half", "valid", "y"]].copy()
    f["w"], f["hr"], f["xbh"] = W[y], (y == 4).astype(float), (y >= 2).astype(float)
    f["res"], f["res_hr"], f["res_xbh"] = f.w - A @ W, f.hr - A[:, 4], f.xbh - A[:, 2:].sum(1)
    f["A_HR"], f["A_w"], f["A_w2"] = A[:, 4], A @ W, A @ W ** 2
    for col in ["res", "res_hr", "res_xbh"]:                   # centred per season (era/ball shifts are not park)
        f[col] -= f.groupby("season")[col].transform("mean")
    ix = np.flatnonzero(phys)
    for part, (a, z) in {"": ("a", "c"), "w": ("a", "n"), "c": ("n", "c")}.items():
        dd = P[a] - P[z]
        for nm, val in [("eff", dd @ W), ("hr", dd[:, 4]), ("xbh", dd[:, 2:].sum(1))]:
            f[f"e_{nm}{part}"] = 0.0; f.loc[ix, f"e_{nm}{part}"] = val   # e_: never shadow the outcome columns
    f["c"] = np.nan; f.loc[ix, "c"] = c
    return f, {"K": K, "K_curve": curve, "balls": len(f), "phys_rows": int(phys.sum()),
               "valid_share": float(b.valid.mean())}, full


# ------------------------------------------------------------------ reads
def cells(f, keys):
    agg = {f"S_{st}": (res, "sum") for st, (_, res, _) in STATS.items()}
    agg |= {f"G_{st}": (ep, "sum") for st, (_, _, ep) in STATS.items()}
    return f.groupby(keys).agg(n=("y", "size"), **agg)


def s2_within(f):
    out = {}
    for st, (_, res, _) in STATS.items():
        for h in (0, 1):
            q = f[f.side == h]; m = q.groupby(["venue_id", "season"])[res].transform("mean")
            out[(st, h)] = float(((q[res] - m) ** 2).sum() / (len(q) - q.groupby(["venue_id", "season"]).ngroups))
    return out


def fit_hyper(c, s2):
    return {(st, h): fh((q := c.xs(h, level="side"))[f"S_{st}"] / q.n, q[f"G_{st}"] / q.n, q.n, s2[(st, h)])
            for st in STATS for h in (0, 1)}


def wrmse(y, p, w):
    return float(np.sqrt((w * (y - p) ** 2).sum() / w.sum()))


def boot(pr, y, preds, comps, wt, reps=2000, seed=13):
    gi = pr.groupby("venue_id").indices; keys = np.array(list(gi)); rng = np.random.default_rng(seed)
    bs = {k: [] for k in comps}
    for _ in range(reps):
        ix = np.concatenate([gi[v] for v in rng.choice(keys, len(keys))])
        for k, (a, z) in comps.items():
            bs[k].append(wrmse(y[ix], preds[a][ix], wt[ix]) - wrmse(y[ix], preds[z][ix], wt[ix]))
    return {k: [wrmse(y, preds[a], wt) - wrmse(y, preds[z], wt), float(np.percentile(bs[k], 2.5)),
                float(np.percentile(bs[k], 97.5))] for k, (a, z) in comps.items()}


def savant_pf(years):
    rows = []
    for y in years:
        for h in "LR":
            f = CACHE / f"savant_pf_{y}_{h}.json"
            if f.exists():
                rows += [dict(r, hand=h) for r in json.loads(f.read_text())]
    d = pd.DataFrame(rows)
    if d.empty:
        return d
    d = d.assign(year=d.key_year.astype(int), venue_id=d.venue_id.astype(int), side=(d.hand == "L").astype(int))
    for k in ["index_wobacon", "index_xwobacon", "index_hr"]:
        d[k] = pd.to_numeric(d[k], errors="coerce")
    return d.set_index(["venue_id", "year", "side"])


def eb70(c70, seasons):
    """§70 recipe (park_factors.ratios + shrink) per window, mapped to venue x hand: HR log ratio and a 1B/2B/3B/HR
    wOBA-weighted composite. Returns {(window end, 'eb'|'raw'): frame(venue_id, side -> x_hr, x_w)}."""
    from park_factors import ratios, shrink
    out = {}
    wk = {"1B": .88, "2B": 1.24, "3B": 1.56, "HR": 1.95}
    for s in seasons:
        for kind, win in [("eb", range(s - WINDOW + 1, s + 1)), ("raw", [s])]:
            g = c70[c70.season.isin(win)]
            if g.empty:
                continue
            r = ratios(g, win)
            if r.empty:
                continue
            if kind == "eb" and not (r.home_pa >= 2000).any():   # §70 floor: no venue-window big enough for tau2
                continue
            r = shrink(r) if kind == "eb" else r.assign(eb=r.lr)
            r = r.sort_values("home_pa").drop_duplicates(["venue_id", "stand", "comp"], keep="last")
            lg = {k: g[f"c_{k}"].sum() / g.pa.sum() for k in wk}
            pv = r.pivot_table(index=["venue_id", "stand"], columns="comp", values="eb")
            x_w = np.log(sum(wk[k] * lg[k] * np.exp(pv[k].fillna(0)) for k in wk) / sum(wk[k] * lg[k] for k in wk))
            o = pd.DataFrame({"x_hr": pv["HR"], "x_w": x_w}).reset_index()
            o["side"] = (o.stand == "L").astype(int)
            out[(s, kind)] = o.set_index(["venue_id", "side"])[["x_hr", "x_w"]]
    return out


def forecast_rows(f, s2, seasons, sav, e70):
    """Cells (venue x hand x target t) with every arm's raw predictor (before its slope) and both targets."""
    fv = f[f.valid]
    c = cells(fv, ["venue_id", "season", "side"])
    rows = []
    for t in seasons:
        win = [s for s in range(t - WINDOW, t) if s in set(fv.season)]
        if not win:
            continue
        cw = c[c.index.get_level_values("season").isin(win)].groupby(level=["venue_id", "side"]).sum()
        cw = cw[cw.n >= N_PRED]
        tg = c.xs(t, level="season")
        tg = tg[tg.n >= N_TARG]
        j = cw.join(tg[["n"] + [f"S_{st}" for st in STATS]], rsuffix="_t", how="inner")
        if j.empty:
            continue
        hyp = fit_hyper(cw, s2)                                  # predictor seasons only
        q = pd.DataFrame(index=j.index).reset_index().assign(t=t, n=j.n.to_numpy(), nt=j.n_t.to_numpy())
        side = q.side.to_numpy()
        for st in STATS:
            r, g, n = (j[f"S_{st}"] / j.n).to_numpy(), (j[f"G_{st}"] / j.n).to_numpy(), j.n.to_numpy()
            bt = np.array([hyp[(st, h)][0] for h in side]); ta = np.array([hyp[(st, h)][1] for h in side])
            ss = np.array([s2[(st, h)] for h in side])
            q[f"y_{st}"] = (j[f"S_{st}_t"] / j.n_t).to_numpy()
            q[f"x_g5_{st}"] = theta(r, g, n, bt, ta, ss)
            t0 = np.array([fh(r[side == h], 0 * r[side == h], n[side == h], s2[(st, h)])[1] for h in side])
            q[f"x_eb0_{st}"] = theta(r, 0 * g, n, 0.0, t0, ss)
            q[f"x_prior_{st}"] = bt * g
            # diagnostic: the same FH without the hand split (both hands pooled per venue)
            pb = cw.groupby(level="venue_id")[["n", f"S_{st}", f"G_{st}"]].sum()
            sb = (s2[(st, 0)] + s2[(st, 1)]) / 2
            rb, gb = pb[f"S_{st}"] / pb.n, pb[f"G_{st}"] / pb.n
            q[f"x_g5b_{st}"] = theta(rb, gb, pb.n, *fh(rb, gb, pb.n, sb), sb).reindex(q.venue_id).to_numpy()
        key = pd.MultiIndex.from_arrays([q.venue_id, np.full(len(q), t - 1), q.side])
        if not sav.empty:
            sv = sav.reindex(key)
            q["x_sav_w"] = (sv.index_wobacon / 100 - 1).to_numpy()
            q["x_sav_wx"] = ((sv.index_wobacon - sv.index_xwobacon) / 100).to_numpy()
            q["x_sav_hr"] = (sv.index_hr / 100 - 1).to_numpy()
        k70 = pd.MultiIndex.from_arrays([q.venue_id, q.side])
        for kind in ["eb", "raw"]:
            e = e70.get((t - 1, kind))
            q[f"x_70{kind}_w"] = np.nan if e is None else e.reindex(k70).x_w.to_numpy()
            q[f"x_70{kind}_hr"] = np.nan if e is None else e.reindex(k70).x_hr.to_numpy()
        tt = e70.get((t, "raw"))                                 # T1: the conventional raw home/road ratio in t
        q["T1_w"] = np.nan if tt is None else tt.reindex(k70).x_w.to_numpy()
        q["T1_hr"] = np.nan if tt is None else tt.reindex(k70).x_hr.to_numpy()
        rows.append(q)
    return pd.concat(rows, ignore_index=True)


ARMS = {"w": ["g5", "eb0", "prior", "g5b", "sav_w", "sav_wx", "70eb", "70raw"],
        "hr": ["g5", "eb0", "prior", "g5b", "sav_hr", "70eb", "70raw"]}


def arm_x(pr, arm, st):
    col = f"x_{arm}" if arm.startswith("sav") else f"x_{arm}_{st}"
    return pr[col].fillna(0.0).to_numpy()


def slopes(pr):
    """Each arm's n_t-weighted no-intercept slope onto each target (T2 = launch-frame residual, T1 = home/road)."""
    out = {}
    for st in ["w", "hr"]:
        for tgt in ["T2", "T1"]:
            y = pr[f"y_{st}" if tgt == "T2" else f"T1_{st}"].to_numpy(); ok = np.isfinite(y)
            wt = pr.nt.to_numpy(float)
            for arm in ARMS[st]:
                x = arm_x(pr, arm, st)
                out[f"{tgt}:{st}:{arm}"] = float((wt[ok] * x[ok] * y[ok]).sum() / (wt[ok] * x[ok] ** 2).sum())
    return out


def score(pr, sl):
    """RMSE and gains of every arm (times its frozen slope) vs zero, per target; venue-clustered bootstrap."""
    out = {"cells": len(pr), "venues": int(pr.venue_id.nunique()), "targets": sorted(pr.t.unique().tolist()),
           "target_balls": int(pr.nt.sum()), "savant_missing": {}}
    for st in ["w", "hr"]:
        sav = "sav_w" if st == "w" else "sav_hr"
        for tgt in ["T2", "T1"]:
            y = pr[f"y_{st}" if tgt == "T2" else f"T1_{st}"].to_numpy(); ok = np.isfinite(y)
            q, wt = pr[ok].reset_index(drop=True), pr.nt.to_numpy(float)[ok]
            preds = {"zero": 0 * y[ok]} | {a: sl[f"{tgt}:{st}:{a}"] * arm_x(q, a, st) for a in ARMS[st]}
            yy = y[ok]
            out[f"{tgt}:{st}:rmse"] = {k: wrmse(yy, p, wt) for k, p in preds.items()}
            out[f"{tgt}:{st}:r"] = {k: float(np.corrcoef(p, yy)[0, 1]) for k, p in preds.items() if k != "zero"}
            comps = {"zero-g5": ("zero", "g5"), "savant-g5": (sl.get(f"choice:{st}", sav), "g5"), "70eb-g5": ("70eb", "g5"),
                     "eb0-g5": ("eb0", "g5"), "prior-g5": ("prior", "g5"), "70raw-g5": ("70raw", "g5"),
                     "zero-savant": ("zero", sl.get(f"choice:{st}", sav)), "zero-70eb": ("zero", "70eb"),
                     "g5nohand-g5": ("g5b", "g5")}
            out[f"{tgt}:{st}:gain"] = boot(q, yy, preds, comps, wt)
            out["savant_missing"][f"{tgt}:{st}"] = int(q[f"x_{sl.get(f'choice:{st}', sav)}"].isna().sum())
    return out


def totals(f, s2):
    """Game-half cross-fit within season: theta_hat from the other half; z SD across venues (N_TOT+ balls)."""
    fv = f[f.valid].copy()
    add = {f"{a}_{st}": np.zeros(len(fv)) for a in ("g5", "prior", "eb0") for st in ("w", "hr")}
    for hf in (0, 1):
        c = cells(fv[fv.half != hf], ["venue_id", "season", "side"]); hyp = fit_hyper(c, s2)
        m = (fv.half == hf).to_numpy(); key = pd.MultiIndex.from_frame(fv.loc[m, ["venue_id", "season", "side"]])
        for st in ("w", "hr"):
            for h in (0, 1):
                q = c.xs(h, level="side", drop_level=False)
                r, g, n = q[f"S_{st}"] / q.n, q[f"G_{st}"] / q.n, q.n
                beta, tau2 = hyp[(st, h)]
                v = {"g5": theta(r, g, n, beta, tau2, s2[(st, h)]), "prior": beta * g,
                     "eb0": theta(r, 0 * g, n, 0.0, fh(r, 0 * g, n, s2[(st, h)])[1], s2[(st, h)])}
                sel = np.flatnonzero(m)[(fv.loc[m, "side"] == h).to_numpy()]
                for a, ser in v.items():
                    add[f"{a}_{st}"][sel] = np.nan_to_num(ser.reindex(key[(fv.loc[m, "side"] == h).to_numpy()]).to_numpy())
    out = {}
    for st, e0, var in [("hr", fv.A_HR, fv.A_HR * (1 - fv.A_HR)), ("w", fv.A_w, fv.A_w2 - fv.A_w ** 2)]:
        y = fv[STATS[st][0]]
        T = {}
        for nm in ["A", "g5", "prior", "eb0"]:
            e = e0 if nm == "A" else e0 + add[f"{nm}_{st}"]
            g = pd.DataFrame({"v_": fv.venue_id, "y": y, "e": e, "var": var}).groupby("v_").sum()
            n = fv.groupby("venue_id").size()
            g = g[n.reindex(g.index) >= N_TOT]; T[nm] = (g.y - g.e) / np.sqrt(g["var"])
        rng = np.random.default_rng(13); J = pd.DataFrame(T).to_numpy()
        res = {}
        for j, nm in enumerate(["g5", "prior", "eb0"], start=1):
            bs = [(lambda q: q[:, j].std(ddof=1) - q[:, 0].std(ddof=1))(J[rng.integers(0, len(J), len(J))]) for _ in range(2000)]
            res[f"{nm}-A"] = [float(J[:, j].std(ddof=1) - J[:, 0].std(ddof=1)), float(np.percentile(bs, 2.5)),
                              float(np.percentile(bs, 97.5)), float(J[:, 0].std(ddof=1)), float(J[:, j].std(ddof=1)), len(J)]
        out[st] = res
    return out


def player_adj(f, s2, hyp, key):
    """Each ball's venue-season-hand theta_hat with the player's own balls left out (G5)."""
    fv = f[f.valid]
    c = cells(fv, ["venue_id", "season", "side"])
    k4 = [key, "venue_id", "season", "side"]
    pc = fv.groupby(k4).agg(ni=("y", "size"), **{f"Si_{st}": (STATS[st][1], "sum") for st in STATS},
                            **{f"Gi_{st}": (STATS[st][2], "sum") for st in STATS}).reset_index()
    pc = pc.join(c, on=["venue_id", "season", "side"])
    for st in STATS:
        bt, ta = pc.side.map({h: hyp[(st, h)][0] for h in (0, 1)}), pc.side.map({h: hyp[(st, h)][1] for h in (0, 1)})
        n = pc.n - pc.ni
        r, g = (pc[f"S_{st}"] - pc[f"Si_{st}"]) / n.where(n > 0), (pc[f"G_{st}"] - pc[f"Gi_{st}"]) / n.where(n > 0)
        pc[f"adj_{st}"] = theta(r, g, n, bt, ta, pc.side.map({h: s2[(st, h)] for h in (0, 1)})).fillna(0.0)
    j = f[k4].merge(pc[k4 + [f"adj_{st}" for st in STATS]], on=k4, how="left").fillna(0.0)   # invalid venues: 0
    return j.set_index(f.index)


def corr_boot(df, xa, xr, yc, cl, reps=1000, seed=1):
    gi = df.groupby(cl).indices; keys = np.array(list(gi)); rng = np.random.default_rng(seed); out = []
    X1, X0, Y = df[xa].to_numpy(), df[xr].to_numpy(), df[yc].to_numpy()
    for _ in range(reps):
        ix = np.concatenate([gi[k] for k in rng.choice(keys, len(keys))])
        out.append(np.corrcoef(X1[ix], Y[ix])[0, 1] - np.corrcoef(X0[ix], Y[ix])[0, 1])
    r1, r0 = np.corrcoef(X1, Y)[0, 1], np.corrcoef(X0, Y)[0, 1]
    return {"n": len(df), "r_raw": float(r0), "r_adj": float(r1),
            "diff": [float(r1 - r0), float(np.percentile(out, 2.5)), float(np.percentile(out, 97.5))]}


def skill(f, s2, hyp, pa, key, team, min_bip=30, min_pa=100):
    adj = player_adj(f, s2, hyp, key)
    d = f.assign(home=(f.home_team == f[team]).astype(int),
                 **{f"{STATS[st][0]}_adj": f[STATS[st][0]] - adj[f"adj_{st}"] for st in STATS})
    pas = pa.groupby([key, "season"]).pa.sum().rename("pa")
    cols = [c for st in STATS for c in (STATS[st][0], STATS[st][0] + "_adj")]
    g = d.groupby([key, "season", "home"])[cols].mean().join(d.groupby([key, "season", "home"]).size().rename("n"))
    hm, rd = g.xs(1, level="home"), g.xs(0, level="home")
    al = d.groupby([key, "season"])[cols].mean().join(pas)
    j = hm.join(rd, lsuffix="_h", rsuffix="_r", how="inner").join(pas)
    j = j[(j.n_h >= min_bip) & (j.n_r >= min_bip) & (j.pa >= min_pa)].reset_index()
    rd1 = rd[rd.n >= min_bip].join(pas); rd1 = rd1[rd1.pa >= min_pa].reset_index()
    al = al[al.pa >= min_pa].reset_index()
    nx = al.assign(season=al.season + 1).merge(rd1, on=[key, "season"], suffixes=("_s", "_t"))
    out = {"home_road_n": len(j), "next_n": len(nx)}
    for st in STATS:
        m = STATS[st][0]
        out[f"{st}:home_road"] = corr_boot(j, f"{m}_adj_h", f"{m}_h", f"{m}_r", key)
        out[f"{st}:next_road"] = corr_boot(nx, f"{m}_adj_s", f"{m}_s", f"{m}_t", key)
    return out, d


def movers(d, pa, min_bip=30, min_pa=100):
    """Pitchers whose home venue changed s -> s+1: r(home_s, home_s+1) both adjusted vs both raw. Stayers beside."""
    h = d[d.home == 1]
    pas = pa.groupby(["pitcher", "season"]).pa.sum().rename("pa")
    cols = [c for st in STATS for c in (STATS[st][0], STATS[st][0] + "_adj")]
    g = h.groupby(["pitcher", "season"])[cols].mean().join(h.groupby(["pitcher", "season"]).agg(
        n=("y", "size"), hp=("venue_id", lambda s: s.mode().iat[0]))).join(pas)
    g = g[(g.n >= min_bip) & (g.pa >= min_pa)].reset_index()
    j = g.merge(g.assign(season=g.season - 1), on=["pitcher", "season"], suffixes=("_s", "_t"))
    out = {}
    for nm, q in [("movers", j[j.hp_s != j.hp_t]), ("stayers", j[j.hp_s == j.hp_t])]:
        out[f"{nm}_n"] = len(q)
        for st in STATS:
            m = STATS[st][0]
            X = q[[f"{m}_adj_s", f"{m}_adj_t", f"{m}_s", f"{m}_t"]].to_numpy()
            rng = np.random.default_rng(1); bs = []
            for _ in range(1000):
                x = X[rng.integers(0, len(X), len(X))]
                bs.append(np.corrcoef(x[:, 0], x[:, 1])[0, 1] - np.corrcoef(x[:, 2], x[:, 3])[0, 1])
            ra, rr = np.corrcoef(X[:, 0], X[:, 1])[0, 1], np.corrcoef(X[:, 2], X[:, 3])[0, 1]
            out[f"{nm}:{st}"] = {"r_raw": float(rr), "r_adj": float(ra),
                                 "diff": [float(ra - rr), float(np.percentile(bs, 2.5)), float(np.percentile(bs, 97.5))]}
    return out


def gates(R):
    sk, mv, tot = R["hitters"], R["pitcher_movers"], R["totals"]
    g = {"M1_totals_HR": tot["hr"]["g5-A"][2] < 0}
    for st in ["w", "hr"]:
        gn = R["forecast"][f"T2:{st}:gain"]
        g[f"M2_{st}_vs_zero"] = gn["zero-g5"][1] > 0
        g[f"M2_{st}_vs_savant"] = gn["savant-g5"][1] > 0
        g[f"M2_{st}_vs_70eb"] = gn["70eb-g5"][1] > 0
    g["M3_hitters"] = all(sk[f"{st}:{r}"]["diff"][1] > -.01 for st in STATS for r in ["home_road", "next_road"])
    g["M4_pitcher_movers"] = all(mv[f"movers:{st}"]["diff"][1] > -.01 for st in STATS)
    return g


def read(f, pa, c70, seasons, targets, sl=None):
    """Every read on an era's frame. sl = frozen slopes (sealed) or None (dev: fit here)."""
    s2 = s2_within(f[f.valid])
    hyp = fit_hyper(cells(f[f.valid], ["venue_id", "season", "side"]), s2)
    R = {"s2": {f"{k[0]}:{k[1]}": v for k, v in s2.items()},
         "hyper": {f"{k[0]}:{'LHH' if k[1] else 'RHH'}": {"beta": v[0], "tau": float(np.sqrt(v[1])), "k_balls": s2[k] / v[1]}
                   for k, v in hyp.items()}}
    sav = savant_pf(range(seasons[0], seasons[-1]))
    pr = forecast_rows(f, s2, targets, sav, eb70(c70, seasons))
    if sl is None:
        sl = slopes(pr)
        for st, cands in [("w", ["sav_w", "sav_wx"])]:   # Savant wOBAcon form: the better on dev, frozen
            sc = score(pr, sl)
            sl[f"choice:{st}"] = min(cands, key=lambda a: sc[f"T2:{st}:rmse"][a])
        sl["choice:hr"] = "sav_hr"
    R["slopes"] = sl
    R["forecast"] = score(pr, sl); print("forecast", flush=True)
    R["totals"] = totals(f, s2); print("totals", flush=True)
    R["hitters"], _ = skill(f, s2, hyp, pa.rename(columns={}), "batter", "bat_team")
    f2 = f.assign(fld_team=np.where(f.bat_team == f.home_team, "__road", f.home_team))
    R["pitchers"], dp = skill(f2, s2, hyp, pa, "pitcher", "fld_team")
    R["pitcher_movers"] = movers(dp, pa)
    R["gates"] = gates(R)
    return R, pr


def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


# ------------------------------------------------------------------ modes
def fetch_savant():
    CACHE.mkdir(parents=True, exist_ok=True)
    for y in range(2015, 2026):
        for h in "LR":
            f = CACHE / f"savant_pf_{y}_{h}.json"
            if f.exists():
                continue
            url = (f"https://baseballsavant.mlb.com/leaderboard/statcast-park-factors?type=year&year={y}&batSide={h}"
                   f"&stat=index_wOBA&condition=All&rolling=3")
            s = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=60).read().decode()
            i = s.index("var data = ") + len("var data = ")
            data, _ = json.JSONDecoder().raw_decode(s[i:])
            f.write_text(json.dumps(data))
            print(y, h, len(data), "venues", flush=True)        # counts only: sealed-season values are not printed


def dev(work):
    work.mkdir(parents=True, exist_ok=True)
    b, pa, c70 = pull("dev")
    if (work / "dev_frame.parquet").exists() and (work / "dev_carry.parquet").exists():   # reuse a built frame
        f, full = pd.read_parquet(work / "dev_frame.parquet"), pd.read_parquet(work / "dev_carry.parquet")
        meta = json.loads((work / "dev_meta.json").read_text())
    else:
        f, meta, full = frame(b)
        f.to_parquet(work / "dev_frame.parquet"); full.to_parquet(work / "dev_carry.parquet")
        (work / "dev_meta.json").write_text(json.dumps(meta, default=float))
    R, pr = read(f, pa, c70, DEV_SEASONS, DEV_SEASONS[1:])
    R["frame"] = meta
    f2 = full[full.n >= 300]
    nx = f2.assign(season=f2.season - 1).merge(f2, on=["venue_id", "season"], suffixes=("_next", ""))
    R["carry"] = {"sd_venue_season_300+": float(f2.c.std()), "yoy_r": [float(nx.c.corr(nx.c_next)), len(nx)],
                  "top": f2.groupby("venue_id").c.mean().sort_values().tail(3).round(4).to_dict(),
                  "bottom": f2.groupby("venue_id").c.mean().sort_values().head(3).round(4).to_dict()}
    pr.to_parquet(work / "dev_forecast_rows.parquet")
    (RES / "park_eb_dev.json").write_text(json.dumps(R, indent=1, default=float))
    print(json.dumps(R["gates"]), json.dumps({k: v for k, v in R["slopes"].items()}, default=float))


def freeze():
    d = json.loads((RES / "park_eb_dev.json").read_text())
    fz = {"slopes": d["slopes"], "carry_K": d["frame"]["K"], "VALID_FROM": VALID_FROM, "floors": [N_PRED, N_TARG, N_TOT],
          "window": WINDOW, "sha256": {p.name: sha(p) for p in [Path(__file__), PIPE / "PREREG-park-eb.md",
                                                                  PIPE / "data/park_dims.csv", PIPE / "data/park_offsets.csv",
                                                                  PIPE / "dong.py", PIPE / "park_factors.py", RES / "park_eb_dev.json",
                                                                  SEALED / "SEAL.json"]},
          "savant_files": {p.name: sha(p) for p in sorted(CACHE.glob("savant_pf_*.json"))}}
    (RES / "park_eb_FROZEN.json").write_text(json.dumps(fz, indent=1, default=str))
    print("frozen", sha(RES / "park_eb_FROZEN.json"))


def sealed(work):
    out = RES / "park_eb_SEALED.json"
    assert not out.exists(), "the sealed read already ran: the 2015-19 bank is SPENT for park factors"
    fz = json.loads((RES / "park_eb_FROZEN.json").read_text())
    assert fz["sha256"]["park_eb.py"] == sha(Path(__file__)), "park_eb.py changed after the freeze"
    out.write_text(json.dumps({"status": "opened, run in progress"}))   # the seal is spent from this line on
    work.mkdir(parents=True, exist_ok=True)
    b, pa, c70 = pull("sealed")
    f, meta, full = frame(b, K=fz["carry_K"])
    R, pr = read(f, pa, c70, SEALED_SEASONS, SEALED_SEASONS[1:], sl=fz["slopes"])
    R["frame"] = meta; R["frozen_sha256"] = sha(RES / "park_eb_FROZEN.json")
    pr.to_parquet(work / "sealed_forecast_rows.parquet")
    out.write_text(json.dumps(R, indent=1, default=float))
    print(json.dumps(R["gates"]))


def demo():
    rng = np.random.default_rng(0); m = 4000
    g = rng.normal(0, .02, m); n = rng.integers(50, 800, m)
    r = 0.7 * g + rng.normal(0, .01, m) + rng.normal(0, np.sqrt(.25 / n))
    beta, tau2 = fh(r, g, n, .25)
    assert abs(beta - .7) < .05 and abs(np.sqrt(tau2) - .01) < .002, (beta, tau2)
    assert abs(theta(np.array([.1]), np.array([.05]), np.array([1]), 1.0, 1e-4, .25)[0] - .05) < .001
    dong, meta, knots, grid, neu = geometry()
    assert len(meta) == 30 and 395 < np.interp(0, grid, neu[0]) < 410 and 320 < neu[0][0] < 340, neu[0][[0, 45, 90]]
    p = pd.DataFrame({"ev": [105.0] * 2, "la": [28.0] * 2, "spray": [0.0] * 2, "side": [0, 0], "dist": [410.0] * 2,
                      "venue_id": [19, 3313]})
    X = flights(p, np.array([0.0, 0.0]))
    assert X["a"].pi.between(0, 1).all() and (X["c"].dist == X["a"].dist).all()
    X2 = flights(p, np.array([0.05, 0.05]))                     # removing positive carry shortens the flight
    assert (X2["c"].dist < X["a"].dist).all() and (X2["c"].pi <= X["c"].pi + 1e-9).all()
    print("park_eb demo ok", round(beta, 3), round(float(np.sqrt(tau2)), 4))


if __name__ == "__main__":
    mode = sys.argv[1]
    {"demo": demo, "savant": fetch_savant, "freeze": freeze}.get(mode, lambda: None)()
    if mode in ("dev", "sealed"):
        {"dev": dev, "sealed": sealed}[mode](Path(sys.argv[2]))
