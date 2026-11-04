"""org_export.py — the team-page organization files (docs/team-pages-plan.md): every affiliate, Rookie through AAA.

    python pipeline/org_export.py   -> data/export/web/orgs/index.json
                                       data/export/web/orgs/{abbr}/{season}/farm.json, depth.json

Source: the same Stats API season lines /minors shows (data/milb hitters/pitchers, 2021-26, built with
minors_export's formulas; FIP's constant stays the full level's), each team tied to its parent club per season by
data/milb/team_orgs.parquet. Positions from data/milb/fielding.parquet (games and innings at each position); the MLB
column of the depth grid uses the MLB lines' listed position. Descriptive box-score rates only: the AAA Statcast
grades (Whiff+, K+, xwOBA ...) are joined on the page from the AAA bake by player id, and Pipeline ranks from
prospects/{year}.json. Rookie splits into DSL and the complex leagues (ACL, FCL) wherever teams are ranked.
"""
import json
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from minors_export import LEVEL_ORDER, hitters, pitchers, r, rows_h, rows_p, season_age  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "data" / "milb"
OUT = ROOT / "data" / "export" / "web" / "orgs"
LV = {11: "AAA", 12: "AA", 13: "A+", 14: "A", 16: "ROK"}
# MLB club id -> site abbr (web_export.MLB_TEAM_IDS without its OAK/ARI aliases)
ABBR = {108: "LAA", 109: "AZ", 110: "BAL", 111: "BOS", 112: "CHC", 113: "CIN", 114: "CLE", 115: "COL", 116: "DET",
        117: "HOU", 118: "KC", 119: "LAD", 120: "WSH", 121: "NYM", 133: "ATH", 134: "PIT", 135: "SD", 136: "SEA",
        137: "SF", 138: "STL", 139: "TB", 140: "TEX", 141: "TOR", 142: "MIN", 143: "PHI", 144: "ATL", 145: "CWS",
        146: "MIA", 147: "NYY", 158: "MIL"}
