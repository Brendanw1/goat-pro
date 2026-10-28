"""§83 (RESULTS-MLB.md): do Whiff+, Pitching+ and Prevention+ under-credit hard four-seamers with
steep approach angles? Pre-registered (and amended) before any read; run ONCE.

    GOAT_LO=2020 nice -n 10 python pipeline/fb_steep_interaction.py          # the read
    python pipeline/fb_steep_interaction.py --demo                           # self-check, synthetic data

velo = the model's `velo` (mph); steep = -hvaa (VAA residualized on plate height). Both z-scored
within season among the pitch type. Cluster bootstraps resample pitchers (1,000 reps, seed 83).

Implementation choices the pre-registration leaves open (fixed here, before the read):
- T1's logistic bootstrap is the one-step estimator: each replicate takes one Newton step from the
  full-sample fit using pitcher-weighted sums of per-pitcher score and Hessian (exact for OLS,
  first-order for the logit; 4 parameters, ~1M swings).
- T2's residual is -(y - v) minus its count mean over all pitch types in the same rows: v = f - E[y|count],
  so y - v = (y - f) + E[y|count], and the count mean recovers E[y|count] when f is calibrated by count.
  Negated: y is delta_run_exp (batter-positive), the claim is stated pitcher-positive.
- T3's next-season RV/100 sign is checked against same-season K-BB (must correlate positively).
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

PIPE = Path(__file__).resolve().parent
CACHE = PIPE.parent / "cache"
SEASONS = (2021, 2022, 2023, 2024, 2025)
ORIG = (2023, 2024, 2025)
B, RNG = 1000, np.random.default_rng(83)
VELO_BINS = [-np.inf, *range(92, 101), np.inf]  # <92 (= "≤ 91"), 92 ... 99, ≥ 100


def zcols(d: pd.DataFrame) -> pd.DataFrame:
    g = d.groupby("season")
    return d.assign(vz=(d["velo"] - g["velo"].transform("mean")) / g["velo"].transform("std"),
                    sz=(d["steep"] - g["steep"].transform("mean")) / g["steep"].transform("std"),
                    sq=g["steep"].transform(lambda s: pd.qcut(s, 5, labels=False)),
                    vt=g["velo"].transform(lambda s: pd.qcut(s, 3, labels=False)),
                    st=g["steep"].transform(lambda s: pd.qcut(s, 3, labels=False)),
                    vb=pd.cut(d["velo"], VELO_BINS, right=False, labels=False))


def boot_weights(pitchers: np.ndarray) -> np.ndarray:
    """(B, n_pitchers) multinomial counts: how often each pitcher is drawn in each replicate."""
    n = len(pitchers)
    return np.stack([np.bincount(RNG.integers(0, n, n), minlength=n) for _ in range(B)])


def ci(x) -> list:
    return [round(float(np.percentile(x, 2.5)), 5), round(float(np.percentile(x, 97.5)), 5)]


def X_of(d: pd.DataFrame) -> np.ndarray:
    return np.column_stack([np.ones(len(d)), d["vz"], d["sz"], d["vz"] * d["sz"]])


def logit_offset(X, y, off, iters=25):
    b = np.zeros(X.shape[1])
    for _ in range(iters):
        p = 1 / (1 + np.exp(-(off + X @ b)))
        step = np.linalg.solve((X * (p * (1 - p))[:, None]).T @ X, X.T @ (y - p))
        b += step
        if np.abs(step).max() < 1e-10:
            break
    return b


def corner_boot(d, val, mask, codes, W):
    """Mean of `val` over `mask`, plus its pitcher-cluster bootstrap CI."""
    s = np.bincount(codes[mask], weights=val[mask], minlength=W.shape[1])
    n = np.bincount(codes[mask], minlength=W.shape[1]).astype(float)
    return float(s.sum() / max(n.sum(), 1)), ci((W @ s) / np.maximum(W @ n, 1)), int(n.sum())


def t1(d: pd.DataFrame) -> dict:
    """Whiff+: whiff ~ offset(logit pred) + vz + sz + vz*sz, on FF swings."""
    X, y = X_of(d), d["whiff"].to_numpy(float)
    p0 = d["pred"].clip(1e-6, 1 - 1e-6).to_numpy()
    off = np.log(p0 / (1 - p0))
    b = logit_offset(X, y, off)
    p = 1 / (1 + np.exp(-(off + X @ b)))
    codes, pitchers = pd.factorize(d["pitcher"])
    k = X.shape[1]
    G = np.zeros((len(pitchers), k))
    H = np.zeros((len(pitchers), k, k))
    np.add.at(G, codes, X * (y - p)[:, None])
    np.add.at(H, codes, X[:, :, None] * X[:, None, :] * (p * (1 - p))[:, None, None])
    W = boot_weights(pitchers)
    bb = np.array([b + np.linalg.solve(np.tensordot(w, H, 1), w @ G) for w in W])
    gap = (d["whiff"] - d["pred"]).to_numpy(float)
    hard_steep = ((d["velo"] >= 97) & (d["sq"] == 4)).to_numpy()
    soft_flat = ((d["velo"] <= 93) & (d["sq"] == 0)).to_numpy()
    c2, c2ci, c2n = corner_boot(d, gap, hard_steep, codes, W)
    sf, sfci, sfn = corner_boot(d, gap, soft_flat, codes, W)
    inter_ci = ci(bb[:, 3])
    c1_ok, c2_ok = inter_ci[0] > 0, c2 >= 0.01 and c2ci[0] > 0
    return {"n_swings": len(d), "n_pitchers": len(pitchers), "coef": [round(float(x), 5) for x in b],
            "C1_interaction": round(float(b[3]), 5), "C1_ci": inter_ci, "C1": bool(c1_ok),
            "C2_corner_gap_pp": round(100 * c2, 2), "C2_ci_pp": [round(100 * x, 2) for x in c2ci], "C2_n": c2n,
            "C2": bool(c2_ok), "soft_flat_gap_pp": round(100 * sf, 2), "soft_flat_ci_pp": [round(100 * x, 2) for x in sfci],
            "soft_flat_n": sfn,
            "verdict": "CONFIRMED" if c1_ok and c2_ok else ("real but immaterial" if c1_ok else "NOT CONFIRMED")}


def t2(d: pd.DataFrame) -> dict:
    """Pitching+: OLS of the pitcher-positive residual on vz, sz, vz*sz (FF pitches, dev pitchers)."""
    X, r = X_of(d), d["r"].to_numpy(float)
    codes, pitchers = pd.factorize(d["pitcher"])
    k = X.shape[1]
    XX = np.zeros((len(pitchers), k, k))
    Xy = np.zeros((len(pitchers), k))
    np.add.at(XX, codes, X[:, :, None] * X[:, None, :])
    np.add.at(Xy, codes, X * r[:, None])
    b = np.linalg.solve(XX.sum(0), Xy.sum(0))
    W = boot_weights(pitchers)
    bb = np.array([np.linalg.solve(np.tensordot(w, XX, 1), w @ Xy) for w in W])
    hard_steep = ((d["velo"] >= 97) & (d["sq"] == 4)).to_numpy()
    soft_flat = ((d["velo"] <= 93) & (d["sq"] == 0)).to_numpy()
    c2, c2ci, c2n = corner_boot(d, r, hard_steep, codes, W)
    sf, sfci, sfn = corner_boot(d, r, soft_flat, codes, W)
    inter_ci = ci(bb[:, 3])
    c1_ok, c2_ok = inter_ci[0] > 0, c2 >= 0.005 and c2ci[0] > 0
    per100 = lambda v: round(100 * v, 3)  # noqa: E731
    return {"n_pitches": len(d), "n_pitchers": len(pitchers), "coef_per100": [per100(x) for x in b],
            "C1_interaction_per100": per100(b[3]), "C1_ci_per100": [per100(x) for x in inter_ci], "C1": bool(c1_ok),
            "C2_corner_runs_per100": per100(c2), "C2_ci_per100": [per100(x) for x in c2ci], "C2_n": c2n, "C2": bool(c2_ok),
            "soft_flat_runs_per100": per100(sf), "soft_flat_ci_per100": [per100(x) for x in sfci], "soft_flat_n": sfn,
            "verdict": "CONFIRMED" if c1_ok and c2_ok else ("real but immaterial" if c1_ok else "NOT CONFIRMED")}


def grid(d: pd.DataFrame, val: str, pred: str | None, floor: int, rows: str, cols: str) -> list:
    """Display cells (never judged): n, observed, predicted, gap; thin cells flagged."""
    agg = {"n": (val, "size"), "obs": (val, "mean")}
    if pred:
        agg["pred"] = (pred, "mean")
    g = d.groupby([rows, cols]).agg(**agg).reset_index()
    if pred:
        g["gap"] = g["obs"] - g["pred"]
    g["thin"] = g["n"] < floor
    return [{k: (round(float(v), 4) if isinstance(v, float) else (bool(v) if k == "thin" else int(v))) for k, v in r.items()}
            for r in g.to_dict("records")]


def t3(allp: pd.DataFrame) -> dict:
    """Prevention+: next-season RV/100 ~ Prevention+ + FF velo z + FF steep z + product (dev pitchers)."""
    import location_plus as lp
    pm = json.loads((PIPE.parent / "data" / "export" / "mlb_pitcher_models.json").read_text())["pitchers"]
    pv = pd.DataFrame(pm)[["mlbam", "season", "prevention_plus"]]
    oc = pd.read_parquet(CACHE / "outcomes_2020.parquet")
    sign = 1.0 if oc[["rv100", "kbb"]].corr().iloc[0, 1] > 0 else -1.0  # pitcher-positive RV/100
    ff = zcols(allp[allp["pitch_type"] == "FF"]).groupby(["pitcher", "season"]).agg(n_ff=("vz", "size"), vz=("vz", "mean"),
                                                                              sz=("sz", "mean")).reset_index()
    npitch = allp.groupby(["pitcher", "season"]).size().rename("n_next").reset_index()
    nxt = (oc.assign(season=oc["season"] - 1, rv_next=sign * oc["rv100"], xrv_next=sign * oc["xrv100"])
           [["mlbam", "season", "rv_next", "xrv_next"]])
    d = (ff.rename(columns={"pitcher": "mlbam"}).merge(pv, on=["mlbam", "season"])
         .merge(npitch.rename(columns={"pitcher": "mlbam"}).assign(season=lambda x: x["season"] - 1), on=["mlbam", "season"])
         .merge(nxt, on=["mlbam", "season"]))
    d = d[(d["n_ff"] >= 200) & (d["n_next"] >= 300) & d["season"].between(2021, 2024)]
    d = d[~d["mlbam"].map(lp.sealed)].dropna(subset=["prevention_plus", "rv_next", "vz", "sz"])
    out = {"rv_sign": sign, "n_pairs": len(d), "n_pitchers": int(d["mlbam"].nunique())}
    codes, pitchers = pd.factorize(d["mlbam"])
    W = boot_weights(pitchers)
    X = np.column_stack([np.ones(len(d)), d["prevention_plus"], d["vz"], d["sz"], d["vz"] * d["sz"]])
    for tgt in ("rv_next", "xrv_next"):
        e = d[tgt].notna().to_numpy()
        Xe, ye, ce = X[e], d[tgt].to_numpy(float)[e], codes[e]
        XX = np.zeros((len(pitchers), 5, 5))
        Xy = np.zeros((len(pitchers), 5))
        np.add.at(XX, ce, Xe[:, :, None] * Xe[:, None, :])
        np.add.at(Xy, ce, Xe * ye[:, None])
        b = np.linalg.solve(XX.sum(0), Xy.sum(0))
        bb = np.array([np.linalg.solve(np.tensordot(w, XX, 1), w @ Xy) for w in W])
        se = float(bb[:, 4].std())
        out[tgt] = {"n": int(e.sum()), "interaction": round(float(b[4]), 4), "ci": [round(x, 4) for x in ci(bb[:, 4])],
                    "mde_80pct_power": round(2.8 * se, 4), "judged": tgt == "rv_next"}
    out["verdict"] = "CONFIRMED" if out["rv_next"]["ci"][0] > 0 else "NOT CONFIRMED (see MDE)"
    return out


def load():
    """Per-pitch frame aligned with the cross-fit caches (same rows, same order)."""
    import stuff_v2
    from physics import add_physics
    from train_mlb import load_features
    df = stuff_v2.prepare(add_physics(load_features()))
    pred = pd.read_parquet(CACHE / "pred_s4_bb.parquet")
    val = pd.read_parquet(CACHE / "pitchval_raw.parquet")["v"]
    assert len(pred) == len(df) == len(val), (len(pred), len(df), len(val))
    for c in ("pitcher", "season", "pitch_type"):
        assert (pred[c].to_numpy() == df[c].to_numpy()).all(), f"pred rows differ on {c}"
    import location_plus as lp
    df = lp.target(df)
    d = pd.DataFrame({"pitcher": df["pitcher"].to_numpy(), "season": df["season"].to_numpy(),
                      "pitch_type": df["pitch_type"].to_numpy(), "velo": df["velo"].to_numpy(),
                      "steep": -df["hvaa"].to_numpy(), "balls": df["balls"].to_numpy(), "strikes": df["strikes"].to_numpy(),
                      "swing": pred["swing"].to_numpy(), "whiff": pred["whiff"].to_numpy(), "pred": pred["pred"].to_numpy(),
                      "y": df["y"].to_numpy(), "v": val.to_numpy()})
    return d[d["season"].isin(SEASONS)]


def run(d: pd.DataFrame) -> dict:
    import location_plus as lp
    d = d.dropna(subset=["velo", "steep"])
    sealed = d["pitcher"].map(lp.sealed)
    # T2 residual: count mean over all pitch types of dev pitchers' rows
    dv = d[~sealed].dropna(subset=["y", "v"])
    u = dv["y"] - dv["v"]
    dv = dv.assign(r=-(u - u.groupby([dv["balls"], dv["strikes"]]).transform("mean")))
    res = {"seasons": list(SEASONS)}
    for pt in ("FF", "SI"):
        sw = zcols(d[(d["pitch_type"] == pt) & (d["swing"] == 1)].dropna(subset=["pred", "whiff"]))
        pi = zcols(dv[dv["pitch_type"] == pt])
        r = {"T1": t1(sw), "T2": t2(pi),
             "T1_orig_2023_25": t1(sw[sw["season"].isin(ORIG)])["verdict"],
             "T2_orig_2023_25": t2(pi[pi["season"].isin(ORIG)])["verdict"],
             "grid_fine_T1": grid(sw, "whiff", "pred", 300, "vb", "sq"),
             "grid_coarse_T1": grid(sw, "whiff", "pred", 300, "vt", "st"),
             "grid_fine_T2": grid(pi, "r", None, 1000, "vb", "sq"),
             "grid_coarse_T2": grid(pi, "r", None, 1000, "vt", "st"),
             "oneway_T1_velo": grid(sw.assign(one=0), "whiff", "pred", 300, "vb", "one"),
             "oneway_T1_steep": grid(sw.assign(one=0), "whiff", "pred", 300, "sq", "one")}
        res[pt] = {**r, "judged": pt == "FF"}
    res["T3"] = t3(d)
    return res


def demo() -> None:
    """Synthetic swings where the model misses a planted interaction: T1 must find it; none planted -> must not."""
    n, rng = 60000, np.random.default_rng(1)
    d = pd.DataFrame({"pitcher": rng.integers(0, 600, n), "season": rng.choice([2024, 2025], n),
                      "velo": rng.normal(95, 2, n), "steep": rng.normal(0, 1, n)})
    base = -1.2 + 0.25 * (d["velo"] - 95) / 2 - 0.3 * d["steep"]
    for planted, want in ((0.6, True), (0.0, False)):
        p_true = 1 / (1 + np.exp(-(base + planted * (d["velo"] - 95) / 2 * d["steep"])))
        x = zcols(d.assign(whiff=(rng.random(n) < p_true).astype(int), pred=1 / (1 + np.exp(-base))))
        out = t1(x)
        assert out["C1"] is want, (planted, out["C1_ci"])
    print("demo ok")


if __name__ == "__main__":
    if "--demo" in sys.argv:
        demo()
        sys.exit()
    out = run(load())
    path = PIPE / "results" / "fb_steep_interaction_83.json"
    assert not path.exists(), f"{path} exists: §83 is read once"
    path.write_text(json.dumps(out, indent=1))
    for pt in ("FF", "SI"):
        for t in ("T1", "T2"):
            print(pt, t, {k: v for k, v in out[pt][t].items() if k.startswith(("C", "verdict", "soft", "n_"))})
        print(pt, "orig 2023-25:", out[pt]["T1_orig_2023_25"], out[pt]["T2_orig_2023_25"])
    print("T3", out["T3"])
