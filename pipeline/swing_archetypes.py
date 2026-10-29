"""RESULTS-MLB §94: swing archetypes, comps and aging by type (swing program piece 6).

    python swing_archetypes.py --gate   # §94 gates -> results/archetypes_94.json
    python swing_archetypes.py          # bake data/export/web/archetypes/archetypes.json (needs the gate file)
    python swing_archetypes.py --demo   # synthetic self-check (planted clusters are recovered and stable)

Hitter-season means of six swing traits over competitive swings, z-scored on 2024-25, clustered (GMM by BIC,
Ward, k-means). Gate (a) stability, claim (b) next-season xwOBAcon beyond bat speed. Comps = nearest neighbours.
"""
import argparse
import json
import sys
import zlib
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.cluster import AgglomerativeClustering, KMeans
from sklearn.decomposition import PCA
from sklearn.metrics import adjusted_rand_score as ari
from sklearn.mixture import GaussianMixture

PIPE = Path(__file__).resolve().parent
ROOT = PIPE.parent
sys.path.insert(0, str(PIPE))
from paths import MART_DIR  # noqa: E402
import swing_common as sc  # noqa: E402

OUT = ROOT / "data" / "export" / "web" / "archetypes"
RES = PIPE / "results"
TRAITS = ["bs", "sl", "aa", "pull", "tilt", "depth"]
TLABEL = {"bs": "bat speed", "sl": "swing length", "aa": "attack angle", "pull": "attack direction (pull +)",
          "tilt": "swing path tilt", "depth": "contact depth (out front +)"}
WORDS = {"bs": ("fast bat", "slower bat"), "sl": ("long", "short"), "aa": ("steep (uphill)", "flat"),
         "pull": ("pull-side path", "opposite-field path"), "tilt": ("vertical tilt", "flat tilt"),
         "depth": ("meets it out front", "lets it travel deep")}
MIN_SW, MIN_CT, MIN_BIP1 = 300, 150, 75
FIT = (2024, 2025)
SEED = 94


def units(seasons=(2024, 2025, 2026)) -> pd.DataFrame:
    sys.path.insert(0, str(MART_DIR))
    import mart
    con = mart.connect()
    con.execute("SET threads TO 4")
    cols = ("swing_length", "attack_angle", "attack_direction", "swing_path_tilt", "age_bat",
            "intercept_ball_minus_batter_pos_y_inches", "estimated_woba_using_speedangle")
    d = con.sql(sc.swing_sql(seasons, cols)).df()
    names = dict(con.sql("SELECT CAST(key_mlbam AS BIGINT), name_first || ' ' || name_last FROM register "
                         "WHERE key_mlbam IS NOT NULL").fetchall())
    con.close()
    c = sc.competitive_swings(d).copy()
    c["pull"] = sc.attack_dir_pull(c)
    ct = c["description"].isin(sc.CONTACT)
    c["depth"] = c["intercept_ball_minus_batter_pos_y_inches"].where(ct)
    c["ct"] = ct
    c["xw"] = c["estimated_woba_using_speedangle"].where(c["description"] == "hit_into_play")
    u = (c.groupby(["batter", "season"])
          .agg(n=("bat_speed", "size"), nct=("ct", "sum"), bs=("bat_speed", "mean"), sl=("swing_length", "mean"),
               aa=("attack_angle", "mean"), pull=("pull", "mean"), tilt=("swing_path_tilt", "mean"),
               depth=("depth", "mean"), xw=("xw", "mean"), bip=("xw", "count"), age=("age_bat", "max"))
          .reset_index())
    u = u[(u.n >= MIN_SW) & (u.nct >= MIN_CT)].dropna(subset=TRAITS).reset_index(drop=True)
    u["name"] = u["batter"].map(names)
    return u


def fit(method: str, Z: np.ndarray, k: int, seed: int = SEED):
    """Return (labels, centroids, model)."""
    if method == "gmm":
        m = GaussianMixture(k, covariance_type="full", n_init=5, random_state=seed).fit(Z)
        lab = m.predict(Z)
    elif method == "kmeans":
        m = KMeans(k, n_init=20, random_state=seed).fit(Z)
        lab = m.labels_
    else:
        m = None
        lab = AgglomerativeClustering(k, linkage="ward").fit_predict(Z)
    cen = np.vstack([Z[lab == j].mean(0) if (lab == j).any() else np.full(Z.shape[1], np.inf) for j in range(k)])
    return lab, cen, m


