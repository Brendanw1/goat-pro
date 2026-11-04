"""milb_pbp.py — prospect program F3: minor-league plate appearances 2010-26 (AAA..Single-A) from the MLB Stats API.

    caffeinate -i nice -n 10 python pipeline/milb_pbp.py           # resumable; spent seasons first
    python pipeline/milb_pbp.py --seasons 2016 --limit 3              # smoke test
    python pipeline/milb_pbp.py --demo                                # parser self-check, no network

Etiquette (public API, non-commercial, attributed per its copyright notice): two connections sharing a cap of 3 requests
a second (the server takes 3-4 s on an uncached old game, so one connection idled at ~0.7 games/s), gzip + a `fields=` filter (~7 KB per game against ~390 KB plain), a User-Agent naming the project, 60 s backoff that
holds both connections and doubles the gap on any 429/5xx, and a stop after 10 failures in a row. Nothing raw is kept: one row per PA goes to
data/milb/pbp/{season}/part-*.parquet, and data/milb/pbp/done.txt lists every finished gamePk.
"""
import argparse
import gzip
import json
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "milb" / "pbp"
API = "https://statsapi.mlb.com/api/v1"
UA = "goat-pro MiLB play-by-play (personal, non-commercial; github.com goat-pro)"
ORDER = list(range(2010, 2018)) + [2018, 2019, 2021, 2022] + list(range(2023, 2027))   # spent seasons first
LEVELS = {11: "AAA", 12: "AA", 13: "A+", 14: "A"}
FIELDS = ("allPlays,result,eventType,rbi,about,halfInning,inning,count,balls,strikes,outs,matchup,batter,pitcher,id,"
          "batSide,pitchHand,code,splits,menOnBase,playEvents,isPitch,details,hitData,trajectory,hardness,location,"
          "coordinates,coordX,coordY,atBatIndex")


CONNS, GAP = 2, 1 / 3                                         # 2 connections, >= 1/3 s between request starts


class Client:
    def __init__(self):
        self.gap, self.fails, self.next_t, self.lock = GAP, 0, 0.0, threading.Lock()

    def _wait(self):
        with self.lock:                                       # shared token: request starts are spaced >= gap apart
            t = max(time.monotonic(), self.next_t)
            self.next_t = t + self.gap
        time.sleep(max(0.0, t - time.monotonic()))

    def get(self, url):
        while True:
            self._wait()
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    raw = r.read()
                    self.fails = 0
                    return json.loads(gzip.decompress(raw) if r.headers.get("Content-Encoding") == "gzip" else raw)
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    return None
                self._backoff(f"HTTP {e.code}")
            except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
                self._backoff(type(e).__name__)

    def _backoff(self, why):
        self.fails += 1
        if self.fails >= 10:
            sys.exit(f"stopping: 10 failures in a row ({why})")
        with self.lock:                                       # holds every connection for 60 s
            self.gap = min(max(self.gap * 2, 0.5), 8.0)
            self.next_t = time.monotonic() + 60
        print(f"  backoff 60 s after {why}; gap now {self.gap:.1f} s", flush=True)


def schedule(c, season):
    games = []
    for sid, lvl in LEVELS.items():
        d = c.get(f"{API}/schedule?sportId={sid}&season={season}&gameType=R&fields=dates,games,gamePk,officialDate,"
                  "status,codedGameState,teams,away,home,team,id,venue")
        for dd in (d or {}).get("dates", []):
            for g in dd["games"]:
                if g["status"].get("codedGameState") == "F":
                    games.append({"game_pk": g["gamePk"], "date": g.get("officialDate"), "level": lvl,
                                  "venue_id": g.get("venue", {}).get("id"),
                                  "home_id": g["teams"]["home"]["team"]["id"], "away_id": g["teams"]["away"]["team"]["id"]})
    return pd.DataFrame(games).drop_duplicates("game_pk")


