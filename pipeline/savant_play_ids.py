"""Savant game-feed ids for every ball in play: play_id (links each play to its Savant video) and
Savant's "would be a home run in N of 30 parks" (contextMetrics.homeRunBallparks).

    python pipeline/savant_play_ids.py                 # -> data/milb/savant_bip.parquet (fetches only missing games)
    python pipeline/savant_play_ids.py --seasons 2026  # one season
    python pipeline/savant_play_ids.py --demo          # self-check of the row parsing, no network

One public GET per game (baseballsavant.mlb.com/gf?game_pk=), hardest-play games first, three workers
(~2-3 requests a second), saved every 100 games so a stop loses little. Read-only; nothing is re-hosted.
Rows join to Statcast on (game_pk, at_bat_number, pitch_number).
"""
import json
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "milb" / "savant_bip.parquet"
URL = "https://baseballsavant.mlb.com/gf?game_pk={}"
COLS = ["game_pk", "at_bat_number", "pitch_number", "play_id", "hr_parks", "hc_x", "hc_y"]


def get(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (goat-pro research)"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except Exception:
            if attempt == 3:
                raise
            time.sleep(5 * (attempt + 1))


def bip_rows(feed: dict, game_pk: int) -> list[dict]:
    """Balls in play (call 'X') from both halves; hr_parks is None when Savant gives no count."""
    out = []
    for r in feed.get("team_home", []) + feed.get("team_away", []):
        if r.get("call") != "X" or not r.get("play_id"):
            continue
        out.append({"game_pk": game_pk, "at_bat_number": int(r["ab_number"]), "pitch_number": int(r["pitch_number"]),
                    "play_id": r["play_id"], "hr_parks": (r.get("contextMetrics") or {}).get("homeRunBallparks"),
                    "hc_x": r.get("hc_x"), "hc_y": r.get("hc_y")})
    return out


def main() -> None:
    sys.path.insert(0, str(ROOT / "pipeline"))
    import web_export as we
    seasons = [int(s) for s in sys.argv[sys.argv.index("--seasons") + 1].split(",")] if "--seasons" in sys.argv else list(range(2026, 2019, -1))
    have = pd.read_parquet(OUT) if OUT.exists() else pd.DataFrame(columns=COLS + ["empty"])
    done = set(have["game_pk"].astype(int))
    con = we.mart.connect()
    games = con.sql(f"""SELECT DISTINCT game_pk, season FROM pitches_all
                        WHERE game_type = 'R' AND season IN ({",".join(map(str, seasons))}) AND bb_type IS NOT NULL
                        ORDER BY season DESC, game_pk DESC""").df()
    # games holding the hardest made plays first (their clips are what the defense tab offers), then the rest
    ch = pd.read_parquet(ROOT / "cache" / "defense_chances_v3.parquet", columns=["game_pk", "p", "made"])
    hard = set(ch.loc[(ch["made"] == 1) & (ch["p"] < 0.35), "game_pk"].astype(int))
    todo = sorted((int(g) for g in games["game_pk"] if int(g) not in done), key=lambda g: g not in hard)
    print(f"{len(games)} games, {len(todo)} to fetch", flush=True)
    rows: list[dict] = []

    def save():
        nonlocal have, rows
        if rows:
            have = pd.concat([have, pd.DataFrame(rows)], ignore_index=True)
            have.to_parquet(OUT, index=False)
            rows = []

    def one(g: int):
        time.sleep(0.8)
        try:
            return g, bip_rows(get(URL.format(g)), g)
        except Exception as e:  # leave the game for the next run
            print(f"  {g}: {e}", flush=True)
            return g, None

    with ThreadPoolExecutor(3) as pool:  # three polite workers, ~2-3 requests a second in all
        for i, (g, got) in enumerate(pool.map(one, todo)):
            if got is not None:
                rows.extend(got or [{"game_pk": g, "empty": True}])  # remember an empty feed so it isn't re-fetched
            if i % 100 == 99:
                save()
                print(f"  {i + 1}/{len(todo)}", flush=True)
    save()
    print(f"{OUT.relative_to(ROOT)}: {len(have)} rows")


def demo() -> None:
    feed = {"team_home": [{"call": "X", "play_id": "a-1", "ab_number": 3, "pitch_number": 2, "contextMetrics": {"homeRunBallparks": 27},
                           "hc_x": 86.7, "hc_y": 35.6},
                          {"call": "S", "play_id": "a-2", "ab_number": 3, "pitch_number": 1}],
            "team_away": [{"call": "X", "play_id": "b-1", "ab_number": 4, "pitch_number": 5, "contextMetrics": {}}]}
    r = bip_rows(feed, 1)
    assert [x["play_id"] for x in r] == ["a-1", "b-1"] and r[0]["hr_parks"] == 27 and r[1]["hr_parks"] is None, r
    print("demo ok")


if __name__ == "__main__":
    demo() if "--demo" in sys.argv else main()
