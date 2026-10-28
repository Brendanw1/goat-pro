"""RESULTS-MLB §70 (D-04): component park factors by batter hand, EB-shrunk, keyed by venue.

    python park_factors.py           # fetch venues once (cache/game_venues.parquet), the §70 read, write results
    python park_factors.py --demo    # self-check of the EB shrink on a hand-worked case

Spell = (home team, venue). Raw ratio = rate in the spell's home games / the team's road games, same seasons, both
teams' PA. EB: log ratio x tau^2/(tau^2 + 1/home events + 1/road events), tau^2 by method of moments per component
and hand. Writes results/park_factors.json (latest window per venue) and results/park_factors_SEALED.json.
"""
import json
import sys
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

from paths import MART_DIR  # noqa: E402
sys.path.insert(0, str(MART_DIR))
import mart  # noqa: E402
from stack import pooled_dr  # noqa: E402

PIPE = Path(__file__).resolve().parent
CACHE = PIPE.parent / "cache" / "game_venues.parquet"
COMP = {"1B": "('single')", "2B": "('double')", "3B": "('triple')", "HR": "('home_run')", "BB": "('walk')",
        "SO": "('strikeout','strikeout_double_play')"}
MIN_HOME_PA, MIN_NEXT_PA = 2000, 1000  # window floor (drops neutral-site one-offs), S+1 floor


def venues(seasons) -> pd.DataFrame:
    if CACHE.exists():
        v = pd.read_parquet(CACHE)
        if set(seasons) <= set(v["season"]):
            return v
    rows = []
    for s in seasons:
        url = f"https://statsapi.mlb.com/api/v1/schedule?sportId=1&season={s}&gameType=R"
        with urllib.request.urlopen(url, timeout=60) as r:
            for day in json.load(r).get("dates", []):
                for g in day["games"]:
                    rows.append({"game_pk": g["gamePk"], "season": s, "venue_id": g["venue"]["id"], "venue": g["venue"]["name"]})
    v = pd.DataFrame(rows).drop_duplicates("game_pk")
    v.to_parquet(CACHE)
    return v


def counts(con, seasons) -> pd.DataFrame:
    cols = ", ".join(f"count(*) FILTER (WHERE events IN {ev}) AS c_{k}" for k, ev in COMP.items())
    return con.sql(f"""SELECT game_pk, season, home_team, away_team, stand, count(*) AS pa, {cols}
                       FROM pitches_all WHERE game_type = 'R' AND events IS NOT NULL
                         AND season IN ({",".join(map(str, seasons))}) GROUP BY 1, 2, 3, 4, 5""").df()


def ratios(g: pd.DataFrame, window) -> pd.DataFrame:
    """Raw home/road log ratio per (team, venue, hand, component) over the seasons in `window`."""
    w = g[g["season"].isin(window)]
    home = w.groupby(["home_team", "venue_id", "stand"])[["pa", *[f"c_{k}" for k in COMP]]].sum()
    home_seasons = w.groupby(["home_team", "venue_id"])["season"].unique()
    out = []
    for (team, vid, hand), h in home.iterrows():
        ss = home_seasons[(team, vid)]
        rd = w[(w["away_team"] == team) & w["season"].isin(ss) & (w["stand"] == hand)][["pa", *[f"c_{k}" for k in COMP]]].sum()
        for k in COMP:
            hc, rc = h[f"c_{k}"], rd[f"c_{k}"]
            if hc > 0 and rc > 0 and rd["pa"] > 0:
                out.append({"team": team, "venue_id": vid, "stand": hand, "comp": k, "home_pa": int(h["pa"]),
                            "lr": np.log((hc / h["pa"]) / (rc / rd["pa"])), "v": 1 / hc + 1 / rc})
    return pd.DataFrame(out)


def shrink(r: pd.DataFrame) -> pd.DataFrame:
    r = r.copy()
    big = r["home_pa"] >= MIN_HOME_PA
    tau2 = r[big].groupby(["comp", "stand"]).apply(lambda x: max(1e-6, x["lr"].var() - x["v"].mean())).rename("tau2")
    r = r.join(tau2, on=["comp", "stand"])
    r["eb"] = r["lr"] * r["tau2"] / (r["tau2"] + r["v"])
    return r