def parse(doc, g):
    rows = []
    for p in (doc or {}).get("allPlays", []):
        ev = p.get("playEvents", [])
        pitches = [e for e in ev if e.get("isPitch")]
        hit = next((e["hitData"] for e in reversed(ev) if e.get("hitData")), {})
        m, a, res = p.get("matchup", {}), p.get("about", {}), p.get("result", {})
        top = a.get("halfInning") == "top"
        rows.append({**g, "ab": p.get("atBatIndex"), "inning": a.get("inning"), "top": top,
                     "bat_team": g["away_id"] if top else g["home_id"], "batter": m.get("batter", {}).get("id"),
                     "pitcher": m.get("pitcher", {}).get("id"), "stand": m.get("batSide", {}).get("code"),
                     "throws": m.get("pitchHand", {}).get("code"), "men_on_end": m.get("splits", {}).get("menOnBase"),
                     "event": res.get("eventType"), "rbi": res.get("rbi"), "outs": p.get("count", {}).get("outs"),
                     "balls": p.get("count", {}).get("balls"), "strikes": p.get("count", {}).get("strikes"),
                     "n_pitch": len(pitches), "calls": "".join(e.get("details", {}).get("code", "?") for e in pitches),
                     "traj": hit.get("trajectory"), "hard": hit.get("hardness"), "loc": hit.get("location"),
                     "hc_x": hit.get("coordinates", {}).get("coordX"), "hc_y": hit.get("coordinates", {}).get("coordY")})
    return rows


def run(seasons, limit=None):
    OUT.mkdir(parents=True, exist_ok=True)
    done_f = OUT / "done.txt"
    done = set(int(x) for x in done_f.read_text().split()) if done_f.exists() else set()
    c = Client()
    for s in seasons:
        sched = schedule(c, s)
        todo = sched[~sched.game_pk.isin(done)]
        if limit:
            todo = todo.head(limit)
        print(f"{s}: {len(sched)} final games, {len(todo)} to fetch", flush=True)
        (OUT / str(s)).mkdir(exist_ok=True)
        buf, ids, t0 = [], [], time.time()

        def flush():
            if ids:
                part = len(list((OUT / str(s)).glob("part-*.parquet")))
                if buf:
                    pd.DataFrame(buf).assign(season=s).to_parquet(OUT / str(s) / f"part-{part:04d}.parquet", compression="zstd")
                with done_f.open("a") as f:
                    f.write("\n".join(map(str, ids)) + "\n")
                done.update(ids)
                buf.clear()
                ids.clear()
        recs = todo.to_dict("records")
        with ThreadPoolExecutor(CONNS) as ex:                 # results come back in order; buffering stays on this thread
            docs = ex.map(lambda g: c.get(f"{API}/game/{g['game_pk']}/playByPlay?fields={FIELDS}"), recs)
            for i, (g, doc) in enumerate(zip(recs, docs), 1):
                buf += parse(doc, g)
                ids.append(g["game_pk"])
                if i % 1000 == 0:
                    flush()
                    print(f"  {s} {i}/{len(todo)}  {i / (time.time() - t0):.1f} games/s", flush=True)
        flush()
        print(f"{s} done in {(time.time() - t0) / 60:.0f} min", flush=True)


def demo():
    doc = {"allPlays": [{"atBatIndex": 0, "about": {"inning": 1, "halfInning": "top"}, "result": {"eventType": "single", "rbi": 0},
                         "count": {"outs": 0, "balls": 1, "strikes": 2},
                         "matchup": {"batter": {"id": 7}, "pitcher": {"id": 9}, "batSide": {"code": "L"}, "pitchHand": {"code": "R"},
                                     "splits": {"menOnBase": "Empty"}},
                         "playEvents": [{"isPitch": True, "details": {"code": "B"}}, {"isPitch": True, "details": {"code": "S"}},
                                        {"isPitch": False}, {"isPitch": True, "details": {"code": "X"},
                                                             "hitData": {"trajectory": "line_drive", "coordinates": {"coordX": 100.0, "coordY": 90.0}}}]}]}
    r = parse(doc, {"game_pk": 1, "date": "2016-06-15", "level": "AA", "venue_id": 5, "home_id": 2, "away_id": 3})
    assert len(r) == 1 and r[0]["bat_team"] == 3 and r[0]["calls"] == "BSX" and r[0]["n_pitch"] == 3
    assert r[0]["traj"] == "line_drive" and r[0]["hc_x"] == 100.0 and r[0]["event"] == "single"
    assert parse(None, {}) == []
    print("demo ok")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--seasons", nargs="*", type=int, default=ORDER)
    ap.add_argument("--limit", type=int)
    ap.add_argument("--demo", action="store_true")
    a = ap.parse_args()
    demo() if a.demo else run(a.seasons, a.limit)
