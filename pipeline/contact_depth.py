"""RESULTS-MLB §89: the MLB contact-depth explorer and the personal damage-window gate (swing program piece 1).

    python contact_depth.py --demo      # self-check of the window fit on synthetic data
    python contact_depth.py --gate      # §89 gates (2025 split halves; 2024/2026 reported) -> results/contact_depth_89.json
    python contact_depth.py --observe   # descriptive league reads -> results/contact_depth_obs.json
    python contact_depth.py             # bake data/export/web/depth/{id}-{season}.json.gz + depth/league.json

Every swing definition comes from swing_common.py (competitive swings, contact-only centred depth).
Depth frame: intercept_ball_minus_batter_pos_{y,x}_inches, measured from the batter, so between-hitter depth carries
stance; every curve uses depth centred within hitter x season x side. Cache: cache/contact_depth.parquet (zstd).
"""
import argparse
import gzip
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

PIPE = Path(__file__).resolve().parent
ROOT = PIPE.parent
sys.path.insert(0, str(PIPE))
from paths import MART_DIR  # noqa: E402
import swing_common as sc  # noqa: E402

CACHE = ROOT / "cache" / "contact_depth.parquet"
OUT = ROOT / "data" / "export" / "web" / "depth"
RES = PIPE / "results"
SEASONS = (2024, 2025, 2026)
SITE = {"FF": "FF", "SI": "SI", "FC": "CT", "SL": "SL", "SW": "SW", "ST": "SW", "SV": "SL", "CU": "CB", "KC": "CB",
        "CH": "CH", "FS": "FS", "FO": "FS"}
FAM = {"FF": "FB", "SI": "FB", "CT": "FB", "SL": "BR", "SW": "BR", "CB": "BR", "CH": "OS", "FS": "OS"}
GRID = np.arange(-20, 21)              # league-curve bins, in.
SHIFTS = np.arange(-10, 10.01, 0.5)    # window grid, in.
MIN_SWINGS = 100                       # same floor as the swing family


def load() -> pd.DataFrame:
    if CACHE.exists():
        return pd.read_parquet(CACHE)
    sys.path.insert(0, str(MART_DIR))
    import mart
    con = mart.connect()
    con.execute("SET threads TO 4")
    cols = ("game_date", "game_pk", "pitch_type", "release_speed", "p_throws", "balls", "strikes", "plate_x", "plate_z",
            "sz_top", "sz_bot", "launch_angle", "estimated_woba_using_speedangle", "hc_x", "hc_y",
            "intercept_ball_minus_batter_pos_y_inches", "intercept_ball_minus_batter_pos_x_inches")
    d = con.sql(sc.swing_sql(SEASONS, cols)).df()
    d = d[sc.competitive_mask(d)]
    d["n_comp"] = d.groupby(["batter", "season"])["bat_speed"].transform("size")  # competitive swings, for the floor
    d = d[d["description"].isin(sc.CONTACT)].copy()
    d["dc"] = sc.depth_centered(d)
    d["pull"] = sc.pull_angle(d)
    d["pt"] = d["pitch_type"].map(SITE)
    d = d.rename(columns={"intercept_ball_minus_batter_pos_y_inches": "y", "intercept_ball_minus_batter_pos_x_inches": "x",
                          "estimated_woba_using_speedangle": "xw", "launch_speed": "ev", "launch_angle": "la",
                          "release_speed": "velo"})
    d["bip"] = d["description"] == "hit_into_play"
    d.loc[~d["bip"], "xw"] = np.nan
    d["game_date"] = pd.to_datetime(d["game_date"])
    keep = ["batter", "season", "stand", "game_date", "game_pk", "pt", "velo", "p_throws", "balls", "strikes", "plate_x",
            "plate_z", "sz_top", "sz_bot", "y", "x", "dc", "ev", "la", "xw", "pull", "bip", "bat_speed", "n_comp"]
    d = d[keep].dropna(subset=["y"]).reset_index(drop=True)
    CACHE.parent.mkdir(exist_ok=True)
    d.to_parquet(CACHE, compression="zstd")
    return d


