"""RESULTS-MLB §110: wRAA / wRC / wRC+ in the FanGraphs Library form, on the site's own wOBA.

    from wrc import context, line      # web_export's hitters family
    python pipeline/wrc.py --demo      # hand-calc selftest on one hitter + the centring/mean-100 check on a toy league
    python pipeline/wrc.py --read      # the §110 read (once): B-Ref gate, OOS, projected-wRC+ calibration

wRAA = (wOBA - lg wOBA) / scale x PA;  wRC = wRAA + lgR/PA x PA
wRC+ = 100 x (wRAA/PA + lgR/PA + (lgR/PA - PF x lgR/PA)) / D
  D  = his league's (AL/NL, by batting team, PA-weighted for movers) wRC/PA without pitcher hitter-seasons
  PF = PA-weighted §85 venue runs factor over the parks he batted in, re-centred per season x league so the
       PA-weighted mean applied PF over non-pitcher PAs is exactly 1 (BaseballGOAT E18: uncentred PF lifted wRC+ ~2).
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

PIPE = Path(__file__).resolve().parent
AL = {"BAL", "BOS", "NYY", "TB", "TOR", "CLE", "CWS", "DET", "KC", "MIN", "HOU", "LAA", "ATH", "OAK", "SEA", "TEX"}
PITCHER_PA = 100  # §85: a pitcher's own hitting leaves the pool under 100 PA that season


def line(woba, pa, c: dict, pf: float, den: float):
    """(wRAA, wRC, wRC+) for one line. c = that season's constants {lgWoba, scale, lgRpa}."""
    wraa = (woba - c["lgWoba"]) / c["scale"] * pa
    plus = 100 * ((woba - c["lgWoba"]) / c["scale"] + c["lgRpa"] + (c["lgRpa"] - pf * c["lgRpa"])) / den
    return wraa, wraa + c["lgRpa"] * pa, plus


def centre(g: pd.DataFrame) -> pd.Series:
    """PF re-centred per (season, lg): divide by the PA-weighted mean PF of non-pitcher PAs in that cell."""
    pool = g[~g["pitcher"]]
    m = (pool["n"] * pool["pf"]).groupby([pool["season"], pool["lg"]]).sum() / pool.groupby(["season", "lg"])["n"].sum()
    return g["pf"] / pd.Series(list(zip(g["season"], g["lg"])), index=g.index).map(m)


def game_rows(con, seasons) -> pd.DataFrame:
    """(season, game_pk, batter, bat_team) PA counts + whether he pitched in that game."""
    sl = ",".join(map(str, seasons))
    return con.sql(f"""
        WITH pa AS (
          SELECT season, game_pk, batter, CASE WHEN inning_topbot = 'Top' THEN away_team ELSE home_team END AS bat_team,
                 COUNT(DISTINCT at_bat_number) AS n
          FROM pitches_all WHERE game_type = 'R' AND season IN ({sl}) AND batter IS NOT NULL
            AND events IS NOT NULL AND events <> 'truncated_pa' GROUP BY ALL),
        pit AS (SELECT DISTINCT game_pk, pitcher FROM pitches_all WHERE game_type = 'R' AND season IN ({sl}))
        SELECT pa.*, pit.pitcher IS NOT NULL AS pitched FROM pa LEFT JOIN pit ON pa.game_pk = pit.game_pk AND pa.batter = pit.pitcher
    """).df()


def runs_frame(con, seasons) -> pd.DataFrame:
    """Per half-inning runs in the shape war.park_factors reads (season, game_pk, inning_topbot, bat/fld team, runs)."""
    sl = ",".join(map(str, seasons))
    return con.sql(f"""
        SELECT season, game_pk, inning, inning_topbot,
               CASE WHEN inning_topbot = 'Top' THEN away_team ELSE home_team END AS bat_team,
               CASE WHEN inning_topbot = 'Top' THEN home_team ELSE away_team END AS fld_team,
               SUM(post_bat_score - bat_score) AS runs
        FROM pitches_all WHERE game_type = 'R' AND season IN ({sl}) GROUP BY ALL""").df()


