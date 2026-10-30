"""Savant's per-play catcher rows (public leaderboard drill-down services), one GET per catcher-season.

    python pipeline/catcher_fetch.py            # -> cache/catcher/{throws,blocking}.parquet (fetches only missing)
    python pipeline/catcher_fetch.py --demo     # self-check of the row slimming, no network

throws:   every stolen-base attempt with this catcher behind the plate (SB, CS, held throws): runner, pitcher,
          sprint speed, lead, pop time, exchange, arm, Savant's exp_cs, play_id (video link). 2019+.
blocking: every pitch with a runner on (the blocking opportunity set): location, pitch type, ground flag,
          Savant's xPBWP and the WP/PB outcome, play_id. 2021+.
Catchers: every fielder_2 with 300+ pitches caught that season in the mart, so backups count too.
Polite: one request at a time, 1.5 s apart, receipts in cache/catcher/done.json so a re-run skips done work.
Nothing is re-hosted: rows are numbers plus play_id, and the site only links to Savant's own video page.
"""
import json
import sys
import time
import urllib.request
from pathlib import Path

import pandas as pd

PIPE = Path(__file__).resolve().parent
sys.path.insert(0, str(PIPE))
from paths import MART_DIR  # noqa: E402

OUT = PIPE.parent / "cache" / "catcher"
URL = ("https://baseballsavant.mlb.com/leaderboard/services/catcher-{kind}/{cid}?game_type=Regular&n=0"
       "&season_start={y}&season_end={y}&split=no&team=&type=Cat&with_team_only=1")
FIRST = {"throwing": 2019, "blocking": 2021}
KEEP = {
    "throwing": ["year", "game_pk", "at_bat_number", "play_init_seq", "play_id", "game_date", "catcher_id", "pitcher_id",
                 "runner_id", "fielder_id", "runner_name", "pitcher_name", "fielder_name", "target_base", "pitch_hand",
                 "is_sba_delayed", "is_pitchout", "is_throw_tracked", "is_throw_held", "throw_type",
                 "seasonal_sprint_speed", "start_distance_to_target", "r_primary_lead", "time_to_target",
                 "generic_time_to_target", "pop_time", "pos2_f_exchange", "pos2_f_arm_strength", "pos2_f_flight_time",
                 "accuracy_impact_seconds", "is_runner_sb", "is_runner_cs", "exp_cs", "cs_aa",
                 "N_prior_pickoffs_with_reset"],
    "blocking": ["year", "game_pk", "play_id", "game_date", "catcher_id", "pitcher_id", "pitch_hand", "bat_side",
                 "api_pitch_type_subgroup", "location_x", "location_z", "is_pitch_ground", "x_runner_pbwp",
                 "is_runner_pbwp", "api_plate_time"],
}


def slim(rows: list[dict], kind: str) -> pd.DataFrame:
    df = pd.DataFrame(rows)
    df = df[[c for c in KEEP[kind] if c in df.columns]].copy()
    for c in df.columns:
        if c not in ("play_id", "game_date", "runner_name", "pitcher_name", "fielder_name", "target_base", "pitch_hand",
                     "bat_side", "throw_type", "api_pitch_type_subgroup"):
            df[c] = pd.to_numeric(df[c], errors="coerce")
    df["game_date"] = df["game_date"].astype(str).str[:10]
    return df


def get(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (goat-pro research; polite, cached)"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.load(r)
        except Exception:
            if attempt == 3:
                raise
            time.sleep(10 * (attempt + 1))


def catchers(season: int) -> list[int]:
    sys.path.insert(0, str(MART_DIR))
    import mart
    con = mart.connect()
    return [int(r[0]) for r in con.sql(f"""SELECT fielder_2 FROM pitches_all WHERE game_type = 'R' AND season = {season}
        AND fielder_2 IS NOT NULL GROUP BY 1 HAVING count(*) >= 300 ORDER BY 1""").fetchall()]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    done_p = OUT / "done.json"
    done = set(json.loads(done_p.read_text())) if done_p.exists() else set()
    for season in range(2019, 2027):
        cids = catchers(season)
        for kind in ("throwing", "blocking"):
            if season < FIRST[kind]:
                continue
            part = OUT / f"{kind}_{season}.parquet"
            frames = [pd.read_parquet(part)] if part.exists() else []
            todo = [c for c in cids if f"{kind}:{season}:{c}" not in done]
            print(f"{kind} {season}: {len(todo)} of {len(cids)} catchers to fetch", flush=True)
            for i, cid in enumerate(todo):
                rows = get(URL.format(kind=kind, cid=cid, y=season)).get("data") or []
                rows = [r for r in rows if int(r.get("year") or season) == season]
                if rows:
                    frames.append(slim(rows, kind))
                done.add(f"{kind}:{season}:{cid}")
                time.sleep(1.5)
                if (i + 1) % 20 == 0 or i == len(todo) - 1:  # checkpoint: a stop loses at most 20 requests
                    if frames:
                        pd.concat(frames, ignore_index=True).drop_duplicates().to_parquet(part)
                        frames = [pd.read_parquet(part)]
                    done_p.write_text(json.dumps(sorted(done)))
    for kind in ("throwing", "blocking"):
        parts = sorted(OUT.glob(f"{kind}_*.parquet"))
        if parts:
            pd.concat([pd.read_parquet(p) for p in parts], ignore_index=True).to_parquet(OUT / f"{kind}.parquet")
    print("done", flush=True)


def demo():
    t = slim([{"year": 2025, "game_pk": 1, "play_id": "a", "game_date": "2025-07-25T00:00:00.000Z", "pop_time": "1.79",
               "is_runner_cs": 1, "throw_type": "On Fly", "junk": 9}], "throwing")
    assert t.loc[0, "pop_time"] == 1.79 and t.loc[0, "game_date"] == "2025-07-25" and "junk" not in t
    print("demo ok")


if __name__ == "__main__":
    demo() if "--demo" in sys.argv else main()
