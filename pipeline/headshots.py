"""D-32 insurance mirror of MLB's headshot CDN into R2 (headshots/{id}.png). The SITE hot-links the
CDN directly (web/lib/headshot.tsx) so photos stay current and nothing load-bearing is stored here;
this copy exists so a CDN change or outage cannot break the site's primary visual, and so usage can
migrate to our bucket later without a second research pass.

    python headshots.py                # mirror every player_index id, politely
    python headshots.py --dry-run      # count ids, list remote coverage, fetch nothing

Politeness: 2.0 s pause per download (the mart's Savant etiquette), honest UA, exponential backoff
on 429/5xx, three attempts, then a dead-list that is reported and never retried this run. Resumable:
remote keys are listed first and skipped. ~2,800 ids at 2 s is ~95 minutes; run it as a background
job, not in a bake window.
"""
import argparse
import io
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import boto3
from botocore.config import Config

sys.path.insert(0, str(Path(__file__).resolve().parent))
from r2_sync import load_env, remote_etags  # noqa: E402  (env file + listing already proven)

ROOT = Path(__file__).resolve().parent.parent
INDEX = ROOT / "data" / "export" / "web" / "player_index.json"
CDN = ("https://img.mlbstatic.com/mlb-photos/image/upload/"
       "d_people:generic:headshot:67:current.png/w_426,q_auto:best/v1/people/{id}/headshot/67/current")
UA = "goat-pro research mirror (contact: repo README)"
PAUSE_S = 2.0
RES = Path(__file__).resolve().parent / "results"


def fetch(id_: str) -> bytes | None:
    req = urllib.request.Request(CDN.format(id=id_), headers={"User-Agent": UA})
    backoff = PAUSE_S
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504):
                time.sleep(backoff)
                backoff *= 2
                continue
            if e.code == 404:
                return None  # no photo and no generic either: record, move on
            return None
        except Exception:
            time.sleep(backoff)
            backoff *= 2
    return None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    ids = sorted(json.loads(INDEX.read_text()))
    print(f"{len(ids)} player ids from player_index.json", flush=True)
    env = load_env()
    s3 = boto3.client("s3", endpoint_url=env["R2_ENDPOINT"], aws_access_key_id=env["R2_ACCESS_KEY_ID"],
                      aws_secret_access_key=env["R2_SECRET_ACCESS_KEY"],
                      config=Config(max_pool_connections=2, retries={"max_attempts": 5, "mode": "adaptive"}))
    bucket, prefix = env["R2_BUCKET_NAME"], "goatpro"
    have = {k.rsplit("/", 1)[1].removesuffix(".png") for k in remote_etags(s3, bucket, f"{prefix}/headshots/")}
    todo = [i for i in ids if i not in have]
    print(f"{len(have)} already mirrored, {len(todo)} to fetch", flush=True)
    if args.dry_run:
        return

    done = failed = nophoto = 0
    dead: list[str] = []
    t0 = time.time()
    for n, id_ in enumerate(todo, 1):
        body = fetch(id_)
        if body is None:
            dead.append(id_)
            nophoto += 1
        else:
            try:
                s3.put_object(Bucket=bucket, Key=f"{prefix}/headshots/{id_}.png", Body=body,
                              ContentType="image/png", CacheControl="public, max-age=86400")
                done += 1
            except Exception as e:  # noqa: BLE001 — logged, never fatal
                failed += 1
                dead.append(id_)
                print(f"  put failed {id_}: {e}", flush=True)
        if n % 100 == 0:
            print(f"  {n}/{len(todo)} ({done} mirrored, {nophoto} no-photo/failed) "
                  f"[{time.time() - t0:.0f}s]", flush=True)
        time.sleep(PAUSE_S)
    RES.mkdir(parents=True, exist_ok=True)
    (RES / "headshots_mirror.json").write_text(json.dumps(
        {"ids_total": len(ids), "already": len(have), "fetched": done, "no_photo_or_failed": nophoto,
         "failed_puts": failed, "dead": dead, "seconds": round(time.time() - t0)}, indent=1))
    print(f"done: {done} mirrored, {nophoto} no-photo/failed, {failed} failed puts -> results/headshots_mirror.json",
          flush=True)


if __name__ == "__main__":
    main()
