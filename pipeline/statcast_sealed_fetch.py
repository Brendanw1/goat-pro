"""Sealed MLB Statcast bank, 2015-2019 regular season (docs/ml-hardening-plan.md §2). Fetch only; never opened.

    nice -n 10 ~/.venvs/goat-bayes/bin/python pipeline/statcast_sealed_fetch.py [2015 2016 ...]
    python pipeline/statcast_sealed_fetch.py --demo     # schema-cast self-check, no network

-> cache/sealed/statcast/{season}.parquet (zstd), cast to the exact 119-column arrow schema of the mart's 2020 file,
   + cache/sealed/statcast/SEAL.json. Same Savant CSV endpoint as savant_mart/ingest_daily.py, regular season only
   (hfGT=R), 3-day windows (~14k rows, under the 25k server cap), 1.5 s apart, backoff retries. Receipts are the part
   files in parts/{season}/ (an empty window writes a .empty marker), so a re-run resumes. Stops if disk < 6 GB free.

Nothing here computes or prints an outcome column. Handling checks only: rows, schema gaps, INPUT null rates,
duplicate pitch keys. The mart (savant_mart/mart.py) reads explicit FULL_SEASONS paths and refuses < 2020 or any
sealed path, so no bake can pick this up.
"""
import datetime as dt
import hashlib
import io
import json
import shutil
import sys
import time
import urllib.request
from pathlib import Path

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

OUT = Path(__file__).resolve().parent.parent / "cache" / "sealed" / "statcast"
SCHEMA_SRC = "/Users/brendanwaterval/Projects/Waterval_stuff_research/data/raw/savant/2020.parquet"
URL = ("https://baseballsavant.mlb.com/statcast_search/csv?all=true&type=details&player_type=pitcher&hfGT=R%7C"
       "&hfSea={season}%7C&game_date_gt={a}&game_date_lt={b}")
UA = "Mozilla/5.0 (compatible; savant-mart/1.0; personal analytics)"
SPAN, STEP, CAP, MIN_FREE_GB = ("03-15", "10-07"), 3, 25_000, 6
KEY = ["game_pk", "at_bat_number", "pitch_number"]
INPUTS = ["pitch_type", "release_speed", "release_pos_x", "release_pos_y", "release_pos_z", "pfx_x", "pfx_z",
          "plate_x", "plate_z", "vx0", "vy0", "vz0", "ax", "ay", "az", "sz_top", "sz_bot", "effective_speed",
          "release_spin_rate", "release_extension", "spin_axis", "arm_angle", "api_break_z_with_gravity",
          "api_break_x_arm", "bat_speed", "launch_speed", "launch_angle"]  # launch_*: null rate only


def get(url: str) -> bytes:
    for i, wait in enumerate([10, 30, 90, 0]):
        try:
            time.sleep(1.5)
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=180) as r:
                return r.read()
        except Exception as e:  # network / 5xx: back off, then give up loudly
            if i == 3:
                raise
            print(f"  retry {i + 1} in {wait}s: {e}", flush=True)
            time.sleep(wait)


def free_gb() -> float:
    return shutil.disk_usage(OUT).free / 1e9


def to_schema(df: pd.DataFrame, schema: pa.Schema) -> tuple[pa.Table, list[str], list[str], dict]:
    """Cast to the mart schema: missing columns become null, extra columns are dropped, and values that don't fit a
    numeric column (pre-2020 PITCHf/x ids like sv_id '150407_203357') are nulled; all three are reported."""
    missing = [n for n in schema.names if n not in df]
    extra = [c for c in df if c not in schema.names]
    df = df.reindex(columns=schema.names)
    nulled = {}
    for f in schema:
        if pa.types.is_integer(f.type) or pa.types.is_floating(f.type):
            num = pd.to_numeric(df[f.name], errors="coerce")
            if n := int(num.isna().sum() - df[f.name].isna().sum()):
                nulled[f.name] = n
            df[f.name] = num.astype("Int64" if pa.types.is_integer(f.type) else "float64")
        else:
            df[f.name] = df[f.name].astype("string")
    return pa.Table.from_pandas(df, schema=schema, preserve_index=False), missing, extra, nulled


