"""Probe: do teams act as if our Stuff+ is right? (program item 6, revealed preference)

    python probe_revealed_leverage.py

Thirty front offices decide reliever roles with private models. If our grade carries
information teams also see, a reliever's season-N cross-fit Stuff+ should predict the
leverage he is trusted with in N+1, beyond his N leverage and N results.
Leverage: an empirical LI (mean |win-probability swing| of a PA by start state:
inning, half, outs, bases, score diff clipped +-4; league mean = 1). gmLI = LI of his
first PA in each appearance, the standard read of manager trust. (A first try,
closeness = 1 - |2*WE - 1|, failed: closers enter with leads.) Relievers: mean
pitches per appearance < 30 and >= 15 appearances, both seasons.
Reports 5-fold CV R^2 for N+1 closeness: base (N closeness + N K% + N RV/100) vs
base + Stuff+. Writes results/probe_revealed_leverage.json.
"""

import json
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, "/Users/brendanwaterval/Projects/vt_baseball/savant_mart")
sys.path.insert(0, str(Path(__file__).resolve().parent))
import mart  # noqa: E402
from tests_small_sample import cv_r2  # noqa: E402

RESULTS = Path(__file__).resolve().parent / "results"


def main() -> None:
    # empirical leverage index: mean |win-probability swing| of a PA by its start state,
    # scaled to 1.0 league-wide; gmLI = LI of the first PA of each appearance
    ps = mart.connect().sql("""
        WITH pa AS (
          SELECT season, game_pk, at_bat_number, pitcher,
                 arg_min(LEAST(inning, 9), pitch_number) AS inn,
                 arg_min(inning_topbot, pitch_number) AS half,
                 arg_min(outs_when_up, pitch_number) AS outs,
                 arg_min((on_1b IS NOT NULL)::INT + 2 * (on_2b IS NOT NULL)::INT
                         + 4 * (on_3b IS NOT NULL)::INT, pitch_number) AS bases,
                 arg_min(GREATEST(-4, LEAST(4, bat_score - fld_score)), pitch_number) AS diff,
                 ABS(SUM(delta_home_win_exp)) AS swing,
                 SUM(CASE WHEN events IN ('strikeout','strikeout_double_play') THEN 1 ELSE 0 END) AS k,
                 SUM(CASE WHEN events IS NOT NULL THEN 1 ELSE 0 END) AS pa_end,
                 SUM(-delta_run_exp) AS rv, COUNT(*) AS pitches
          FROM pitches_all WHERE game_type = 'R' AND season >= 2023
          GROUP BY 1, 2, 3, 4),
        li AS (SELECT inn, half, outs, bases, diff, AVG(swing) AS s FROM pa GROUP BY ALL),
        pa_li AS (SELECT pa.*, li.s / (SELECT AVG(swing) FROM pa) AS li,
                         row_number() OVER (PARTITION BY season, game_pk, pitcher
                                            ORDER BY at_bat_number) AS nth
                  FROM pa JOIN li USING (inn, half, outs, bases, diff))
        SELECT season, pitcher,
               SUM(pitches) / COUNT(DISTINCT game_pk) AS pitches_per_app,
               COUNT(DISTINCT game_pk) AS apps,
               AVG(CASE WHEN nth = 1 THEN li END) AS closeness,
               100 * SUM(k) / NULLIF(SUM(pa_end), 0) AS k_pct,
               100 * SUM(rv) / SUM(pitches) AS rv100
        FROM pa_li GROUP BY 1, 2""").df()
    rel = ps[(ps["pitches_per_app"] < 30) & (ps["apps"] >= 15)]
    cf = pd.read_csv(RESULTS / "crossfit_v2_grades.csv").rename(
        columns={"mlbam": "pitcher", "grade": "stuff"})
    rel = rel.merge(cf, on=["pitcher", "season"])
    out = {}
    for a, b in ((2023, 2024), (2024, 2025), (2025, 2026)):
        A = rel[rel["season"] == a].set_index("pitcher")
        B = rel[rel["season"] == b].set_index("pitcher")[["closeness"]]
        h = A.join(B, rsuffix="_next", how="inner").dropna()
        y = h["closeness_next"].to_numpy()
        base_cols = ["closeness", "k_pct", "rv100"]
        base = cv_r2(y, h[base_cols].to_numpy())
        both = cv_r2(y, h[base_cols + ["stuff"]].to_numpy())
        r_stuff = float(h["stuff"].corr(h["closeness_next"]))
        out[f"{a}->{b}"] = {"n": len(h), "r_stuff_next_leverage": round(r_stuff, 3),
                            "cv_r2_base": round(float(base), 4),
                            "cv_r2_base_plus_stuff": round(float(both), 4),
                            "delta": round(float(both - base), 4)}
        print(f"{a}->{b}: {out[f'{a}->{b}']}")
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / "probe_revealed_leverage.json").write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
