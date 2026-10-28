#!/usr/bin/env python
"""Fetch MLB Pipeline prospect rankings for every list and year, into
data/milb/prospects.json (gitignored; re-fetchable).

Source: MLB Pipeline's public data-graph GraphQL, the same named query the
prospects page issues (`GetPlayerRankings` → `getPlayerRankingsFromSelection`).
Slug shapes (dissected from the page's own bundle, verified live):
  sel-pr-{year}-top100          the Top 100
  sel-pr-{year}-{team slug}     Top 30 per club (yankees, redsox, dbacks, ...)
  sel-pr-{year}-{position}      Top 10 per position (1b 2b ss 3b c of rhp lhp)
Years 2011–2026 answered as of 2026-10-28.

  venv pipeline/prospects_fetch.py                # all years
  venv pipeline/prospects_fetch.py --years 2026   # one season
"""
import argparse
import json
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "milb" / "prospects.json"

TEAMS = ["angels", "astros", "athletics", "bluejays", "braves", "brewers", "cardinals",
         "cubs", "dbacks", "dodgers", "giants", "guardians", "mariners", "marlins",
         "mets", "nationals", "orioles", "padres", "phillies", "pirates", "rangers",
         "rays", "redsox", "reds", "rockies", "royals", "tigers", "twins", "whitesox", "yankees"]
POSITIONS = ["of", "rhp", "lhp", "ss", "c", "1b", "2b", "3b"]

QUERY = """query GetPlayerRankings($slug: String, $limit: Int, $skip: Int) {
  prospects: getPlayerRankingsFromSelection(slug: $slug, limit: $limit, skip: $skip) {
    rank
    playerEntity {
      eta
      gradesHitting { key value }
      gradesPitching { key value }
      player {
        id
        fullName
        birthDate
        currentAge
        batSideCode
        primaryPosition { abbreviation }
        activeRoster { id name parentOrgName }
      }
    }
  }
}"""


def fetch_list(slug: str, retries: int = 2) -> list[dict]:
    body = json.dumps({"query": QUERY, "variables": {"slug": slug, "limit": 200, "skip": 0}}).encode()
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request("https://data-graph.mlb.com/graphql", data=body,
                                         headers={"Content-Type": "application/json"}, method="POST")
            with urllib.request.urlopen(req, timeout=45) as r:
                d = json.loads(r.read())
            return d.get("data", {}).get("prospects") or []
        except Exception as e:
            if attempt >= retries:
                print(f"  {slug}: FAILED ({e})")
                return []
            time.sleep(2 * (attempt + 1))
    return []


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", type=int, nargs="+", default=list(range(2011, 2027)))
    args = ap.parse_args()

    out = {}
    t0 = time.time()
    for year in args.years:
        year_out = {}
        for kind, slugs in [("top100", ["top100"]), ("team", TEAMS), ("position", POSITIONS)]:
            for slug_part in slugs:
                slug = f"sel-pr-{year}-{slug_part}"
                rows = fetch_list(slug)
                if not rows:
                    continue
                key = "top100" if kind == "top100" else f"{kind}:{slug_part}"
                year_out[key] = [{
                    "rank": r["rank"],
                    "id": (r.get("playerEntity") or {}).get("player", {}).get("id"),
                    "name": (r.get("playerEntity") or {}).get("player", {}).get("fullName"),
                    "pos": ((r.get("playerEntity") or {}).get("player", {}).get("primaryPosition") or {}).get("abbreviation"),
                    "eta": (r.get("playerEntity") or {}).get("eta"),
                    "age": (r.get("playerEntity") or {}).get("player", {}).get("currentAge"),
                    "bats": (r.get("playerEntity") or {}).get("player", {}).get("batSideCode"),
                    "org": ((r.get("playerEntity") or {}).get("player", {}).get("activeRoster") or {}).get("parentOrgName"),
                    "gradesHitting": (r.get("playerEntity") or {}).get("gradesHitting"),
                    "gradesPitching": (r.get("playerEntity") or {}).get("gradesPitching"),
                } for r in rows if (r.get("playerEntity") or {}).get("player", {}).get("id")]
                if kind != "top100":
                    time.sleep(0.15)
        if year_out:
            out[str(year)] = year_out
            print(f"{year}: " + ", ".join(f"{k}={len(v)}" for k, v in sorted(year_out.items())[:3])
                  + f" ({sum(len(v) for v in year_out.values())} rows)")
        time.sleep(0.2)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, sort_keys=True))
    n_lists = sum(len(v) for v in out.values())
    n_rows = sum(len(v) for v in out.values() for v in v.values())
    print(f"{n_lists} lists, {n_rows} ranked rows across {len(out)} years -> {OUT} ({time.time() - t0:.0f}s)")


if __name__ == "__main__":
    main()