def assign(method, model, cen, Z):
    if method == "gmm":
        return model.predict(Z)
    if method == "kmeans":
        return model.predict(Z)
    return np.argmin(((Z[:, None, :] - cen[None]) ** 2).sum(-1), 1)


def stability(method, Z, hitters, k, B=200, seed=SEED):
    ref, _, _ = fit(method, Z, k, seed)
    rng = np.random.default_rng(seed)
    ids = np.unique(hitters)
    idx = {h: np.flatnonzero(hitters == h) for h in ids}
    out = []
    for b in range(B):
        ix = np.concatenate([idx[h] for h in rng.choice(ids, len(ids))])
        _, cen, m = fit(method, Z[ix], k, seed + b + 1)
        out.append(ari(ref, assign(method, m, cen, Z)))
    return ref, np.array(out)


def yoy(u: pd.DataFrame, lab: np.ndarray):
    t = u.assign(lab=lab)
    a = t[t.season == 2024].set_index("batter")["lab"]
    b = t[t.season == 2025].set_index("batter")["lab"]
    j = pd.concat([a, b], axis=1, join="inner")
    j.columns = ["a", "b"]
    p = np.bincount(lab, minlength=lab.max() + 1) / len(lab)
    return {"n": len(j), "ari": round(ari(j.a, j.b), 3), "same": round((j.a == j.b).mean(), 3), "chance": round(float((p ** 2).sum()), 3)}


def wls_oof(X, y, w, fold):
    pred = np.empty(len(y))
    for f in np.unique(fold):
        tr, te = fold != f, fold == f
        A = np.c_[np.ones(tr.sum()), X[tr]] * np.sqrt(w[tr])[:, None]
        beta = np.linalg.lstsq(A, y[tr] * np.sqrt(w[tr]), rcond=None)[0]
        pred[te] = np.c_[np.ones(te.sum()), X[te]] @ beta
    return pred


def wr2(y, p, w):
    mu = np.average(y, weights=w)
    return 1 - np.sum(w * (y - p) ** 2) / np.sum(w * (y - mu) ** 2)


def delta_r2(df, base_cols, add_cols, rng, B=2000):
    y, w = df["xw1"].to_numpy(), df["bip1"].to_numpy(float)
    fold = df["batter"].map(lambda b: zlib.crc32(str(int(b)).encode()) % 5).to_numpy()
    p0 = wls_oof(df[base_cols].to_numpy(float), y, w, fold)
    p1 = wls_oof(df[base_cols + add_cols].to_numpy(float), y, w, fold)
    est = wr2(y, p1, w) - wr2(y, p0, w)
    grp = df.groupby("batter").indices
    ids = np.array(list(grp))
    bs = []
    for _ in range(B):
        ix = np.concatenate([grp[i] for i in rng.choice(ids, len(ids))])
        bs.append(wr2(y[ix], p1[ix], w[ix]) - wr2(y[ix], p0[ix], w[ix]))
    lo, hi = np.percentile(bs, [2.5, 97.5])
    return {"n": len(df), "hitters": len(ids), "base_wr2": round(wr2(y, p0, w), 4), "d_wr2": round(est, 4),
            "ci": [round(lo, 4), round(hi, 4)], "pass": bool(est > 0 and lo > 0)}


def frozen(u):
    f = u[u.season.isin(FIT)]
    mu, sd = f[TRAITS].mean(), f[TRAITS].std()
    return mu, sd


def label_words(z: np.ndarray) -> str:
    order = np.argsort(-np.abs(z))
    w = [WORDS[TRAITS[i]][0 if z[i] > 0 else 1] for i in order[:3] if abs(z[i]) >= 0.4]
    return ", ".join(w) if w else "middle of the league on every trait"


