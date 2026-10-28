"""AAA vs MLB Hawk-Eye comparability audit (AGENTS.md rule 6), paired within pitcher.

    python aaa_audit.py

Pitchers who threw the same pitch type at both levels in the same regular
season (>= 30 pitches at each). For each (pitcher, season, pitch type) the
level difference MLB - AAA of each measurement; reported as the mean over
pitchers with a 95% CI. A tracking offset shows as a consistent shift in shape
(ivb/hb/ext/release) at matched velo and spin; a real pitcher change (adrenaline,
fatigue, mechanics) moves velo and spin too, so read shape against velo.
Yardstick: the 2023 MLB system change moved FF ivb -0.45 in and ext +0.12 ft.

Writes results/aaa_audit.json.
"""

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, "/Users/brendanwaterval/Projects/vt_baseball/savant_mart")
import mart  # noqa: E402

RESULTS = Path(__file__).resolve().parent / "results"
MIN_PITCHES = 30
METRICS = ["velo", "spin", "ivb", "hb_arm", "ext", "rel_h", "rel_s_arm", "sz_top", "sz_bot"]

COLS = """
    CAST(game_year AS INT) AS season, pitcher, pitch_type,
    release_speed AS velo, release_spin_rate AS spin, pfx_z * 12 AS ivb,
    pfx_x * 12 * CASE WHEN p_throws = 'R' THEN -1 ELSE 1 END AS hb_arm,
    release_extension AS ext, release_pos_z AS rel_h,
    release_pos_x * CASE WHEN p_throws = 'R' THEN -1 ELSE 1 END AS rel_s_arm,
    sz_top, sz_bot
"""
WHERE = "game_type = 'R' AND CAST(game_year AS INT) >= 2023 AND pitch_type IN ('FF','SI','FC','SL','ST','CU','KC','CH','FS')"


# PCL parks at 2,000+ ft: thin air cuts movement, a physics confound, not tracking
HIGH_ALT = ("ABQ", "RNO", "SL", "ELP", "LV")


def per_cell(con, view: str, extra: str = "") -> pd.DataFrame:
    return con.sql(f"SELECT season, pitcher, pitch_type, COUNT(*) AS n, "
                   + ", ".join(f"AVG({m}) AS {m}" for m in METRICS)
                   + f" FROM (SELECT {COLS} FROM {view} WHERE {WHERE} {extra}) "
                   "GROUP BY 1, 2, 3").df()


def main() -> None:
    con = mart.connect()
    mlb_view = "pitches_all" if "pitches_all" in con.sql("SHOW TABLES").df()["name"].values else "pitches"
    mlb = per_cell(con, mlb_view)
    low = f"AND home_team NOT IN {HIGH_ALT}"
    results = {}
    for label, aaa in (("all_parks", per_cell(con, "pitches_aaa")),
                       ("low_altitude", per_cell(con, "pitches_aaa", low))):
        print(f"\n=== MLB - AAA, AAA {label} ===")
        results[label] = compare(mlb, aaa)
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / "aaa_audit.json").write_text(json.dumps(results, indent=1))
    print("-> results/aaa_audit.json")


def compare(mlb: pd.DataFrame, aaa: pd.DataFrame) -> dict:
    j = mlb.merge(aaa, on=["season", "pitcher", "pitch_type"], suffixes=("_mlb", "_aaa"))
    j = j[(j["n_mlb"] >= MIN_PITCHES) & (j["n_aaa"] >= MIN_PITCHES)]
    out = {}
    for (season, pt), g in j.groupby(["season", "pitch_type"]):
        if len(g) < 20:
            continue
        cell = {"n_pitchers": len(g)}
        for m in METRICS:
            d = (g[f"{m}_mlb"] - g[f"{m}_aaa"]).dropna()
            se = d.std() / np.sqrt(len(d))
            cell[m] = {"mean": round(float(d.mean()), 3), "ci95": round(float(1.96 * se), 3)}
        out[f"{season} {pt}"] = cell
    show = ["velo", "spin", "ivb", "hb_arm", "ext", "rel_h", "sz_top"]
    print(f"{'cell':10} {'n':>4} " + " ".join(f"{m:>14}" for m in show))
    for k, c in out.items():
        print(f"{k:10} {c['n_pitchers']:>4} " + " ".join(
            f"{c[m]['mean']:>+7.2f}±{c[m]['ci95']:<5.2f}" for m in show))
    return out


if __name__ == "__main__":
    main()
