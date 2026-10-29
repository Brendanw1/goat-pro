"""r2_sync.py — mirror data/export/web/ into R2 under the goatpro/ key prefix.

The fork's web client (web/lib/r2.ts) reads baked JSON from R2 only, with
R2_PREFIX namespacing the keys, so the two must agree:

    python pipeline/r2_sync.py                 # upload + prune, prefix goatpro/
    python pipeline/r2_sync.py --dry-run       # list the plan
    python pipeline/r2_sync.py --path aaa      # one subtree (upload + prune inside it only)

Credentials come from goat-pro/.env (gitignored): R2_ENDPOINT, R2_BUCKET_NAME,
R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY. Never printed; a missing key fails the
run loudly. The mirror is exact: remote objects under the prefix that no longer
exist locally are deleted, so a re-bake overwrites whole keys and nothing stale
survives (AGENTS.md clean-room rule 5: the site reads baked JSON only, and only
ours — the prefix is never shared with another app's keys).

Fast path: the bucket listing carries every object's ETag, which for a single-part
upload is the object's md5, so the plan is one list call per 1,000 keys and a local
hash; uploads run in parallel as single-part puts (so every ETag stays an md5 —
multipart uploads have non-md5 ETags and would re-upload on every run).
No-loss rules: every put is checked against the md5 R2 returns; deletions run only
after every upload succeeded, in batches, and a deletion of more than 10% of the
remote keys stops unless --allow-mass-delete (a half-finished bake must not prune
the site); the run ends by re-listing and checking every local key's md5.
"""

import argparse
import hashlib
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import boto3
from botocore.config import Config

ROOT = Path(__file__).resolve().parents[1]
LOCAL = ROOT / "data" / "export" / "web"
PREFIX = "goatpro"
ENV_FILE = ROOT / ".env"
WORKERS = 32


def load_env() -> dict:
    env = dict(os.environ)
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    return env


def remote_etags(s3, bucket: str, prefix: str) -> dict[str, str]:
    out = {}
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=prefix):
        out.update({o["Key"]: o["ETag"].strip('"') for o in page.get("Contents", [])})
    return out


def md5(p: Path) -> str:
    return hashlib.md5(p.read_bytes()).hexdigest()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--path", default="", help="sync only this subtree of data/export/web (e.g. aaa, minors)")
    ap.add_argument("--allow-mass-delete", action="store_true",
                    help="permit deleting more than 10%% of the remote keys in scope")
    args = ap.parse_args()

    env = load_env()
    missing = [k for k in ("R2_ENDPOINT", "R2_BUCKET_NAME", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY") if not env.get(k)]
    if missing:
        sys.exit(f"missing {', '.join(missing)} in env or {ENV_FILE}")

    sub = args.path.strip("/")
    base = LOCAL / sub if sub else LOCAL
    if not base.exists():
        sys.exit(f"{base} does not exist — run pipeline/web_export.py first")
    scope = f"{PREFIX}/{sub}/" if sub else f"{PREFIX}/"

    s3 = boto3.client(
        "s3",
        endpoint_url=env["R2_ENDPOINT"],
        aws_access_key_id=env["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=env["R2_SECRET_ACCESS_KEY"],
        config=Config(max_pool_connections=WORKERS * 2, retries={"max_attempts": 10, "mode": "adaptive"}),
    )
    bucket = env["R2_BUCKET_NAME"]

    t0 = time.time()
    # BAKE_LOCK is the concurrent-bake lockfile (web_export.py run_bake), not
    # data — it appears and vanishes mid-sync and its upload race aborts the run.
    local = {f"{PREFIX}/{p.relative_to(LOCAL).as_posix()}": p
             for p in sorted(base.rglob("*")) if p.is_file() and p.name != "BAKE_LOCK"}
    with ThreadPoolExecutor(WORKERS) as ex:
        local_md5 = dict(zip(local, ex.map(md5, local.values())))
    remote = remote_etags(s3, bucket, scope)
    print(f"local: {len(local)} files under {scope}; remote: {len(remote)} ({time.time() - t0:.0f}s)")

    to_put = [k for k in local if remote.get(k) != local_md5[k]]
    to_delete = sorted(set(remote) - set(local))
    print(f"plan: {len(to_put)} uploads, {len(to_delete)} deletions")
    if args.dry_run:
        for k in to_put[:10]:
            print("  put", k)
        for k in to_delete[:10]:
            print("  del", k)
        return
    if to_delete and len(to_delete) > 0.10 * len(remote) and not args.allow_mass_delete:
        sys.exit(f"refusing to delete {len(to_delete)} of {len(remote)} remote keys (>10%) — is the local bake "
                 f"complete? Re-run with --allow-mass-delete if this is intended. Nothing was uploaded.")

    def put(key: str) -> str | None:
        body = local[key].read_bytes()
        etag = s3.put_object(Bucket=bucket, Key=key, Body=body)["ETag"].strip('"')
        return None if etag == local_md5[key] else f"{key}: R2 md5 {etag} != local {local_md5[key]}"

    t1, failed = time.time(), []
    with ThreadPoolExecutor(WORKERS) as ex:
        futs = {ex.submit(put, k): k for k in to_put}
        for i, f in enumerate(as_completed(futs), 1):
            try:
                err = f.result()
            except Exception as e:  # noqa: BLE001 — collected, the run fails below
                err = f"{futs[f]}: {e}"
            if err:
                failed.append(err)
            if i % 2000 == 0:
                print(f"  {i}/{len(to_put)} uploaded ({time.time() - t1:.0f}s)", flush=True)
    if failed:
        print(f"FAILED: {len(failed)} uploads; nothing deleted.")
        for e in failed[:20]:
            print("  ", e)
        sys.exit(1)

    for i in range(0, len(to_delete), 1000):
        batch = [{"Key": k} for k in to_delete[i:i + 1000]]
        res = s3.delete_objects(Bucket=bucket, Delete={"Objects": batch, "Quiet": True})
        if res.get("Errors"):
            sys.exit(f"delete errors: {res['Errors'][:5]}")

    after = remote_etags(s3, bucket, scope)
    bad = [k for k in local if after.get(k) != local_md5[k]]
    stale = set(after) - set(local)
    if bad or stale:
        sys.exit(f"VERIFY FAILED: {len(bad)} keys missing or wrong md5, {len(stale)} stale keys (e.g. {(bad or sorted(stale))[:3]})")
    print(f"done: {len(to_put)} uploaded, {len(to_delete)} deleted; verified {len(local)} keys "
          f"({time.time() - t0:.0f}s total)")


if __name__ == "__main__":
    main()
