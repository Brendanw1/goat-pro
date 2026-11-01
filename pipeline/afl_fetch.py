"""afl_fetch.py — Arizona Fall League pitches and box lines from the public MLB Stats API.

    python pipeline/afl_fetch.py                    # 2021-2026 -> data/afl/{pitches,box}.parquet
    python pipeline/afl_fetch.py --seasons 2026     # refresh one season (cached finals are not re-pulled)

Schedule: /api/v1/schedule?sportId=17&leagueId=119 (sportId 17 also carries the winter leagues).
Every final game's /api/v1.1/game/{pk}/feed/live is cached gzipped under cache/afl/{season}/ (untracked;
a final game never changes, so it is pulled once). Three requests in flight at most, project UA.

The pitch table is written on the Statcast column names the site's bakes read, so the site's own SQL
(web_export.SWING / WHIFF / CSW, zone 1-14) runs on it unchanged. Mapping, checked pitch-for-pitch
against Savant on MLB game 822761 (2026-09-27, 277 pitches):
    release_speed = startSpeed (exact)          pfx_x = -breakHorizontal / 12, pfx_z = breakVerticalInduced / 12
    plate_x/z = pX/pZ (zone identical)          release_spin_rate = spinRate, spin_axis = spinDirection (+-1 deg)
    release_extension = extension (+-.05 ft)    release_pos_x/z = the 9-parameter fit run back from y0 to
    launch_speed/angle = hitData (exact)          y = 60.5 - extension (+-.005 ft)
    description = Savant's name for the call code; balls/strikes = the count BEFORE the pitch (Savant's).
Box lines are the official per-game box score (IP, BF, K, BB, AB, H, ...), summed later by afl_export.py.
Public data only (Stats API), so it may ship to goat-pro.
"""
import argparse
import gzip
import json
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "cache" / "afl"
OUT = ROOT / "data" / "afl"
API = "https://statsapi.mlb.com/api"
UA = {"User-Agent": "goat-pro research (public data; github.com/Brendanw1/goat-pro)"}
SEASONS = range(2021, 2027)
GAME_TYPES = ("R", "D", "L", "W")  # regular season + playoffs; "A" (Fall Stars exhibition) is left out
FINAL = ("Final", "Completed Early", "Game Over")

# Stats API call code -> Savant `description`
CALL = {"B": "ball", "*B": "blocked_ball", "C": "called_strike", "S": "swinging_strike",
        "W": "swinging_strike_blocked", "T": "foul_tip", "F": "foul", "L": "foul_bunt", "M": "missed_bunt",
        "O": "bunt_foul_tip", "R": "foul_pitchout", "X": "hit_into_play", "D": "hit_into_play",
        "E": "hit_into_play", "H": "hit_by_pitch", "P": "pitchout", "Q": "swinging_pitchout",
        "I": "intent_ball", "V": "automatic_ball", "AB": "automatic_ball", "AC": "automatic_strike"}
# a play that ends on a runner out leaves the batter's PA unfinished (Savant: truncated_pa)
TRUNCATING = ("caught_stealing", "pickoff", "other_out", "runner_double_play")  # prefixes


def get(url: str, tries: int = 4) -> dict:
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return json.load(r)
        except Exception:  # noqa: BLE001 — retried, then raised
            if attempt == tries - 1:
                raise
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(url)


def schedule(season: int) -> list[dict]:
    d = get(f"{API}/v1/schedule?sportId=17&leagueId=119&season={season}")
    return [{"season": season, "game_pk": g["gamePk"], "game_date": g["officialDate"], "game_type": g["gameType"],
             "venue": g["venue"]["name"]}
            for day in d.get("dates", []) for g in day["games"]
            if g["gameType"] in GAME_TYPES and g["status"]["detailedState"] in FINAL]


def feed(season: int, pk: int) -> dict:
    path = CACHE / str(season) / f"{pk}.json.gz"
    if path.exists():
        return json.loads(gzip.decompress(path.read_bytes()))
    time.sleep(0.4)  # polite: three workers, ~7 requests/s at most
    d = get(f"{API}/v1.1/game/{pk}/feed/live")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(gzip.compress(json.dumps(d, separators=(",", ":")).encode()))
    return d