def league_curve(bip: pd.DataFrame) -> np.ndarray:
    """xwOBAcon by centred depth on GRID: 1-in. bins, Gaussian-smoothed (bw 2 in.), flat beyond the ends."""
    b = bip.dropna(subset=["dc", "xw"])
    k = np.exp(-0.5 * ((b["dc"].to_numpy()[:, None] - GRID[None, :]) / 2.0) ** 2)
    return (k * b["xw"].to_numpy()[:, None]).sum(0) / k.sum(0)


def L(curve: np.ndarray, d) -> np.ndarray:
    return np.interp(np.clip(d, GRID[0], GRID[-1]), GRID, curve)


def fit_shift(dc: np.ndarray, xw: np.ndarray, curve: np.ndarray) -> tuple[float, float]:
    """δ minimising Σ(xw − m − L(d − δ))² with m refit per δ; returns (δ, m at δ)."""
    best = (np.inf, 0.0, 0.0)
    for s in SHIFTS:
        p = L(curve, dc - s)
        m = (xw - p).mean()
        sse = ((xw - m - p) ** 2).sum()
        if sse < best[0] - 1e-12:
            best = (sse, s, m)
    return best[1], best[2]


def halves(bip: pd.DataFrame) -> pd.Series:
    """0/1 by alternate game within unit (batter, season, stand), games ordered by date then game_pk."""
    g = bip[["batter", "season", "stand", "game_date", "game_pk"]].drop_duplicates()
    g = g.sort_values(["batter", "season", "stand", "game_date", "game_pk"])
    g["h"] = g.groupby(["batter", "season", "stand"]).cumcount() % 2
    return bip.merge(g, on=["batter", "season", "stand", "game_date", "game_pk"], how="left")["h"].to_numpy()


def gate_season(d: pd.DataFrame, curve: np.ndarray, season: int, floor: int, seed: int = 89) -> dict:
    b = d[(d["season"] == season) & d["bip"]].dropna(subset=["dc", "xw"]).copy()
    b["h"] = halves(b)
    units, held = [], []
    for key, u in b.groupby(["batter", "season", "stand"]):
        parts = [u[u["h"] == k] for k in (0, 1)]
        if min(len(p) for p in parts) < floor:
            continue
        fits = [fit_shift(p["dc"].to_numpy(), p["xw"].to_numpy(), curve) for p in parts]
        units.append({"batter": key[0], "stand": key[2], "d0": fits[0][0], "d1": fits[1][0], "n": len(u)})
        for a, t in ((0, 1), (1, 0)):  # fit on half a, predict half t
            held.append((key[0], parts[a], parts[t], fits[a][0]))
    u = pd.DataFrame(units)
    if len(u) < 10:
        return {"season": season, "floor": floor, "units": len(u)}
    r = float(np.corrcoef(u["d0"], u["d1"])[0, 1])
    sb = 2 * r / (1 + r)

    def errs(shrink: float) -> pd.DataFrame:
        rows = []
        for pid, pa, pt, dl in held:
            dt, yt = pt["dc"].to_numpy(), pt["xw"].to_numpy()
            m_lg = (pa["xw"] - L(curve, pa["dc"])).mean()
            dw = dl * shrink
            m_w = (pa["xw"] - L(curve, pa["dc"] - dw)).mean()
            rows.append((pid, ((yt - m_lg - L(curve, dt)) ** 2).sum(), ((yt - m_w - L(curve, dt - dw)) ** 2).sum(), len(yt)))
        return pd.DataFrame(rows, columns=["batter", "lg", "w", "n"]).groupby("batter")[["lg", "w", "n"]].sum()

    s = errs(1.0)
    dm = (s["lg"].sum() - s["w"].sum()) / s["n"].sum()
    rng = np.random.default_rng(seed)
    arr = s.to_numpy()
    boot = []
    for _ in range(2000):
        x = arr[rng.integers(0, len(arr), len(arr))]
        boot.append((x[:, 0].sum() - x[:, 1].sum()) / x[:, 2].sum())
    lo, hi = np.percentile(boot, [2.5, 97.5])
    sh = errs(max(sb, 0.0))
    return {"season": season, "floor": floor, "units": int(len(u)), "r_split": round(r, 3), "sb": round(sb, 3),
            "delta_sd": round(float(pd.concat([u["d0"], u["d1"]]).std()), 2),
            "dmse": float(dm), "dmse_ci": [float(lo), float(hi)],
            "mse_league": float(s["lg"].sum() / s["n"].sum()), "mse_window": float(s["w"].sum() / s["n"].sum()),
            "dmse_shrunk": float((sh["lg"].sum() - sh["w"].sum()) / sh["n"].sum()),
            "_units": u}


