"""prospect_eval.py — prospect program F6: the one scoring harness for prospect dev tables and sealed reads.

    python pipeline/prospect_eval.py --demo      # self-check on synthetic data

Rules it enforces (docs/prospect-program.md): proper scores first (log loss, Brier; CRPS for value distributions), every
comparison paired with a player-clustered bootstrap and its MDE (2.8 x SE: 80% power at alpha .05), calibration by
subgroup, the gain over the consensus list measured out of time, and no scoring of a sealed cell without a named read
(SEALED mirrors docs/prospect-holdouts.md; update both together).
"""
import sys

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression

SEALED = {("value", y) for y in (2019, 2020, 2021, 2022)} | {("arrival", y) for y in (2024, 2025)}
CONSENSUS = ["has_top", "log_top", "on_org", "org_frac0", "log_pick0"]           # B1's inputs: list rank + draft
AGE_LEVEL = ["lvl", "age_rel", "log_pick0", "yrs_pro"]
RATES = {False: ["hz_k_2y", "hz_bb_2y", "hz_iso_2y"], True: ["pz_k_2y", "pz_bb_2y", "pz_hr_2y"]}
EPS = 1e-6


def guard(task, years, read=None):
    hit = sorted(y for y in set(years) if (task, int(y)) in SEALED)
    if hit and not read:
        raise PermissionError(f"sealed {task} lists {hit}: name the pre-registered read (read='§...') to score them")


def logloss(y, p):
    p = np.clip(p, EPS, 1 - EPS)
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


def brier(y, p):
    return float(np.mean((p - y) ** 2))


def crps_gauss(y, mu, sd):
    from scipy.stats import norm
    z = (y - mu) / sd
    return float(np.mean(sd * (z * (2 * norm.cdf(z) - 1) + 2 * norm.pdf(z) - 1 / np.sqrt(np.pi))))


def ece(y, p, bins=10):
    q = pd.qcut(p, bins, labels=False, duplicates="drop")
    g = pd.DataFrame({"y": y, "p": p, "q": q}).groupby("q")
    return float((g.size() / len(y) * (g.y.mean() - g.p.mean()).abs()).sum())


def boot(d, fn, cluster="id", n=1000, seed=7):
    """fn(frame) -> float. Returns estimate, 95% CI, SE and MDE from a cluster bootstrap (whole players resampled)."""
    rng = np.random.default_rng(seed)
    pos = d.groupby(cluster).indices
    keys = np.array(list(pos))
    vals = [fn(d.iloc[np.concatenate([pos[k] for k in rng.choice(keys, len(keys))])]) for _ in range(n)]
    se = float(np.nanstd(vals))
    lo, hi = np.nanpercentile(vals, [2.5, 97.5])
    return {"est": round(float(fn(d)), 5), "ci": [round(float(lo), 5), round(float(hi), 5)], "se": round(se, 5),
            "mde": round(2.8 * se, 5)}


def calibration(d, y, p, by):
    """Per subgroup: n, mean forecast, observed rate, ECE. `by` is a column name (level, age band, round, org, role)."""
    rows = {}
    for k, g in d.groupby(by):
        if len(g) >= 200:
            rows[str(k)] = {"n": len(g), "p": round(float(g[p].mean()), 4), "y": round(float(g[y].mean()), 4),
                            "ece": round(ece(g[y].values, g[p].values), 4)}
    return rows


def _lr(tr, cols, y):
    X = tr[cols].astype(float)
    med = X.median().fillna(0)
    X = X.fillna(med)
    mu, sd = X.mean(), X.std().replace(0, 1).fillna(1)
    m = LogisticRegression(max_iter=2000).fit((X - mu) / sd, tr[y])
    return lambda te: m.predict_proba(((te[cols].astype(float).fillna(med)) - mu) / sd)[:, 1]


def out_of_time(d, y, cols, years, lag=4, year="tyear", by_role=True, loyo=False):
    """Rolling origin: for each test year Y, fit LR(y ~ cols) on rows with year <= Y - lag, predict year Y.
    loyo=True (dev only, for model scores that exist only on the test years): fit on the other test years instead."""
    out = pd.Series(np.nan, index=d.index)
    for Y in years:
        for role in ((False, True) if by_role else (None,)):
            sel = (d.pitcher == role) if by_role else pd.Series(True, index=d.index)
            fit = d[year].isin([v for v in years if v != Y]) if loyo else (d[year] <= Y - lag)
            tr, te = d[sel & fit], d[sel & (d[year] == Y)]
            if len(te) and tr[y].nunique() == 2:
                c = cols(role) if callable(cols) else cols
                out[te.index] = _lr(tr, c, y)(te)
    return out