POS = ["C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "DH"]
# team-rank direction: +1 higher is better, -1 lower is better
H_RANK = {"ops": 1, "iso": 1, "kPct": -1, "bbPct": 1}
P_RANK = {"era": -1, "fip": -1, "kPct": 1, "bbPct": -1, "kBbPct": 1}


def tier(level, league):
    """Rank groups: each level, with Rookie split into DSL and the US complex leagues."""
    return ("DSL" if league == "DSL" else "CPX") if level == "ROK" else level


def load():
    orgs = pd.read_parquet(SRC / "team_orgs.parquet")[["season", "team_id", "org_id"]]
    out = {}
    for kind in ("hitters", "pitchers"):
        d = pd.read_parquet(SRC / f"{kind}.parquet")
        d = d[d.sport_id.isin(LV) & (d.league_name != "MEX")].merge(orgs, on=["season", "team_id"], how="left")
        bad = d.org_id.isna() | ~d.org_id.isin(ABBR)
        assert not bad.any(), f"{kind}: {int(bad.sum())} line rows with no parent club"
        d["org"] = d.org_id.astype(int).map(ABBR)
        d["tier"] = [tier(lv, lg) for lv, lg in zip(d.level, d.league_name)]
        out[kind] = d
    return out


def team_rows(L):
    """One row per affiliate x season: team rates + rank within its tier."""
    key = ["team_id", "season", "level"]
    meta = L["hitters"].groupby(key)[["team_name", "league_name", "org", "tier"]].first()
    h = hitters(L["hitters"], key).set_index(key)
    h["ops"] = h.obp + h.slg
    p = pitchers(L["pitchers"], key, league=L["pitchers"]).set_index(key)
    t = meta.join(h[["PA", "HR"] + list(H_RANK) + ["obp", "slg", "avg"]].add_prefix("h_"))
    p["kBbPct"] = p.kPct - p.bbPct
    t = t.join(p[["OUTS", "ip"] + list(P_RANK)].add_prefix("p_"))
    t = t.reset_index()
    for pre, spec in (("h_", H_RANK), ("p_", P_RANK)):
        for c, sgn in spec.items():
            t[f"{pre}{c}_rk"] = t.groupby(["season", "tier"])[pre + c].rank(ascending=sgn < 0, method="min")
    t["n_tier"] = t.groupby(["season", "tier"]).team_id.transform("size")
    return t


def org_totals(L, teams):
    """Org-wide rates across every affiliate (FIP: innings-weighted over the affiliates' level-constant FIPs)."""
    key = ["org", "season"]
    h = hitters(L["hitters"].assign(level="ALL"), key + ["level"]).set_index(key)
    p = pitchers(L["pitchers"].assign(level="ALL"), key + ["level"]).set_index(key)
    fip = teams.assign(w=teams.p_OUTS * teams.p_fip).groupby(key)[["w", "p_OUTS"]].sum()
    t = pd.DataFrame({"h_pa": h.PA, "h_ops": h.obp + h.slg, "h_iso": h.iso, "h_kPct": h.kPct, "h_bbPct": h.bbPct,
                      "p_ip": p.ip, "p_era": p.era, "p_fip": fip.w / fip.p_OUTS, "p_kPct": p.kPct, "p_bbPct": p.bbPct,
                      "p_kBbPct": p.kPct - p.bbPct}).reset_index()
    for c, sgn in [(f"h_{k}", v) for k, v in H_RANK.items()] + [(f"p_{k}", v) for k, v in P_RANK.items()]:
        t[c + "_rk"] = t.groupby("season")[c].rank(ascending=sgn < 0, method="min")
    return t


def _team_json(t):
    def blk(pre, spec, extra):
        o = {k: r(getattr(t, pre + k), 3 if k in ("ops", "iso", "avg", "obp", "slg") else 2) for k in list(spec) + extra}
        o["rk"] = {k: (None if pd.isna(getattr(t, f"{pre}{k}_rk")) else int(getattr(t, f"{pre}{k}_rk"))) for k in spec}
        return o
    return {"teamId": int(t.team_id), "team": t.team_name, "level": t.level, "league": t.league_name, "tier": t.tier,
            "nTier": int(t.n_tier), "hit": {"pa": int(t.h_PA), **blk("h_", H_RANK, ["avg", "obp", "slg"])},
            "pitch": {"ip": r(t.p_ip), **blk("p_", P_RANK, [])}}


_NAMES = {}


def NAMES():
    """id -> name from every line table + the people register: a player can field a spot with no hitting line there."""
    if not _NAMES:
        for f in ("hitters", "pitchers", "hist_hitters", "hist_pitchers", "mlb_hitters", "mlb_pitchers"):
            d = pd.read_parquet(SRC / f"{f}.parquet", columns=["mlbam_id", "player_name"]).drop_duplicates("mlbam_id")
            _NAMES.update({k: v for k, v in zip(d.mlbam_id, d.player_name) if k not in _NAMES})
        pp = pd.read_parquet(SRC / "people.parquet", columns=["id", "name"])
        _NAMES.update({int(k): v for k, v in zip(pp.id, pp.name) if int(k) not in _NAMES})
    return _NAMES


def depth(L, season, org, h_rows, p_rows):
    """Position x level grid. Hitters by games at each spot (fielding table); pitchers SP by GS, RP by relief games."""
    f = pd.read_parquet(SRC / "fielding.parquet")
    f = f[(f.season == season) & f.sport_id.isin(LV)].merge(
        pd.read_parquet(SRC / "team_orgs.parquet")[["season", "team_id", "org_id"]], on=["season", "team_id"])
    f = f[f.org_id.map(ABBR) == org].assign(level=lambda x: x.sport_id.map(LV))
    teams = pd.concat([L["hitters"], L["pitchers"]])[["season", "team_id", "team_name", "league_name"]].drop_duplicates(
        ["season", "team_id"])
    f = f.merge(teams, on=["season", "team_id"], how="left")
    hstat = {(x["id"], x["level"]): x for x in h_rows}
    names = NAMES()
    grid = {pos: {lv: [] for lv in ["MLB"] + LEVEL_ORDER} for pos in POS + ["SP", "RP"]}
    for (lv, pos, pid), g in f[f.pos.isin(POS)].groupby(["level", "pos", "mlbam_id"]):
        hs = hstat.get((str(pid), lv), {})
        grid[pos][lv].append({"id": str(pid), "name": hs.get("name") or names.get(int(pid)), "age": hs.get("age"), "g": int(g.G.sum()),
                              "inn": r(g.inn.sum()), "ops": hs.get("ops"), "pa": hs.get("pa"),
                              "team": g.team_name.iloc[0] if g.team_id.nunique() == 1 else f"{g.team_id.nunique()} teams",
                              "lg": g.league_name.iloc[0]})
    for x in p_rows:
        e = {"id": x["id"], "name": x["name"], "age": x["age"], "kBbPct": x["kBbPct"], "ip": x["ip"], "team": x["team"],
             "lg": x.get("lg")}
        if x["gs"]:
            grid["SP"][x["level"]].append({**e, "g": x["gs"]})
        if x["g"] - x["gs"]:
            grid["RP"][x["level"]].append({**e, "g": x["g"] - x["gs"]})
    # MLB column: listed position + games from the MLB lines (no MLB fielding split on disk)
    for kind in ("hitters", "pitchers"):
        m = pd.read_parquet(SRC / f"mlb_{kind}.parquet")
        m = m[(m.season == season) & (m.team_id.map(ABBR) == org)]
        if kind == "hitters":
            for t in hitters(m.assign(level="MLB"), ["mlbam_id", "season", "level"]).itertuples():
                pos = t.position if t.position in POS else ("DH" if t.position in ("TWP",) else None)
                if pos and t.PA:
                    grid[pos]["MLB"].append({"id": str(t.mlbam_id), "name": t.player_name, "g": int(t.G),
                                             "pa": int(t.PA), "ops": r(t.obp + t.slg, 3), "listed": True})
        else:
            for t in pitchers(m.assign(level="MLB"), ["mlbam_id", "season", "level"]).itertuples():
                e = {"id": str(t.mlbam_id), "name": t.player_name, "ip": r(t.ip), "kBbPct": r(t.kPct - t.bbPct)}
                if t.GS:
                    grid["SP"]["MLB"].append({**e, "g": int(t.GS)})
                if t.G - t.GS:
                    grid["RP"]["MLB"].append({**e, "g": int(t.G - t.GS)})
    for pos in grid:
        for lv in grid[pos]:
            grid[pos][lv].sort(key=lambda e: -(e["g"] or 0))
    return grid


def roster(L, season):
    """Per club, its current 40-man (rosters40/teams.json): games by level this season and this season's IL stints.

    Stints from transactions_full: "placed ... on the N-day injured list" opens one, any "activated" / "reinstated" closes it (activations often
    omit the list), a
    "transferred" to the 60-day keeps it open and updates the list. The placing team is the transaction's toTeam.
    """
    r40 = json.loads((ROOT / "data" / "export" / "web" / "rosters40" / "teams.json").read_text())["teams"]
    canon = {"ARI": "AZ", "OAK": "ATH"}
    games = {}
    for kind in ("hitters", "pitchers"):
        d = L[kind][L[kind].season == season]
        for (org, pid, lv), g in d.groupby(["org", "mlbam_id", "level"]).G.sum().items():
            e = games.setdefault((org, int(pid)), {})
            e[lv] = max(e.get(lv, 0), int(g))
        m = pd.read_parquet(SRC / f"mlb_{kind}.parquet")
        m = m[(m.season == season) & m.team_id.isin(ABBR)]
        for (tid, pid), g in m.groupby(["team_id", "mlbam_id"]).G.sum().items():
            e = games.setdefault((ABBR[tid], int(pid)), {})
            e["MLB"] = max(e.get("MLB", 0), int(g))
    tr = pd.read_parquet(SRC / "transactions_full.parquet")
    tr = tr[(tr.date >= f"{season}-01-01") & (tr.date <= f"{season}-12-31")
            & tr.desc.str.contains("injured list| activated | reinstated ", case=False, na=False)].sort_values("date")
    stints = {}
    for t in tr.itertuples():
        verb = next((v for v in ("placed", "activated", "reinstated", "transferred") if f" {v} " in t.desc), None)
        lst = next((w for w in t.desc.replace("-", " ").split() if w.isdigit()), None)
        s_ = stints.setdefault(int(t.id), [])
        if verb == "placed" and "injured list" in t.desc:
            if s_ and s_[-1]["to"] is None:  # a fresh placement (e.g. minors 7-day -> MLB 60-day) ends the open one
                s_[-1]["to"] = t.date
            s_.append({"from": t.date, "to": None, "list": f"{lst}-day" if lst else "IL", "team": t.to})
        elif verb == "transferred" and s_ and s_[-1]["to"] is None:
            s_[-1]["list"] = f"{lst}-day" if lst else s_[-1]["list"]
        elif verb in ("activated", "reinstated") and s_ and s_[-1]["to"] is None:
            s_[-1]["to"] = t.date
    out = {}
    for team in r40:
        org = canon.get(team["abbr"], team["abbr"])
        out[org] = {"season": int(season), "players": {
            p["id"]: {"lv": games.get((org, int(p["id"])), {}), "il": stints.get(int(p["id"]), [])}
            for p in team["players"]}}
    return out


def main():
    L = load()
    for kind in L:
        L[kind]["age"] = season_age(L[kind].birth_date, L[kind].season)
    teams = team_rows(L)
    totals = org_totals(L, teams)
    okey = ["org", "mlbam_id", "season", "level"]
    H = hitters(L["hitters"], okey)
    P = pitchers(L["pitchers"], okey, league=L["pitchers"])
    for D, src in ((H, L["hitters"]), (P, L["pitchers"])):
        first = src.groupby(okey)[["age", "league_name"]].first()
        D[["age", "league_name"]] = first.reindex(pd.MultiIndex.from_frame(D[okey])).values
    index = {"levels": LEVEL_ORDER, "clubs": {}}
    n_files = 0
    for (org, season), _ in teams.groupby(["org", "season"]):
        aff = teams[(teams.org == org) & (teams.season == season)].copy()
        aff["lv"] = aff.level.map({l: i for i, l in enumerate(LEVEL_ORDER)})
        aff = aff.sort_values(["lv", "tier", "team_name"])
        tot = totals[(totals.org == org) & (totals.season == season)].iloc[0]
        h_rows = [dict(x, lg=lg) for x, lg in zip(rows_h(H[(H.org == org) & (H.season == season)]),
                                                   H[(H.org == org) & (H.season == season)].league_name)]
        p_rows = [dict(x, lg=lg) for x, lg in zip(rows_p(P[(P.org == org) & (P.season == season)]),
                                                   P[(P.org == org) & (P.season == season)].league_name)]
        farm = {"org": org, "season": int(season), "levels": LEVEL_ORDER,
                "affiliates": [_team_json(t) for t in aff.itertuples()],
                "totals": {k: (None if pd.isna(v) else (int(v) if k.endswith("_rk") else r(v, 3)))
                           for k, v in tot.drop(["org", "season"]).items()},
                "nOrgs": int((totals.season == season).sum()), "hitters": h_rows, "pitchers": p_rows}
        d = OUT / org / str(int(season))
        d.mkdir(parents=True, exist_ok=True)
        (d / "farm.json").write_text(json.dumps(farm, separators=(",", ":")))
        (d / "depth.json").write_text(json.dumps({"org": org, "season": int(season), "levels": ["MLB"] + LEVEL_ORDER,
                                                  "positions": POS + ["SP", "RP"],
                                                  "grid": depth(L, int(season), org, h_rows, p_rows)},
                                                 separators=(",", ":")))
        n_files += 2
        c = index["clubs"].setdefault(org, {"seasons": [], "affiliates": {}})
        c["seasons"].append(int(season))
        c["affiliates"][str(int(season))] = [{"level": t.level, "team": t.team_name, "league": t.league_name,
                                              "teamId": int(t.team_id)} for t in aff.itertuples()]
    last = int(teams.season.max())
    for org, ro in roster(L, last).items():
        (OUT / org / "roster.json").write_text(json.dumps(ro, separators=(",", ":")))
        n_files += 1
    (OUT / "index.json").write_text(json.dumps(index, separators=(",", ":")))
    print(f"orgs: {len(index['clubs'])} clubs, {n_files} files")


if __name__ == "__main__":
    main()
