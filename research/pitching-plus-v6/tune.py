"""Rung e: nested Optuna (TPE) per outer pitcher fold, grouped early stopping, pitcher-level objective.

    OMP_NUM_THREADS=3 nice -n 10 python research/pitching-plus-v6/tune.py <design> --trials 25 [--inner-frac 0.5]

Inner split: 20% of the outer-training pitchers (salt "ppv6-inner") are inner validation; early stopping uses the
"ppv6-es" pitchers inside the inner training set. Objective = r(inner-val pitcher-season grade on odd games,
RV/100 on even games), pitcher-seasons with >= 100 pitches in each parity. The outer fold is never touched while
tuning; it is then scored by a refit on the full outer-training set with the fold's best trial.
Writes cache/oof_<design>+tuned@full.parquet and results/tune_<design>.json.
"""
import argparse
import json
import sys
import zlib
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ladder  # noqa: E402
import lib  # noqa: E402

SPACE_NOTE = ("num_leaves 15-1023 log, min_child_samples 20-20000 log, learning_rate .01-.2 log, colsample .3-1, "
              "subsample .4-1, reg_lambda 1e-3-300 log, min_split_gain 0-.05, max_bin {63,255}, loss {l2, huber}, "
              "huber alpha .05-2 log, monotone velo {none, +1}")


def suggest(trial, kind):
    p = dict(num_leaves=trial.suggest_int("num_leaves", 15, 1023, log=True),
             min_child_samples=trial.suggest_int("min_child_samples", 20, 20000, log=True),
             learning_rate=trial.suggest_float("learning_rate", 0.01, 0.2, log=True),
             colsample_bytree=trial.suggest_float("colsample_bytree", 0.3, 1.0),
             subsample=trial.suggest_float("subsample", 0.4, 1.0),
             reg_lambda=trial.suggest_float("reg_lambda", 1e-3, 300, log=True),
             min_split_gain=trial.suggest_float("min_split_gain", 0.0, 0.05),
             max_bin=trial.suggest_categorical("max_bin", [63, 255]))
    if kind == "reg" and trial.suggest_categorical("loss", ["l2", "huber"]) == "huber":
        p.update(objective="huber", alpha=trial.suggest_float("alpha", 0.05, 2.0, log=True))
    mono = trial.suggest_categorical("mono_velo", [0, 1])
    return p, ({"velo": 1} if mono else None)


def parity_r(meta, v):
    d = meta.assign(v=v).dropna(subset=["v"])
    par = d.groupby(["pitcher", "season"])["game_pk"].rank(method="dense").astype(int) % 2
    d = d.assign(par=par)
    g = d[d["par"] == 1].groupby(["pitcher", "season"])["v"].agg(["mean", "size"])
    o = d[d["par"] == 0].groupby(["pitcher", "season"])["rv"].agg(["mean", "size"])
    m = g.join(o, lsuffix="_g", rsuffix="_o", how="inner")
    m = m[(m["size_g"] >= 100) & (m["size_o"] >= 100)]
    return float(np.corrcoef(m["mean_g"], m["mean_o"])[0, 1])


def main():
    import optuna
    ap = argparse.ArgumentParser()
    ap.add_argument("design")
    ap.add_argument("--trials", type=int, default=25)
    ap.add_argument("--inner-frac", type=float, default=0.5)
    a = ap.parse_args()
    base = a.design.split("@")[0]
    kind, tgt, feats, extra = ladder.spec_of(base)
    df = lib.load(lib.META + lib.BASE + ladder.EXTRA + ["at_bat_number"])
    if any(f in feats for f in ladder.D1 + ladder.D2):
        df = ladder.add_d(df)
    y = None
    if kind == "reg":
        y = lib.target(df, tgt)
        y = y - y.groupby([df["season"], df["balls"], df["strikes"]]).transform("mean")
    inner = df["pitcher"].map(lambda p: zlib.crc32(f"ppv6-inner:{p}".encode()) % 5 == 0)
    oof = pd.Series(np.nan, index=df.index)
    log = {"space": SPACE_NOTE, "trials": a.trials, "inner_frac": a.inner_frac, "folds": {}}
    optuna.logging.set_verbosity(optuna.logging.WARNING)
    for k in range(5):
        outer_tr = df["fold"] != k
        # inner frame: outer-training pitchers only; relabel folds so fit_oof trains on inner-train, scores inner-val
        sub = df[outer_tr].copy()
        sub["fold"] = np.where(inner[outer_tr], 0, 1).astype("int8")
        ysub = None if y is None else y[outer_tr]

        def objective(trial):
            p, mono = suggest(trial, kind)
            v = lib.fit_oof(sub, feats, kind, ysub, params={**extra, **p}, frac=a.inner_frac, folds=[0],
                            mono=mono)
            return parity_r(sub, v)

        st = optuna.create_study(direction="maximize", sampler=optuna.samplers.TPESampler(seed=k))
        st.optimize(objective, n_trials=a.trials)
        p, mono = suggest(optuna.trial.FixedTrial(st.best_params), kind)
        v = lib.fit_oof(df, feats, kind, y, params={**extra, **p}, frac=1.0, folds=[k], mono=mono)
        oof[df["fold"] == k] = v[df["fold"] == k]
        log["folds"][k] = {"best": st.best_params, "inner_r": round(st.best_value, 4),
                           "default_like": [t.value for t in st.trials[:3]]}
        print(f"outer fold {k}: inner r {st.best_value:.4f} {st.best_params}", flush=True)
    # fit_oof count-normalizes within each call; re-normalize the assembled OOF on all folds together
    raw = oof
    oof = raw - raw.groupby([df["season"], df["balls"], df["strikes"]]).transform("mean")
    oof.rename("v").astype("float32").to_frame().to_parquet(lib.CACHE / f"oof_{base}+tuned@full.parquet")
    (lib.RESULTS / f"tune_{base}.json").write_text(json.dumps(log, indent=1, default=float))


if __name__ == "__main__":
    main()
