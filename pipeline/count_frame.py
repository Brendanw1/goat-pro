"""Pitch-level frame for the restart studies (count minimax, predictability, count-state policy).

    GOAT_LO=2020 python pipeline/count_frame.py OUT.parquet

Rebuilds the Pitching+ frame exactly as pitching_plus.main() does (so the cached pitchval_raw aligns row for row),
then keeps only the columns the studies need. Reads cache/, never writes it.
"""
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import location_plus as lp  # noqa: E402
import pitching_plus as pp  # noqa: E402
import stuff_v2  # noqa: E402
from physics import add_physics  # noqa: E402
from train_mlb import load_features  # noqa: E402


def main(out: str) -> None:
    df = stuff_v2.prepare(add_physics(load_features()))
    df["ptype"] = df["pitch_type"].map(lp.TYPE_CODE)
    df = lp.target(df)
    df, _ = pp.add_batter(df)
    v = pd.read_parquet(lp.CACHE / "pitchval_raw.parquet")["v"]
    assert len(v) == len(df), (len(v), len(df))
    df["b"] = v.to_numpy()
    print("columns:", list(df.columns))
    keep = [c for c in ("season", "game_pk", "at_bat_number", "pitch_number", "mlbam", "pitcher", "batter", "stand",
                        "p_throws", "balls", "strikes", "pitch_type", "ptype", "y", "b", "rv", "swing", "csw",
                        "whiff", "plate_x", "plate_z", "velo", "ivb", "hb", "outs_when_up", "inning", "pa_end") if c in df]
    df[keep].to_parquet(out)
    print(len(df), "rows ->", out, "| kept", keep)


if __name__ == "__main__":
    main(sys.argv[1])