def gate(d: pd.DataFrame) -> None:
    curve = league_curve(d[(d["season"] == 2024) & d["bip"]])
    peak = float(GRID[np.argmax(curve)])
    out = {"league_curve_2024": {"grid": GRID.tolist(), "xw": np.round(curve, 4).tolist(), "peak_in": peak}, "runs": []}
    for season, floor in ((2025, 60), (2025, 40), (2025, 100), (2024, 60), (2026, 60)):
        g = gate_season(d, curve, season, floor)
        g.pop("_units", None)
        out["runs"].append(g)
        print(g)
    main = out["runs"][0]
    out["verdict"] = {"A_sb>=.50": main["sb"] >= 0.5, "B_dmse_ci>0": main["dmse_ci"][0] > 0}
    out["verdict"]["pass"] = all(out["verdict"].values())
    # YoY of δ and of mean raw depth, 2024 -> 2025 (reported)
    yo = {}
    for s in (2024, 2025):
        b = d[(d["season"] == s) & d["bip"]].dropna(subset=["dc", "xw"])
        for key, u in b.groupby(["batter", "stand"]):
            if len(u) >= 120:
                yo.setdefault(key, {})[s] = fit_shift(u["dc"].to_numpy(), u["xw"].to_numpy(), curve)[0]
    pairs = np.array([[v[2024], v[2025]] for v in yo.values() if len(v) == 2])
    raw = (d[d["season"].isin([2024, 2025])].groupby(["batter", "stand", "season"])["y"].agg(["mean", "size"])
           .query("size >= 150")["mean"].unstack().dropna())
    out["yoy"] = {"delta_r": round(float(np.corrcoef(pairs.T)[0, 1]), 3), "delta_n": int(len(pairs)),
                  "raw_depth_r": round(float(raw[2024].corr(raw[2025])), 3), "raw_depth_n": int(len(raw))}
    print(out["verdict"], out["yoy"])
    RES.mkdir(exist_ok=True)
    (RES / "contact_depth_89.json").write_text(json.dumps(out, indent=1))


ASB = {2024: "2024-07-16", 2025: "2025-07-15", 2026: "2026-07-14"}   # All-Star games
BINS = [-99, -8, -4, 0, 4, 8, 99]
BIN_LABEL = ["8+ deep", "4-8 deep", "0-4 deep", "0-4 front", "4-8 front", "8+ front"]


def frame(d: pd.DataFrame) -> pd.DataFrame:
    """Derived columns shared by --observe and the bake."""
    d = d.copy()
    d["fam"] = d["pt"].map(FAM)
    d["ins"] = np.where(d["stand"] == "R", -d["plate_x"], d["plate_x"])          # + = inside for him
    d["loc"] = pd.cut(d["ins"], [-9, -0.28, 0.28, 9], labels=["away", "middle", "inside"])
    zr = (d["plate_z"] - d["sz_bot"]) / (d["sz_top"] - d["sz_bot"])
    d["ht"] = pd.cut(zr, [-9, 1 / 3, 2 / 3, 9], labels=["low", "mid", "high"])
    d["vb"] = pd.cut(d["velo"], [0, 85, 90, 95, 200], labels=["<85", "85-90", "90-95", "95+"])
    d["dbin"] = pd.cut(d["dc"], BINS, labels=BIN_LABEL)
    d["month"] = d["game_date"].dt.month.clip(4, 9)                               # March games fold into April
    d["post_asb"] = d["game_date"] >= d["season"].map(ASB).pipe(pd.to_datetime)
    return d


