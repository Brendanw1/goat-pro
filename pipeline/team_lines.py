"""Official per-club pitching lines (MLB Stats API) for pitchers who changed clubs mid-season.

The season-lines feed (milb_lines.py) returns one combined row per player-season, so a traded
pitcher's ERA and IP can't be split by club from it. The per-person endpoint can:
/people/{id}/stats?stats=season&group=pitching&season=S&sportId=N returns one split per club.

    python pipeline/team_lines.py              # -> data/milb/team_lines.parquet (fetches only missing keys)
    python pipeline/team_lines.py --demo       # self-check of the club matching, no network

Club codes are matched to Statcast's (the bake's stints) by the Stats API team abbreviation for
that season; the one rename Statcast backfilled (OAK -> ATH) is aliased.
"""
import json
import sys
import time
import urllib.request
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "milb" / "team_lines.parquet"
API = "https://statsapi.mlb.com/api/v1"
SPORT = {"mlb": 1, "aaa": 11}
SEASONS = {"mlb": "2021,2022,2023,2024,2025,2026", "aaa": "2023,2024,2025,2026"}
ALIAS = {"OAK": "ATH"}


def get(url: str) -> dict:
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                return json.load(r)
        except Exception:
            if attempt == 3:
                raise
            time.sleep(3 * (attempt + 1))


def abbrs(sport: int, season: int) -> dict[int, str]:
    teams = get(f"{API}/teams?sportId={sport}&season={season}")["teams"]
    return {t["id"]: ALIAS.get(t["abbreviation"], t["abbreviation"]) for t in teams}


def club_rows(splits: list[dict], ab: dict[int, str]) -> list[dict]:
    """Per-club splits only (the combined row has no team)."""
    out = []
    for s in splits:
        team = s.get("team", {}).get("id")
        if team is None:
            continue
        st = s["stat"]
        ip = str(st.get("inningsPitched", "0.0"))
        whole, _, frac = ip.partition(".")
        out.append({"team": ab.get(team), "team_id": team, "OUTS": 3 * int(whole) + int(frac or 0),
                    "ER": int(st.get("earnedRuns") or 0), "R": int(st.get("runs") or 0),
                    "G": int(st.get("gamesPlayed") or 0), "GS": int(st.get("gamesStarted") or 0)})
    return out


def main() -> None:
    sys.path.insert(0, str(ROOT / "pipeline"))
    import web_export as we
    have = pd.read_parquet(OUT) if OUT.exists() else pd.DataFrame(columns=["level", "mlbam_id", "season"])
    done = set(zip(have["level"], have["mlbam_id"], have["season"]))
    rows, con = [], we.mart.connect()
    for level, sport in SPORT.items():
        if level == "aaa":
            con.execute("CREATE OR REPLACE TEMP VIEW pitches_all AS SELECT * FROM pitches_aaa")
        _, stints = we.team_stints(con, "pitcher", SEASONS[level])
        todo = sorted(k for k in stints if (level, k[0], k[1]) not in done)
        print(f"{level}: {len(stints)} multi-club pitcher-seasons, {len(todo)} to fetch", flush=True)
        ab_cache: dict = {}
        for i, (pid, season) in enumerate(todo):
            if season not in ab_cache:
                ab_cache[season] = abbrs(sport, season)
            splits = get(f"{API}/people/{pid}/stats?stats=season&group=pitching&season={season}"
                         f"&sportId={sport}&gameType=R")["stats"]
            for r in club_rows(splits[0]["splits"] if splits else [], ab_cache[season]):
                rows.append({"level": level, "mlbam_id": pid, "season": season, **r})
            if not splits:  # remember the miss so it isn't re-fetched
                rows.append({"level": level, "mlbam_id": pid, "season": season, "team": None})
            if i % 100 == 99:
                print(f"  {i + 1}/{len(todo)}", flush=True)
            time.sleep(0.15)
    out = pd.concat([have, pd.DataFrame(rows)], ignore_index=True) if rows else have
    out.to_parquet(OUT, index=False)
    print(f"{OUT.relative_to(ROOT)}: {len(out)} rows")


def demo() -> None:
    splits = [{"stat": {"inningsPitched": "162.0", "earnedRuns": 57}},
              {"team": {"id": 116}, "stat": {"inningsPitched": "106.2", "earnedRuns": 35, "gamesPlayed": 18, "gamesStarted": 18}},
              {"team": {"id": 133}, "stat": {"inningsPitched": "55.1", "earnedRuns": 22, "gamesPlayed": 10, "gamesStarted": 10}}]
    r = club_rows(splits, {116: "DET", 133: ALIAS.get("OAK", "OAK")})
    assert [x["team"] for x in r] == ["DET", "ATH"] and r[0]["OUTS"] == 320 and r[1]["OUTS"] == 166, r
    print("demo ok")


if __name__ == "__main__":
    demo() if "--demo" in sys.argv else main()
