"""Fable kit, step 3.1 (BaseballGOAT docs/fable-research-setup.md sections 2 and 6): the fable: seal, the frozen
judge and the dev seal check. The kit lives outside every repo (it will hold private college data); this file only
builds and checks it.

    python fable_kit.py freeze KIT_DIR   # judge.py at git HEAD -> KIT_DIR/judge/ + SHA256SUMS + KIT.json
    python fable_kit.py verify KIT_DIR   # every frozen file still matches SHA256SUMS
    python fable_kit.py check KIT_DIR    # zero fable:-sealed pitcher IDs in any parquet/csv under KIT_DIR/dev
    python fable_kit.py dev-mlb KIT_DIR  # mart 2021-25 regular season minus sealed pitchers -> KIT_DIR/dev/mlb
    python fable_kit.py demo

Seal: crc32("fable:" + id) % 5 == 0, about 20% of pitchers, MLB mlbam and college pid alike (judge.sealed). It is
independent of the P7 seal ("p7:"). No season is unspent (MLB 2020, AAA 2025->26 and college 2026 are spent; no 2027
reads), so a sealed read is labelled "pitcher-held-out, not time-held-out". Sealed rows are never exported: the
sealed read is run by us on the full mart (judge.py --salt fable --pitchers sealed), never from the kit.
"""
import hashlib
import json
import subprocess
import sys
import tempfile
from datetime import date
from pathlib import Path

import pandas as pd

PIPE = Path(__file__).resolve().parent
sys.path.insert(0, str(PIPE))
from judge import sealed  # noqa: E402

SALT = "fable"
# 3.2: change_test + crossfit_v2 read dev/ under FABLE_DEV (train_mlb.DEV); their imports ride along so the frozen
# copies run from KIT_DIR/judge alone
FROZEN = ("pipeline/judge.py", "pipeline/change_test.py", "pipeline/crossfit_v2.py", "pipeline/train_mlb.py",
          "pipeline/stuff_v2.py", "pipeline/physics.py", "pipeline/paths.py")
MLB_SEASONS = range(2021, 2026)
ID_COLS = ("mlbam", "pitcher", "pid", "PitcherKey")   # first present = the sealed unit (college: pid, not the raw key)


def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def freeze(kit):
    kit = Path(kit)
    (kit / "judge").mkdir(parents=True, exist_ok=True)
    head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=PIPE, capture_output=True, text=True, check=True).stdout.strip()
    sums = {}
    for f in FROZEN:   # from the commit, not the working tree, so the hash names reviewed code
        body = subprocess.run(["git", "show", f"HEAD:{f}"], cwd=PIPE, capture_output=True, check=True).stdout
        dst = kit / "judge" / Path(f).name
        dst.unlink(missing_ok=True)   # re-freeze (a deliberate re-hash) replaces the read-only copy
        dst.write_bytes(body)
        dst.chmod(0o444)
        sums[dst.name] = hashlib.sha256(body).hexdigest()
    (kit / "judge" / "SHA256SUMS").write_text("".join(f"{h}  {n}\n" for n, h in sums.items()))
    (kit / "KIT.json").write_text(json.dumps({"step": "3.2", "goat_pro_commit": head, "frozen": date.today().isoformat(),
                                              "seal": f'crc32("{SALT}:" + id) % 5 == 0', "sha256": sums,
                                              "label": "pitcher-held-out, not time-held-out"}, indent=1))
    return sums


def verify(kit):
    j = Path(kit) / "judge"
    bad = [n for h, n in (ln.split("  ") for ln in (j / "SHA256SUMS").read_text().splitlines()) if sha(j / n) != h]
    return bad


def check(kit):
    """Every ID column in every dev table must hold zero sealed pitchers. Returns {file: n_sealed} for failures."""
    bad, seen = {}, 0
    for f in sorted(Path(kit, "dev").rglob("*")):
        if f.suffix not in (".parquet", ".csv"):
            continue
        d = pd.read_parquet(f) if f.suffix == ".parquet" else pd.read_csv(f)
        cols = [c for c in ID_COLS if c in d]
        assert cols, f"{f}: no pitcher ID column ({ID_COLS})"
        n = int(sealed(d[cols[0]].dropna().astype(str).unique(), SALT).sum())
        seen += 1
        if n:
            bad[str(f)] = n
    assert seen, "no dev tables found"
    return bad


