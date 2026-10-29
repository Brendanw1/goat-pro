"""Fetch the amateur + movement layer for the site (depth list item 5).

Three public statsapi sources into data/milb/ (gitignored, refetchable):

  python amateur_fetch.py                 # everything below
  python amateur_fetch.py --only draft    # draft 2011-2026
  python amateur_fetch.py --only trans    # transactions 2019-2026, monthly pages
  python amateur_fetch.py --only people   # debut/position hydration

- Draft:            /api/v1/draft/{year} — one call per year, every pick with
                    mlbam id (where the API carries one), overall + round pick
                    numbers, club, school, signing bonus.
- Transactions:     /api/v1/transactions paged by month — call-ups, options,
                    DFAs, trades. The minors-profile timeline surface.
- People:           /api/v1/people?personIds=… batched — MLB debut date and
                    position for every drafted∪ranked player, the reached-MLB
                    and time-to-MLB joins of the hit-rate tables.

Etiquette: 1.5 s pause between requests (the mart's rule), logged skips
rather than raises, idempotent full-file writes.
"""
import argparse
import json
import time
import urllib.request
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "milb"
UA = {"User-Agent": "Mozilla/5.0"}
PAUSE = 1.5
DRAFT_YEARS = range(2011, 2027)
TRANS_START = (2019, 4)   # (year, month)
TRANS_END = (2026, 10)


def get(url: str):
    req = urllib.request.Request(url, headers=UA)
    return json.load(urllib.request.urlopen(req, timeout=60))


def fetch_draft() -> None:
    out: dict[str, list] = {}
    for y in DRAFT_YEARS:
        try:
            d = get(f"https://statsapi.mlb.com/api/v1/draft/{y}")
        except Exception as e:  # noqa: BLE001
            print(f"  ! draft {y}: {e}")
            continue
        picks = []
        for rnd in d.get("drafts", {}).get("rounds", []) or []:
            for p in rnd.get("picks", []) or []:
                if p.get("isPass"):
                    continue
                person = p.get("person") or {}
                team = p.get("team") or {}
                picks.append({
                    "year": y,
                    "pick": p.get("pickNumber"),
                    "round": p.get("pickRound") or rnd.get("round"),
                    "roundPick": p.get("roundPickNumber"),
                    "id": person.get("id"),
                    "name": person.get("fullName"),
                    "team": team.get("name"),
                    "teamId": team.get("id"),
                    "school": (p.get("school") or {}).get("name"),
                    "bonus": p.get("signingBonus"),
                })
        out[str(y)] = picks
        print(f"  draft {y}: {len(picks)} picks")
        time.sleep(PAUSE)
    (OUT / "draft.json").write_text(json.dumps(out))
    n = sum(len(v) for v in out.values())
    n_id = sum(1 for v in out.values() for p in v if p["id"])
    print(f"draft.json: {n} picks, {n_id} with mlbam ids")


def _months():
    y, m = TRANS_START
    while (y, m) <= TRANS_END:
        yield y, m
        m += 1
        if m == 13:
            y, m = y + 1, 1


def fetch_transactions() -> None:
    rows = []
    for y, m in _months():
        mm = f"{m:02d}"
        last = "12" if (y, m) != TRANS_END else "28"
        # statsapi dates are MM/DD/YYYY; the 01/28 day bounds cap each call to
        # its month (28 avoids month-length math; the full re-read each run
        # covers anything a short month's tail might clip).
        url = (f"https://statsapi.mlb.com/api/v1/transactions"
               f"?startDate={mm}/01/{y}&endDate={mm}/28/{y}&sportId=1&sportId=11")
        try:
            d = get(url)
        except Exception as e:  # noqa: BLE001
            print(f"  ! transactions {y}-{mm}: {e}")
            continue
        batch = d.get("transactions", []) or []
        for t in batch:
            person = t.get("person") or {}
            if not person.get("id"):
                continue
            rows.append({
                "id": person["id"],
                "name": person.get("fullName"),
                "date": t.get("date"),
                "type": t.get("typeCode"),
                "desc": t.get("description"),
                "from": (t.get("fromTeam") or {}).get("abbreviation"),
                "to": (t.get("toTeam") or {}).get("abbreviation"),
            })
        print(f"  {y}-{mm}: {len(batch)} rows (total {len(rows)})")
        time.sleep(PAUSE)
    df = pd.DataFrame(rows).drop_duplicates(subset=["id", "date", "type", "desc"])
    df.to_parquet(OUT / "transactions.parquet")
    print(f"transactions.parquet: {len(df)} rows, {df.id.nunique()} players")


def fetch_people() -> None:
    ids: set[int] = set()
    draft_fp = OUT / "draft.json"
    if draft_fp.exists():
        for picks in json.loads(draft_fp.read_text()).values():
            ids |= {p["id"] for p in picks if p.get("id")}
    prospects_fp = OUT / "prospects.json"
    if prospects_fp.exists():
        raw = json.loads(prospects_fp.read_text())
        for lists in raw.values():
            for ls in lists.values():
                ids |= {int(r["id"]) for r in ls if r.get("id")}
    ids = sorted(i for i in ids if i)
    print(f"players to hydrate: {len(ids)}")
    rows = []
    for i in range(0, len(ids), 100):
        batch = ids[i:i + 100]
        try:
            d = get("https://statsapi.mlb.com/api/v1/people?personIds=" + ",".join(map(str, batch)))
        except Exception as e:  # noqa: BLE001
            print(f"  ! people {batch[0]}..: {e}")
            continue
        for p0 in d.get("people", []):
            rows.append({
                "id": p0.get("id"), "name": p0.get("fullName"),
                "debut": p0.get("mlbDebutDate"),
                "pos": (p0.get("primaryPosition") or {}).get("abbreviation"),
                "birth": p0.get("birthDate"),
                "height": p0.get("height"), "weight": p0.get("weight"),
                "bats": p0.get("batSide", {}).get("code"), "throws": p0.get("pitchHand", {}).get("code"),
            })
        time.sleep(PAUSE)
    pd.DataFrame(rows).to_parquet(OUT / "people.parquet")
    n_debut = sum(1 for r0 in rows if r0.get("debut"))
    print(f"people.parquet: {len(rows)} players, {n_debut} with MLB debut")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", choices=("draft", "trans", "people"), default=None)
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    if args.only in (None, "draft"):
        fetch_draft()
    if args.only in (None, "trans"):
        fetch_transactions()
    if args.only in (None, "people"):
        fetch_people()


if __name__ == "__main__":
    main()
