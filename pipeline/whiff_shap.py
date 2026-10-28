"""Whiff+ explained: TreeSHAP of the s4_bb cross-fit, in Whiff+ points, for the profiles' grade breakdown.

    GOAT_LO=2020 python crossfit_v2.py --params "$P" --target wps --name s4_bb_shap --shap --save-pred
    python whiff_shap.py [--out DIR]     # -> DIR/whiff_shap/{id}-{season}.json.gz (default data/export/web)
    python whiff_shap.py --demo          # self-check of the decomposition

Every pitch is explained by the fold booster that predicted it (trained without his pitcher fold), so the breakdown
carries no memorization. pred = bias + sum of feature contributions, and both grades are linear in pred, so the points
add up exactly:
  overall   10 x (c_f - R_f) / sd per pitch, R_f = the frozen Whiff+ reference population's mean contribution
            (TRAIN pitcher means over swings, >= 10 swings, per class x batter hand), averaged over his pitches;
            sums to Whiff+ - 100 (before the 50-175 clip).
  per type  type_grades.py's scale: own-type mean shrunk toward the class mean (k = 150), 10 x (. - R_site,f) / sd_site
            with R / sd on TRAIN cells >= 50 pitches; sums to the site's per-type Whiff+ - 100.
"bias" is the fold boosters' baseline against the reference (fold noise, near 0); shown as "baseline".
The model's view, not causation: correlated inputs share credit.
"""
import gzip
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

import stuff_v2
import train_mlb as tm
from type_grades import K_SHRINK, MIN_N, SITE

PIPE = Path(__file__).resolve().parent
CACHE, RES = PIPE.parent / "cache", PIPE / "results"
DISPLAY_N = 10  # p7_export.DISPLAY_N: per-type Whiff+ shown from 10 pitches


def overall_points(p: pd.DataFrame, cols: list[str]) -> pd.DataFrame:
    """Per pitcher-season mean points per column (>= 5 pitches), vs the Whiff+ refs (whiff_hand.refs, per column)."""
    tr = p[p["season"].isin(tm.TRAIN_SEASONS) & (p["swing"] == 1)]
    pm = tr.groupby(["pclass", "stand", "pitcher"])[cols + ["pred"]].agg("mean").join(
        tr.groupby(["pclass", "stand", "pitcher"]).size().rename("k"))
    pm = pm[pm["k"] >= 10].groupby(["pclass", "stand"])
    R, sd = pm[cols].mean(), pm["pred"].std()
    idx = pd.MultiIndex.from_arrays([p["pclass"], p["stand"]])
    pts = 10 * (p[cols].to_numpy() - R.reindex(idx).to_numpy()) / sd.reindex(idx).to_numpy()[:, None]
    g = pd.DataFrame(pts, columns=cols, index=p.index).assign(pitcher=p["pitcher"], season=p["season"]).groupby(
        ["pitcher", "season"])
    out = g.mean()
    return out[g.size() >= 5]


def type_points(p: pd.DataFrame, cols: list[str]) -> pd.DataFrame:
    """type_grades.type_table's scale, column by column (pred = sum of cols)."""
    p = p[p["pitch_type"].isin(SITE)].assign(site=lambda d: d["pitch_type"].map(SITE))
    cls = p.groupby(["pitcher", "season", "pclass"])[cols].mean()
    t = p.groupby(["pitcher", "season", "site", "pclass"])[cols].mean().join(
        p.groupby(["pitcher", "season", "site", "pclass"]).size().rename("n"))
    c = cls.reindex(t.index.droplevel("site"))
    c.index = t.index
    t[cols] = (t[cols].mul(t["n"], axis=0) + K_SHRINK * c[cols]) / (t["n"] + K_SHRINK).to_numpy()[:, None]
    t["pred"] = t[cols].sum(axis=1)
    t = t.reset_index()
    ref = t[t["season"].isin(tm.TRAIN_SEASONS) & (t["n"] >= MIN_N)].groupby("site")
    R, sd = ref[cols].mean(), ref["pred"].std()
    t[cols] = 10 * (t[cols].to_numpy() - R.reindex(t["site"]).to_numpy()) / sd.reindex(t["site"]).to_numpy()[:, None]
    return t[t["n"] >= DISPLAY_N]


