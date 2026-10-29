"""Per-game Whiff+ sums, so the bake can grade any slice of a season (a club stint, a game) on the
season grade's own scale.

    GOAT_LO=2020 nice -n 10 python pipeline/whiff_game.py      # -> cache/whiff_game.parquet
    python pipeline/whiff_game.py --demo                       # self-check, synthetic data

Also writes cache/pitch_models.parquet: per-pitch Whiff+ and Pitching+ on their season scales (explorer).

Season Whiff+ = grade(z), z = the pitch-weighted mean over classes of each class's mean per-pitch
z = (pred - m[class, hand]) / s[class, hand] (train_mlb.season_grades), i.e. the plain mean of
per-pitch z. The refs m, s are not stored, so they are recovered from the shipped grades: z is
linear in a = 1/s and b = m/s per cell, and least squares over every unclipped pitcher-season
solves them exactly. The fit must reproduce the shipped grades (max error < 0.05) or nothing is
written. A slice's Whiff+ = grade(sum z / n) over its pitches.
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

PIPE = Path(__file__).resolve().parent
CACHE = PIPE.parent / "cache"
GRADES = PIPE / "results" / "crossfit_v2_s4_bb_grades.csv"


def fit_refs(cells: pd.DataFrame, grades: pd.DataFrame) -> dict:
    """cells: pitcher, season, cell, n, psum (sum of pred). grades: mlbam, season, grade.
    Returns {cell: (a, b)} with per-pitch z = a * pred - b."""
    keys = sorted(cells["cell"].unique())
    tot = cells.groupby(["pitcher", "season"])["n"].transform("sum")
    w = cells.assign(xa=cells["psum"] / tot, xb=-cells["n"] / tot)
    X = (w.pivot_table(index=["pitcher", "season"], columns="cell", values=["xa", "xb"], aggfunc="sum")
         .fillna(0.0))
    g = grades.rename(columns={"mlbam": "pitcher"}).set_index(["pitcher", "season"])["grade"]
    g = g[(g > 50.01) & (g < 174.99)]  # clipped grades carry no z
    X = X.loc[X.index.intersection(g.index)]
    z = (g.loc[X.index] - 100) / 10
    coef, *_ = np.linalg.lstsq(X.to_numpy(), z.to_numpy(), rcond=None)
    cols = list(X.columns)
    return {k: (coef[cols.index(("xa", k))], coef[cols.index(("xb", k))]) for k in keys}


def check(cells: pd.DataFrame, grades: pd.DataFrame, refs: dict) -> float:
    c = cells.assign(zsum=[refs[k][0] * p - refs[k][1] * n for k, p, n in zip(cells["cell"], cells["psum"], cells["n"])])
    s = c.groupby(["pitcher", "season"])[["zsum", "n"]].sum()
    mine = np.clip(100 + 10 * s["zsum"] / s["n"], 50, 175)
    g = grades.rename(columns={"mlbam": "pitcher"}).set_index(["pitcher", "season"])["grade"]
    both = pd.concat([mine.rename("mine"), g], axis=1, join="inner")
    return float((both["mine"] - both["grade"]).abs().max())


def main() -> None:
    import stuff_v2
    from physics import add_physics
    from train_mlb import load_features
    df = stuff_v2.prepare(add_physics(load_features()))
    pred = pd.read_parquet(CACHE / "pred_s4_bb.parquet", columns=["pitcher", "season", "pitch_type", "stand", "pred"])
    assert len(pred) == len(df), (len(pred), len(df))
    for c in ("pitcher", "season", "pitch_type", "stand"):
        assert (pred[c].to_numpy() == df[c].to_numpy()).all(), f"pred rows differ on {c}"
    d = pd.DataFrame({"pitcher": df["pitcher"].to_numpy(), "season": df["season"].to_numpy(),
                      "game_pk": df["game_pk"].to_numpy(), "cell": (df["pclass"] + "_" + df["stand"]).to_numpy(),
                      "pred": pred["pred"].to_numpy()}).dropna(subset=["pred"])
    cells = d.groupby(["pitcher", "season", "cell"]).agg(n=("pred", "size"), psum=("pred", "sum")).reset_index()
    grades = pd.read_csv(GRADES)
    refs = fit_refs(cells, grades)
    err = check(cells, grades, refs)
    print(f"refs recovered for {len(refs)} cells; max |grade error| vs shipped Whiff+ = {err:.4f}")
    assert err < 0.05, "recovered refs do not reproduce the shipped grades"
    a = d["cell"].map({k: v[0] for k, v in refs.items()})
    b = d["cell"].map({k: v[1] for k, v in refs.items()})
    out = (d.assign(z=a * d["pred"] - b).groupby(["pitcher", "season", "game_pk"])
           .agg(n=("z", "size"), zsum=("z", "sum")).reset_index())
    out.to_parquet(CACHE / "whiff_game.parquet", index=False)
    print(f"cache/whiff_game.parquet: {len(out):,} pitcher-games")

    # Per-pitch model grades for the pitch explorer, both on their season grade's own scale, so any
    # slice's grade is the plain mean: Whiff+ = 100 + 10 z (before the 50-175 clip) and Pitching+ =
    # a + b v, the exact linear map of location_plus.grades (fit on the shipped grades, checked).
    pg = pd.read_csv(PIPE / "results" / "pitching_plus_raw_grades.csv")
    b_, a_ = np.polyfit(pg["v"], pg["grade"], 1)
    assert (pg["grade"] - (a_ + b_ * pg["v"])).abs().max() < 1e-6, "Pitching+ is not linear in mean v"
    v = pd.read_parquet(CACHE / "pitchval_raw.parquet")["v"].to_numpy()
    assert len(v) == len(df)
    z = np.full(len(df), np.nan)
    has = pred["pred"].notna().to_numpy()
    cell = (df["pclass"] + "_" + df["stand"]).to_numpy()
    z[has] = (pd.Series(cell[has]).map({k: r[0] for k, r in refs.items()}).to_numpy() * pred["pred"].to_numpy()[has]
              - pd.Series(cell[has]).map({k: r[1] for k, r in refs.items()}).to_numpy())
    pm = pd.DataFrame({"game_pk": df["game_pk"].to_numpy(), "at_bat_number": df["at_bat_number"].to_numpy(),
                       "pitch_number": df["pitch_number"].to_numpy(),
                       "whiff_plus": (100 + 10 * z).astype("float32"), "pitching_plus": (a_ + b_ * v).astype("float32")})
    pm.to_parquet(CACHE / "pitch_models.parquet", index=False)
    print(f"cache/pitch_models.parquet: {len(pm):,} pitches (Pitching+ = {a_:.3f} + {b_:.2f} v)")


def demo() -> None:
    """Plant refs, build grades from them, recover them."""
    rng = np.random.default_rng(0)
    true = {"FB_R": (8.0, 2.0), "FB_L": (7.0, 1.5), "BR_R": (5.0, 1.2), "BR_L": (6.0, 1.9)}
    rows = []
    for p in range(400):
        for k in true:
            n = int(rng.integers(20, 300))
            rows.append({"pitcher": p, "season": 2025, "cell": k, "n": n, "psum": n * rng.normal(0.25, 0.04)})
    cells = pd.DataFrame(rows)
    zs = cells.assign(z=[true[k][0] * ps - true[k][1] * n for k, ps, n in zip(cells["cell"], cells["psum"], cells["n"])])
    s = zs.groupby(["pitcher", "season"])[["z", "n"]].sum()
    grades = pd.DataFrame({"mlbam": s.index.get_level_values(0), "season": 2025,
                           "grade": np.clip(100 + 10 * s["z"].to_numpy() / s["n"].to_numpy(), 50, 175)})
    refs = fit_refs(cells, grades)
    assert check(cells, grades, refs) < 1e-6
    print("demo ok")


if __name__ == "__main__":
    demo() if "--demo" in sys.argv else main()