def season(y: int, schema: pa.Schema) -> dict:
    parts = OUT / "parts" / str(y)
    parts.mkdir(parents=True, exist_ok=True)
    a, end = dt.date.fromisoformat(f"{y}-{SPAN[0]}"), dt.date.fromisoformat(f"{y}-{SPAN[1]}")
    while a <= end:
        b = min(a + dt.timedelta(days=STEP - 1), end)
        f = parts / f"{a}.parquet"
        if not f.exists() and not f.with_suffix(".empty").exists():
            df = pd.read_csv(io.BytesIO(get(URL.format(season=y, a=a, b=b))), low_memory=False)
            if len(df) >= CAP:
                raise RuntimeError(f"{a}..{b}: {len(df)} rows hit the server cap; shrink STEP")
            if df.empty:
                f.with_suffix(".empty").touch()
            else:
                df.to_parquet(f, index=False)
            print(f"  {y} {a}..{b}: {len(df):,}", flush=True)
        a = b + dt.timedelta(days=1)
    df = pd.concat([pd.read_parquet(p) for p in sorted(parts.glob("*.parquet"))], ignore_index=True)
    table, missing, extra, nulled = to_schema(df, schema)
    out = OUT / f"{y}.parquet"
    pq.write_table(table, out, compression="zstd")
    k = df[KEY]
    report = {"rows": len(df), "dup_keys": int(k.duplicated().sum()), "null_key_rows": int(k.isna().any(axis=1).sum()),
              "missing_vs_2020_schema": missing, "extra_dropped": extra, "nulled_by_cast": nulled,
              "input_null_rate": {c: round(float(df[c].isna().mean()), 4) if c in df else None for c in INPUTS}}
    shutil.rmtree(parts)
    return report


def main(years: list[int]) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    schema = pq.read_schema(SCHEMA_SRC).remove_metadata()
    checks_p = OUT / "checks.json"
    checks = json.loads(checks_p.read_text()) if checks_p.exists() else {}
    for y in years:
        assert 2015 <= y <= 2019, "sealed bank is 2015-2019 only"
        if (OUT / f"{y}.parquet").exists() and str(y) in checks:
            continue
        if free_gb() < MIN_FREE_GB:
            sys.exit(f"STOP: {free_gb():.1f} GB free < {MIN_FREE_GB} GB before {y}")
        print(f"{y}: fetching ({free_gb():.1f} GB free)", flush=True)
        checks[str(y)] = season(y, schema)
        checks_p.write_text(json.dumps(checks, indent=1))
        print(f"{y}: {checks[str(y)]['rows']:,} rows, dup keys {checks[str(y)]['dup_keys']}", flush=True)
    files = {f.name: {"rows": pq.ParquetFile(f).metadata.num_rows, "sha256": hashlib.sha256(f.read_bytes()).hexdigest()}
             for f in sorted(OUT.glob("*.parquet"))}
    seal = {"section": "ml-hardening-plan §2 sealed bank: MLB Statcast 2015-2019", "date": str(dt.date.today()),
            "status": "not opened", "source": URL, "chunking": f"{STEP}-day windows {SPAN[0]}..{SPAN[1]}, hfGT=R",
            "schema": f"cast to {SCHEMA_SRC} (119 cols), zstd",
            "rule": "no outcome column (events, description, type, bb_type, des, delta_*_exp, estimated_*, woba_*, "
                    "babip/iso_value, hit_*, hc_*, post_*_score, *_win_exp) computed or printed until a frozen model "
                    "is scored once; each read spends the bank for that claim",
            "files": files}
    (OUT / "SEAL.json").write_text(json.dumps(seal, indent=1))
    print(json.dumps({k: v["rows"] for k, v in files.items()}), flush=True)


def demo():
    schema = pa.schema([("game_pk", pa.int64()), ("zone", pa.float64()), ("pitch_type", pa.large_string())])
    t, missing, extra, nulled = to_schema(pd.DataFrame({"game_pk": [1, None], "zone": ["150407_2", 3], "junk": [0, 0],
                                                        "pitch_type": ["FF", None]}), schema)
    assert t.schema == schema and missing == [] and extra == ["junk"] and t.column("game_pk").null_count == 1
    assert nulled == {"zone": 1}
    print("demo ok")


if __name__ == "__main__":
    demo() if "--demo" in sys.argv else main([int(a) for a in sys.argv[1:]] or list(range(2015, 2020)))
