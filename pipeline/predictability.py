"""Pitch predictability price (pipeline/PREREG-predictability.md), restart step 2.

    python pipeline/predictability.py FRAME.parquet --window selection|confirmation

p = leave-one-game-out, shrunk P(own type | pitcher, season, count, side, previous type in PA).
a = beta * p + gamma * b + FE(pitcher x season x count x side x type) + FE(prev type x type x count), pitcher-clustered.
"""
import argparse

import numpy as np
import pandas as pd

FAM = {"FF": "FF", "SI": "SI", "FC": "FC", "SL": "SL", "ST": "SL", "SV": "SL", "CU": "CU", "KC": "CU", "CS": "CU",
       "CH": "CH", "FS": "CH", "FO": "CH", "SC": "CH"}
CLS = {"FF": "FB", "SI": "FB", "FC": "FB", "SL": "BB", "CU": "BB", "CH": "OS"}
WIN = {"selection": (2023, 2024, 2025, 2026), "confirmation": (2021, 2022)}
K = 20.0
BASE = ["pitcher", "season", "balls", "strikes", "opp"]


def loo_rate(df, keys, num_type="type"):
    """Leave-one-game-out count of own type and of all pitches in the key cell."""
    tk = keys + [num_type]
    n_t = df.groupby(tk).game_pk.transform("size") - df.groupby(tk + ["game_pk"]).game_pk.transform("size")
    n = df.groupby(keys).game_pk.transform("size") - df.groupby(keys + ["game_pk"]).game_pk.transform("size")
    return n_t.astype(float), n.astype(float)


def other_half(df, keys):
    """Own-type count and total in the key cell, from the OTHER game-parity half (cross-fit; amendment)."""
    c = df.groupby(keys + ["type", "half"]).size().rename("nt").reset_index()
    n = df.groupby(keys + ["half"]).size().rename("n").reset_index()
    c["half"] = 1 - c["half"]; n["half"] = 1 - n["half"]          # half h reads half 1-h
    m = df[keys + ["type", "half"]].merge(c, on=keys + ["type", "half"], how="left").merge(n, on=keys + ["half"], how="left")
    return m.nt.fillna(0).to_numpy(float), m.n.fillna(0).to_numpy(float)


def expectation(df, prev_col):
    t0, n0 = other_half(df, ["pitcher", "season", "opp"])
    p0 = np.where(n0 > 0, t0 / np.maximum(n0, 1), np.nan)
    t1, n1 = other_half(df, BASE)
    p1 = (t1 + K * p0) / (n1 + K)
    t2, n2 = other_half(df, BASE + [prev_col])
    return (t2 + K * p1) / (n2 + K)


def demean(M, fes, iters=15):
    cnts = [np.bincount(f) for f in fes]
    for _ in range(iters if len(fes) > 1 else 1):
        for f, c in zip(fes, cnts):
            M = M - (np.stack([np.bincount(f, M[:, j]) for j in range(M.shape[1])], 1) / c[:, None])[f]
    return M


def ols_cluster(y, X, g):
    XtXi = np.linalg.inv(X.T @ X); b = XtXi @ X.T @ y; u = y - X @ b
    sc = np.zeros((g.max() + 1, X.shape[1])); np.add.at(sc, g, X * u[:, None])
    V = XtXi @ (sc.T @ sc) @ XtXi
    return b, np.sqrt(np.diag(V))


def fit(df, ycol, pcol, extra=()):
    d = df.dropna(subset=[ycol, pcol, "b"])
    fes = [d.groupby(BASE + ["type", "half"], sort=False).ngroup().to_numpy(),
           d.groupby(["prev", "type", "balls", "strikes"], sort=False).ngroup().to_numpy()]
    cols = [pcol, "b", *extra]
    M = demean(np.column_stack([d[c].to_numpy(float) for c in cols] + [d[ycol].to_numpy(float)]), fes)
    b, se = ols_cluster(M[:, -1], M[:, :-1], pd.factorize(d.pitcher)[0])
    return {c: (b[i], se[i]) for i, c in enumerate(cols)}, len(d)


