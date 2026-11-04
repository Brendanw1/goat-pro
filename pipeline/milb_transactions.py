"""milb_transactions.py — prospect program F4: Stats API transactions 2011-26, MLB + AAA..Single-A, full months.

    nice -n 10 python pipeline/milb_transactions.py         # -> data/milb/transactions_full.parquet

One request per month (all five sportIds in one call), one connection with a 1 s gap, the milb_pbp Client (gzip,
User-Agent, 60 s backoff, stop after 10 failures). Replaces nothing: `transactions.parquet` (amateur_fetch.py, 2019+,
MLB + AAA only, and each month cut at the 28th, which drops ~4.5% of rows) stays as it is for its current readers;
new prospect work reads this file.
"""
import calendar
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from milb_pbp import API, Client  # noqa: E402

OUT = Path(__file__).resolve().parent.parent / "data" / "milb" / "transactions_full.parquet"
SPORTS = "&".join(f"sportId={s}" for s in (1, 11, 12, 13, 14))


def run(first=2011, last=(2026, 11)):
    c = Client()
    c.gap = 1.0
    rows = []
    for y in range(first, last[0] + 1):
        for m in range(1, 13):
            if (y, m) > last:
                break
            end = calendar.monthrange(y, m)[1]
            d = c.get(f"{API}/transactions?startDate={m:02d}/01/{y}&endDate={m:02d}/{end}/{y}&{SPORTS}") or {}
            for t in d.get("transactions", []):
                p, fr, to = t.get("person") or {}, t.get("fromTeam") or {}, t.get("toTeam") or {}
                if p.get("id"):
                    rows.append({"id": p["id"], "name": p.get("fullName"), "date": t.get("date"),
                                 "effective": t.get("effectiveDate"), "resolution": t.get("resolutionDate"),
                                 "type": t.get("typeCode"), "desc": t.get("description"),
                                 "from_id": fr.get("id"), "from": fr.get("name"), "to_id": to.get("id"), "to": to.get("name")})
        print(f"{y}: {len(rows):,} rows so far", flush=True)
    df = pd.DataFrame(rows).drop_duplicates(subset=["id", "date", "type", "desc"])
    df.to_parquet(OUT, compression="zstd", index=False)
    print(f"{OUT.name}: {len(df):,} rows, {df.id.nunique():,} players")


if __name__ == "__main__":
    run()