def dev_mlb(kit):
    """Regular-season pitches 2021-25 with every fable:-sealed pitcher removed, one parquet per season, plus the
    names of the kept pitchers and next-season outcomes computed from these rows only (judge.outcomes on dev)."""
    from train_mlb import mart   # the real mart: never run this with FABLE_DEV set
    import os
    assert not os.environ.get("FABLE_DEV"), "dev-mlb reads the full mart; unset FABLE_DEV"
    out = Path(kit, "dev", "mlb")
    out.mkdir(parents=True, exist_ok=True)
    con = mart.connect()
    ids = con.sql(f"SELECT DISTINCT pitcher FROM pitches_all WHERE game_type = 'R' AND season BETWEEN "
                  f"{min(MLB_SEASONS)} AND {max(MLB_SEASONS)} AND pitcher IS NOT NULL").df()["pitcher"]
    keep = pd.DataFrame({"pitcher": ids[~sealed(ids, SALT).to_numpy()].astype("int64")})
    con.register("keep", keep)
    rows = {}
    for s in MLB_SEASONS:
        f = out / f"pitches_{s}.parquet"
        con.execute(f"COPY (SELECT p.* FROM pitches_all p JOIN keep k ON p.pitcher = k.pitcher "
                    f"WHERE p.game_type = 'R' AND p.season = {s}) TO '{f.as_posix()}' (FORMAT parquet, COMPRESSION zstd)")
        rows[s] = con.sql(f"SELECT count(*) FROM read_parquet('{f.as_posix()}')").fetchone()[0]
    con.sql("SELECT DISTINCT CAST(key_mlbam AS BIGINT) AS pitcher, name_first, name_last FROM register "
            "WHERE key_mlbam IS NOT NULL").df().merge(keep).drop_duplicates("pitcher").to_parquet(out / "names.parquet")
    # outcomes from dev rows only (the xRV-on-contact fit never sees a sealed pitcher)
    env = {**os.environ, "FABLE_DEV": str(Path(kit).resolve()), "GOAT_LO": str(min(MLB_SEASONS))}
    subprocess.run([sys.executable, "-c", "import judge, pathlib, sys; judge.CACHE = pathlib.Path(sys.argv[1]); "
                    "judge.outcomes()", str((out / "outcomes.parquet").resolve())], cwd=PIPE, env=env, check=True)
    return {"pitchers_kept": len(keep), "pitchers_sealed": int(len(ids) - len(keep)), "rows": rows}


def demo():
    ids = pd.Series(range(100000, 120000))
    share = sealed(ids, SALT).mean()
    assert .18 < share < .22, share
    assert not (sealed(ids, SALT) == sealed(ids, "p7")).all()   # independent of the P7 seal
    with tempfile.TemporaryDirectory() as t:
        (Path(t) / "dev").mkdir()
        clean = ids[~sealed(ids, SALT)]
        pd.DataFrame({"mlbam": clean}).to_parquet(Path(t) / "dev/ok.parquet")
        assert check(t) == {}
        pd.DataFrame({"mlbam": ids[:50]}).to_parquet(Path(t) / "dev/leak.parquet")
        pd.DataFrame({"pid": clean[:50].astype(str), "PitcherKey": ids[:50].astype(str)}).to_parquet(Path(t) / "dev/key.parquet")
        assert list(check(t)) == [str(Path(t) / "dev/leak.parquet")]
        freeze(t)
        freeze(t)   # re-freeze over the read-only copies
        assert verify(t) == []
        f = Path(t) / "judge/judge.py"
        f.chmod(0o644)
        f.write_text(f.read_text() + "\n# edit\n")
        assert verify(t) == ["judge.py"]
    print(f"demo ok: sealed share {share:.3f}, leak caught, tamper caught")


if __name__ == "__main__":
    cmd, arg = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else None)
    if cmd == "demo":
        demo()
    elif cmd == "freeze":
        print(json.dumps(freeze(arg), indent=1))
    elif cmd == "verify":
        b = verify(arg)
        print("ok" if not b else f"CHANGED: {b}")
        sys.exit(1 if b else 0)
    elif cmd == "dev-mlb":
        print(json.dumps(dev_mlb(arg), indent=1, default=int))
    elif cmd == "check":
        b = check(arg)
        print("ok: zero sealed IDs in dev/" if not b else f"SEALED IDS FOUND: {b}")
        sys.exit(1 if b else 0)
