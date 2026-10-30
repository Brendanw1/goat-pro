"""D-48: coaching staffs, every club, every season.

    python coaches_fetch.py            # fetch every pending (team, season); resumable
    python coaches_fetch.py --probe    # one known case, writes nothing

The scope-doc verified recipe: statsapi.mlb.com/api/v1/teams/{id}/coaches?season=
returns the full staff with job titles (2015 + 2026 checked live; the run confirms
the 2020-2024 span). One JSON per season at data/coaches/coaches_{season}.json with
the API's rows verbatim (coach id, name, job, title) plus the club id. Resumable
receipts, 1.5 s pause, honest UA, backoff — the house etiquette.
"""
import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "coaches"
PAUSE_S = 1.5
UA = "goat-pro research fetcher (personal, non-commercial; contact: repo owner)"
SEASONS = list(range(2015, 2027))


def http_json(url: str, tries: int = 4) -> dict | None:
    for t in range(tries):
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503) and t < tries - 1:
                time.sleep(2 ** (t + 1) * 2)
                continue
            print(f"  HTTP {e.code} for {url}")
            return None
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            if t < tries - 1:
                time.sleep(2 ** (t + 1) * 2)
                continue
            print(f"  {type(e).__name__} for {url}")
            return None
    return None


def club_ids() -> list[int]:
    d = http_json("https://statsapi.mlb.com/api/v1/teams?sportIds=1&season=2026")
    return sorted(t["id"] for t in (d or {}).get("teams", [])) or []


def fetch_season(season: int, ids: list[int]) -> bool:
    rows = []
    for cid in ids:
        d = http_json(f"https://statsapi.mlb.com/api/v1/teams/{cid}/coaches?season={season}")
        if d is None:
            return False
        for c in d.get("roster", []):
            p = c.get("person", {})
            rows.append({
                "season": season, "team_id": cid,
                "id": p.get("id"), "name": p.get("fullName"),
                "job_code": c.get("jobId"), "job": c.get("job"), "title": c.get("title"),
            })
        time.sleep(PAUSE_S)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"coaches_{season}.json").write_text(json.dumps(rows, separators=(",", ":")))
    print(f"  {season}: {len(rows)} coach-season rows across {len({r['team_id'] for r in rows})} clubs")
    return True


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--probe", action="store_true")
    a = ap.parse_args()
    if a.probe:
        d = http_json("https://statsapi.mlb.com/api/v1/teams/147/coaches?season=2022")
        r = (d or {}).get("roster", [])
        print(f"probe 2022 NYY: {len(r)} coaches; e.g. "
              + "; ".join(f"{c['person']['fullName']} ({c.get('job')})" for c in r[:3]))
        return

    receipts_f = OUT / "fetch_receipts.json"
    receipts = json.loads(receipts_f.read_text()) if receipts_f.exists() else {}
    ids = club_ids()
    if not ids:
        sys.exit("no club ids — API unreachable?")
    pending = [s for s in SEASONS if receipts.get(str(s)) != "ok" or not (OUT / f"coaches_{s}.json").exists()]
    print(f"{len(pending)} of {len(SEASONS)} seasons pending; {len(ids)} clubs; pause {PAUSE_S}s")
    for s in pending:
        t0 = time.time()
        ok = fetch_season(s, ids)
        receipts[str(s)] = "ok" if ok else "failed"
        receipts_f.write_text(json.dumps(receipts, indent=1, sort_keys=True))
        print(f"  [{time.time() - t0:.0f}s] {s}: {receipts[str(s)]}")
    print(f"done: {sum(1 for v in receipts.values() if v == 'ok')}/{len(SEASONS)} seasons ok -> {OUT}")


if __name__ == "__main__":
    main()