def _m(x, nd=2):
    return None if pd.isna(x) else round(float(x), nd)


def ushape(b: pd.DataFrame) -> list:
    g = b.groupby("dbin", observed=False).agg(n=("xw", "size"), xw=("xw", "mean"), ev=("ev", "mean"),
                                              pull=("pull", lambda s: (s > 15).mean()))
    return [{"bin": k, "n": int(r.n), "xw": _m(r.xw, 3), "ev": _m(r.ev, 1), "pullPct": _m(100 * r.pull, 1)}
            for k, r in g.iterrows()]


def late_on_velo(d: pd.DataFrame) -> pd.DataFrame:
    """Per contact on a fastball: centred depth minus the league's at the same 1-mph velo (season-specific)."""
    fb = d[d["fam"] == "FB"].dropna(subset=["dc", "velo"]).copy()
    fb["v1"] = fb["velo"].round()
    fb["res"] = fb["dc"] - fb.groupby(["season", "v1"])["dc"].transform("mean")
    return fb


def league_doc(d: pd.DataFrame, curve: np.ndarray) -> dict:
    d = frame(d)
    b = d[d["bip"]].dropna(subset=["dc", "xw"])
    doc: dict = {"seasons": list(SEASONS), "n_contact": int(len(d)), "n_bip": int(len(b))}
    doc["curve"] = {"grid": GRID.tolist(), "xw": np.round(curve, 4).tolist(), "peak": float(GRID[np.argmax(curve)]),
                    "fit": "2024 balls in play"}
    doc["ushape"] = {"all": ushape(b)}
    for col, keys in (("fam", ("FB", "BR", "OS")), ("stand", ("R", "L")), ("p_throws", ("R", "L"))):
        for k in keys:
            doc["ushape"][f"{col}:{k}"] = ushape(b[b[col] == k])
    # depth vs pitch velocity (centred, all contact), 1-mph bins with 300+ contacts
    v = d.dropna(subset=["velo", "dc"]).assign(v1=lambda x: x["velo"].round())
    vg = v.groupby(["fam", "v1"]).agg(n=("dc", "size"), dc=("dc", "mean"), raw=("y", "mean")).query("n >= 300")
    doc["velo"] = {f: [{"v": int(k), "n": int(r.n), "dc": _m(r.dc), "raw": _m(r.raw)} for k, r in vg.loc[f].iterrows()]
                   for f in ("FB", "BR", "OS") if f in vg.index.get_level_values(0)}
    doc["velo_r_bip"] = _m(b["dc"].corr(b["velo"]), 3)
    # in-season: centred depth by month and by week, per season, with pitch velo beside it (composition check)
    mo = d.groupby(["season", "month"]).agg(n=("dc", "size"), dc=("dc", "mean"), velo=("velo", "mean"),
                                            fbv=("velo", lambda s: s[d.loc[s.index, "fam"] == "FB"].mean()))
    doc["month"] = {str(s): [{"m": int(m), "n": int(r.n), "dc": _m(r.dc), "fbVelo": _m(r.fbv, 1)}
                             for (ss, m), r in mo.iterrows() if ss == s] for s in SEASONS}
    d["week"] = (d["game_date"] - pd.to_datetime(d["season"].astype(str) + "-03-15")).dt.days // 7  # same day axis as the hitter roll
    wk = d.groupby(["season", "week"]).agg(n=("dc", "size"), dc=("dc", "mean"), se=("dc", "sem"))
    doc["week"] = {str(s): [{"w": int(w), "n": int(r.n), "dc": _m(r.dc), "se": _m(r.se)} for (ss, w), r in wk.iterrows()
                            if ss == s and r.n >= 2000] for s in SEASONS}
    asb = d.groupby(["season", "post_asb"])["dc"].agg(["mean", "size"])
    doc["asb"] = {str(s): {"pre": _m(asb.loc[(s, False), "mean"]), "post": _m(asb.loc[(s, True), "mean"])}
                  for s in SEASONS if (s, True) in asb.index and (s, False) in asb.index}
    # within-hitter fastball-velo-adjusted month drift (is the drift just summer velo?)
    fb = late_on_velo(d)
    doc["month_fb_velo_adj"] = {str(s): {int(m): _m(x) for m, x in g.groupby("month")["res"].mean().items()}
                                for s, g in fb.groupby("season")}
    # pitch type x velo band, count, location
    pv = d.groupby(["pt", "vb"], observed=True)["dc"].agg(["mean", "size"]).query("size >= 500")
    doc["type_velo"] = {pt: {str(vb): {"dc": _m(r["mean"]), "n": int(r["size"])} for (p2, vb), r in pv.iterrows() if p2 == pt}
                        for pt in ["FF", "SI", "CT", "SL", "SW", "CB", "CH", "FS"]}
    doc["fam"] = {k: _m(x) for k, x in d.groupby("fam")["dc"].mean().items()}
    doc["two_strike"] = {"two": _m(d.loc[d["strikes"] == 2, "dc"].mean()), "other": _m(d.loc[d["strikes"] < 2, "dc"].mean())}
    doc["two_strike_fam"] = {f: {"two": _m(g.loc[g["strikes"] == 2, "dc"].mean()), "other": _m(g.loc[g["strikes"] < 2, "dc"].mean())}
                             for f, g in d.groupby("fam")}
    doc["loc"] = {k: _m(x) for k, x in d.groupby("loc", observed=True)["dc"].mean().items()}
    doc["height"] = {k: _m(x) for k, x in d.groupby("ht", observed=True)["dc"].mean().items()}
    doc["loc_x_raw"] = {k: _m(x) for k, x in d.groupby("loc", observed=True)["x"].mean().items()}
    return doc


