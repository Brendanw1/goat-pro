"""Trade tracker: every MLB trade 2020-26, grouped into deals, with what each club got back.

    python pipeline/trades.py            # fetch (cached) + write data/export/web/trades/{season}.json + index.json
    python pipeline/trades.py --refetch  # re-pull the Stats API feed
    python pipeline/trades.py --demo     # self-check of the grouping and the deadline pick, no network

Source: the public Stats API transactions feed (typeCode TR), one record per player moved, each with
fromTeam/toTeam; the records of one deal share the date and the description, which is the deal key.
Value is Statcast run value with the ACQUIRING club after the trade date (regular season): a hitter's
summed delta_run_exp at the plate, a pitcher's negated summed delta_run_exp on the mound, both runs
above average. Not WAR (no defense, position or replacement level). `season` = rest of the trade year,
`since` = everything with that club through today. Players who never reached MLB carry their Pipeline
rank in the trade year (top 100, else org list) and debut year. Descriptive.
"""
import json
import sys
import urllib.request
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "milb" / "trades_raw.parquet"
OUT = ROOT / "data" / "export" / "web" / "trades"
SEASONS = range(2020, 2027)
TEAM = {108: "LAA", 109: "AZ", 110: "BAL", 111: "BOS", 112: "CHC", 113: "CIN", 114: "CLE", 115: "COL", 116: "DET",
        117: "HOU", 118: "KC", 119: "LAD", 120: "WSH", 121: "NYM", 133: "ATH", 134: "PIT", 135: "SD", 136: "SEA",
        137: "SF", 138: "STL", 139: "TB", 140: "TEX", 141: "TOR", 142: "MIN", 143: "PHI", 144: "ATL", 145: "CWS",
        146: "MIA", 147: "NYY", 158: "MIL"}


def fetch() -> pd.DataFrame:
    rows = []
    for y in SEASONS:
        for m in range(1, 13):
            end = pd.Timestamp(y, m, 1) + pd.offsets.MonthEnd(0)
            url = (f"https://statsapi.mlb.com/api/v1/transactions?sportId=1&startDate={y}-{m:02d}-01"
                   f"&endDate={end:%Y-%m-%d}")
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=60) as r:
                for t in json.load(r).get("transactions", []):
                    if t.get("typeCode") != "TR" or not t.get("person"):
                        continue
                    rows.append({"id": t["person"]["id"], "name": t["person"].get("fullName"), "date": t.get("date"),
                                 "from_id": (t.get("fromTeam") or {}).get("id"), "to_id": (t.get("toTeam") or {}).get("id"),
                                 "desc": t.get("description") or ""})
        print(f"  {y}: {len(rows)} trade records so far", flush=True)
    df = pd.DataFrame(rows).drop_duplicates()
    RAW.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(RAW, index=False)
    return df


def deals(df: pd.DataFrame) -> pd.DataFrame:
    """One row per player moved between two MLB clubs, keyed to its deal (date + description)."""
    d = df[df["from_id"].isin(TEAM) & df["to_id"].isin(TEAM)].copy()
    d["frm"], d["to"] = d["from_id"].map(TEAM), d["to_id"].map(TEAM)
    d = d.drop_duplicates(["id", "date", "frm", "to"])
    d["deal"] = d.groupby(["date", "desc"], sort=True).ngroup()
    return d


def deadline(dates: pd.Series) -> str | None:
    """The trade deadline = the July-August date with the most trade records (it moves every year)."""
    dt = pd.to_datetime(dates)
    w = dt[dt.dt.month.isin([7, 8])]
    return None if w.empty else w.dt.strftime("%Y-%m-%d").value_counts().sort_index().idxmax()


def value(d: pd.DataFrame) -> pd.DataFrame:
    sys.path.insert(0, str(ROOT / "pipeline"))
    import web_export as we
    con = we.mart.connect()
    con.register("tr", d[["deal", "id", "to", "date"]].assign(date=pd.to_datetime(d["date"]).dt.date))
    return con.sql("""
        WITH p AS (
            SELECT batter, pitcher, CAST(game_date AS DATE) AS game_date, season, game_pk, at_bat_number, delta_run_exp,
                   CASE WHEN inning_topbot = 'Top' THEN away_team ELSE home_team END AS bat_team,
                   CASE WHEN inning_topbot = 'Top' THEN home_team ELSE away_team END AS fld_team
            FROM pitches_all WHERE game_type = 'R' AND delta_run_exp IS NOT NULL)
        SELECT tr.deal, tr.id,
          sum(CASE WHEN p.batter = tr.id AND p.bat_team = tr."to" THEN p.delta_run_exp END) AS bat_since,
          sum(CASE WHEN p.batter = tr.id AND p.bat_team = tr."to" AND p.season = year(tr.date) THEN p.delta_run_exp END) AS bat_season,
          count(DISTINCT CASE WHEN p.batter = tr.id AND p.bat_team = tr."to" THEN (p.game_pk, p.at_bat_number) END) AS pa,
          -sum(CASE WHEN p.pitcher = tr.id AND p.fld_team = tr."to" THEN p.delta_run_exp END) AS pit_since,
          -sum(CASE WHEN p.pitcher = tr.id AND p.fld_team = tr."to" AND p.season = year(tr.date) THEN p.delta_run_exp END) AS pit_season,
          count(DISTINCT CASE WHEN p.pitcher = tr.id AND p.fld_team = tr."to" THEN (p.game_pk, p.at_bat_number) END) AS bf
        FROM tr JOIN p ON (p.batter = tr.id OR p.pitcher = tr.id) AND p.game_date >= tr.date
        GROUP BY 1, 2""").df()


