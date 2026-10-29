"""RESULTS-MLB §86 "would it dong": in how many of the 30 current parks is each MLB batted ball a home run?

    python dong.py           # fit every 2020-26 batted ball, cache/dong_balls.parquet, bake data/export/web/dong/
    python dong.py --tune    # per-park own-park agreement on EVEN seasons (the only seasons knots may be tuned on)
    python dong.py --gate    # the §86 gates, ODD seasons + Savant's Home Run Tracker CSV (read once)
    python dong.py --demo    # physics self-check

Geometry: pipeline/data/park_dims.csv (published distances + wall heights, linear in spray angle).
Flight: 2-D, gravity + quadratic drag + fixed backspin lift; C_D solved per ball so it lands at hit_distance_sc
in its own park's air; other parks scale C_D and C_L by air density (elevation only).
"""
import gzip
import json
import sys
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

PIPE = Path(__file__).resolve().parent
ROOT = PIPE.parent
sys.path.insert(0, str(PIPE))
from paths import MART_DIR  # noqa: E402
sys.path.insert(0, str(MART_DIR))
import mart  # noqa: E402
from park_factors import venues  # noqa: E402

DIMS = PIPE / "data" / "park_dims.csv"
OFFSETS = PIPE / "data" / "park_offsets.csv"  # per-park fence shift fit on EVEN seasons only (dong.py --tune)
CACHE = ROOT / "cache"
BALLS = CACHE / "dong_balls.parquet"
POST_VENUES = CACHE / "dong_post_venues.parquet"
SAVANT = CACHE / "savant_hr_tracker"
OUT = ROOT / "data" / "export" / "web" / "dong"
SEASONS = list(range(2020, 2027))
POST = ("F", "D", "L", "W")

G, K, Y0, DT, CL = 32.174, 0.005307, 3.0, 0.02, 0.25  # ft/s^2; rho*A/(2m) per ft at sea level; contact height ft
SCALE_HT = 27_500.0  # ft, air-density scale height (ponytail: elevation only, no temperature/humidity/wind/roof)
MIN_DIST, MIN_LA = 250, 10  # below either: 0 parks, no integration
# Elevations (ft) of venues outside the 30 current parks, for the own-park air of balls hit there.
OTHER_ELEV = {10: 0, 2523: 10, 2536: 10, 2756: 600, 2397: 30, 5150: 100, 5340: 7350, 5355: 2000, 5381: 30,
              5445: 1000, 3949: 600, 6130: 1700, 2735: 520}
# (venue_id, first season of the 2026 configuration); the own-park gate uses only these spells.
CONFIG_FROM = {2: 2025, 2394: 2023, 14: 2023, 7: 2026, 2529: 2025}


def rho(elev):
    return np.exp(-np.asarray(elev, float) / SCALE_HT)


def parks(raw=False) -> tuple[pd.DataFrame, dict]:
    d = pd.read_csv(DIMS, comment="#")
    if not raw and OFFSETS.exists():
        off = pd.read_csv(OFFSETS, comment="#").set_index("venue_id")["offset_ft"]
        d["dist_ft"] += d["venue_id"].map(off).fillna(0)
    meta = d.groupby("venue_id").agg(park=("park", "first"), elev=("elev_ft", "first")).reset_index()
    knots = {v: (g["angle"].to_numpy(float), g["dist_ft"].to_numpy(float), g["wall_ft"].to_numpy(float))
             for v, g in d.sort_values("angle").groupby("venue_id")}
    return meta, knots


def fence(knots, vid, spray):
    a, r, h = knots[vid]
    s = np.clip(spray, a[0], a[-1])
    return np.interp(s, a, r), np.interp(s, a, h)


