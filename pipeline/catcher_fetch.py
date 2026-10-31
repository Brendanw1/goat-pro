"""Savant's per-play catcher rows (public leaderboard drill-down services), one GET per catcher-season.

    python pipeline/catcher_fetch.py            # -> cache/catcher/{throwing,blocking}_{season}.parquet (fetches only missing)
    python pipeline/catcher_fetch.py --running  # -> cache/catcher/pitcher_running_{season}.parquet + pickoffs_{season}.parquet
    python pipeline/catcher_fetch.py --sealed   # -> cache/catcher/sealed/ pre-2020 holdout (§108c) + SEAL.json
    python pipeline/catcher_fetch.py --demo     # self-check of the row slimming, no network

throws:   every stolen-base attempt with this catcher behind the plate (SB, CS, held throws): runner, pitcher,
          sprint speed, lead, pop time, exchange, arm, Savant's exp_cs, play_id (video link). Served 2016+.
blocking: every pitch with a runner on (the blocking opportunity set): location, pitch type, ground flag,
          Savant's xPBWP and the WP/PB outcome, play_id. Served 2018+ (fetched 2021+; 2018-19 sealed).
running:  Savant's pitcher-running-game board, one CSV per season (every pitcher with 1+ pitch, n=1): opportunities,
          SB/CS/PK, mean primary / secondary lead and lead gained (secondary - primary: ground the runner takes between
          the pitcher's first move and release), all opportunities and on attempts only (_sbx). 2016+.
pickoffs: prior pickoff throws (with reset) per running event. The catcher rows carry N_prior_pickoffs_with_reset but
          Savant serves it null on every row (checked raw, 2026-10-30), so it comes from the pitcher-running-game team
          drill-down filtered by prior_pk = 0..3 (3 = the board's top bucket): play_id -> prior_pk, 4 GETs per team-season.
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
                 "accuracy_impact_seconds", "is_runner_sb", "is_runner_cs", "exp_cs", "cs_aa"],
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


def main(seasons=range(2019, 2027), out=OUT, ids=catchers, first=FIRST):
    out.mkdir(parents=True, exist_ok=True)
    done_p = out / "done.json"
    done = set(json.loads(done_p.read_text())) if done_p.exists() else set()
    for season in seasons:
        cids = ids(season)
        for kind in ("throwing", "blocking"):
            if season < first[kind]:
                continue
            part = out / f"{kind}_{season}.parquet"
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
    print("done", flush=True)


RUN_CSV = ("https://baseballsavant.mlb.com/leaderboard/pitcher-running-game?game_type=Regular&season_start={y}"
           "&season_end={y}&n=1&type={t}&csv=true")
RUN_PLAYS = ("https://baseballsavant.mlb.com/leaderboard/services/pitcher-running-game/{tid}?game_type=Regular&n=1"
             "&season_start={y}&season_end={y}&team=&type=Pitching%20Team&prior_pk={k}")


def get_csv(url: str) -> pd.DataFrame:
    import io
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (goat-pro research; polite, cached)"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return pd.read_csv(io.BytesIO(r.read()), encoding="utf-8-sig")


def running(seasons=range(2020, 2027), out=OUT):
    """Pitcher-running-game season board + prior-pickoff count per running event (team drill-down by prior_pk)."""
    out.mkdir(parents=True, exist_ok=True)
    done_p = out / "done.json"
    done = set(json.loads(done_p.read_text())) if done_p.exists() else set()
    for season in seasons:
        part = out / f"pitcher_running_{season}.parquet"
        if not part.exists():
            get_csv(RUN_CSV.format(y=season, t="Pit")).rename(columns={"player_id": "pitcher_id"}).assign(
                season=season).to_parquet(part)
            time.sleep(1.5)
        pk_part = out / f"pickoffs_{season}.parquet"
        frames = [pd.read_parquet(pk_part)] if pk_part.exists() else []
        teams = get_csv(RUN_CSV.format(y=season, t="Pitching%20Team"))["player_id"].astype(int).tolist()
        time.sleep(1.5)
        for tid in teams:
            for k in range(4):
                key = f"pk:{season}:{tid}:{k}"
                if key in done:
                    continue
                rows = get(RUN_PLAYS.format(tid=tid, y=season, k=k)).get("data") or []
                if rows:
                    frames.append(pd.DataFrame(rows)[["play_id", "pitcher_id", "runner_id", "target_base",
                                                      "runner_moved_cd", "r_sec_minus_prim_lead"]].assign(prior_pk=k))
                done.add(key)
                time.sleep(1.5)
            if frames:
                pd.concat(frames, ignore_index=True).drop_duplicates().to_parquet(pk_part)
                frames = [pd.read_parquet(pk_part)]
            done_p.write_text(json.dumps(sorted(done)))
        print(f"running {season}: {len(teams)} teams", flush=True)
    print("done", flush=True)


SEALED = OUT / "sealed"
POP_CSV = "https://baseballsavant.mlb.com/leaderboard/poptime?year={y}&team=&min2b=0&min3b=0&csv=true"


def pop_catchers(season: int) -> list[int]:
    """Pre-2020 catcher list (the mart starts 2020): Savant's pop-time board, every catcher with a tracked throw.
    Ids only; the board carries no CS outcomes. Cached so a re-run makes no extra request."""
    f = SEALED / f"catchers_{season}.json"
    if not f.exists():
        f.write_text(json.dumps(sorted(get_csv(POP_CSV.format(y=season))["entity_id"].astype(int).tolist())))
        time.sleep(1.5)
    return json.loads(f.read_text())


def sealed():
    """Sealed pre-2020 holdout (§108c H-pre). Probed 2026-10-30, one request per season and kind, row counts only:
    throwing drill-down 2016-19, blocking 2018-19, running board + pickoff drill-down 2016-19 (2015: none served).
    Writes cache/catcher/sealed/ + SEAL.json (sha256, row counts). Prints counts only; nothing here reads an outcome."""
    import hashlib
    import pyarrow.parquet as pq
    from datetime import date
    seasons = range(2016, 2020)
    main(seasons, SEALED, pop_catchers, {"throwing": 2016, "blocking": 2018})
    running(seasons, SEALED)
    files = {}
    for f in sorted(SEALED.glob("*.parquet")):
        files[f.name] = {"rows": pq.ParquetFile(f).metadata.num_rows,
                         "sha256": hashlib.sha256(f.read_bytes()).hexdigest()}
    seal = {"section": "§108c H-pre", "date": str(date.today()), "status": "not opened",
            "rule": "no outcome (is_runner_cs, exp_cs, cs_aa, is_runner_pbwp, x_runner_pbwp, SB/CS/PK counts) computed "
                    "or printed until the frozen §108a-v2 model is scored once", "files": files}
    (SEALED / "SEAL.json").write_text(json.dumps(seal, indent=1))
    print({k: v["rows"] for k, v in files.items()}, flush=True)


def demo():
    t = slim([{"year": 2025, "game_pk": 1, "play_id": "a", "game_date": "2025-07-25T00:00:00.000Z", "pop_time": "1.79",
               "is_runner_cs": 1, "throw_type": "On Fly", "junk": 9}], "throwing")
    assert t.loc[0, "pop_time"] == 1.79 and t.loc[0, "game_date"] == "2025-07-25" and "junk" not in t
    print("demo ok")


if __name__ == "__main__":
    (demo() if "--demo" in sys.argv else running() if "--running" in sys.argv else sealed() if "--sealed" in sys.argv
     else main())
