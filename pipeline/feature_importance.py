"""What does each Stuff+ v2 input contribute, and which inputs let it memorize pitchers?

    python feature_importance.py

One pitcher fold (fold 0 of crc32(pitcher) % 4, as in crossfit_v2.py) is held out; the v2
boosters train on the other folds' 2023-24 pitches. Per feature, pooled over the six
class x batter-side cells:
  gain_share    LightGBM split gain, share of the cell total (row-weighted over cells)
  shap          mean |SHAP| (pred_contrib) on unseen pitchers' 2023-24 pitches
  perm_seen     drop in per-pitch r(pred, csw_norm) when the feature is shuffled, on
                pitchers the model trained on (their 2023-24 pitches)
  perm_unseen   the same on held-out pitchers (same seasons)
  memo_index    perm_seen - perm_unseen: value that exists only for pitchers the model saw
  pitcher_share between-pitcher-season share of the feature's variance (fingerprint-ness)
Per Statcast pitch type (FF, SI, FC, SL, ST, CU, KC, CH, FS, ...; >= 5,000 sampled rows):
perm_unseen and shap inside the class cell -> results/feature_importance_by_pitch_type.csv.
Also writes the full input inventory (features, monotone directions, LightGBM params).
Writes results/feature_importance.json.
"""

import json
import sys
import zlib
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import stuff_v2  # noqa: E402
from physics import add_physics  # noqa: E402
from train_mlb import LGBM_PARAMS, load_features  # noqa: E402

RESULTS = Path(__file__).resolve().parent / "results"
N_SAMPLE = 200_000  # rows per (cell, seen/unseen) for permutation and SHAP


def cell_mask(df, key):
    pclass, side = key.split("_vs_")
    return (df["pclass"] == pclass) & (df["stand"] == ("L" if side == "LHH" else "R"))


def pt_r(pred, s):
    """Per-pitch r(pred, csw_norm) within each Statcast pitch type with >= 5,000 rows."""
    d = pd.DataFrame({"p": pred, "y": s["csw_norm"].to_numpy(), "pt": s["pitch_type"].to_numpy()})
    return {pt: g["p"].corr(g["y"]) for pt, g in d.groupby("pt") if len(g) >= 5000}


def main() -> None:
    df = stuff_v2.prepare(add_physics(load_features()))
    F = stuff_v2.FEATURES
    fold = df["pitcher"].map(lambda p: zlib.crc32(str(p).encode()) % 4)
    full_train = df["train_season"].copy()
    df["train_season"] = full_train & (fold != 0)
    bst = stuff_v2.train_boosters(df)
    df["train_season"] = full_train

    rng = np.random.default_rng(13)
    base = full_train & df["csw_norm"].notna()
    acc = {f: {"gain": 0.0, "shap": 0.0, "perm_seen": 0.0, "perm_unseen": 0.0, "w": 0}
           for f in F}
    by_pt = []
    for key, b in bst.items():
        m = cell_mask(df, key) & base
        gain = b.booster_.feature_importance("gain")
        gain = gain / gain.sum()
        samples = {}
        for name, sel in (("seen", m & (fold != 0)), ("unseen", m & (fold == 0))):
            idx = df.index[sel]
            samples[name] = df.loc[rng.choice(idx, min(N_SAMPLE, len(idx)), replace=False)]
        w = int(m.sum())
        X_un = samples["unseen"][F]
        shap = np.abs(b.predict(X_un, pred_contrib=True)[:, :len(F)]).mean(axis=0)
        r0 = {n: np.corrcoef(b.predict(s[F]), s["csw_norm"])[0, 1] for n, s in samples.items()}
        un = samples["unseen"]
        shap_pt = pd.DataFrame(np.abs(b.predict(X_un, pred_contrib=True)[:, :len(F)]), columns=F,
                               index=un.index).groupby(un["pitch_type"]).mean()
        r0_pt = pt_r(b.predict(X_un), un)
        for j, f in enumerate(F):
            a = acc[f]
            a["gain"] += w * gain[j]
            a["shap"] += w * shap[j]
            a["w"] += w
            for n, s in samples.items():
                X = s[F].copy()
                X[f] = rng.permutation(X[f].to_numpy())
                p = b.predict(X)
                a[f"perm_{n}"] += w * (r0[n] - np.corrcoef(p, s["csw_norm"])[0, 1])
                if n == "unseen":  # by Statcast pitch type, inside the class cell
                    for pt, r in pt_r(p, s).items():
                        by_pt.append({"pitch_type": pt, "cell": key, "feature": f,
                                      "n": int((s["pitch_type"] == pt).sum()),
                                      "perm_unseen": r0_pt[pt] - r, "shap": shap_pt.loc[pt, f]})
        print(f"{key}: r seen {r0['seen']:.3f} unseen {r0['unseen']:.3f}", flush=True)

    ps = df[full_train].groupby(["pitcher", "season", "pclass"])
    out = {}
    for f in F:
        a = acc[f]
        between = ps[f].transform("mean")
        out[f] = {k: round(a[k] / a["w"], 4) for k in ("gain", "shap", "perm_seen", "perm_unseen")}
        out[f]["memo_index"] = round(out[f]["perm_seen"] - out[f]["perm_unseen"], 4)
        out[f]["pitcher_share"] = round(float(between.var() / df.loc[full_train, f].var()), 3)
    tab = pd.DataFrame(out).T.sort_values("perm_unseen", ascending=False)
    print(tab.to_string())
    inventory = {"features": F,
                 "monotone": {c: {f: d for f, d in m.items() if d} for c, m in stuff_v2.CLASS_MONO.items()},
                 "cells": "one LightGBM per pitch class (FB, BB, CH) x batter side (RHH, LHH)",
                 "target": "csw_norm = CSW / E[CSW | count], E fitted on 2023-24",
                 "lgbm_params": LGBM_PARAMS}
    pt = (pd.DataFrame(by_pt).assign(wp=lambda d: d["n"] * d["perm_unseen"], ws=lambda d: d["n"] * d["shap"])
          .groupby(["pitch_type", "feature"])[["wp", "ws", "n"]].sum())
    pt = pd.DataFrame({"perm_unseen": pt["wp"] / pt["n"], "shap": pt["ws"] / pt["n"]}).round(4)
    print(pt["perm_unseen"].unstack("pitch_type").loc[tab.index].to_string())
    RESULTS.mkdir(exist_ok=True)
    pt.reset_index().to_csv(RESULTS / "feature_importance_by_pitch_type.csv", index=False)
    (RESULTS / "feature_importance.json").write_text(
        json.dumps({"inventory": inventory, "importance": out}, indent=1, default=str))


if __name__ == "__main__":
    main()
