"""milb_lines.py — minor league season lines (Rookie through AAA) from the public MLB Stats API.

One row per player x team x level x season, pitching and hitting, regular season only:

    python pipeline/milb_lines.py                    # 2021-2026 -> data/milb/{pitchers,hitters}.parquet
    python pipeline/milb_lines.py --seasons 2026     # refresh one season, keep the rest
    python pipeline/milb_lines.py --mlb              # MLB (sportId 1) -> data/milb/mlb_{pitchers,hitters}.parquet
                                                     # (official ER for the site's ERA; web_export.py)

Box-score lines only: no pitch tracking exists below AAA (AAA Statcast lives in the mart's
pitches_aaa view). Public data, so it may ship to goat-pro.
"""
import argparse
import json
import time
import urllib.request
from pathlib import Path

import pandas as pd

OUT = Path(__file__).resolve().parents[1] / "data" / "milb"
LEVELS = {1: "MLB", 11: "AAA", 12: "AA", 13: "A+", 14: "A", 16: "ROK"}
FIELDS = {
    "pitching": {"outs": "OUTS", "battersFaced": "BF", "hits": "H", "homeRuns": "HR", "baseOnBalls": "BB",
                 "intentionalWalks": "IBB", "hitByPitch": "HBP", "strikeOuts": "SO", "groundOuts": "GO",
                 "airOuts": "AO", "earnedRuns": "ER", "runs": "R", "gamesPlayed": "G", "gamesStarted": "GS"},
    "hitting": {"plateAppearances": "PA", "atBats": "AB", "hits": "H", "doubles": "2B", "triples": "3B",
                "homeRuns": "HR", "baseOnBalls": "BB", "intentionalWalks": "IBB", "hitByPitch": "HBP",
                "sacFlies": "SF", "sacBunts": "SH", "strikeOuts": "SO", "stolenBases": "SB",
                "caughtStealing": "CS", "groundIntoDoublePlay": "GIDP", "gamesPlayed": "G"},
}


def fetch(group: str, season: int, sid: int) -> list[dict]:
    url = (f"https://statsapi.mlb.com/api/v1/stats?stats=season&group={group}&season={season}"
           f"&sportId={sid}&playerPool=ALL&gameType=R&limit=10000&hydrate=person")
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=90) as r:
                splits = json.load(r)["stats"][0]["splits"]
            break
        except Exception:
            if attempt == 3:
                raise
            time.sleep(5 * (attempt + 1))
    rows = []
    for s in splits:
        st, team, league = s["stat"], s.get("team", {}), s.get("league", {})
        person = s["player"]
        row = {"mlbam_id": person["id"], "player_name": person.get("fullName"), "season": season,
               "sport_id": sid, "level": LEVELS[sid], "league_name": league.get("name"),
               "team_id": team.get("id"), "team_name": team.get("name"),
               "age": person.get("currentAge"), "birth_date": person.get("birthDate"),
               "bats": person.get("batSide", {}).get("code"), "throws": person.get("pitchHand", {}).get("code"),
               "position": person.get("primaryPosition", {}).get("abbreviation")}
        row.update({out: int(st.get(k) or 0) for k, out in FIELDS[group].items()})
        rows.append(row)
    return rows


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seasons", type=int, nargs="+", default=list(range(2021, 2027)))
    ap.add_argument("--mlb", action="store_true", help="MLB lines into mlb_*.parquet instead of the minors files")
    args = ap.parse_args()
    sids = [1] if args.mlb else [s for s in LEVELS if s != 1]
    OUT.mkdir(parents=True, exist_ok=True)
    for group, name in (("pitching", "pitchers"), ("hitting", "hitters")):
        rows = []
        for season in args.seasons:
            for sid in sids:
                got = fetch(group, season, sid)
                rows += got
                print(f"{name} {season} {LEVELS[sid]}: {len(got)}", flush=True)
                time.sleep(0.5)
        new = pd.DataFrame(rows)
        path = OUT / f"{'mlb_' if args.mlb else ''}{name}.parquet"
        if path.exists():  # keep seasons not refetched
            old = pd.read_parquet(path)
            new = pd.concat([old[~old.season.isin(args.seasons)], new], ignore_index=True)
        new = new.sort_values(["season", "sport_id", "mlbam_id", "team_id"], kind="stable").reset_index(drop=True)
        new.to_parquet(path, index=False)
        print(f"{name}: {len(new)} rows -> {path}")


if __name__ == "__main__":
    main()