def release_point(c: dict, ext: float | None) -> tuple[float | None, float | None]:
    """x, z where y = 60.5 - extension, from the constant-acceleration fit at y0 (Savant's release_pos)."""
    try:
        x0, y0, z0 = c["x0"], c["y0"], c["z0"]
        vx, vy, vz, ax, ay, az = c["vX0"], c["vY0"], c["vZ0"], c["aX"], c["aY"], c["aZ"]
    except KeyError:
        return None, None
    if ext is None or None in (x0, y0, z0, vx, vy, vz, ax, ay, az):
        return None, None
    a, b, cc = 0.5 * ay, vy, y0 - (60.5 - ext)
    disc = b * b - 4 * a * cc
    if disc < 0 or a == 0:
        return None, None
    roots = [(-b - disc ** 0.5) / (2 * a), (-b + disc ** 0.5) / (2 * a)]
    t = next((r for r in roots if r <= 0), None)  # release is before y0 (ball travels toward -y)
    if t is None:
        return None, None
    return x0 + vx * t + 0.5 * ax * t * t, z0 + vz * t + 0.5 * az * t * t


def pitch_rows(d: dict, meta: dict) -> list[dict]:
    """One Savant-schema row per pitch."""
    rows = []
    teams = d["gameData"]["teams"]
    for p in d["liveData"]["plays"]["allPlays"]:
        ab = p["about"]
        top = ab["isTopInning"]
        pitches = [e for e in p["playEvents"] if e.get("isPitch")]
        balls = strikes = 0
        ev = p["result"].get("eventType")
        done = p["result"].get("type") == "atBat" and ab.get("isComplete") and ev
        if done and ev.startswith(TRUNCATING):
            ev = "truncated_pa"
        for i, e in enumerate(pitches):
            pdx = e.get("pitchData") or {}
            c, br, h = pdx.get("coordinates") or {}, pdx.get("breaks") or {}, e.get("hitData") or {}
            det = e["details"]
            ext = pdx.get("extension")
            rx, rz = release_point(c, ext)
            hb, ivb = br.get("breakHorizontal"), br.get("breakVerticalInduced")
            code = det.get("code")
            rows.append({
                **meta, "at_bat_number": ab["atBatIndex"] + 1, "pitch_number": e.get("pitchNumber", i + 1),
                "inning": ab["inning"], "inning_topbot": "Top" if top else "Bot",
                "pitcher": p["matchup"]["pitcher"]["id"], "batter": p["matchup"]["batter"]["id"],
                "p_throws": p["matchup"]["pitchHand"]["code"], "stand": p["matchup"]["batSide"]["code"],
                "pitcher_team": teams["home" if top else "away"]["name"],
                "batter_team": teams["away" if top else "home"]["name"],
                "pitch_type": (det.get("type") or {}).get("code"), "call_code": code,
                "description": CALL.get(code, code),
                "events": ev if done and i == len(pitches) - 1 else None,
                "balls": balls, "strikes": strikes,
                "release_speed": pdx.get("startSpeed"),
                "pfx_x": -hb / 12 if hb is not None else None, "pfx_z": ivb / 12 if ivb is not None else None,
                "plate_x": c.get("pX"), "plate_z": c.get("pZ"), "zone": pdx.get("zone"),
                "sz_top": pdx.get("strikeZoneTop"), "sz_bot": pdx.get("strikeZoneBottom"),
                "release_spin_rate": br.get("spinRate"), "spin_axis": br.get("spinDirection"),
                "release_extension": ext, "release_pos_x": rx, "release_pos_z": rz,
                "vx0": c.get("vX0"), "vy0": c.get("vY0"), "vz0": c.get("vZ0"),
                "ax": c.get("aX"), "ay": c.get("aY"), "az": c.get("aZ"),
                "launch_speed": h.get("launchSpeed"), "launch_angle": h.get("launchAngle"),
                "bb_type": h.get("trajectory") if code in ("X", "D", "E") else None,
            })
            cnt = e.get("count") or {}
            balls, strikes = min(cnt.get("balls", balls), 3), min(cnt.get("strikes", strikes), 2)
    return rows