def context(con, seasons, hag: pd.DataFrame, woba_of, hfactor: dict):
    """Season constants + per-(id, season) and per-(id, season, team) {pf, den} for the hitters family.
    hag: the family's hitter-season counts (id, season, pa, ...); woba_of(t, s): its wOBA. Asserts the §110 guards."""
    from war import park_factors  # §85's venue runs factor, the one WAR already applies
    from park_factors import venues
    vmap = venues(sorted(seasons))
    rf = runs_frame(con, seasons)
    pf = park_factors(rf, vmap)
    g = game_rows(con, seasons).merge(vmap[["game_pk", "venue_id"]], on="game_pk", how="left")
    g = g.merge(pf, on=["season", "venue_id"], how="left")
    g["pf"] = g["pf"].fillna(1.0)
    g["lg"] = np.where(g["bat_team"].isin(AL), "AL", "NL")
    tot = g.groupby(["season", "batter"])["n"].transform("sum")
    pitched_any = g.groupby(["season", "batter"])["pitched"].transform("any")
    g["pitcher"] = pitched_any & (tot < PITCHER_PA)
    g["pfc"] = centre(g)

    # season constants: lg wOBA over every hitter's PA (= lg OBP by the family's scale), lgR/PA from the scores
    cons = {}
    hw = hag.assign(w=[woba_of(t, t.season) for t in hag.itertuples()])
    runs = rf.groupby("season")["runs"].sum()
    for s in seasons:
        h = hag[hag["season"] == s]
        if not len(h):
            continue
        ab = h["pa"] - h["bb"] - h["hbp"] - h["sf"] - h["sh"] - h["ci"]
        den = ab + h["bb"] - h["ibb"] + h["hbp"] + h["sf"]
        ws = hw.loc[h.index, "w"].astype(float)
        cons[s] = {"lgWoba": float((ws.fillna(0) * den).sum() / den.sum()), "scale": float(hfactor[s]),
                   "lgRpa": float(runs[s] / h["pa"].sum())}

    # per hitter: PF and league shares
    g["npf"], g["npf_raw"], g["nal"] = g["n"] * g["pfc"], g["n"] * g["pf"], g["n"] * (g["lg"] == "AL")
    per = g.groupby(["season", "batter"]).agg(n=("n", "sum"), npf=("npf", "sum"), npf_raw=("npf_raw", "sum"),
                                              nal=("nal", "sum"), pitcher=("pitcher", "first"))
    per = pd.DataFrame({"pf": per["npf"] / per["n"], "pf_raw": per["npf_raw"] / per["n"], "al": per["nal"] / per["n"],
                        "pitcher": per["pitcher"]})
    hh = hag.merge(per, left_on=["season", "id"], right_index=True, how="left")
    hh["w"] = hw["w"].astype(float)
    hh["pf"], hh["pf_raw"], hh["al"] = hh["pf"].fillna(1.0), hh["pf_raw"].fillna(1.0), hh["al"].fillna(0.0)
    hh["pitcher"] = hh["pitcher"].fillna(False).astype(bool)
    hh = hh[hh["w"].notna() & (hh["pa"] > 0)]
    for s, c in cons.items():
        h = hh[(hh["season"] == s) & ~hh["pitcher"]]
        wrc = (h["w"] - c["lgWoba"]) / c["scale"] * h["pa"] + c["lgRpa"] * h["pa"]
        for lg, share in (("AL", h["al"]), ("NL", 1 - h["al"])):
            c[f"den{lg}"] = float((wrc * share).sum() / (h["pa"] * share).sum())
        c["denMLB"] = float(wrc.sum() / h["pa"].sum())
    hh["den"] = [cons[s]["denAL"] * a + cons[s]["denNL"] * (1 - a) for s, a in zip(hh["season"], hh["al"])]

    # guards (hard): PF centred per season x league; PA-weighted mean wRC+ = 100 +- 0.5, park on and off
    pool = g[~g["pitcher"]]
    for (s, lg), d in pool.groupby(["season", "lg"]):
        m = (d["n"] * d["pfc"]).sum() / d["n"].sum()
        assert abs(m - 1) < 1e-9, f"PF not centred {s} {lg}: {m}"
    for s, c in cons.items():
        h = hh[(hh["season"] == s) & ~hh["pitcher"]]
        for park in (True, False):
            plus = line(h["w"], h["pa"], c, h["pf"] if park else 1.0, h["den"])[2]
            for lg, share in (("MLB", 1.0), ("AL", h["al"]), ("NL", 1 - h["al"])):
                wts = h["pa"] * share
                mean = float((plus * wts).sum() / wts.sum())
                assert abs(mean - 100) <= 0.5, f"mean wRC+ {s} {lg} park={park}: {mean:.2f}"
        c["pfRawMean"] = float((h["pa"] * h["pf_raw"]).sum() / h["pa"].sum())

    by_hitter = {(int(r.id), int(r.season)): {"pf": float(r.pf), "den": float(r.den)} for r in hh.itertuples()}
    # per club stint: that club's league and parks
    t = g.groupby(["season", "batter", "bat_team"]).agg(n=("n", "sum"), npf=("npf", "sum"), nal=("nal", "sum")).reset_index()
    t["pf"], t["al"] = t["npf"] / t["n"], t["nal"] > 0
    by_team = {(int(r.batter), int(r.season), r.bat_team): {"pf": float(r.pf), "den": cons[r.season]["denAL"] if r.al
               else cons[r.season]["denNL"]} for r in t.itertuples() if r.season in cons}
    print("wRC constants:", {s: {k: round(v, 4) for k, v in c.items()} for s, c in cons.items()}, flush=True)
    return cons, by_hitter, by_team


def demo():
    # one hitter by hand: wOBA .400, 600 PA, lg wOBA .320, scale 1.25, lgR/PA .120, PF 1.05, D .125
    c = {"lgWoba": .320, "scale": 1.25, "lgRpa": .120}
    wraa, wrc, plus = line(.400, 600, c, 1.05, .125)
    assert abs(wraa - 38.4) < 1e-9                       # (.400-.320)/1.25*600 = .064*600
    assert abs(wrc - (38.4 + 72.0)) < 1e-9               # + .120*600
    assert abs(plus - 100 * (.064 + .120 + (.120 - 1.05 * .120)) / .125) < 1e-9   # = 142.4
    assert abs(plus - 142.4) < 1e-9
    # centring: two parks, PF 1.2 on 100 PA and 0.9 on 300 PA -> mean 0.975 -> centred 1.2308 / 0.9231
    g = pd.DataFrame({"season": [2025, 2025, 2025], "lg": ["AL", "AL", "NL"], "n": [100, 300, 50],
                      "pf": [1.2, 0.9, 1.1], "pitcher": [False, False, True]})
    pfc = centre(g)
    assert abs((g["n"][:2] * pfc[:2]).sum() / 400 - 1) < 1e-12 and np.isnan(pfc[2])  # NL cell has only a pitcher
    print("demo ok")


if __name__ == "__main__":
    if "--demo" in sys.argv:
        demo()
    elif "--read" in sys.argv:
        from wrc_read import main
        main()