def prospect_ranks() -> dict:
    """(year, id) -> 'Top 100 #n' or '#n ORG' from the Pipeline lists."""
    path = ROOT / "data" / "milb" / "prospects.json"
    if not path.exists():
        return {}
    out = {}
    for y, lists in json.loads(path.read_text()).items():
        for key, rows in lists.items():
            if key.startswith("team:"):
                for r in rows or []:
                    out.setdefault((int(y), int(r["id"])), f"org #{r['rank']}")
        for r in lists.get("top100") or []:
            out[(int(y), int(r["id"]))] = f"Top 100 #{r['rank']}"
    return out


def rnd(x, nd=1):
    return None if x is None or pd.isna(x) else round(float(x), nd) + 0.0


def main() -> None:
    raw = pd.read_parquet(RAW) if RAW.exists() and "--refetch" not in sys.argv else fetch()
    d = deals(raw)
    v = value(d)
    d = d.merge(v, on=["deal", "id"], how="left")
    vals = ["pa", "bf", "bat_since", "bat_season", "pit_since", "pit_season"]
    d[vals] = d[vals].fillna(0)  # never reached MLB with the new club: no rows, value None below
    ppl = pd.read_parquet(ROOT / "data" / "milb" / "people.parquet", columns=["id", "debut", "pos"])
    ppl["debut"] = pd.to_datetime(ppl["debut"], errors="coerce").dt.year
    d = d.merge(ppl, on="id", how="left")
    ranks = prospect_ranks()
    d["season"] = pd.to_datetime(d["date"]).dt.year
    OUT.mkdir(parents=True, exist_ok=True)
    index = {}
    for s, sd in d.groupby("season"):
        trades, team_tot = [], {}
        for deal, g in sd.groupby("deal"):
            players = []
            for r in g.itertuples():
                since = (r.bat_since or 0) + (r.pit_since or 0) if (r.pa or r.bf) else None
                season_rv = (r.bat_season or 0) + (r.pit_season or 0) if (r.pa or r.bf) else None
                players.append({"id": str(r.id), "name": r.name, "from": r.frm, "to": r.to, "pos": None if pd.isna(r.pos) else r.pos,
                                "debut": None if pd.isna(r.debut) else int(r.debut),
                                "rank": ranks.get((int(s), int(r.id))),
                                "pa": int(r.pa or 0), "bf": int(r.bf or 0),
                                "rvSeason": rnd(season_rv), "rvSince": rnd(since)})
                for team, sign in ((r.to, 1), (r.frm, -1)):
                    t = team_tot.setdefault(team, {"team": team, "in": 0.0, "out": 0.0, "deals": set()})
                    t["in" if sign > 0 else "out"] += since or 0.0
                    t["deals"].add(deal)
            clubs = sorted({p["to"] for p in players} | {p["from"] for p in players})
            got = {c: rnd(sum(p["rvSince"] or 0 for p in players if p["to"] == c)) for c in clubs}
            trades.append({"date": g["date"].iloc[0], "desc": g["desc"].iloc[0], "clubs": clubs, "got": got,
                           "players": sorted(players, key=lambda p: -(p["rvSince"] or 0))})
        trades.sort(key=lambda t: (t["date"], t["desc"]))
        teams = sorted(({"team": t["team"], "in": rnd(t["in"]), "out": rnd(t["out"]), "net": rnd(t["in"] - t["out"]),
                         "deals": len(t["deals"])} for t in team_tot.values()), key=lambda t: -(t["net"] or 0))
        dl = deadline(sd["date"])
        (OUT / f"{s}.json").write_text(json.dumps({"season": int(s), "deadline": dl, "trades": trades, "teams": teams},
                                                  separators=(",", ":"), sort_keys=True))
        index[str(s)] = {"deadline": dl, "deals": len(trades), "players": int(len(sd))}
    (OUT / "index.json").write_text(json.dumps({"seasons": index, "through": str(pd.Timestamp.today().date())}, sort_keys=True))
    print("trades:", {k: v["deals"] for k, v in index.items()})


def demo() -> None:
    raw = pd.DataFrame([
        {"id": 1, "name": "A", "date": "2025-07-31", "from_id": 133, "to_id": 135, "desc": "ATH traded A and B to SD for C."},
        {"id": 2, "name": "B", "date": "2025-07-31", "from_id": 133, "to_id": 135, "desc": "ATH traded A and B to SD for C."},
        {"id": 3, "name": "C", "date": "2025-07-31", "from_id": 135, "to_id": 133, "desc": "ATH traded A and B to SD for C."},
        {"id": 3, "name": "C", "date": "2025-07-31", "from_id": 135, "to_id": 133, "desc": "ATH traded A and B to SD for C."},
        {"id": 4, "name": "D", "date": "2025-07-30", "from_id": 147, "to_id": 999, "desc": "NYY traded D to a minors club."},
        {"id": 5, "name": "E", "date": "2025-06-01", "from_id": 147, "to_id": 119, "desc": "NYY traded E to LAD."}])
    d = deals(raw)
    assert len(d) == 4 and d["deal"].nunique() == 2, d
    assert set(d.loc[d["id"] == 3, "to"]) == {"ATH"}
    assert deadline(raw["date"]) == "2025-07-31"
    print("demo ok")


if __name__ == "__main__":
    demo() if "--demo" in sys.argv else main()
