"""RESULTS-MLB §95: bat speed drift as an injury flag (swing program piece 7).

    python bat_speed_drift.py --gate   # §95 gate (2024-25) + 2026 replication -> results/drift_95.json
    python bat_speed_drift.py --demo   # synthetic self-check (planted drop is caught by both detectors)

Per hitter-game mean competitive bat speed vs his rolling within-season baseline. Detectors: lower CUSUM,
Adams-MacKay Bayesian online change point, and a naive one-low-game rule. Validated against IL placements from
the statsapi transactions feed (start = the retroactive date when given), vs a within-hitter-season permutation null.
"""
import argparse
import json
import re
import sys
from pathlib import Path

import numpy as np
import pandas as pd

PIPE = Path(__file__).resolve().parent
ROOT = PIPE.parent
sys.path.insert(0, str(PIPE))
from paths import MART_DIR  # noqa: E402
import swing_common as sc  # noqa: E402

RES = PIPE / "results"
MIN_SW, MIN_BASE, WIN, LEAD = 4, 10, 30, 14
K, H = 0.5, 4.0
HAZ, PRIOR_SD, R_MAX, DROP, QUIET = 1 / 60, 1.5, 4, 1.0, 10


def games(seasons) -> pd.DataFrame:
    sys.path.insert(0, str(MART_DIR))
    import mart
    con = mart.connect()
    con.execute("SET threads TO 4")
    d = con.sql(sc.swing_sql(seasons, ("game_date", "game_pk"))).df()
    con.close()
    c = sc.competitive_swings(d)
    g = (c.groupby(["batter", "season", "game_date", "game_pk"])["bat_speed"].agg(["mean", "size"]).reset_index())
    g = g[g["size"] >= MIN_SW].sort_values(["batter", "season", "game_date", "game_pk"]).reset_index(drop=True)
    g["game_date"] = pd.to_datetime(g["game_date"])
    return g.rename(columns={"mean": "x", "size": "n"})


def baseline(x: np.ndarray):
    """Rolling mean / SD of the previous <= WIN games (>= MIN_BASE needed)."""
    s = pd.Series(x)
    b = s.shift(1).rolling(WIN, min_periods=MIN_BASE).mean().to_numpy()
    sd = s.shift(1).rolling(WIN, min_periods=MIN_BASE).std().clip(lower=0.5).to_numpy()
    return b, sd


def cusum(z: np.ndarray) -> np.ndarray:
    c, out = 0.0, np.zeros(len(z), bool)
    for t, v in enumerate(z):
        if np.isnan(v):
            continue
        c = max(0.0, c - v - K)
        if c >= H:
            out[t], c = True, 0.0
    return out


def bocpd(x: np.ndarray) -> np.ndarray:
    """Adams-MacKay with Gaussian known variance; prior from the first MIN_BASE games; alerts from game MIN_BASE on."""
    out = np.zeros(len(x), bool)
    if len(x) <= MIN_BASE:
        return out
    mu0, s2 = x[:MIN_BASE].mean(), max(x[:MIN_BASE].std(ddof=1), 0.5) ** 2
    t2 = PRIOR_SD ** 2
    P = np.array([1.0])                        # run-length posterior
    m, v = np.array([mu0]), np.array([t2])     # segment-mean posterior per run length
    quiet = 0
    for t in range(MIN_BASE, len(x)):
        pred = np.exp(-0.5 * (x[t] - m) ** 2 / (v + s2)) / np.sqrt(v + s2)
        grow = P * pred * (1 - HAZ)
        cp = HAZ * np.exp(-0.5 * (x[t] - mu0) ** 2 / (t2 + s2)) / np.sqrt(t2 + s2)  # new segment starts at x_t
        P = np.r_[cp, grow]
        P /= P.sum()
        k = v / (v + s2)                          # update each run's posterior with x_t, prepend a fresh prior
        m, v = np.r_[mu0 + t2 / (t2 + s2) * (x[t] - mu0), m + k * (x[t] - m)], np.r_[t2 * s2 / (t2 + s2), v * s2 / (v + s2)]
        if len(P) > 300:
            P, m, v = P[:300] / P[:300].sum(), m[:300], v[:300]
        quiet -= 1
        if quiet <= 0 and P[:R_MAX + 1].sum() >= 0.5:
            r = int(np.argmax(P[:R_MAX + 1]))
            if x[:t - r].mean() - x[t - r:t + 1].mean() >= DROP:
                out[t], quiet = True, QUIET
    return out