PITCH_BOX = {"outs": "outs", "battersFaced": "bf", "strikeOuts": "so", "baseOnBalls": "bb", "intentionalWalks": "ibb",
             "hitByPitch": "hbp", "hits": "h", "homeRuns": "hr", "earnedRuns": "er", "runs": "r",
             "numberOfPitches": "pitches", "gamesStarted": "gs"}
BAT_BOX = {"plateAppearances": "pa", "atBats": "ab", "hits": "h", "doubles": "2b", "triples": "3b", "homeRuns": "hr",
           "baseOnBalls": "bb", "intentionalWalks": "ibb", "hitByPitch": "hbp", "sacFlies": "sf", "sacBunts": "sh",
           "strikeOuts": "so", "stolenBases": "sb", "caughtStealing": "cs"}


def box_rows(d: dict, meta: dict) -> list[dict]:
    rows = []
    for t in d["liveData"]["boxscore"]["teams"].values():
        for pl in t["players"].values():
            pid, st = pl["person"]["id"], pl.get("stats") or {}
            for role, fields in (("P", PITCH_BOX), ("H", BAT_BOX)):
                s = st.get("pitching" if role == "P" else "batting") or {}
                if not s or (role == "P" and not s.get("battersFaced")) or (role == "H" and not s.get("plateAppearances")):
                    continue
                rows.append({**meta, "id": pid, "name": pl["person"]["fullName"], "role": role,
                             "team": t["team"]["name"], **{v: int(s.get(k) or 0) for k, v in fields.items()}})
    return rows


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seasons", type=int, nargs="*", default=list(SEASONS))
    a = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    old_p = pd.read_parquet(OUT / "pitches.parquet") if (OUT / "pitches.parquet").exists() else None
    old_b = pd.read_parquet(OUT / "box.parquet") if (OUT / "box.parquet").exists() else None
    pitches, box, receipts = [], [], {}
    for season in a.seasons:
        games = schedule(season)

        def one(g: dict, season: int = season):
            d = feed(season, g["game_pk"])
            return pitch_rows(d, g), box_rows(d, g)

        with ThreadPoolExecutor(3) as ex:
            got = list(ex.map(one, games))
        n_p = sum(len(p) for p, _ in got)
        for p, b in got:
            pitches += p
            box += b
        receipts[season] = {"games": len(games), "pitches": n_p}
        print(f"{season}: {len(games)} final games, {n_p} pitches", flush=True)
    p, b = pd.DataFrame(pitches), pd.DataFrame(box)
    if old_p is not None:  # keep seasons not refreshed this run
        p = pd.concat([old_p[~old_p["season"].isin(a.seasons)], p], ignore_index=True)
        b = pd.concat([old_b[~old_b["season"].isin(a.seasons)], b], ignore_index=True)
    unknown = sorted(set(p["call_code"].dropna()) - set(CALL))
    if unknown:
        print("unmapped call codes (kept raw):", unknown)
    p = p.sort_values(["season", "game_pk", "at_bat_number", "pitch_number"], kind="stable")
    p.to_parquet(OUT / "pitches.parquet", index=False, compression="zstd")
    b.to_parquet(OUT / "box.parquet", index=False, compression="zstd")
    rec_path = OUT / "fetch_receipts.json"
    rec = json.loads(rec_path.read_text()) if rec_path.exists() else {}
    rec.update({str(k): {**v, "pulled": time.strftime("%Y-%m-%d")} for k, v in receipts.items()})
    rec_path.write_text(json.dumps(rec, indent=1, sort_keys=True) + "\n")
    print(f"wrote {len(p)} pitches, {len(b)} box rows -> {OUT}")


if __name__ == "__main__":
    main()