def late_board(d: pd.DataFrame) -> tuple[dict, dict]:
    """Who's late on velo: per hitter-season, mean depth vs the league at the same velo on 95+ fastballs.
    Returns the board rows by season and the reliability read (split-half 2025, YoY 2024->2025)."""
    fb = late_on_velo(frame(d))
    hv = fb[fb["velo"] >= 95].copy()
    hv["h"] = halves(hv)
    rows: dict = {}
    for (pid, s), g in hv.groupby(["batter", "season"]):
        if len(g) < 25:
            continue
        rows.setdefault(str(s), []).append({"id": str(pid), "n": int(len(g)), "late": _m(g["res"].mean(), 1),
                                            "xw": _m(g.loc[g["bip"], "xw"].mean(), 3), "nBip": int(g["bip"].sum()),
                                            "ev": _m(g.loc[g["bip"], "ev"].mean(), 1)})
    sh = hv[hv["season"] == 2025].groupby(["batter", "h"])["res"].agg(["mean", "size"]).unstack()
    sh = sh[(sh["size"] >= 15).all(axis=1)]
    r = float(sh["mean"][0].corr(sh["mean"][1]))
    yo = hv.groupby(["batter", "season"])["res"].agg(["mean", "size"]).query("size >= 25")["mean"].unstack()
    rel = {"split_r": round(r, 3), "sb": round(2 * r / (1 + r), 3), "n_split": int(len(sh)),
           "yoy_r": round(float(yo[2024].corr(yo[2025])), 3), "n_yoy": int(yo[[2024, 2025]].dropna().shape[0])}
    return rows, rel


