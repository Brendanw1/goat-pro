"""§84 (RESULTS-MLB.md): does Pitching+ under-credit hard four-seamers? Sealed pitchers only.
Pre-registered before any read; run ONCE.

    GOAT_LO=2020 nice -n 10 python pipeline/fb_velo_residual.py          # the read
    python pipeline/fb_velo_residual.py --demo                           # self-check, synthetic data

Reuses §83's loader and helpers (fb_steep_interaction.py); bootstrap reseeded to 84.
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

import fb_steep_interaction as f83

PIPE = Path(__file__).resolve().parent
f83.RNG = np.random.default_rng(84)


def ols_boot(X, r, codes, W):
    """OLS coefficients plus pitcher-cluster bootstrap replicates (per-pitcher X'X aggregation)."""
    k, n = X.shape[1], W.shape[1]
    XX, Xy = np.zeros((n, k, k)), np.zeros((n, k))
    np.add.at(XX, codes, X[:, :, None] * X[:, None, :])
    np.add.at(Xy, codes, X * r[:, None])
    b = np.linalg.solve(XX.sum(0), Xy.sum(0))
    return b, np.array([np.linalg.solve(np.tensordot(w, XX, 1), w @ Xy) for w in W])


def test(d: pd.DataFrame) -> dict:
    """d: one pitch type's rows with r, velo, vz, sz, vb, season. Slope of r on vz; ≥ 97 mph mean r."""
    r = d["r"].to_numpy(float)
    codes, pitchers = pd.factorize(d["pitcher"])
    W = f83.boot_weights(pitchers)
    b, bb = ols_boot(np.column_stack([np.ones(len(d)), d["vz"]]), r, codes, W)
    bc, bbc = ols_boot(np.column_stack([np.ones(len(d)), d["vz"], d["sz"]]), r, codes, W)
    hard = (d["velo"] >= 97).to_numpy()
    c2, c2ci, c2n = f83.corner_boot(d, r, hard, codes, W)
    slope_ci = f83.ci(bb[:, 1])
    c1_ok, c2_ok = slope_ci[0] > 0, c2 >= 0.005 and c2ci[0] > 0
    per100 = lambda v: round(100 * float(v), 3)  # noqa: E731
    by_season = {}
    for s in sorted(d["season"].unique()):
        m = hard & (d["season"] == s).to_numpy()
        by_season[int(s)] = {"n": int(m.sum()), "r_per100": per100(r[m].mean()) if m.any() else None}
    return {"n_pitches": len(d), "n_pitchers": len(pitchers),
            "C1_slope_per100_per_sd": per100(b[1]), "C1_ci": [per100(x) for x in slope_ci], "C1": bool(c1_ok),
            "slope_mde_80pct_per100": per100(2.8 * bb[:, 1].std()),
            "slope_steep_controlled_per100": per100(bc[1]), "slope_steep_controlled_ci": [per100(x) for x in f83.ci(bbc[:, 1])],
            "C2_ge97_per100": per100(c2), "C2_ci": [per100(x) for x in c2ci], "C2_n": c2n, "C2": bool(c2_ok),
            "ge97_by_season": by_season,
            "grid_velo": f83.grid(d.assign(one=0), "r", None, 1000, "vb", "one"),
            "verdict": "CONFIRMED" if c1_ok and c2_ok else ("real but immaterial" if c1_ok else "NOT CONFIRMED")}


def residual(d: pd.DataFrame) -> pd.DataFrame:
    """§83 T2 residual, count mean over all pitch types of these rows; pitcher-positive."""
    d = d.dropna(subset=["y", "v", "velo", "steep"])
    u = d["y"] - d["v"]
    return d.assign(r=-(u - u.groupby([d["balls"], d["strikes"]]).transform("mean")))


def run(d: pd.DataFrame) -> dict:
    import location_plus as lp
    sealed = d["pitcher"].map(lp.sealed)
    out = {"seasons": list(f83.SEASONS)}
    for name, part in (("sealed", d[sealed]), ("dev_reference", d[~sealed])):
        rd = residual(part)
        out[name] = {pt: test(f83.zcols(rd[rd["pitch_type"] == pt])) for pt in ("FF", "SI")}
    out["verdict"] = out["sealed"]["FF"]["verdict"]
    return out


def demo() -> None:
    """Planted velocity residual must be found and called material; none planted must not be."""
    n, rng = 200000, np.random.default_rng(1)
    d = pd.DataFrame({"pitcher": rng.integers(0, 800, n), "season": rng.choice([2024, 2025], n),
                      "velo": rng.normal(95, 2, n), "steep": rng.normal(0, 1, n)})
    for planted, want in ((0.004, "CONFIRMED"), (0.0, "NOT CONFIRMED")):
        r = planted * (d["velo"] - 95) + rng.normal(0, 0.05, n)
        out = test(f83.zcols(d.assign(r=r)))
        assert out["verdict"] == want, (planted, out["C1_ci"], out["C2_ge97_per100"], out["C2_ci"])
    print("demo ok")


if __name__ == "__main__":
    if "--demo" in sys.argv:
        demo()
        sys.exit()
    path = PIPE / "results" / "fb_velo_residual_84.json"
    assert not path.exists(), f"{path} exists: §84 is read once"
    out = run(f83.load())
    path.write_text(json.dumps(out, indent=1))
    for name in ("sealed", "dev_reference"):
        for pt in ("FF", "SI"):
            print(name, pt, {k: v for k, v in out[name][pt].items() if not k.startswith("grid")})
    print("VERDICT (sealed FF):", out["verdict"])