def simulate(v, la, cd, cl, R=None, tmax=9.0):
    """RK2 flights. v ft/s, la deg. Returns landing distance and, if R (n x m), height at each R (-inf if short)."""
    n = len(v)
    vx, vz = v * np.cos(np.radians(la)), v * np.sin(np.radians(la))
    x, y = np.zeros(n), np.full(n, Y0)
    land = np.full(n, np.nan)
    hR = None if R is None else np.full(R.shape, -np.inf)

    def acc(vx, vz):
        s = np.hypot(vx, vz)
        return -K * s * (cd * vx + cl * vz), -G + K * s * (cl * vx - cd * vz)

    for _ in range(int(tmax / DT)):
        ax, az = acc(vx, vz)
        mx, mz = vx + 0.5 * DT * ax, vz + 0.5 * DT * az
        ax, az = acc(mx, mz)
        nx, ny = x + DT * mx, y + DT * mz
        live = np.isnan(land)
        if hR is not None:
            hit = live[:, None] & (x[:, None] < R) & (nx[:, None] >= R)
            if hit.any():
                f = (R - x[:, None]) / np.maximum(nx - x, 1e-9)[:, None]
                hR = np.where(hit, (y[:, None] + f * (ny - y)[:, None]), hR)
        down = live & (ny <= 0)
        land[down] = x[down] + (nx - x)[down] * y[down] / np.maximum(y - ny, 1e-9)[down]
        x, y, vx, vz = nx, ny, vx + DT * ax, vz + DT * az
        if not np.isnan(land).any():
            break
    land[np.isnan(land)] = x[np.isnan(land)]
    return land, hR


def fit_cd(v, la, dist, r_own, iters=22):
    """Bisection on C_D (monotone: more drag, shorter) so the ball lands at dist in its own park's air."""
    lo, hi = np.zeros(len(v)), np.full(len(v), 1.5)
    for _ in range(iters):
        mid = (lo + hi) / 2
        land, _ = simulate(v, la, mid * r_own, CL * r_own)
        far = land > dist
        lo, hi = np.where(far, mid, lo), np.where(far, hi, mid)
    return (lo + hi) / 2


def park_masks(df, meta, knots, chunk=60_000):
    """Bitmask over meta.venue_id order: bit p set when the ball clears park p."""
    vids = meta["venue_id"].tolist()
    r_p = rho(meta["elev"].to_numpy())
    groups = {}
    for i, rp in enumerate(np.round(r_p, 3)):
        groups.setdefault(rp, []).append(i)
    mask = np.zeros(len(df), np.int64)
    big = ((df["dist"] >= MIN_DIST) & (df["la"] >= MIN_LA) & df["ev"].notna()).to_numpy()
    idx = np.flatnonzero(big)
    for s in range(0, len(idx), chunk):
        ii = idx[s:s + chunk]
        sub = df.iloc[ii]
        v, la, dist, r_own = (sub["ev"].to_numpy() * 1.4667, sub["la"].to_numpy(), sub["dist"].to_numpy(),
                              sub["rho"].to_numpy())
        cd = fit_cd(v, la, dist, r_own)
        m = np.zeros(len(ii), np.int64)
        for rp, cols in groups.items():
            R = np.column_stack([fence(knots, vids[c], sub["spray"].to_numpy())[0] for c in cols])
            H = np.column_stack([fence(knots, vids[c], sub["spray"].to_numpy())[1] for c in cols])
            _, hR = simulate(v, la, cd * rp, CL * rp, R)  # cd is the sea-level coefficient (fit_cd scales by r_own)
            for k, c in enumerate(cols):
                m |= (hR[:, k] > H[:, k]).astype(np.int64) << c
        mask[ii] = m
        print(f"  {s + len(ii):,}/{len(idx):,} balls", flush=True)
    return mask


def post_venues() -> pd.DataFrame:
    if POST_VENUES.exists():
        return pd.read_parquet(POST_VENUES)
    rows = []
    for s in SEASONS:
        url = f"https://statsapi.mlb.com/api/v1/schedule?sportId=1&season={s}&gameType={','.join(POST)}"
        with urllib.request.urlopen(url, timeout=60) as r:
            for day in json.load(r).get("dates", []):
                for g in day["games"]:
                    rows.append({"game_pk": g["gamePk"], "season": s, "venue_id": g["venue"]["id"],
                                 "venue": g["venue"]["name"]})
    v = pd.DataFrame(rows).drop_duplicates("game_pk")
    v.to_parquet(POST_VENUES)
    return v


