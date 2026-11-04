"""prospect_r0.py — prospect program R0: re-baseline on the line-WAR labels (F2) with the harness (F6). Spent/dev lists only.

    nice -n 10 python pipeline/prospect_r0.py        # -> results/prospect_r0.json

Value (lists 2015-18, all spent or dev):
  * old arms: the §104 predictions trained on the playing-time label (B1/v0u/LGB/NPY _ev);
  * new arms: B1, v0u and LGB retrained on war6 (clipped at 0: the hurdle's value head is log1p, and a sub-replacement
    career adds no surplus) with the same §104 splits (tyear <= Y - 4);
  * ladder: consensus (B1's inputs) -> + age/level/draft -> + 3 rate stats, forward in time.
  Scores: out-of-time log loss of P(war6 >= 1) and P(star) over consensus (harness `incremental`; model scores mapped
  leave-one-year-out, dev only), Spearman with war6, and the old NDCG@100 / sleeper p@50 as reported-only columns.
Arrival (lists 2015-21, dev): the §99h dev predictions (B1, LGB, H_fix) on debut_k4: log loss, Brier, ECE, paired deltas,
calibration by role and list state.
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import spearmanr

PIPE = Path(__file__).resolve().parent
sys.path.insert(0, str(PIPE))
import prospect_backtest as pb  # noqa: E402
import prospect_eval as pe  # noqa: E402

RES = PIPE / "results"
YEARS = [2015, 2016, 2017, 2018]


def value():
    S = pb.load()
    L = pd.read_parquet(pb.ROOT / "data" / "milb" / "prospect_labels.parquet")[["id", "as_of", "war6", "star"]]
    S = S.merge(L, on=["id", "as_of"], how="left")
    S["y_val"] = S.war6.clip(lower=0)
    pe.guard("value", YEARS)
    cache = RES / "prospect_r0_retrained.parquet"
    if cache.exists():
        new = pd.read_parquet(cache)
    else:
        new = pd.concat([pb.run_fold(S, Y, "val", ["B1", "v0u", "LGB"])[0] for Y in YEARS], ignore_index=True)
        new.to_parquet(cache, compression="zstd")
    new = new.rename(columns={"B1_ev": "B1n_ev", "v0u_ev": "v0un_ev", "LGB_ev": "LGBn_ev"})
    old = pd.read_parquet(RES / "prospect_104_dev_preds.parquet")
    old = pb.merge_npy(old[old.task == "val"], "val", [2015, 2016, 2017], tag="104")
    rd = pd.read_parquet(RES / "prospect_104_read_preds.parquet")
    old = pd.concat([old, rd[[c for c in old.columns if c in rd.columns]]], ignore_index=True)
    keep = ["id", "as_of", "B1_ev", "v0u_ev", "LGB_ev", "NPY_ev"]
    d = new.merge(old[keep], on=["id", "as_of"], how="left")
    d["y1"] = (d.war6 >= 1).astype(int)
    d["ystar"] = d.star.astype(int)
    arms = ["B1_ev", "v0u_ev", "LGB_ev", "NPY_ev", "B1n_ev", "v0un_ev", "LGBn_ev"]
    for a in arms:
        d[f"s_{a}"] = np.log1p(d[a].clip(lower=0))
    out = {"n": len(d), "years": YEARS, "base_rate_y1": round(float(d.y1.mean()), 4), "stars": int(d.ystar.sum())}
    lad = {"+age_level": pe.AGE_LEVEL, "+age_level+rates": pe.AGE_LEVEL + pe.RATES[False] + pe.RATES[True]}
    # ladder, forward: list rows 2011-18 (labels all matured); loyo beside it to compare with the model arms
    D = S[(S.snap == "list") & S.tyear.between(2011, 2018) & (S.event != "debuted_before")].reset_index(drop=True)
    D["y1"], D["ystar"] = (D.war6 >= 1).astype(int), D.star.astype(int)
    for tgt in ("y1", "ystar"):
        r = {}
        for k, cols in lad.items():
            r[k + " (forward)"] = pe.incremental(D, tgt, cols, YEARS, n=500)
            r[k + " (loyo)"] = pe.incremental(d, tgt, cols, YEARS, n=500, loyo=True)
        for a in arms:
            r[a] = pe.incremental(d, tgt, f"s_{a}", YEARS, n=500, loyo=True)
        out[f"incremental_{tgt}"] = r
    d["y_val"] = d.war6.clip(lower=0)                     # reported-only rank metrics on the new label
    out["rank"] = {a: {"spearman_war6": round(float(spearmanr(d[a], d.war6, nan_policy="omit").statistic), 4),
                       "ndcg100": round(float(pb._nd(d.dropna(subset=[a]), a)), 4),
                       "sleeper_p50": round(float(pb._pr(d.dropna(subset=[a]), a)), 4)} for a in arms}
    d[["id", "as_of", "tyear", "pitcher", "war6", "star", "y1"] + arms].to_parquet(RES / "prospect_r0_value_preds.parquet",
                                                                                   compression="zstd")
    return out


def arrival():
    a = pd.read_parquet(RES / "prospect_99h_dev_preds.parquet").dropna(subset=["y_arr"])
    yrs = sorted(a.tyear.unique().tolist())
    out = {"all": pe.report(a, "y_arr", ["B1", "LGB", "H_fix"], yrs, ref="B1", task="arrival", n=500)}
    out["H_fix_vs_LGB"] = pe.boot(a, lambda x: pe.logloss(x.y_arr, x.H_fix) - pe.logloss(x.y_arr, x.LGB), n=500)
    out["calibration_H_fix"] = {"role": pe.calibration(a.assign(role=np.where(a.pitcher, "P", "H")), "y_arr", "H_fix", "role"),
                                "list_state": pe.calibration(a, "y_arr", "H_fix", "list_state")}
    return out


if __name__ == "__main__":
    res = {"arrival": arrival()}
    print(json.dumps(res, indent=1, default=str), flush=True)
    res["value"] = value()
    (RES / "prospect_r0.json").write_text(json.dumps(res, indent=1, default=str))
    print(json.dumps(res["value"], indent=1, default=str))