def gate():
    u = units()
    mu, sd = frozen(u)
    f = u[u.season.isin(FIT)].reset_index(drop=True)
    Z = ((f[TRAITS] - mu) / sd).to_numpy()
    bic = {k: GaussianMixture(k, covariance_type="full", n_init=5, random_state=SEED).fit(Z).bic(Z) for k in range(2, 11)}
    kstar = min(bic, key=bic.get)
    print(f"{len(f)} hitter-seasons 2024-25 ({f.batter.nunique()} hitters); BIC k* = {kstar}")
    res = {"units_fit": len(f), "hitters_fit": int(f.batter.nunique()), "bic": {k: round(v, 1) for k, v in bic.items()},
           "k_star": kstar, "trait_corr": f[TRAITS].corr().round(2).to_dict(), "methods": {}, "by_k": {}}
    h = f["batter"].to_numpy()
    for m in ("gmm", "ward", "kmeans"):
        ref, b = stability(m, Z, h, kstar)
        y = yoy(f, ref)
        ok = bool(np.median(b) >= 0.60 and y["ari"] >= 0.40 and y["same"] >= 0.60)
        res["methods"][m] = {"boot_median_ari": round(float(np.median(b)), 3), "boot_p05": round(float(np.percentile(b, 5)), 3),
                             "yoy": y, "sizes": np.bincount(ref).tolist(), "pass": ok}
        print(m, res["methods"][m])
    for k in range(3, 9):
        res["by_k"][k] = {}
        for m in ("gmm", "ward", "kmeans"):
            ref, b = stability(m, Z, h, k, B=50)
            res["by_k"][k][m] = {"boot_median_ari": round(float(np.median(b)), 3), **{f"yoy_{a}": v for a, v in yoy(f, ref).items()}}
        print(k, res["by_k"][k])
    passing = [m for m, v in res["methods"].items() if v["pass"]]
    res["gate_a_pass"] = bool(passing)
    res["method"] = max(passing, key=lambda m: res["methods"][m]["boot_median_ari"]) if passing else \
        max(res["methods"], key=lambda m: res["methods"][m]["boot_median_ari"])

    # claim (b): next-season xwOBAcon by archetype beyond bat speed (labels from the frozen fit, chosen method)
    m = res["method"]
    _, cen, model = fit(m, Z, kstar)
    Zall = ((u[TRAITS] - mu) / sd).to_numpy()
    u["lab"] = assign(m, model, cen, Zall)
    nxt = u[["batter", "season", "xw", "bip"]].assign(season=u.season - 1).rename(columns={"xw": "xw1", "bip": "bip1"})
    pr = u[u.season.isin(FIT)].merge(nxt, on=["batter", "season"])
    pr = pr[pr.bip1 >= MIN_BIP1].reset_index(drop=True)
    dm = pd.get_dummies(pr["lab"], prefix="a", drop_first=True, dtype=float)
    pr = pd.concat([pr, dm], axis=1)
    pr["p25"] = (pr.season == 2025).astype(float)
    rng = np.random.default_rng(SEED)
    res["claim_b"] = delta_r2(pr, ["bs", "p25"], list(dm.columns), rng)
    res["claim_b_reported"] = {
        "beyond_bs_and_last_xwobacon": delta_r2(pr, ["bs", "xw", "p25"], list(dm.columns), rng),
        "six_traits_beyond_bs": delta_r2(pr, ["bs", "p25"], [t for t in TRAITS if t != "bs"], rng),
        "archetype_beyond_six_traits": delta_r2(pr, TRAITS + ["p25"], list(dm.columns), rng),
        "by_pair": {int(s): delta_r2(pr[pr.season == s], ["bs"], list(dm.columns), rng, B=500) for s in FIT}}
    print("claim b", res["claim_b"], res["claim_b_reported"])
    RES.mkdir(exist_ok=True)
    (RES / "archetypes_94.json").write_text(json.dumps(res, indent=1, default=float))


