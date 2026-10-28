"""Can Stuff+ judge AAA pitchers before MLB does? AAA grade vs AAA results -> next-season MLB.

    python aaa_translation.py

AAA pitches (mart view pitches_aaa) are graded by the shipping v2 Stuff+: the export's
cross-fitted fold models (pipeline/models/*_fold{k}.txt), each pitcher scored by the fold
that never saw him in MLB training. RESULTS-MLB §14 adjustments: AAA extension +0.10 ft and
release height -0.06 ft onto the MLB scale; the five high-altitude parks are dropped. AAA
2026 is excluded (the 2026 plate convention is audited for MLB only, and hvaa reads plate_z).

AAA rows enter the feature frame with season codes 3023-3025, so the per-pitcher-season
fastball anchors keep the levels apart and the 2023-24 training mask (hvaa line, count
baseline, frozen scale) never sees them. The shared loader is not modified: its SQL is
swapped for a MLB + AAA union and _load_features() is called uncached.

Question: for pitchers with >= 300 AAA taken pitches in season S, which predicts their
MLB CSW% and K% in S+1 (>= 100 taken pitches): AAA Stuff+, AAA results, or both?
Subset "prospects": no MLB pitches in S. Writes results/aaa_translation.json.
"""

import json
import re
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import stuff_v2  # noqa: E402
import train_mlb as tm  # noqa: E402
from physics import add_physics  # noqa: E402
from tests_small_sample import cv_r2  # noqa: E402

RESULTS = Path(__file__).resolve().parent / "results"
MODELS = Path(__file__).resolve().parent / "models"
HIGH_ALT = "('ABQ','RNO','SL','ELP','LV')"
AAA_OFFSET = 1000


def union_sql(hi: int = 2025) -> str:
    mlb = re.sub(r"--[^\n]*", "", tm.FEATURE_SQL.split("ORDER BY")[0])
    aaa = (mlb.replace("SELECT season,", f"SELECT season + {AAA_OFFSET} AS season,", 1)
              .replace("release_extension AS ext", "release_extension + 0.10 AS ext", 1)
              .replace("release_pos_z AS rel_h", "release_pos_z - 0.06 AS rel_h", 1)
              .replace("FROM pitches_all", "FROM pitches_aaa", 1)
              .replace("season BETWEEN {lo} AND {hi}",
                       f"season BETWEEN 2023 AND {hi} AND home_team NOT IN {HIGH_ALT}", 1))
    return f"{mlb}\nUNION ALL BY NAME\n{aaa}"


CACHE = Path(__file__).resolve().parent / "cache"


def grade_aaa():
    """Expensive half: AAA grades + per pitcher-season outcomes -> cache parquet."""
    import lightgbm as lgb
    tm.FEATURE_SQL = union_sql()
    df = stuff_v2.prepare(add_physics(tm._load_features()))
    aaa_seasons = [s + AAA_OFFSET for s in (2023, 2024, 2025)]
    print("rows by season:", df.groupby("season").size().to_dict(), flush=True)

    import zlib
    fold = df["pitcher"].map(lambda p: zlib.crc32(str(p).encode()) % 4)
    bst = {}
    for pc in ("FB", "BB", "CH"):
        for h in ("RHH", "LHH"):
            key = f"{pc}_vs_{h}"
            models = [lgb.Booster(model_file=str(MODELS / f"stuff_csw_norm_{key}_fold{k}.txt"))
                      for k in range(4)]
            bst[key] = tm.FoldBooster(models, fold)
    refs = tm.frozen_scale(df, bst, stuff_v2.FEATURES, "csw_norm")
    rows, _ = stuff_v2.grade_seasons(df, bst, refs, seasons=aaa_seasons)
    g = pd.DataFrame([{"pitcher": r["mlbam"], "S": r["season"] - AAA_OFFSET, "aaa_stuff": r["grade"]}
                      for r in rows])

    taken = df[df["pa_taken"] == 1]
    per = taken.groupby(["pitcher", "season"]).agg(n=("csw", "size"), csw=("csw", "mean"),
                                                   k=("is_k", "mean")).reset_index()
    per[["csw", "k"]] *= 100
    CACHE.mkdir(exist_ok=True)
    g.to_parquet(CACHE / "aaa_grades.parquet")
    per.to_parquet(CACHE / "aaa_outcomes.parquet")


def main() -> None:
    if not (CACHE / "aaa_grades.parquet").exists():
        grade_aaa()
    g = pd.read_parquet(CACHE / "aaa_grades.parquet")
    per = pd.read_parquet(CACHE / "aaa_outcomes.parquet")
    aaa = per[per["season"] >= 3000].assign(S=lambda x: x["season"] - AAA_OFFSET)
    mlb = per[per["season"] < 3000]  # AAA codes are 3023-3025
    t = (g.merge(aaa[aaa["n"] >= 300][["pitcher", "S", "csw", "k"]], on=["pitcher", "S"])
          .rename(columns={"csw": "aaa_csw", "k": "aaa_k"}))
    nxt = mlb[mlb["n"] >= 100].assign(S=lambda x: x["season"] - 1)[["pitcher", "S", "csw", "k"]]
    t = t.merge(nxt.rename(columns={"csw": "mlb_csw_next", "k": "mlb_k_next"}), on=["pitcher", "S"])
    in_mlb_S = set(map(tuple, mlb[["pitcher", "season"]].to_numpy()))
    t["prospect"] = [(p, s) not in in_mlb_S for p, s in zip(t["pitcher"], t["S"])]

    out = {}
    for subset, d in (("all", t), ("prospects", t[t["prospect"]])):
        for tgt, naive_col in (("mlb_csw_next", "aaa_csw"), ("mlb_k_next", "aaa_k")):
            y = d[tgt].to_numpy()
            cell = {"n": len(d),
                    "r_aaa_stuff": round(float(np.corrcoef(d["aaa_stuff"], y)[0, 1]), 3),
                    "r_aaa_result": round(float(np.corrcoef(d[naive_col], y)[0, 1]), 3),
                    "cv_r2_result": round(float(cv_r2(y, d[[naive_col]].to_numpy())), 4),
                    "cv_r2_stuff": round(float(cv_r2(y, d[["aaa_stuff"]].to_numpy())), 4),
                    "cv_r2_both": round(float(cv_r2(y, d[[naive_col, "aaa_stuff"]].to_numpy())), 4)}
            out[f"{subset} {tgt}"] = cell
            print(f"{subset:9} {tgt}: {cell}", flush=True)
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / "aaa_translation.json").write_text(json.dumps(out, indent=1))
    t.to_csv(RESULTS / "aaa_translation_rows.csv", index=False)


if __name__ == "__main__":
    main()