def il_starts() -> pd.DataFrame:
    t = pd.read_parquet(ROOT / "data" / "milb" / "transactions.parquet")
    t = t[t["desc"].str.contains(r"placed .+? on the \d+-day injured list", case=False, na=False, regex=True)
          & ~t["desc"].str.contains("transferred", case=False, na=False)].copy()
    retro = t["desc"].str.extract(r"retroactive to (\w+ \d{1,2}, \d{4})", flags=re.I)[0]
    t["start"] = pd.to_datetime(retro, format="%B %d, %Y", errors="coerce").fillna(pd.to_datetime(t["date"]))
    t["retro"] = retro.notna()
    return t[["id", "start", "retro"]].drop_duplicates(["id", "start"]).rename(columns={"id": "batter"})


def score(g: pd.DataFrame, il: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Per game: eligible (has a baseline), z, alerts, and hw = game is 1-LEAD days before an eligible IL start."""
    parts = []
    for (b, s), q in g.groupby(["batter", "season"], sort=False):
        x = q["x"].to_numpy()
        base, sd = baseline(x)
        z = (x - base) / sd
        q = q.assign(base=base, z=z, elig=~np.isnan(base), cusum=cusum(z), bocpd=bocpd(x), naive=z <= -2)
        parts.append(q)
    g = pd.concat(parts, ignore_index=True)
    il = il.assign(season=il["start"].dt.year).merge(g[["batter", "season"]].drop_duplicates(), on=["batter", "season"])
    stints = []
    for r in il.itertuples():
        q = g[(g.batter == r.batter) & (g.season == r.season)]
        before = q[q.game_date < r.start]
        if before.empty or (r.start - before.game_date.max()).days > 10 or before.elig.sum() == 0:
            continue
        stints.append({"batter": r.batter, "season": r.season, "start": r.start, "retro": r.retro})
    st = pd.DataFrame(stints).reset_index(drop=True)
    g["hw"], g["stint"] = False, -1
    for i, r in st.iterrows():
        m = (g.batter == r.batter) & (g.season == r.season) & (g.game_date < r.start) & \
            (g.game_date >= r.start - pd.Timedelta(days=LEAD))
        g.loc[m & (g.stint < 0), "stint"] = i
        g.loc[m, "hw"] = True
    return g, st


def evaluate(g, st, col, rng, B=1000):
    e = g[g.elig].reset_index(drop=True)
    a = e[col].to_numpy()
    hw = e["hw"].to_numpy()
    stint = e["stint"].to_numpy()
    na = a.sum()
    prec = (a & hw).sum() / na if na else np.nan
    caught = np.unique(stint[a & (stint >= 0)])
    rec = len(caught) / len(st) if len(st) else np.nan
    lead = [(st.start[s] - e.game_date[(stint == s) & a].max()).days for s in caught]
    # permutation null: shuffle alert flags over each hitter-season's eligible games
    grp = (e["batter"].astype(str) + "-" + e["season"].astype(str)).to_numpy()
    _, gid = np.unique(grp, return_inverse=True)
    cnt = np.bincount(gid, weights=a)
    starts = np.r_[0, np.cumsum(np.bincount(gid))[:-1]]
    nullp, nullr = [], []
    for _ in range(B):
        o = np.lexsort((rng.random(len(e)), gid))
        rank = np.empty(len(e), int)
        rank[o] = np.arange(len(e)) - starts[gid[o]]
        f = rank < cnt[gid]
        nullp.append((f & hw).sum() / na)
        nullr.append(len(np.unique(stint[f & (stint >= 0)])) / len(st))
    nullp = np.array(nullp)
    f1 = 2 * prec * rec / (prec + rec) if prec + rec > 0 else 0.0
    nf1 = 2 * nullp.mean() * np.mean(nullr) / (nullp.mean() + np.mean(nullr))
    return {"alerts": int(na), "alerts_per_100_games": round(100 * na / len(e), 2), "precision": round(prec, 4),
            "recall": round(rec, 4), "f1": round(f1, 4), "lead_days_median": float(np.median(lead)) if lead else None,
            "null_precision": round(nullp.mean(), 4), "null_recall": round(float(np.mean(nullr)), 4), "null_f1": round(nf1, 4),
            "lift": round(prec / nullp.mean(), 3) if nullp.mean() > 0 else None,
            "p": round((1 + (nullp >= prec).sum()) / (B + 1), 4)}


def run(seasons, rng):
    g, st = score(games(seasons), il_starts())
    e = g[g.elig]
    out = {"seasons": list(seasons), "hitter_seasons": int(g.groupby(["batter", "season"]).ngroups), "games": int(len(g)),
           "eligible_games": int(len(e)), "stints": int(len(st)), "stints_retro_share": round(float(st.retro.mean()), 3),
           "base_rate_hw": round(float(e.hw.mean()), 4), "game_sd_mph": round(float((e.x - e.base).std()), 2)}
    for col in ("cusum", "bocpd", "naive"):
        out[col] = evaluate(g, st, col, rng)
        print(seasons, col, out[col], flush=True)
    return out, g, st


def gate():
    rng = np.random.default_rng(95)
    dev, _, _ = run((2024, 2025), rng)
    ps = sorted(("cusum", "bocpd"), key=lambda c: dev[c]["p"])
    holm = {c: min(1.0, dev[c]["p"] * (2 - i)) for i, c in enumerate(ps)}
    nv = dev["naive"]
    for c in ("cusum", "bocpd"):
        d = dev[c]
        d["p_holm"] = round(holm[c], 4)
        d["pass"] = bool(d["p_holm"] < 0.05 and (d["lift"] or 0) >= 1.5 and d["f1"] >= nv["f1"] and d["lift"] >= nv["lift"])
    res = {"dev": dev}
    passing = [c for c in ("cusum", "bocpd") if dev[c]["pass"]]
    if passing:
        rep, _, _ = run((2026,), rng)
        best = max(passing, key=lambda c: dev[c]["f1"])
        res["replication"] = {"detector": best, **rep,
                              "pass": bool(rep[best]["p"] < 0.05 and (rep[best]["lift"] or 0) >= 1.5)}
    res["verdict"] = "pass" if passing and res["replication"]["pass"] else "fail"
    RES.mkdir(exist_ok=True)
    (RES / "drift_95.json").write_text(json.dumps(res, indent=1, default=str))
    print(json.dumps({k: v for k, v in res.items() if k != "dev"}, indent=1, default=str)[:3000])


def demo():
    rng = np.random.default_rng(1)
    x = np.r_[rng.normal(72, 0.8, 40), rng.normal(69.5, 0.8, 15)]
    b, sd = baseline(x)
    c, bo = cusum((x - b) / sd), bocpd(x)
    assert c[:40].sum() <= 1 and c[40:46].any(), np.flatnonzero(c)
    assert bo[40:46].any() and bo[:40].sum() <= 1, np.flatnonzero(bo)
    flat = rng.normal(72, 0.8, 120)
    b, sd = baseline(flat)
    assert cusum((flat - b) / sd).sum() <= 2 and bocpd(flat).sum() <= 2
    print("demo ok")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--gate", action="store_true")
    ap.add_argument("--demo", action="store_true")
    a = ap.parse_args()
    demo() if a.demo else gate()