def load() -> pd.DataFrame:
    con = mart.connect()
    df = con.sql(f"""SELECT game_pk, game_date, season, game_type, batter, events, des,
                            CASE WHEN inning_topbot = 'Bot' THEN home_team ELSE away_team END AS team,
                            launch_speed AS ev, launch_angle AS la, hit_distance_sc AS dist,
                            degrees(atan2(hc_x - 125.42, 198.27 - hc_y)) AS spray
                     FROM pitches_all WHERE type = 'X' AND season BETWEEN {SEASONS[0]} AND {SEASONS[-1]}
                       AND game_type IN ('R', {",".join(f"'{t}'" for t in POST)})""").df()
    v = pd.concat([venues(SEASONS), post_venues()]).drop_duplicates("game_pk")
    df = df.merge(v[["game_pk", "venue_id"]], on="game_pk", how="left")
    meta, _ = parks()
    elev = dict(zip(meta["venue_id"], meta["elev"])) | OTHER_ELEV
    df["rho"] = rho(df["venue_id"].map(elev).fillna(0))
    df["hr"] = df["events"].eq("home_run")
    df["itp"] = df["des"].str.contains("inside-the-park", case=False, na=False)
    return df.drop(columns="des")


def build() -> pd.DataFrame:
    meta, knots = parks()
    df = load()
    print(f"{len(df):,} batted balls; fitting flights", flush=True)
    df["mask"] = park_masks(df, meta, knots)
    df["n_parks"] = [int(m).bit_count() for m in df["mask"]]
    df.to_parquet(BALLS, compression="zstd")
    return df


def own_park_eval(df, seasons, meta, knots):
    """Own-park prediction vs actual, current-config spells, dist >= 300, inside-the-park HRs dropped."""
    col = {v: i for i, v in enumerate(meta["venue_id"])}
    d = df[df["season"].isin(seasons) & df["venue_id"].isin(col) & (df["dist"] >= 300) & ~df["itp"]].copy()
    d = d[d["season"] >= d["venue_id"].map(CONFIG_FROM).fillna(0)]
    d["pred"] = [(int(m) >> col[v]) & 1 == 1 for m, v in zip(d["mask"], d["venue_id"])]
    r_own = np.array([fence(knots, v, s)[0] for v, s in zip(d["venue_id"], d["spray"])])
    d["naive"] = d["dist"].to_numpy() >= r_own

    def score(g, p="pred"):
        tp, fp, fn = (g[p] & g["hr"]).sum(), (g[p] & ~g["hr"]).sum(), (~g[p] & g["hr"]).sum()
        return {"n": len(g), "acc": round((g[p] == g["hr"]).mean(), 4), "recall": round(tp / max(tp + fn, 1), 4),
                "precision": round(tp / max(tp + fp, 1), 4), "hr": int(g["hr"].sum()), "pred": int(g[p].sum())}
    per = {meta.set_index("venue_id").loc[v, "park"]: score(g) for v, g in d.groupby("venue_id")}
    return score(d), score(d, "naive"), per


def tune(grid=np.arange(-20, 12.5, 2.5)):
    """Per-park fence shift (ft) maximising own-park agreement on EVEN seasons; writes OFFSETS. Odd seasons untouched."""
    meta, knots = parks(raw=True)
    df = pd.read_parquet(BALLS)
    d = df[df["season"].isin([2020, 2022, 2024, 2026]) & df["venue_id"].isin(set(meta["venue_id"]))
           & (df["dist"] >= 300) & ~df["itp"]]
    d = d[d["season"] >= d["venue_id"].map(CONFIG_FROM).fillna(0)]
    v, la, r, hr = d["ev"].to_numpy() * 1.4667, d["la"].to_numpy(), d["rho"].to_numpy(), d["hr"].to_numpy()
    RH = np.array([fence(knots, a, s) for a, s in zip(d["venue_id"], d["spray"])])
    cd = fit_cd(v, la, d["dist"].to_numpy(), r)
    _, h = simulate(v, la, cd * r, CL * r, RH[:, :1] + grid[None, :])
    hit = h > RH[:, 1:2]
    rows, ok = [], np.zeros(len(d), bool)
    for vid in meta["venue_id"]:
        m = (d["venue_id"] == vid).to_numpy()
        acc = (hit[m] == hr[m, None]).mean(0)
        k = int(np.argmax(acc - np.abs(grid) * 1e-5))  # ties go to the smaller shift
        rows.append({"venue_id": vid, "offset_ft": float(grid[k]), "n": int(m.sum()), "acc_raw": round(acc[grid == 0][0], 4),
                     "acc": round(acc[k], 4)})
        ok[m] = hit[m, k] == hr[m]
    out = pd.DataFrame(rows)
    with open(OFFSETS, "w") as f:
        f.write(f"# RESULTS-MLB §86: fence shift per park (ft, + = deeper), chosen on 2020/22/24/26 own-park balls >= 300 ft, CL={CL}.\n")
        out.to_csv(f, index=False)
    print(out.to_string(), f"\nEVEN seasons, tuned: acc {ok.mean():.4f}")


