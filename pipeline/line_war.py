"""line_war.py — prospect program F1: our WAR from public MLB season lines, 2011-26, for prospect value labels.

    python pipeline/line_war.py           # build data/milb/line_war.parquet + validation -> results/line_war_check.json
    python pipeline/line_war.py --demo    # self-check, no data

Same accounting as §85 (`war.accounting`: league + replacement, 1,000 WAR x G/2,430 split 57/43), but every input comes
from Stats API season lines, so it reaches back before the 2020 pitch mart.
  batting    = linear weights per event (uBB .30, HBP .32, 1B .45, 2B .76, 3B 1.03, HR 1.40, out -.27) scaled to the season's
               runs per PA; baserunning = SB .2, CS -.41
  positional = FanGraphs per-162 values x G / 162 by the line's listed position (DH -17.5)
  pitchers   = §85 FIP WAR, role replacement 0.03/0.12, no leverage
ponytail: no range, framing or park terms (pre-2020 has no pitch data here) and leverage 1 for relievers; the gates
below say how far that costs us. B-Ref's war_daily files are a validation reference only, never a label or shown.
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

PIPE = Path(__file__).resolve().parent
ROOT = PIPE.parent
MILB = ROOT / "data" / "milb"
WEB = ROOT / "data" / "export" / "web"
sys.path.insert(0, str(PIPE))
from war import POS_162, DH_162, accounting  # noqa: E402

LW = {"uBB": .30, "HBP": .32, "1B": .45, "2B": .76, "3B": 1.03, "HR": 1.40, "out": -.27}
POS = {"C": 2, "1B": 3, "2B": 4, "3B": 5, "SS": 6, "LF": 7, "CF": 8, "RF": 9}
SEASONS = [s for s in range(2011, 2027)]


def lines(kind):
    d = pd.concat([pd.read_parquet(MILB / f"hist_mlb_{kind}.parquet"), pd.read_parquet(MILB / f"mlb_{kind}.parquet")])
    d = d[d.sport_id == 1].drop_duplicates(["mlbam_id", "season", "team_id"])
    num = d.columns.difference(["mlbam_id", "player_name", "season", "sport_id", "level", "league_name", "team_id",
                                "team_name", "age", "birth_date", "bats", "throws", "position"])
    d[num] = d[num].apply(pd.to_numeric, errors="coerce").fillna(0)
    agg = {c: "sum" for c in num}
    agg["position"] = lambda s: s.mode().iat[0] if len(s.dropna()) else None
    return d.groupby(["season", "mlbam_id"]).agg(agg).reset_index().rename(columns={"mlbam_id": "id"})


def build():
    h, p = lines("hitters"), lines("pitchers")
    lg = p.groupby("season").agg(R=("R", "sum"), outs=("OUTS", "sum"), G=("GS", "sum"))
    lg["G"] = lg.G / 2                                                   # two starts per game
    lg["ra9"] = 27 * lg.R / lg.outs
    lg["rpw"] = 9 * (lg.R / (lg.outs / 3)) * 1.5 + 3
    pit_outs = p.set_index(["season", "id"]).OUTS
    h = h[~((h.set_index(["season", "id"]).index.map(pit_outs).fillna(0).values >= 30) & (h.PA < 100))]   # pitchers batting
    one = h.H - h["2B"] - h["3B"] - h.HR
    outs = h.AB - h.H + h.SF
    raw = (LW["uBB"] * (h.BB - h.IBB) + LW["HBP"] * h.HBP + LW["1B"] * one + LW["2B"] * h["2B"] + LW["3B"] * h["3B"]
           + LW["HR"] * h.HR + LW["out"] * outs)
    lg_rpa = (lg.R / h.groupby("season").PA.sum())
    scale = h.season.map(lg_rpa / lg_rpa.mean())
    h["pa"], h["bat"] = h.PA, raw * scale
    h["bsr"] = 0.2 * h.SB - 0.41 * h.CS
    h["fld"] = 0.0
    h["posn"] = [POS_162.get(POS.get(ps), DH_162 if ps == "DH" else 0.0) * g / 162 for ps, g in zip(h.position, h.G)]
    p = p[p.OUTS > 0].copy()
    p["ip"] = p.OUTS / 3
    p["g"] = p.G.clip(lower=1)
    fip_raw = (13 * p.HR + 3 * (p.BB + p.HBP) - 2 * p.SO) / p.ip
    lgfip = p.groupby("season").apply(lambda d: (13 * d.HR.sum() + 3 * (d.BB.sum() + d.HBP.sum()) - 2 * d.SO.sum()) / d.ip.sum())
    p["fipr9"] = fip_raw + p.season.map(lg.ra9 - lgfip)
    ra9, ipg, gs = p.season.map(lg.ra9), p.ip / p.g, p.GS / p.g
    drpw = (((18 - ipg) * ra9 + ipg * p.fipr9) / 18 + 2) * 1.5
    p["waa_raw"] = (ra9 - p.fipr9) / drpw * p.ip / 9
    p["rep_raw"] = (0.03 * (1 - gs) + 0.12 * gs) * p.ip / 9
    oh, op = [], []
    for s in SEASONS:
        if s not in lg.index:
            continue
        a, b = accounting(h[h.season == s], p[p.season == s], lg.at[s, "G"], lg.at[s, "rpw"])
        oh.append(a)
        op.append(b)
    out = pd.concat([pd.concat(oh)[["season", "id", "war", "pa"]].assign(role="bat"),
                     pd.concat(op)[["season", "id", "war", "ip"]].assign(role="pit")])
    return out


def check(w):
    r = lambda a, b: round(float(np.corrcoef(a, b)[0, 1]), 3)  # noqa: E731
    res = {}
    # vs our §85 WAR, 2020-26
    own = {}
    for s, v in json.loads((WEB / "war_index.json").read_text())["seasons"].items():
        for grp, role in (("hitters", "bat"), ("pitchers", "pit")):
            for x in v.get(grp, []):
                own[(int(s), int(x["id"]), role)] = x.get("war") or 0
    w = w.copy()
    w["own"] = [own.get((s, i, ro)) for s, i, ro in zip(w.season, w.id, w.role)]
    for role, vol, floor in (("bat", "pa", 300), ("pit", "ip", 50)):
        d = w[(w.role == role) & w.own.notna() & (w[vol] >= floor) & (w.season != 2020)]
        res[f"vs_war85_{role}"] = {"n": len(d), "r": r(d.war, d.own)}
    # vs B-Ref (validation only), 2011-19 where §85 does not reach
    for kind, role, vol, floor in (("bat", "bat", "pa", 300), ("pitch", "pit", "ip", 50)):
        b = pd.read_csv(MILB / "bref" / f"war_daily_{kind}.txt", low_memory=False)
        b = b[b.lg_ID.isin(["AL", "NL"]) & (b.pitcher == "N" if kind == "bat" else True)]
        b["WAR"] = pd.to_numeric(b.WAR, errors="coerce")
        b = b.groupby(["year_ID", "mlb_ID"]).WAR.sum()
        d = w[(w.role == role) & (w[vol] >= floor) & (w.season != 2020)].copy()
        d["bw"] = [b.get((s, i)) for s, i in zip(d.season, d.id)]
        d = d.dropna(subset=["bw"])
        res[f"vs_bref_{role}"] = {"n": len(d), "r": r(d.war, d.bw),
                                  "r_2011_19": r(d[d.season < 2020].war, d[d.season < 2020].bw)}
        # the label shape: WAR over the first 6 MLB seasons, debuts 2012-20 (2011 lines can't see an earlier debut)
        x = w[w.role == role].copy()
        x["deb"] = x.groupby("id").season.transform("min")
        x = x[x.deb.between(2012, 2020) & (x.season < x.deb + 6)]
        x["bw"] = [b.get((s, i), 0.0) for s, i in zip(x.season, x.id)]
        j = x.groupby("id")[["war", "bw"]].sum()
        res[f"ctrl6_sum_{role}"] = {"n": len(j), "r": r(j.war, j.bw), "r_ge1": r(j[j.bw.abs() >= 1].war, j[j.bw.abs() >= 1].bw)}
    res["season_totals"] = {str(int(s)): round(float(v), 1) for s, v in w.groupby("season").war.sum().items()}
    return res


def demo():
    from war import accounting as acc
    pos = pd.DataFrame({"pa": [600, 300], "bat": [20.0, -10.0], "bsr": [1.0, 0.0], "fld": [0.0, 0.0], "posn": [7.5, -17.5]})
    pit = pd.DataFrame({"ip": [180.0], "waa_raw": [2.0], "rep_raw": [2.4]})
    a, b = acc(pos, pit, 2430, 10.0)
    assert abs(a.war.sum() - 570) < 1e-6 and a.war.iat[0] > a.war.iat[1]
    assert POS_162[POS["SS"]] == 7.5
    print("demo ok")


if __name__ == "__main__":
    if "--demo" in sys.argv:
        demo()
        sys.exit()
    w = build()
    w.to_parquet(MILB / "line_war.parquet", compression="zstd")
    res = check(w)
    (PIPE / "results" / "line_war_check.json").write_text(json.dumps(res, indent=1))
    print(json.dumps(res, indent=1))