def incremental(d, y, score, years, lag=4, task="value", read=None, n=1000, loyo=False):
    """The gate shape: out-of-time log loss of y ~ consensus vs y ~ consensus + score, paired by player.
    `score` is a column name or a list of columns. loyo is dev only and is refused on a named read."""
    guard(task, years, read)
    if loyo and read:
        raise PermissionError("leave-one-year-out mapping is dev only; a read maps forward in time")
    d = d.copy()
    extra = [score] if isinstance(score, str) else list(score)
    d["p_cons"] = out_of_time(d, y, CONSENSUS, years, lag, loyo=loyo)
    d["p_full"] = out_of_time(d, y, CONSENSUS + extra, years, lag, loyo=loyo)
    t = d[d.tyear.isin(years)].dropna(subset=["p_cons", "p_full"])
    if t.empty:
        raise ValueError("no scored rows: forward mapping needs training-year rows (tyear <= Y - lag) in d")
    return {"n": len(t), "logloss_cons": round(logloss(t[y], t.p_cons), 5), "logloss_full": round(logloss(t[y], t.p_full), 5),
            "d_logloss": boot(t, lambda x: logloss(x[y], x.p_full) - logloss(x[y], x.p_cons), n=n),
            "d_brier": boot(t, lambda x: brier(x[y], x.p_full) - brier(x[y], x.p_cons), n=n)}


def report(d, y, arms, years, ref, task="value", read=None, n=1000):
    """Probability arms already on d (each a column of P(y)): proper scores, ECE, paired deltas vs ref with MDE."""
    guard(task, years, read)
    t = d[d.tyear.isin(years)].dropna(subset=arms + [y])
    out = {"n": len(t), "base_rate": round(float(t[y].mean()), 4), "years": sorted(int(v) for v in t.tyear.unique())}
    for a in arms:
        r = {"logloss": round(logloss(t[y], t[a]), 5), "brier": round(brier(t[y], t[a]), 5), "ece": round(ece(t[y].values, t[a].values), 4)}
        if a != ref:
            r["d_logloss_vs_ref"] = boot(t, lambda x, a=a: logloss(x[y], x[a]) - logloss(x[y], x[ref]), n=n)
        out[a] = r
    return out


def demo():
    rng = np.random.default_rng(0)
    n = 6000
    d = pd.DataFrame({"id": np.arange(n) // 2, "tyear": rng.choice(range(2008, 2019), n), "pitcher": rng.random(n) < .45})
    for c in CONSENSUS:
        d[c] = rng.normal(size=n)
    d["skill"] = rng.normal(size=n)                       # signal the consensus does not hold
    d["noise"] = rng.normal(size=n)
    lin = -3 + 0.8 * d.log_top + 0.8 * d.skill
    d["y"] = (rng.random(n) < 1 / (1 + np.exp(-lin))).astype(int)
    yrs = list(range(2014, 2019))
    sig = incremental(d, "y", "skill", yrs, n=200)
    null = incremental(d, "y", "noise", yrs, n=200)
    assert sig["d_logloss"]["ci"][1] < 0, sig                  # real signal: gain with CI below 0
    assert null["d_logloss"]["ci"][1] > -1e-4, null            # noise: no significant gain
    assert sig["d_logloss"]["mde"] > 0
    d["p"] = 1 / (1 + np.exp(-lin))
    assert ece(d.y.values, d.p.values) < .02                   # the true probability is calibrated
    assert abs(crps_gauss(np.zeros(1), np.zeros(1), np.ones(1)) - (np.sqrt(2) - 1) / np.sqrt(np.pi)) < 1e-9
    try:
        guard("value", [2018, 2019])
        raise AssertionError("guard let a sealed list through")
    except PermissionError:
        pass
    guard("value", [2019], read="§test")
    print("demo ok", {"signal": sig["d_logloss"], "null": null["d_logloss"]})


if __name__ == "__main__":
    if "--demo" in sys.argv:
        demo()