def show(label, r, n, key="p", scale=100 * 0.4):
    e, s = r[key]
    print(f"{label} (n={n:,}): beta {e:+.4f} [{e - 1.96 * s:+.4f}, {e + 1.96 * s:+.4f}] per unit p"
          f" -> p .3->.7 = {e * scale:+.3f} [{(e - 1.96 * s) * scale:+.3f}, {(e + 1.96 * s) * scale:+.3f}] (x100)", flush=True)


def main() -> None:
    ap = argparse.ArgumentParser(); ap.add_argument("frame"); ap.add_argument("--window", choices=list(WIN), required=True)
    a_ = ap.parse_args()
    df = pd.read_parquet(a_.frame, columns=["season", "game_pk", "at_bat_number", "pitch_number", "pitcher", "stand",
                                            "p_throws", "balls", "strikes", "pitch_type", "y", "b", "swing", "whiff",
                                            "plate_x", "plate_z"])
    df = df[df.season.isin(WIN[a_.window]) & df.balls.between(0, 3) & df.strikes.between(0, 2)].copy()
    df["type"] = df.pitch_type.map(FAM)
    df = df.sort_values(["game_pk", "at_bat_number", "pitch_number"]).reset_index(drop=True)
    pa = (df.game_pk.astype(str) + "_" + df.at_bat_number.astype(str))
    df["prev"] = df.groupby(pa, sort=False).type.shift(1).fillna("NONE")
    df = df[df.type.notna()].reset_index(drop=True)
    df["opp"] = (df.stand != df.p_throws).astype(int)
    df["a"] = df.y - df.groupby(["season", "balls", "strikes", "opp"]).y.transform("mean")
    df["half"] = (df.game_pk % 2).astype(int)
    df["p"] = expectation(df, "prev")
    rng = np.random.default_rng(0)
    df["prev_shuf"] = df.groupby(BASE, sort=False).prev.transform(lambda s: s.to_numpy()[rng.permutation(len(s))])
    df["p_shuf"] = expectation(df, "prev_shuf")
    print(f"{a_.window}: {len(df):,} pitches; mean p {df.p.mean():.3f}, sd {df.p.std():.3f}; "
          f"p for own type: first pitch {df[df.prev == 'NONE'].p.mean():.3f}")
    # calibration of the expectation model: mean p vs realized frequency by p decile
    q = pd.qcut(df.p, 10, duplicates="drop")
    print("expectation calibration (mean p -> own-type share is 1 by construction; check spread):",
          df.groupby(q, observed=True).p.mean().round(2).tolist())

    r, n = fit(df, "a", "p"); show("PRIMARY a ~ p | b", r, n)
    e, s = r["b"]; print(f"    gamma (b) {e:+.3f} ±{1.96 * s:.3f}")
    rp, n = fit(df, "a", "p_shuf"); show("PLACEBO a ~ p_shuf | b", rp, n, key="p_shuf")
    grp = np.select([df.balls > df.strikes, df.balls == df.strikes], ["behind", "even"], "ahead")
    for gname in ("behind", "even", "ahead"):
        r, n = fit(df[grp == gname], "a", "p"); show(f"  count {gname}", r, n)
    for c in ("FB", "BB", "OS"):
        r, n = fit(df[df.type.map(CLS) == c], "a", "p"); show(f"  class {c}", r, n)
    out = (df.plate_x.abs() > 0.83) | ~df.plate_z.between(1.5, 3.5)
    df["chase"] = np.where(out, df.swing, np.nan)
    df["whiff_sw"] = np.where(df.swing == 1, df.whiff, np.nan)
    df["a_contact"] = np.where((df.swing == 1) & (df.whiff == 0), df.a, np.nan)
    for ycol, scale in (("swing", 100 * .4), ("whiff_sw", 100 * .4), ("chase", 100 * .4), ("a_contact", 100 * .4)):
        r, n = fit(df, ycol, "p"); show(f"  hitter channel {ycol} (pts or runs x100)", r, n, scale=scale)


if __name__ == "__main__":
    main()
