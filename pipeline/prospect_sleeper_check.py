"""prospect_sleeper_check.py — sleeper watch pre-checks on SPENT lists 2015-18 (post-hoc, no new label read):
(1) dumb baselines inside the sleeper pool, (2) power: minimum detectable effect for 1 class vs a 4-class pool."""
import sys, json
import numpy as np, pandas as pd
sys.path.insert(0, "pipeline")
import prospect_backtest as pb
from sklearn.linear_model import LogisticRegression

S = pb.load()
RES = pb.RES
dev = pd.read_parquet(RES / "prospect_104_dev_preds.parquet")
dev = pb.merge_npy(dev[dev.task == "val"], "val", [2015, 2016, 2017], tag="104")
rd = pd.read_parquet(RES / "prospect_104_read_preds.parquet")[[c for c in dev.columns if c != "task"]]
v = pd.concat([dev, rd], ignore_index=True)

F = ["lvl", "age_rel", "log_pick0", "yrs_pro"]
RATE = {False: ["hz_k_2y", "hz_bb_2y", "hz_iso_2y"], True: ["pz_k_2y", "pz_bb_2y", "pz_hr_2y"]}
v = v.merge(S[["id", "as_of"] + F + RATE[False] + RATE[True]].drop_duplicates(["id", "as_of"]), on=["id", "as_of"], how="left")

# no-training baselines: younger for level is better; then level + youth, equal weights on z-scores
v["AGE"] = -v.age_rel
z = lambda s: (s - s.mean()) / s.std()
v["LVLAGE"] = z(v.lvl.astype(float)) - z(v.age_rel)

# trained baselines, same split as §104 (tyear <= Y-4, no player removal), target = sleeper hit (y_val >= 1)
def fit_lr(cols_fn, name):
    out = pd.Series(np.nan, index=v.index)
    for Y in range(2015, 2019):
        tr, _ = pb.value_split(S, Y)
        for pit in (False, True):
            cols = cols_fn(pit)
            t = tr[tr.pitcher == pit].dropna(subset=["age_rel", "lvl"])
            med = t[cols].astype(float).median().fillna(0)
            X = t[cols].astype(float).fillna(med); mu, sd = X.mean(), X.std().replace(0, 1).fillna(1)
            m = LogisticRegression(max_iter=2000).fit((X - mu) / sd, t.y_val >= 1)
            te = v[(v.tyear == Y) & (v.pitcher == pit)]
            Xt = te[cols].astype(float).fillna(med)
            out[te.index] = m.predict_proba((Xt - mu) / sd)[:, 1]
    v[name] = out
fit_lr(lambda p: F, "LR_age")
fit_lr(lambda p: F + RATE[p], "LR_rates")

ARMS = ["B1_ev", "AGE", "LVLAGE", "LR_age", "LR_rates", "v0u_ev", "LGB_ev", "NPY_ev"]
pool = pb.sleeper_pool(v)
print("pool", len(pool), "of", len(v), "hits", int((pool.y_val >= 1).sum()), "rate", round((pool.y_val >= 1).mean(), 4))

def se(d, fn, n=400):
    rng = np.random.default_rng(7); ids = d.id.unique(); pos = d.groupby("id").indices; vals = []
    for _ in range(n):
        idx = np.concatenate([pos[i] for i in rng.choice(ids, len(ids))]); vals.append(fn(d.iloc[idx]))
    return float(np.nanstd(vals)), [float(x) for x in np.nanpercentile(vals, [2.5, 97.5])]

res = {"table": {}, "power": {}}
for Y in [2015, 2016, 2017, 2018, "all"]:
    d = v if Y == "all" else v[v.tyear == Y]
    res["table"][str(Y)] = {a: {"p50": round(pb._pr(d, a), 3), "ndcg": round(pb._nd(d, a), 3)} for a in ARMS}
for a in ["v0u_ev", "NPY_ev"]:
    for ref in ["B1_ev", "LR_age", "LR_rates"]:
        r = {}
        for label, d in [("one class (2018)", v[v.tyear == 2018]), ("four classes (2015-18)", v)]:
            s1, ci1 = se(d, lambda x: pb._pr(x, a) - pb._pr(x, ref))
            s2, ci2 = se(d, lambda x: pb._nd(x, a) - pb._nd(x, ref))
            r[label] = {"dp50": round(pb._pr(d, a) - pb._pr(d, ref), 3), "dp50_ci": [round(x, 3) for x in ci1],
                        "mde_p50": round(2.8 * s1, 3),
                        "dndcg": round(pb._nd(d, a) - pb._nd(d, ref), 3), "dndcg_ci": [round(x, 3) for x in ci2],
                        "mde_ndcg": round(2.8 * s2, 3)}
        res["power"][f"{a} vs {ref}"] = r
out = RES / "prospect_104_sleeper_check.json"
json.dump(res, open(out, "w"), indent=1)
print(json.dumps(res, indent=1))
