"""RESULTS-MLB §72 (D-04 part 2): park-adjusted wOBA (Savant scale) and FIP, per plate appearance.

    python park_adjust.py            # the §72 read once -> results/park_adjusted.csv + park_adjust_SEALED.json
    python park_adjust.py --demo     # self-check of the per-PA divide

Each confirmed §70 component (2B, 3B, HR, SO) on a PA is divided by its venue factor for the batter's hand,
from the window S-2..S; singles, walks and HBP are not adjusted (their factors failed §70); venues under the
§70 floor get 1. Adjusted wOBA = sum(woba_value / PF) / sum(woba_denom). Adjusted FIP uses HR/PF and K/PF
with official outs and the season's FIP constant (league ERA - raw league FIP).
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

from park_factors import MIN_HOME_PA, counts, ratios, shrink, venues
from paths import MART_DIR  # noqa: E402
sys.path.insert(0, str(MART_DIR))
import mart  # noqa: E402

PIPE = Path(__file__).resolve().parent
MILB = PIPE.parent / "data" / "milb"
COMP_OF = {"double": "2B", "triple": "3B", "home_run": "HR", "strikeout": "SO", "strikeout_double_play": "SO"}
SQL = """
SELECT game_pk, season, home_team, away_team, inning_topbot, batter, pitcher, stand, events, woba_value, woba_denom
FROM pitches_all WHERE game_type = 'R' AND events IS NOT NULL AND season BETWEEN 2020 AND 2026
"""


def factor_table(con, shipped) -> pd.DataFrame:
    """(season, team, venue_id, stand, comp) -> PF (exp of the EB log ratio), window S-2..S."""
    seasons = list(range(2020, 2027))
    g = counts(con, seasons).merge(venues(seasons)[["game_pk", "venue_id"]], on="game_pk")
    out = []
    for s in seasons:
        r = shrink(ratios(g, range(s - 2, s + 1)))
        r = r[(r["home_pa"] >= MIN_HOME_PA) & r["comp"].isin(shipped)]
        out.append(r.assign(season=s, pf=np.exp(r["eb"]))[["season", "team", "venue_id", "stand", "comp", "pf"]])
    return pd.concat(out, ignore_index=True)


def adjust(pa: pd.DataFrame, ft: pd.DataFrame) -> pd.DataFrame:
    """Adds pf (1 where unadjusted) and the adjusted columns to a PA frame."""
    pa = pa.assign(comp=pa["events"].map(COMP_OF))
    m = pa.merge(ft.rename(columns={"team": "home_team"}), on=["season", "home_team", "venue_id", "stand", "comp"],
                 how="left")
    m["pf"] = m["pf"].fillna(1.0)
    m["woba_adj"] = m["woba_value"].fillna(0) / m["pf"]
    m["hr_adj"] = (m["comp"] == "HR") / m["pf"]
    m["k_adj"] = (m["comp"] == "SO") / m["pf"]
    return m


def demo():
    pa = pd.DataFrame({"season": [2025] * 3, "home_team": ["COL"] * 3, "venue_id": [19] * 3, "stand": ["R"] * 3,
                       "events": ["home_run", "single", "strikeout"], "woba_value": [2.0, 0.9, 0.0]})
    ft = pd.DataFrame({"season": [2025, 2025], "team": ["COL", "COL"], "venue_id": [19, 19], "stand": ["R", "R"],
                       "comp": ["HR", "SO"], "pf": [1.25, 0.8]})
    m = adjust(pa, ft)
    assert np.allclose(m["woba_adj"], [1.6, 0.9, 0.0]) and np.allclose(m["k_adj"], [0, 0, 1.25]), m
    print("demo ok")


def main():
    con = mart.connect()
    shipped = json.loads((PIPE / "results" / "park_factors.json").read_text())["shipped"]
    ft = factor_table(con, shipped)
    pa = con.sql(SQL).df().merge(venues(list(range(2020, 2027)))[["game_pk", "venue_id"]], on="game_pk")
    m = adjust(pa, ft)
    m["is_bb"] = m["events"].isin(["walk", "intent_walk"])
    m["is_hbp"] = m["events"] == "hit_by_pitch"
    m["is_hr"] = m["events"] == "home_run"
    m["is_k"] = m["comp"] == "SO"
    m["bat_team"] = np.where(m["inning_topbot"] == "Top", m["away_team"], m["home_team"])
    m["fld_team"] = np.where(m["inning_topbot"] == "Top", m["home_team"], m["away_team"])

    h = m.groupby(["batter", "season"]).agg(pa=("events", "size"), wn=("woba_value", "sum"), wa=("woba_adj", "sum"),
                                              den=("woba_denom", "sum"),
                                              team=("bat_team", lambda x: x.mode().iloc[0])).reset_index()
    h["woba"], h["woba_adj"] = h["wn"] / h["den"], h["wa"] / h["den"]

    oo = pd.read_parquet(MILB / "mlb_pitchers.parquet", columns=["mlbam_id", "season", "level", "ER", "OUTS"])
    oo = oo[oo["level"] == "MLB"].groupby(["mlbam_id", "season"])[["ER", "OUTS"]].sum().reset_index()
    p = m.groupby(["pitcher", "season"]).agg(bf=("events", "size"), hr=("is_hr", "sum"), hra=("hr_adj", "sum"),
                                               k=("is_k", "sum"), ka=("k_adj", "sum"), bb=("is_bb", "sum"),
                                               hbp=("is_hbp", "sum"),
                                               team=("fld_team", lambda x: x.mode().iloc[0])).reset_index()
    p = p.merge(oo.rename(columns={"mlbam_id": "pitcher"}), on=["pitcher", "season"], how="inner")
    p = p[p["OUTS"] > 0]
    lg = p.groupby("season")[["hr", "bb", "hbp", "k", "ER", "OUTS"]].sum()
    c = 27 * lg["ER"] / lg["OUTS"] - (13 * lg["hr"] + 3 * (lg["bb"] + lg["hbp"]) - 2 * lg["k"]) / (lg["OUTS"] / 3)
    ip = p["OUTS"] / 3
    cs = p["season"].map(c)
    p["fip"] = (13 * p["hr"] + 3 * (p["bb"] + p["hbp"]) - 2 * p["k"]) / ip + cs
    p["fip_adj"] = (13 * p["hra"] + 3 * (p["bb"] + p["hbp"]) - 2 * p["ka"]) / ip + cs

    out = pd.concat([h[["batter", "season", "pa", "team", "woba", "woba_adj"]].rename(columns={"batter": "mlbam"}).assign(role="hitter"),
                     p[["pitcher", "season", "bf", "team", "fip", "fip_adj"]].rename(columns={"pitcher": "mlbam", "bf": "pa"}).assign(role="pitcher")])
    out.round(4).to_csv(PIPE / "results" / "park_adjusted.csv", index=False)

    res = {"claims": {}, "reported": {}}
    for role, raw, adj in (("hitter", "woba", "woba_adj"), ("pitcher", "fip", "fip_adj")):
        d = out[out["role"] == role]
        nxt = d[["mlbam", "season", "pa", "team", raw, adj]].assign(season=d["season"] - 1).rename(
            columns={"pa": "pa_n", "team": "team_n", raw: raw + "_n", adj: adj + "_n"})
        pr = d.merge(nxt, on=["mlbam", "season"])
        pr = pr[(pr["pa"] >= 200) & (pr["pa_n"] >= 200) & pr["season"].between(2022, 2025)]
        for grp, sub in (("movers", pr[pr["team"] != pr["team_n"]]), ("stayers", pr[pr["team"] == pr["team_n"]])):
            sub = sub.reset_index(drop=True)
            # pooled_dr compares r(b, y) - r(a, y) on one y; here each stat predicts its own next value,
            # so run it on the per-stat y and difference the two r's per pair by hand.
            per, dr_b = {}, []
            rng = np.random.default_rng(13)
            for s, g in sub.groupby("season"):
                r_raw, r_adj = g[raw].corr(g[raw + "_n"]), g[adj].corr(g[adj + "_n"])
                per[f"{s}->{s + 1}"] = {"n": int(len(g)), "r_raw": round(float(r_raw), 4), "r_adj": round(float(r_adj), 4)}
            ids = sub["mlbam"].unique()
            for _ in range(2000):
                pick = rng.choice(ids, len(ids))
                b = sub.set_index("mlbam").loc[pick].reset_index()
                v = [g[adj].corr(g[adj + "_n"]) - g[raw].corr(g[raw + "_n"]) for _, g in b.groupby("season")]
                dr_b.append(np.mean(v))
            point = float(np.mean([v["r_adj"] - v["r_raw"] for v in per.values()]))
            ci = [round(float(x), 4) for x in np.percentile(dr_b, [2.5, 97.5])]
            entry = {"pairs": per, "dr": round(point, 4), "ci": ci, "n": int(len(sub))}
            if grp == "movers":
                entry["verdict"] = "CONFIRMED" if ci[0] > 0 else "NOT CONFIRMED"
                res["claims"][role] = entry
            else:
                res["reported"][f"{role}_stayers"] = entry
    big = out[(out["role"] == "hitter") & (out["pa"] >= 400) & (out["season"] == 2025)].assign(d=lambda x: x["woba_adj"] - x["woba"])
    res["reported"]["largest_hitter_moves_2025"] = big.sort_values("d")[["mlbam", "team", "woba", "woba_adj"]].iloc[[0, 1, 2, -3, -2, -1]].round(3).to_dict("records")
    print(json.dumps(res, indent=1, default=str))
    (PIPE / "results" / "park_adjust_SEALED.json").write_text(json.dumps(res, indent=1, default=str))


if __name__ == "__main__":
    demo() if "--demo" in sys.argv else main()
