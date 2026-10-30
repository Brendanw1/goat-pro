"""D-18: per-game P7 cells — the composer inputs for Outing+ (descriptive).

    python p7_games.py            # -> cache/p7_games.parquet (pitcher x game) + season scales

Groups the cross-fit per-pitch grades (cache/pitch_models.parquet, from whiff_game.py)
into pitcher x game cells: the outing's mean Whiff+ and Pitching+ over graded pitches,
with the season's outing distribution as the scale. Outing+ = 100 + 10 z of the outing's
Pitching+ mean among that season's outings with >= 15 graded pitches — a measurement of
the outing, not a forecast of anything. The xRV leg of the college composer waits on
recomputing the §78 model's per-pitch run values from its probability legs (the cache
carries p_whiff/p_foul/p_bip, not xRV), so nothing xRV ships here yet.
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

PIPE = Path(__file__).resolve().parent
sys.path.insert(0, str(PIPE))
from paths import MART_DIR  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(MART_DIR))
import mart  # noqa: E402

MIN_GRADED = 15  # graded pitches before an outing gets an Outing+


def main() -> None:
    pm = pd.read_parquet(ROOT / "cache" / "pitch_models.parquet")
    keys = mart.connect().sql("""
        SELECT game_pk, at_bat_number, pitch_number, pitcher, season, game_date
        FROM pitches_all WHERE game_type = 'R' AND season >= 2020
          AND pitcher IS NOT NULL
    """).df()
    df = pm.merge(keys, on=["game_pk", "at_bat_number", "pitch_number"], how="inner")
    g = df.groupby(["pitcher", "season", "game_pk"], as_index=False).agg(
        game_date=("game_date", "first"), n_graded=("pitching_plus", "count"),
        whiff_mean=("whiff_plus", "mean"), pitching_mean=("pitching_plus", "mean"))
    g["outPlus"] = np.nan
    for s, sub in g.groupby("season"):
        pool = sub[sub["n_graded"] >= MIN_GRADED]["pitching_mean"]
        mu, sd = float(pool.mean()), float(pool.std())
        if sd and np.isfinite(sd):
            m = (g["season"] == s) & (g["n_graded"] >= MIN_GRADED)
            g.loc[m, "outPlus"] = (100 + 10 * (g.loc[m, "pitching_mean"] - mu) / sd).round(1)
    g["whiff_mean"] = g["whiff_mean"].round(1)
    g["pitching_mean"] = g["pitching_mean"].round(1)
    g = g.rename(columns={"pitcher": "mlbam", "n_graded": "nPitched"})
    g.to_parquet(ROOT / "cache" / "p7_games.parquet", index=False)
    rated = g["outPlus"].notna().sum()
    print(f"p7_games.parquet: {len(g):,} pitcher-game cells, {rated:,} with Outing+ (>= {MIN_GRADED} graded pitches)")


if __name__ == "__main__":
    main()