def savant() -> pd.DataFrame:
    SAVANT.mkdir(parents=True, exist_ok=True)
    out = []
    for s in SEASONS:
        f = SAVANT / f"xhr_{s}.csv"
        if not f.exists():
            url = (f"https://baseballsavant.mlb.com/leaderboard/home-runs?player_type=Batter&team=&min=0&cat=xhr"
                   f"&year={s}&csv=true")
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            f.write_bytes(urllib.request.urlopen(req, timeout=60).read())
        out.append(pd.read_csv(f, encoding="utf-8-sig"))
    return pd.concat(out)


def per_player_season(df) -> pd.DataFrame:
    d = df.assign(x=df["n_parks"] / 30, nd=df["hr"] & (df["n_parks"] == 30),
                  mg=df["hr"] & df["n_parks"].between(8, 29), db=df["hr"] & (df["n_parks"] <= 7))
    return d.groupby(["batter", "season"]).agg(hr=("hr", "sum"), xhr=("x", "sum"), nd=("nd", "sum"),
                                                mg=("mg", "sum"), db=("db", "sum")).reset_index()


def gate():
    meta, knots = parks()
    df = pd.read_parquet(BALLS)
    odd = [2021, 2023, 2025]
    allm, naive, per = own_park_eval(df, odd, meta, knots)
    ours = per_player_season(df[df["game_type"] == "R"])  # Savant's tracker is regular season
    sv = savant()
    sv = sv[sv["year"].isin(odd)].rename(columns={"player_id": "batter", "year": "season"})
    j = sv.merge(ours, on=["batter", "season"], suffixes=("_sv", ""))
    res = {"a_own_park": allm, "a_naive": naive, "a_per_park": per, "b_n": len(j),
           "b_r_xhr": round(np.corrcoef(j["xhr_sv"], j["xhr"])[0, 1], 4),
           "b_r_no_doubters": round(np.corrcoef(j["no_doubters"], j["nd"])[0, 1], 4),
           "b_r_doubters": round(np.corrcoef(j["doubters"], j["db"])[0, 1], 4),
           "b_r_mostly_gone": round(np.corrcoef(j["mostly_gone"], j["mg"])[0, 1], 4),
           "b_bias_xhr": round((j["xhr"] - j["xhr_sv"]).mean(), 3),
           "b_hr_match": round((j["hr"] == j["hr_total"]).mean(), 4),
           "b_totals": {k: int(j[a].sum()) for k, a in [("nd_sv", "no_doubters"), ("nd", "nd"), ("mg_sv", "mostly_gone"),
                                                       ("mg", "mg"), ("db_sv", "doubters"), ("db", "db")]}}
    res["pass_a"] = bool(allm["acc"] >= .95 and allm["recall"] >= .90 and allm["precision"] >= .90
                         and allm["acc"] >= naive["acc"])
    res["pass_b"] = bool(res["b_r_xhr"] >= .95 and res["b_r_no_doubters"] >= .90)
    (PIPE / "results" / "dong_86.json").write_text(json.dumps(res, indent=1, default=float))
    print(json.dumps(res, indent=1, default=float))


def num(x, dp=0):
    """JSON-safe rounding; untracked values (NaN) become null."""
    return None if pd.isna(x) else (round(float(x), dp) if dp else int(x))


