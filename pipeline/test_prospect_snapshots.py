"""§99 leakage test: features at an as-of date must not move when every later row is dropped or scrambled.

    python pipeline/test_prospect_snapshots.py
"""
import numpy as np
import pandas as pd

import prospect_snapshots as ps

TARGET_COLS = {"debut_season", "t_debut", "exit_season", "event", "ctrl_pa", "ctrl_bf", "ctrl_war"}


def scramble_future(T, as_of, seed=0):
    rng = np.random.default_rng(seed)
    out = {}
    for k, v in T.items():
        v = v.copy()
        if "avail" in v:
            fut = v.avail > as_of
            for c in v.select_dtypes("number").columns:
                if c not in ("season", "year", "id", "mlbam_id", "team_id"):
                    v.loc[fut, c] = rng.permutation(v.loc[fut, c].values) * 3 + 7
        out[k] = v
    return out


def check(T, as_of):
    full = ps.features_asof(T, as_of)
    cut = ps.features_asof(ps.truncate(T, as_of), as_of)
    scr = ps.features_asof(scramble_future(T, as_of), as_of)
    for other, name in ((cut, "truncated"), (scr, "scrambled")):
        pd.testing.assert_frame_equal(full.reset_index(drop=True), other.reset_index(drop=True),
                                      check_dtype=False, obj=f"{as_of.date()} {name}")
    assert not TARGET_COLS & set(full.columns), "a target leaked into the features"
    return len(full)


if __name__ == "__main__":
    T = ps.load_tables()
    for d in ("2013-02-15", "2019-10-01", "2022-02-15", "2024-02-15"):
        print(d, check(T, pd.Timestamp(d)), "rows identical after drop + scramble of later rows")
    print("PASS")
