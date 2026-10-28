"""--check --write: seed, diff and apply keep the export dir equal to the checked bake.

    python pipeline/test_check_write.py   (or pytest)
"""
import json
import tempfile
from pathlib import Path

from web_export import apply_dir, diff_dirs, seed_dir


def test_seed_diff_apply():
    root = Path(tempfile.mkdtemp())
    real, a = root / "real", root / "a"
    for rel, body in {"keep.json": "1", "old.json": "x", "aaa/x.json": "aaa", "BAKE_LOCK": "1"}.items():
        (real / rel).parent.mkdir(parents=True, exist_ok=True)
        (real / rel).write_text(body)
    (real / "meta.json").write_text(json.dumps({"exportedAt": "t0", "v": 1}))
    seed_dir(real, a, ("aaa",))
    assert not (a / "aaa").exists() and not (a / "BAKE_LOCK").exists() and (a / "keep.json").read_text() == "1"
    # the "bake": one new, one changed, one dropped, a new timestamp
    (a / "new.json").write_text("n"); (a / "keep.json").write_text("2"); (a / "old.json").unlink()
    (a / "meta.json").write_text(json.dumps({"exportedAt": "t1", "v": 1}))
    assert diff_dirs(a, real, ("aaa",)) == [Path("keep.json"), Path("new.json"), Path("old.json")]
    assert apply_dir(a, real, ("aaa",)) == 3
    assert diff_dirs(a, real, ("aaa",)) == []
    assert (real / "aaa/x.json").read_text() == "aaa"            # untouched
    assert json.loads((real / "meta.json").read_text())["exportedAt"] == "t1"


if __name__ == "__main__":
    test_seed_diff_apply()
    print("ok")
