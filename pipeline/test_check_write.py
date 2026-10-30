"""--check --write: seed, diff and apply keep the export dir equal to the checked bake.

    python pipeline/test_check_write.py   (or pytest)
"""
import json
import tempfile
from pathlib import Path

import web_export as we
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


def test_no_two_writers_one_key():
    """The career/gamelog/pa_log/visuals bug: a hitter writer overwrote the pitcher's file for the same id."""
    out = Path(tempfile.mkdtemp())
    we._WRITERS.clear()
    for s in (2024, 2025):                                   # one site rewriting a key (a latest alias): fine
        we.jwrite(out / "x" / "1.json", {"s": s})
    we.jwrite(out / "x" / "1.json", {"m": 1}, merge=True)    # a declared read-merge-write: fine
    try:
        we.jwrite_gz(out / "x" / "1.json", {"h": 1})        # a second writer, same key
    except RuntimeError as e:
        assert "collision" in str(e)
    else:
        raise AssertionError("collision not caught")
    we._WRITERS.clear()


if __name__ == "__main__":
    test_seed_diff_apply()
    test_no_two_writers_one_key()
    print("ok")