def observe(d: pd.DataFrame) -> None:
    curve = league_curve(d[(d["season"] == 2024) & d["bip"]])
    doc = league_doc(d, curve)
    _, rel = late_board(d)
    doc["late_reliability"] = rel
    RES.mkdir(exist_ok=True)
    (RES / "contact_depth_obs.json").write_text(json.dumps(doc, indent=1, default=str))
    for k in ("month", "asb", "month_fb_velo_adj", "fam", "two_strike", "two_strike_fam", "loc", "height", "loc_x_raw",
              "velo_r_bip", "late_reliability"):
        print(k, json.dumps(doc[k], default=str))
    print("type_velo", json.dumps(doc["type_velo"]))
    for k, v in doc["ushape"].items():
        print(k, [(e["bin"], e["xw"], e["n"]) for e in v])


PT_CODES = ["FF", "SI", "CT", "SL", "SW", "CB", "CH", "FS"]
LG_PLATE = {"yFront": 27.9, "xCenter": 27.7}  # league mean batter position vs the plate (Savant swing path, 2025)


def pctile(s: pd.Series) -> pd.Series:
    return (100 * (s.rank(method="average") - 1) / max(len(s) - 1, 1)).round(0)


def rolling(g: pd.DataFrame, w: int = 50, cap: int = 120) -> list:
    """Rolling mean of centred depth over his last w contacts, with a 95% band; at most cap points."""
    g = g.sort_values(["game_date", "game_pk"])
    if len(g) < w:
        return []
    r = g["dc"].rolling(w)
    m, se = r.mean(), r.std() / np.sqrt(w)
    idx = np.unique(np.linspace(w - 1, len(g) - 1, min(cap, len(g) - w + 1)).round().astype(int))
    day0 = pd.Timestamp(f"{int(g['season'].iloc[0])}-03-15")
    return [[int((g["game_date"].iloc[i] - day0).days), _m(m.iloc[i], 1), _m(1.96 * se.iloc[i], 1)] for i in idx]


