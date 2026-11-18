"""Fable kit, step 3.1 (BaseballGOAT docs/fable-research-setup.md sections 2 and 6): the fable: seal, the frozen
judge and the dev seal check. The kit lives outside every repo (it will hold private college data); this file only
builds and checks it.

    python fable_kit.py freeze KIT_DIR   # judge.py at git HEAD -> KIT_DIR/judge/ + SHA256SUMS + KIT.json
    python fable_kit.py verify KIT_DIR   # every frozen file still matches SHA256SUMS
    python fable_kit.py check KIT_DIR    # zero fable:-sealed pitcher IDs in any parquet/csv under KIT_DIR/dev
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
FROZEN = ("pipeline/judge.py",)   # change_test.py + crossfit_v2.py join in 3.2, once they read dev/ instead of the mart
ID_COLS = ("mlbam", "pitcher", "pid", "PitcherKey")


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
        dst.write_bytes(body)
        dst.chmod(0o444)
        sums[dst.name] = hashlib.sha256(body).hexdigest()
    (kit / "judge" / "SHA256SUMS").write_text("".join(f"{h}  {n}\n" for n, h in sums.items()))
    (kit / "KIT.json").write_text(json.dumps({"step": "3.1", "goat_pro_commit": head, "frozen": date.today().isoformat(),
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
        n = sum(int(sealed(d[c].dropna().astype(str).unique(), SALT).sum()) for c in cols)
        seen += 1
        if n:
            bad[str(f)] = n
    assert seen, "no dev tables found"
    return bad


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
        assert list(check(t)) == [str(Path(t) / "dev/leak.parquet")]
        freeze(t)
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
    elif cmd == "check":
        b = check(arg)
        print("ok: zero sealed IDs in dev/" if not b else f"SEALED IDS FOUND: {b}")
        sys.exit(1 if b else 0)
