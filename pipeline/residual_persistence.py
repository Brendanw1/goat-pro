"""Is CSW% above/below what Stuff+ predicts a persistent skill?  python residual_persistence.py

Residual = season CSW% - OLS(CSW% ~ cross-fit grade), fitted within season (>=300 taken pitches).
Reports split-half and YoY reliability, persistence slope, habit correlates, and a
pitch-mix-adjusted re-run. Writes results/residual_persistence.json.
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from tests_small_sample import cv_r2  # noqa: E402
from train_mlb import load_features  # noqa: E402

PAIRS = [(2023, 2024), (2024, 2025), (2025, 2026)]
HABITS = ["zone", "edge", "chase", "fps", "fb_share", "n_types"]


def ols(y, X):
    X1 = np.column_stack([np.ones(len(y)), X])
    b, *_ = np.linalg.lstsq(X1, y, rcond=None)
    return b, y - X1 @ b


def habits(g):
    zin = (g.plate_x.abs() <= 0.83) & g.plate_z.between(1.5, 3.5)
    # within 2 in (1/6 ft) of the border, either side
    dx = 0.83 - g.plate_x.abs()
    dz = np.minimum(g.plate_z - 1.5, 3.5 - g.plate_z)
    d = np.where(zin, np.minimum(dx, dz), np.maximum(np.maximum(-dx, -dz), 0))
    use = {p for p, c in g.pitch_type.value_counts(normalize=True).items() if c >= 0.05}
    fp = g[(g.balls == 0) & (g.strikes == 0)]
    return pd.Series({
        "zone": zin.mean(), "edge": (d <= 1 / 6).mean(),
        "chase": g.swing[~zin].mean(),
        "fps": (fp.csw.astype(bool) | fp.swing.astype(bool)).mean() if len(fp) else np.nan,
        "fb_share": (g.pclass == "FB").mean(), "n_types": len(use)})


def build():
    df = load_features()
    gr = pd.read_csv(HERE / "results" / "crossfit_v2_grades.csv").rename(columns={"mlbam": "pitcher"})
    rows = []
    for (p, s), g in df.groupby(["pitcher", "season"]):
        t = g[g.pa_taken == 1]
        if len(t) < 300:
            continue
        gp = t.groupby("game_pk").ngroup()  # game_pk-sorted order
        r = {"pitcher": p, "season": s, "csw": t.csw.mean(),
             "h1": t.csw[gp % 2 == 0].mean(), "h2": t.csw[gp % 2 == 1].mean()}
        r.update(habits(g))
        rows.append(r)
    d = pd.DataFrame(rows).merge(gr, on=["pitcher", "season"])
    return d


def residualize(d, extra=()):
    d = d.copy()
    for s, g in d.groupby("season"):
        X = g[["grade", *extra]].to_numpy()
        b, e = ols(g.csw.to_numpy(), X)
        d.loc[g.index, "resid"] = e
        X1 = np.column_stack([np.ones(len(g)), X]) @ b
        for h in ("h1", "h2"):
            d.loc[g.index, "r_" + h] = g[h] - X1
    return d


def yoy(d, rng, boot=2000):
    out = {}
    for a, b in PAIRS:
        m = d[d.season == a].merge(d[d.season == b], on="pitcher", suffixes=("0", "1"))
        x, y = m.resid0.to_numpy(), m.resid1.to_numpy()
        n, r, slope = len(m), np.corrcoef(x, y)[0, 1], np.polyfit(x, y, 1)[0]
        rs, ss = [], []
        for _ in range(boot):
            i = rng.integers(0, n, n)
            rs.append(np.corrcoef(x[i], y[i])[0, 1]); ss.append(np.polyfit(x[i], y[i], 1)[0])
        out[f"{a}->{b}"] = {"n": n, "r": r, "r_ci95": list(np.percentile(rs, [2.5, 97.5])),
                            "slope": slope, "slope_ci95": list(np.percentile(ss, [2.5, 97.5])),
                            "sd_resid_N": x.std(), "sd_resid_N1": y.std()}
    return out


def main():
    d = residualize(build())
    rng = np.random.default_rng(13)
    res = {"n_pitcher_seasons": len(d)}
    res["expected_csw_fit"] = {int(s): {"n": len(g), "r_grade_csw": g.grade.corr(g.csw),
                                        "sd_resid": g.resid.std()} for s, g in d.groupby("season")}
    sh = {}
    for s, g in d.groupby("season"):
        r = g.r_h1.corr(g.r_h2)
        sh[int(s)] = {"r": r, "spearman_brown": 2 * r / (1 + r), "n": len(g)}
    res["split_half"] = sh
    res["yoy"] = yoy(d, rng)

    # step 4: habits
    rows = []
    for a, b in PAIRS:
        m = d[d.season == a].merge(d[d.season == b][["pitcher", "resid"]], on="pitcher",
                                   suffixes=("", "_next"))
        m[HABITS + ["resid"]] = m.groupby("season")[HABITS + ["resid"]].transform(
            lambda c: (c - c.mean()) / c.std())  # z within season (2026 zone shift)
        m["resid_next"] = m["resid_next"] / d[d.season == b].resid.std()
        rows.append(m)
    P = pd.concat(rows)
    y = P.resid_next.to_numpy()
    res["habit_corr"] = {h: {"with_resid_N": P[h].corr(P.resid), "with_resid_N1": P[h].corr(P.resid_next)}
                         for h in HABITS}
    Xr, Xh, Xa = P[["resid"]].to_numpy(), P[HABITS].to_numpy(), P[["resid"] + HABITS].to_numpy()
    b, _ = ols(y, Xa)
    # t-stats
    X1 = np.column_stack([np.ones(len(y)), Xa]); e = y - X1 @ b
    se = np.sqrt(np.diag(np.linalg.inv(X1.T @ X1)) * e.var(ddof=X1.shape[1]))
    res["habit_ols"] = {"n": len(y), "note": "z-scored within season; coef in SD of resid_N+1",
                        "coef": dict(zip(["const", "resid"] + HABITS, b)),
                        "t": dict(zip(["const", "resid"] + HABITS, b / se)),
                        "cv_r2_resid_only": cv_r2(y, Xr), "cv_r2_habits_only": cv_r2(y, Xh),
                        "cv_r2_resid_plus_habits": cv_r2(y, Xa)}
    res["habit_ols"]["cv_r2_resid_plus_each"] = {h: cv_r2(y, P[["resid", h]].to_numpy()) for h in HABITS}

    # step 5: add pitch mix to expected-CSW regression
    d2 = residualize(d, extra=("fb_share", "n_types"))
    d2["resid"] = d2["resid"]
    res["mix_adjusted_yoy"] = yoy(d2, rng)
    res["mix_adjusted_split_half"] = {int(s): g.r_h1.corr(g.r_h2) for s, g in d2.groupby("season")}
    # note: after extra residualization r_h1/r_h2 use the mix-adjusted fit
    (HERE / "results" / "residual_persistence.json").write_text(json.dumps(res, indent=1, default=float))
    print(json.dumps(res, indent=1, default=float))


if __name__ == "__main__":
    main()