def bake(d: pd.DataFrame) -> None:
    curve = league_curve(d[(d["season"] == 2024) & d["bip"]])
    lg = league_doc(d, curve)
    gate_res = json.loads((RES / "contact_depth_89.json").read_text()) if (RES / "contact_depth_89.json").exists() else {}
    lg["gate"] = {"verdict": gate_res.get("verdict"), "main": (gate_res.get("runs") or [None])[0], "yoy": gate_res.get("yoy")}
    late_rows, late_rel = late_board(d)
    lg["late_reliability"] = late_rel
    names = json.loads((ROOT / "data" / "export" / "web" / "player_index.json").read_text())
    nm = lambda i: names.get(str(i), {}).get("n", str(i))  # noqa: E731
    d = frame(d)
    d = d[d["n_comp"] >= MIN_SWINGS]
    fb = late_on_velo(d)
    late_hv = fb[fb["velo"] >= 95].groupby(["batter", "season"])["res"].agg(["mean", "size"]).query("size >= 25")["mean"]
    sp = {}
    sys.path.insert(0, str(MART_DIR))
    import mart
    con = mart.connect()
    for s in SEASONS:
        try:
            t = con.sql(f"SELECT id, side, avg_batter_y_position, avg_batter_x_position FROM lb_swingpath_{s}").df()
            sp.update({(int(r.id), s, r.side): (float(r.avg_batter_y_position), float(r.avg_batter_x_position)) for r in t.itertuples()})
        except Exception:  # noqa: BLE001  (no swing-path leaderboard before 2025)
            pass
    # hitter-season summary for the percentile chips
    agg = d.groupby(["batter", "season"]).agg(n=("y", "size"), depth=("y", "mean"), sd=("dc", "std"),
                                               xw=("xw", "mean"), ev=("ev", lambda s: s[d.loc[s.index, "bip"]].mean()),
                                               nBip=("bip", "sum")).reset_index()
    agg["late"] = [late_hv.get((b, s), np.nan) for b, s in zip(agg["batter"], agg["season"])]
    for c in ("depth", "xw", "ev", "late"):
        agg[c + "Pct"] = agg.groupby("season")[c].transform(lambda x: pctile(x.dropna()).reindex(x.index))
    agg = agg.set_index(["batter", "season"])
    OUT.mkdir(parents=True, exist_ok=True)
    n = 0
    for (pid, s), g in d.groupby(["batter", "season"]):
        a = agg.loc[(pid, s)]
        side = g["stand"].mode().iloc[0]
        pos = sp.get((int(pid), s, side))
        day0 = pd.Timestamp(f"{s}-03-15")
        b = g[g["bip"]].dropna(subset=["dc", "xw"])
        his = b.groupby("dbin", observed=False)["xw"].agg(["mean", "size"])
        pts = {
            "y": (g["y"] * 10).round().astype(int).tolist(), "x": (g["x"].fillna(-999) * 10).round().astype(int).tolist(),
            "dc": (g["dc"] * 10).round().astype(int).tolist(),
            "ev": g["ev"].fillna(-1).round().astype(int).tolist(), "xw": (g["xw"].fillna(-1) * 1000).round().astype(int).tolist(),
            "pt": [PT_CODES.index(t) if t in PT_CODES else -1 for t in g["pt"]],
            "v": (g["velo"].fillna(0) * 10).round().astype(int).tolist(), "k2": (g["strikes"] == 2).astype(int).tolist(),
            "day": (g["game_date"] - day0).dt.days.astype(int).tolist(), "side": (g["stand"] == "L").astype(int).tolist(),
        }
        doc = {"id": str(pid), "season": int(s), "side": side, "sides": sorted(g["stand"].unique().tolist()),
               "n": int(len(g)), "nBip": int(a.nBip),
               "plate": {"yFront": round(pos[0], 1), "xCenter": round(pos[1], 1), "src": "savant"} if pos
               else {**LG_PLATE, "src": "league"},
               "summary": {"depth": _m(a.depth, 1), "xw": _m(a.xw, 3), "ev": _m(a.ev, 1), "late": _m(a.late, 1),
                           "fbDepth": _m(g.loc[g["fam"] == "FB", "y"].mean(), 1),
                           "osDepth": _m(g.loc[g["fam"].isin(["BR", "OS"]), "y"].mean(), 1)},
               "pct": {c: (None if pd.isna(a[c + "Pct"]) else int(a[c + "Pct"])) for c in ("depth", "xw", "ev", "late")},
               "his": [{"bin": k, "xw": _m(r["mean"], 3), "n": int(r["size"])} for k, r in his.iterrows()],
               "roll": rolling(g), "pts": pts, "ptCodes": PT_CODES}
        with gzip.open(OUT / f"{pid}-{s}.json.gz", "wt", compresslevel=9) as fh:
            json.dump(doc, fh, separators=(",", ":"))
        n += 1
    lg["late_board"] = {s: sorted([{**r, "name": nm(r["id"]), "tm": names.get(r["id"], {}).get("tm")} for r in rows], key=lambda r: r["late"])
                        for s, rows in late_rows.items()}
    (OUT / "league.json").write_text(json.dumps(lg, separators=(",", ":"), default=str))
    print(f"depth bake: {n} hitter-season files + league.json -> {OUT}")


def demo() -> None:
    rng = np.random.default_rng(0)
    curve = 0.42 - 0.0012 * (GRID - 6.0) ** 2
    dc = rng.normal(0, 10, 4000)
    xw = 0.05 + L(curve, dc - 3.0) + rng.normal(0, 0.05, dc.size)
    s, m = fit_shift(dc, xw, curve)
    assert abs(s - 3.0) <= 0.5 and abs(m - 0.05) < 0.01, (s, m)
    assert abs(GRID[np.argmax(league_curve(pd.DataFrame({"dc": dc, "xw": L(curve, dc)})))] - 6) <= 1
    print("contact_depth demo: ok")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--demo", action="store_true")
    ap.add_argument("--gate", action="store_true")
    ap.add_argument("--observe", action="store_true")
    a = ap.parse_args()
    if a.demo:
        demo()
    elif a.gate:
        gate(load())
    elif a.observe:
        observe(load())
    else:
        bake(load())