def demo():
    r = pd.DataFrame({"comp": ["HR"] * 3, "stand": ["R"] * 3, "home_pa": [3000] * 3, "lr": [0.2, -0.2, 0.0], "v": [0.01] * 3})
    s = shrink(r)
    # var(lr) = .04, mean v = .01 -> tau2 = .03, weight .75 -> eb = .15
    assert abs(s["eb"].iloc[0] - 0.15) < 1e-9, s["eb"].iloc[0]
    print("demo ok")


def main():
    con = mart.connect()
    seasons = list(range(2020, 2027))
    g = counts(con, seasons).merge(venues(seasons)[["game_pk", "venue_id", "venue"]], on="game_pk")
    names = g.groupby("venue_id")["venue"].agg(lambda x: x.mode().iloc[0])
    key = ["team", "venue_id", "stand", "comp"]
    rows = []
    for s in range(2022, 2026):
        eb = shrink(ratios(g, range(s - 2, s + 1)))[key + ["eb", "home_pa"]]
        raw = ratios(g, [s])[key + ["lr"]].rename(columns={"lr": "raw_s"})
        nxt = ratios(g, [s + 1])[key + ["lr", "home_pa"]].rename(columns={"lr": "y", "home_pa": "next_pa"})
        m = eb.merge(raw, on=key).merge(nxt, on=key)
        m = m[(m["home_pa"] >= MIN_HOME_PA) & (m["next_pa"] >= MIN_NEXT_PA)].assign(season=s)
        rows.append(m)
    d = pd.concat(rows, ignore_index=True)
    d["mlbam"] = d["venue_id"]  # pooled_dr clusters on this column: here, the venue
    res = {"floors": {"window_home_pa": MIN_HOME_PA, "next_home_pa": MIN_NEXT_PA}, "claims": {}}
    shipped = []
    for k in COMP:
        x = d[d["comp"] == k].reset_index(drop=True)
        c = pooled_dr(x, "raw_s", "eb", "y")
        pos = all(v["r_eb"] > 0 for v in c["pairs"].values())
        c.update(n=int(len(x)), all_pairs_positive=pos,
                 by_hand={h: round(float(x[x["stand"] == h]["eb"].corr(x[x["stand"] == h]["y"])), 3) for h in ("L", "R")},
                 verdict="CONFIRMED" if c["ci"][0] > 0 and pos else "NOT CONFIRMED")
        res["claims"][k] = c
        if c["verdict"] == "CONFIRMED":
            shipped.append(k)
    latest = shrink(ratios(g, range(2024, 2027)))
    latest = latest[latest["home_pa"] >= MIN_HOME_PA]
    res["tau"] = {f"{c}_{h}": round(float(np.sqrt(t)), 4) for (c, h), t in latest.groupby(["comp", "stand"])["tau2"].first().items()}
    hr = latest[latest["comp"] == "HR"].groupby("team")["eb"].mean().sort_values(ascending=False)
    t3 = latest[latest["comp"] == "3B"].groupby("team")["eb"].mean().sort_values(ascending=False)
    res["sanity"] = {"hr_top5": list(hr.index[:5]), "3b_top3": list(t3.index[:3])}
    print(json.dumps(res, indent=1, default=str))
    (PIPE / "results" / "park_factors_SEALED.json").write_text(json.dumps(res, indent=1, default=str))
    out = {"window": "2024-2026", "shipped": shipped, "method": "RESULTS-MLB §70", "venues": []}
    for (team, vid), x in latest.groupby(["team", "venue_id"]):
        pf = {c: {h: round(100 * float(np.exp(v)), 1) for h, v in zip(y["stand"], y["eb"])} for c, y in x.groupby("comp") if c in shipped}
        out["venues"].append({"team": team, "venue_id": int(vid), "venue": names.get(vid), "home_pa": int(x["home_pa"].max()), "pf": pf})
    (PIPE / "results" / "park_factors.json").write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    demo() if "--demo" in sys.argv else main()