def export():
    meta, _ = parks()
    df = pd.read_parquet(BALLS)
    pnames = meta["park"].tolist()
    vname = dict(zip(meta["venue_id"], meta["park"]))
    names = json.loads((ROOT / "data" / "export" / "web" / "player_index.json").read_text())
    bits = np.array([[(int(m) >> p) & 1 for p in range(30)] for m in df["mask"]], np.int8)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "players").mkdir(exist_ok=True)

    def summary(g, b):
        hr = g["hr"].to_numpy()
        n = g["n_parks"].to_numpy()
        per_park = b.sum(0)
        avg = per_park.mean()
        best, worst = int(per_park.argmax()), int(per_park.argmin())
        return {"bbe": len(g), "hr": int(hr.sum()), "xhr": round(float(n.sum() / 30), 1),
                "nd": int((hr & (n == 30)).sum()), "mg": int((hr & (n >= 8) & (n <= 29)).sum()),
                "db": int((hr & (n <= 7)).sum()), "lost": int((hr & (n == 0)).sum()),
                "else": int((~hr & (n >= 1)).sum()), "else_x": round(float(n[~hr].sum() / 30), 1),
                "best": [best, int(per_park[best])], "worst": [worst, int(per_park[worst])], "avg": round(float(avg), 1)}

    board = {"parks": pnames, "seasons": {}, "career": []}
    keep = df["n_parks"].gt(0) | df["hr"]
    for (s,), g in df.groupby(["season"]):
        rows = []
        for (bid,), h in g.groupby(["batter"]):
            if not (h["hr"].any() or h["n_parks"].gt(0).any()):
                continue
            r = summary(h, bits[h.index])
            rows.append({"id": int(bid), "n": names.get(str(bid), {}).get("n", str(bid)), "tm": h["team"].iloc[-1], **r})
        board["seasons"][str(s)] = sorted(rows, key=lambda r: -r["xhr"])
        # league: HRs each park would have allowed this season, and the season's balls by park count
        board.setdefault("league", {})[str(s)] = {"per_park": bits[g.index].sum(0).tolist(),
                                                   "hist": np.bincount(g["n_parks"], minlength=31).tolist()}
    for (bid,), h in df.groupby(["batter"]):
        if not h["hr"].any() and not h["n_parks"].gt(0).any():
            continue
        r = summary(h, bits[h.index])
        board["career"].append({"id": int(bid), "n": names.get(str(bid), {}).get("n", str(bid)), "tm": h["team"].iloc[-1], **r})
        balls = h[keep[h.index]].sort_values("game_date", ascending=False)
        doc = {"id": int(bid), "parks": pnames,
               "seasons": {str(s): summary(x, bits[x.index]) for (s,), x in h.groupby(["season"])},
               "career": r,
               # per ball: date, game, venue, EV, LA, dist, spray, parks cleared, actual HR, postseason, park bitmask
               "balls": [[str(b.game_date)[:10], int(b.game_pk), vname.get(b.venue_id, None), num(b.ev, 1),
                          num(b.la), num(b.dist), num(b.spray, 1), int(b.n_parks), bool(b.hr),
                          b.game_type != "R", int(b.mask)] for b in balls.itertuples()]}
        with gzip.open(OUT / "players" / f"{int(bid)}.json.gz", "wt") as f:
            json.dump(doc, f, separators=(",", ":"))
    board["career"].sort(key=lambda r: -r["xhr"])
    (OUT / "board.json").write_text(json.dumps(board, separators=(",", ":")))
    print(f"wrote {OUT}: {len(board['career'])} players")


def demo():
    v = np.array([105 * 1.4667]); la = np.array([28.0])
    land, _ = simulate(v, la, np.array([0.35]), CL)
    assert 330 < land[0] < 470, land  # a 105/28 ball carries ~400 ft
    cd = fit_cd(v, la, np.array([400.0]), np.array([1.0]))
    assert abs(simulate(v, la, cd, CL)[0][0] - 400) < 1
    thin, _ = simulate(v, la, cd * rho(5200), CL * rho(5200))
    assert 15 < thin[0] - 400 < 45, thin  # Coors adds ~5-10% carry
    _, h = simulate(v, la, cd, CL, np.array([[300.0, 390.0, 420.0]]))
    assert h[0, 0] > h[0, 1] > 0 and h[0, 2] == -np.inf
    print("demo ok", round(land[0]), round(thin[0] - 400, 1), h.round(1))


if __name__ == "__main__":
    arg = sys.argv[1] if len(sys.argv) > 1 else ""
    {"--demo": demo, "--tune": tune, "--gate": gate, "--export": export}.get(arg, lambda: (build(), export()))()