def bake():
    g = json.loads((RES / "archetypes_94.json").read_text())
    u = units()
    mu, sd = frozen(u)
    f = u[u.season.isin(FIT)].reset_index(drop=True)
    Z = ((f[TRAITS] - mu) / sd).to_numpy()
    m, k = g["method"], g["k_star"]
    _, cen, model = fit(m, Z, k)
    Zall = ((u[TRAITS] - mu) / sd).to_numpy()
    u["lab"] = assign(m, model, cen, Zall)
    if m == "gmm":
        u["prob"] = model.predict_proba(Zall).max(1)
    pca = PCA(2, random_state=SEED).fit(Z)
    xy = pca.transform(Zall)
    u["px"], u["py"] = xy[:, 0], xy[:, 1]
    # order archetypes by mean bat speed (fastest first) so ids read naturally
    order = np.argsort(-np.array([u.loc[u.lab == j, "bs"].mean() for j in range(k)]))
    remap = {int(o): i for i, o in enumerate(order)}
    u["lab"] = u["lab"].map(remap)
    cz = np.vstack([Zall[u.lab == j].mean(0) for j in range(k)])

    # outcomes and aging per archetype (descriptive)
    nxt = u[["batter", "season", "xw", "bip", "bs", "sl"]].assign(season=u.season - 1)
    nxt.columns = ["batter", "season", "xw1", "bip1", "bs1", "sl1"]
    pr = u.merge(nxt, on=["batter", "season"])
    pr["band"] = pd.cut(pr["age"], [0, 26, 30, 99], labels=["≤26", "27–30", "31+"])
    rng = np.random.default_rng(SEED)

    def ci(x):
        x = x.dropna().to_numpy()
        if len(x) < 20:
            return None
        bs_ = [rng.choice(x, len(x)).mean() for _ in range(500)]
        return {"n": len(x), "mean": round(x.mean(), 2), "ci": [round(float(np.percentile(bs_, q)), 2) for q in (2.5, 97.5)]}

    arche = []
    for j in range(k):
        s = u[u.lab == j]
        p = pr[pr.lab == j]
        p1 = p[p.bip1 >= MIN_BIP1]
        arche.append({
            "id": j, "label": label_words(cz[j]), "n": len(s), "hitters": int(s.batter.nunique()),
            "z": {t: round(float(cz[j][i]), 2) for i, t in enumerate(TRAITS)},
            "mean": {t: round(float(s[t].mean()), 2) for t in TRAITS},
            "xwobacon": round(float(np.average(s.xw, weights=s.bip)), 3),
            "nextXwobacon": round(float(np.average(p1.xw1, weights=p1.bip1)), 3) if len(p1) else None,
            "nPairs": len(p1),
            "examples": s.sort_values("n", ascending=False).head(4)[["batter", "season", "name"]]
                         .assign(batter=lambda x: x.batter.astype(str)).to_dict("records"),
            "aging": {str(b): {"bs": ci(q.bs1 - q.bs), "sl": ci(q.sl1 - q.sl)} for b, q in p.groupby("band", observed=False)},
        })
    # comps: nearest 5 in z-space, other hitters only
    D = ((Zall[:, None, :] - Zall[None]) ** 2).sum(-1) ** 0.5
    same = u.batter.to_numpy()[:, None] == u.batter.to_numpy()[None]
    D[same] = np.inf
    rows = {}
    for i, r in u.iterrows():
        nn = np.argsort(D[i])[:5]
        rows[f"{int(r.batter)}-{int(r.season)}"] = {
            "a": int(r.lab), "p": round(float(r.prob), 2) if "prob" in u else None,
            "z": [round(float(v), 2) for v in Zall[i]],
            "comps": [{"id": str(int(u.batter[q])), "season": int(u.season[q]), "name": u.name[q], "d": round(float(D[i, q]), 2)} for q in nn]}
    pts = [[round(float(r.px), 2), round(float(r.py), 2), int(r.lab), int(r.season), str(int(r.batter)), r["name"]] for _, r in u.iterrows()]
    meta = {"section": "§94", "method": m, "k": k, "gateA": g["gate_a_pass"], "claimB": g["claim_b"]["pass"],
            "stability": g["methods"][m], "methods": g["methods"], "claimBRes": g["claim_b"],
            "claimBRep": g["claim_b_reported"], "traits": TRAITS, "traitLabel": TLABEL,
            "pca": {"var": [round(float(v), 3) for v in pca.explained_variance_ratio_],
                    "load": [[round(float(v), 2) for v in comp] for comp in pca.components_]},
            "leagueAging": {str(b): {"bs": round(float((q.bs1 - q.bs).mean()), 2), "sl": round(float((q.sl1 - q.sl).mean()), 3),
                                     "n": len(q)} for b, q in pr.groupby("band", observed=False)},
            "floors": {"swings": MIN_SW, "contact": MIN_CT}, "seasons": sorted(int(s) for s in u.season.unique())}
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "archetypes.json").write_text(json.dumps({"meta": meta, "archetypes": arche, "points": pts, "rows": rows},
                                                    separators=(",", ":"), default=float))
    print(f"archetypes: {len(rows)} hitter-seasons, k={k} ({m})")


def demo():
    rng = np.random.default_rng(0)
    c = rng.normal(0, 3, (4, 6))
    Z = np.vstack([c[j] + rng.normal(0, 0.5, (60, 6)) for j in range(4)])
    h = np.arange(len(Z))
    for m in ("gmm", "ward", "kmeans"):
        _, b = stability(m, Z, h, 4, B=10)
        assert np.median(b) > 0.9, (m, b)
    assert label_words(np.array([1.2, 0.8, 0, -0.6, 0, 0])) == "fast bat, long, opposite-field path"
    print("demo ok")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--gate", action="store_true")
    ap.add_argument("--demo", action="store_true")
    a = ap.parse_args()
    demo() if a.demo else gate() if a.gate else bake()
