"""Probe: is observed-minus-inferred spin axis (the seam-wake signature) a pitcher trait?

    python probe_axis.py

Hawk-Eye measures spin_axis optically (2020+); the movement-implied axis is
180 - atan2(pfx_x, pfx_z) in Statcast's convention (180 = pure backspin,
catcher view). Deviation is signed arm-relative (LHP mirrored). Reports
split-half (odd/even pitches, >=50 each) and 2024->2025 reliability.
"""

import sys

import numpy as np

from paths import MART_DIR  # noqa: E402
sys.path.insert(0, str(MART_DIR))
import mart  # noqa: E402

TYPES = ("FF", "SI", "CH", "FS", "SL", "ST", "CU", "FC")


def main() -> None:
    d = mart.connect().sql(f"""
        SELECT season, pitcher, pitch_type, p_throws, spin_axis, pfx_x, pfx_z,
          row_number() OVER (PARTITION BY season, pitcher, pitch_type
                             ORDER BY game_pk, at_bat_number, pitch_number) AS k
        FROM pitches_all WHERE game_type = 'R' AND season IN (2024, 2025)
          AND spin_axis IS NOT NULL AND pitch_type IN {TYPES}""").df()
    inferred = (180 - np.degrees(np.arctan2(d["pfx_x"], d["pfx_z"]))) % 360
    d["dev"] = (((d["spin_axis"] - inferred) + 180) % 360 - 180) * np.where(d["p_throws"] == "L", -1, 1)
    print("median deviation (deg):", d.groupby("pitch_type")["dev"].median().round(1).to_dict())
    x25 = d[d["season"] == 2025]
    for pt in TYPES:
        x = x25[x25["pitch_type"] == pt]
        g = x.groupby(["pitcher", x["k"] % 2])["dev"].agg(["mean", "size"]).unstack()
        g = g[(g["size"] >= 50).all(axis=1)]
        r = np.corrcoef(g["mean"][0], g["mean"][1])[0, 1]
        print(f"2025 {pt}: n={len(g)} split-half r={r:.3f} between-pitcher SD={g['mean'].mean(axis=1).std():.1f}")
    p = d.groupby(["season", "pitcher", "pitch_type"])["dev"].agg(["mean", "size"]).reset_index()
    w = p[p["size"] >= 100].pivot_table(index=["pitcher", "pitch_type"], columns="season",
                                        values="mean").dropna()
    print("YoY 2024->2025:", {pt: round(float(np.corrcoef(g[2024], g[2025])[0, 1]), 3)
                              for pt, g in w.groupby(level=1) if len(g) > 30})


if __name__ == "__main__":
    main()