def check(p: pd.DataFrame, cols: list[str], pred_file: Path) -> dict:
    """Same predictions as the shipped grade, and SHAP closes on them (or nothing is written)."""
    ref = pd.read_parquet(pred_file, columns=["pitcher", "season", "pred"])
    assert len(ref) == len(p) and (ref["pitcher"].to_numpy() == p["pitcher"].to_numpy()).all(), "row order differs"
    return {"max_abs_vs_shipped": float(np.nanmax(np.abs(ref["pred"].to_numpy() - p["pred"].to_numpy()))),
            "max_abs_closure": float(np.nanmax(np.abs(p[cols].sum(axis=1).to_numpy() - p["pred"].to_numpy())))}


def main(out: Path) -> None:
    p = pd.read_parquet(CACHE / "shap_s4_bb_shap.parquet")
    cols = [*stuff_v2.FEATURES, "bias"]
    chk = check(p, cols, CACHE / "pred_s4_bb.parquet")
    print(chk, flush=True)
    assert chk["max_abs_closure"] < 1e-4, chk
    assert chk["max_abs_vs_shipped"] < 1e-3, f"not the shipped s4_bb predictions: {chk}"
    p = p[p["pred"].notna()].assign(pclass=lambda d: d["pitch_type"].map(tm.CLASS_OF))
    ov, ty = overall_points(p, cols), type_points(p, cols)

    # the sums must be the grades the site shows
    g = pd.read_csv(RES / "crossfit_v2_s4_bb_grades.csv").set_index(["mlbam", "season"])["grade"]
    s = (100 + ov.sum(axis=1)).clip(50, 175)
    both = s.index.intersection(g.index)
    gap = float((s.loc[both] - g.reindex(both)).abs().max())
    print(f"overall: {len(ov)} pitcher-seasons, max |sum - Whiff+| {gap:.4f}", flush=True)
    assert gap < 0.05, gap

    out = out / "whiff_shap"
    n = 0
    tys = {k: v for k, v in ty.groupby(["pitcher", "season"])}
    for (pid, season), row in ov.iterrows():
        rows = tys.get((pid, season))
        doc = {"season": int(season), "features": cols, "grade": round(100 + float(row.sum()), 1),
               "overall": {c: round(float(row[c]), 2) for c in cols},
               "byType": [] if rows is None else [
                   {"type": r.site, "n": int(r.n), "grade": round(100 + float(sum(getattr(r, c) for c in cols)), 1),
                    "points": {c: round(float(getattr(r, c)), 2) for c in cols}}
                   for r in rows.sort_values("n", ascending=False).itertuples()]}
        path = out / f"{int(pid)}-{int(season)}.json.gz"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(gzip.compress(json.dumps(doc, separators=(",", ":"), sort_keys=True).encode(), mtime=0))
        n += 1
    (RES / "whiff_shap_checks.json").write_text(json.dumps({**chk, "overall_gap": gap, "files": n}, indent=1))
    print(f"wrote {n} files to {out}")


def demo() -> None:
    rng = np.random.default_rng(0)
    m = 2400
    p = pd.DataFrame({"pitcher": np.repeat(np.arange(40), 60), "season": 2023, "pclass": "FB", "stand": "R",
                      "swing": 1, "pitch_type": "FF", "a": rng.normal(size=m), "bias": 0.3})
    p["pred"] = p["a"] + p["bias"]
    ov = overall_points(p, ["a", "bias"])
    pm = p.groupby("pitcher")["pred"].mean()
    want = 10 * (pm - pm.mean()) / pm.std()
    assert np.allclose(ov.sum(axis=1).to_numpy(), want.to_numpy())  # points sum to the grade - 100
    ty = type_points(p, ["a", "bias"])
    assert np.allclose(ty[["a", "bias"]].sum(axis=1).mean(), 0, atol=1e-9)  # TRAIN cells centre on 100
    print("demo ok")


if __name__ == "__main__":
    if "--demo" in sys.argv:
        demo()
    else:
        main(Path(sys.argv[sys.argv.index("--out") + 1]) if "--out" in sys.argv else PIPE.parent / "data" / "export" / "web")
