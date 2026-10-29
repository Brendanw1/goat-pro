"""§90 swing plane match (swing program piece 2, docs/swing-program.md).

    python pipeline/plane_match.py test        # self-check of the mismatch math + FE solver
    python pipeline/plane_match.py dev         # pre-registered development read (2024-25)
    python pipeline/plane_match.py holdout     # 2026 replication, read once (NOT run: dev gate failed)

Verdict (§90): FAILED on development, so nothing bakes and 2026 stays unread.

Mismatch terms (pre-registered in RESULTS-MLB.md §90):
  M1 = |AA + VAA|                               degrees; AA = -VAA is a perfect mirror
  M2 = |tan AA / cos AD + tan VAA|              inches of vertical bat-ball offset per inch of depth error
Every definition (competitive swings, VAA, squared-up, depth) comes from swing_common.
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
import swing_common as sc  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "export" / "web" / "plane"
RES = Path(__file__).parent / "results" / "plane_match.json"
GROUPS = {"FF": "FF", "SI": "SI", "FC": "FC", "SL": "SL", "ST": "SL", "SV": "SL",
          "CU": "CU", "KC": "CU", "CH": "CH", "FS": "CH"}
OUTCOMES = {"sq": "squared-up / contact", "ev": "EV (BIP)", "ss": "sweet spot 8-32 (BIP)", "xw": "xwOBA on contact (BIP)"}
B, SEED, MIN_EFFECT = 1000, 90, 0.010


def mismatch(aa, vaa, ad):
    m1 = np.abs(aa + vaa)
    cad = np.clip(np.cos(np.radians(ad)), 0.5, None)
    m2 = np.abs(np.tan(np.radians(aa)) / cad + np.tan(np.radians(vaa)))
    return m1, m2


def load(seasons) -> pd.DataFrame:
    sys.path.insert(0, str(sc.SAVANT_MART))
    import mart
    con = mart.connect()
    con.execute("SET threads TO 4")
    cols = ("pitcher", "game_date", "pitch_type", "plate_x", "plate_z", "balls", "strikes", "launch_angle",
            "attack_angle", "attack_direction", "intercept_ball_minus_batter_pos_y_inches", "des",
            "estimated_woba_using_speedangle", "vx0", "vy0", "vz0", "ax", "ay", "az", "p_throws")
    d = con.sql(sc.swing_sql(seasons, cols)).df()
    d = sc.competitive_swings(d)
    d = d.assign(depth_c=sc.depth_centered(d))
    d = d[d["description"].isin(sc.CONTACT)].copy()
    d["vaa"], d["pspeed"] = sc.vaa(d), sc.plate_speed(d)
    d["sq"] = sc.squared_up(d).astype(float)
    d["grp"] = d["pitch_type"].map(GROUPS)
    d = d.dropna(subset=["attack_angle", "attack_direction", "vaa", "pspeed", "plate_x", "plate_z", "depth_c", "grp"])
    d = d[d["balls"].between(0, 3) & d["strikes"].between(0, 2)]
    d["m1"], d["m2"] = mismatch(d["attack_angle"].values, d["vaa"].values, d["attack_direction"].values)
    bip = d["description"] == "hit_into_play"
    d["ev"] = d["launch_speed"].where(bip)
    d["ss"] = d["launch_angle"].between(8, 32).astype(float).where(bip & d["launch_angle"].notna())
    d["xw"] = pd.to_numeric(d["estimated_woba_using_speedangle"], errors="coerce").where(bip)
    d["month"] = pd.to_datetime(d["game_date"]).dt.month.clip(4, 9)
    d["hs"] = d["batter"].astype(str) + "-" + d["season"].astype(str)
    return d.reset_index(drop=True)


def design(d: pd.DataFrame, terms) -> tuple[np.ndarray, list]:
    """Controls C + the given terms (a list of 'aa', 'vaa', 'm1', 'm2'). Intercept absorbed by the FE."""
    cols, names = [], []
    def add(n, v):
        cols.append(np.asarray(v, float)); names.append(n)
    for g in ("SI", "FC", "SL", "CU", "CH"):
        add(f"g_{g}", d["grp"] == g)
    add("pspeed", d["pspeed"])
    z, x = d["plate_z"], d["plate_x"]
    add("z", z); add("z2", z ** 2); add("x", x); add("x2", x ** 2); add("xz", x * z)
    cnt = d["balls"].astype(int) * 3 + d["strikes"].astype(int)
    for c in range(1, 12):
        add(f"c{c}", cnt == c)
    add("dc", d["depth_c"]); add("dc2", d["depth_c"] ** 2)
    for t in terms:
        if t == "aa":
            add("aa", d["attack_angle"]); add("aa2", d["attack_angle"] ** 2)
        elif t == "vaa":
            add("vaa", d["vaa"]); add("vaa2", d["vaa"] ** 2)
        else:
            add(t, d[t])
    return np.column_stack(cols), names


def demean(a: np.ndarray, g: np.ndarray) -> np.ndarray:
    a = a.reshape(len(a), -1)
    n = np.bincount(g)
    means = np.stack([np.bincount(g, weights=a[:, j]) / n for j in range(a.shape[1])], 1)
    return a - means[g]


def fe_fit(d, y, terms, boot=0, rng=None, cv=False):
    """Hitter-season FE OLS. Returns coef (dict), within R2, optional clustered bootstrap of the last term
    and hitter-grouped 5-fold out-of-fold within SSE."""
    s = d[d[y].notna()]
    g = pd.factorize(s["hs"])[0]
    X, names = design(s, terms)
    X = demean(X, g)
    yv = demean(s[y].values.astype(float), g)[:, 0]
    keep = X.std(0) > 1e-9                                  # e.g. a pitch group absent from a subgroup sample
    X, names = X[:, keep], [n for n, k in zip(names, keep) if k]
    beta = np.linalg.lstsq(X, yv, rcond=None)[0]
    r2 = 1 - ((yv - X @ beta) ** 2).sum() / (yv ** 2).sum()
    out = {"coef": dict(zip(names, beta)), "r2": r2, "n": len(s), "hitters": int(s["batter"].nunique()), "names": names}
    h = pd.factorize(s["batter"])[0]
    if boot:
        k = X.shape[1]
        xtx = np.zeros((h.max() + 1, k, k)); xty = np.zeros((h.max() + 1, k))
        o = np.argsort(h, kind="stable")
        for j, idx in enumerate(np.split(o, np.cumsum(np.bincount(h))[:-1])):
            xtx[j] = X[idx].T @ X[idx]; xty[j] = X[idx].T @ yv[idx]
        draws = []
        for _ in range(boot):
            w = rng.multinomial(len(xtx), np.full(len(xtx), 1 / len(xtx))).astype(float)
            draws.append(np.linalg.lstsq(np.einsum("h,hij->ij", w, xtx), w @ xty, rcond=None)[0][-1])  # lstsq: a draw can drop the only hitters with a rare count
        out["boot"] = np.array(draws)
    if cv:
        fold = (s["batter"].values * 2654435761 % 2 ** 32) % 5
        sse = 0.0
        for f in range(5):
            tr, te = fold != f, fold == f
            b = np.linalg.lstsq(X[tr], yv[tr], rcond=None)[0]
            sse += ((yv[te] - X[te] @ b) ** 2).sum()
        out["oof_r2"] = 1 - sse / (yv ** 2).sum()
    return out


def gate_read(d, label, min_effect, rng):
    """The pre-registered models on one sample. Returns a JSON-able dict."""
    res = {"label": label, "n_contact": len(d), "hitters": int(d["batter"].nunique()),
           "iqr": {m: float(d[m].quantile(.75) - d[m].quantile(.25)) for m in ("m1", "m2")},
           "mean": {c: float(d[c].mean()) for c in ("attack_angle", "vaa", "m1", "m2", "sq")}, "outcomes": {}}
    for y in OUTCOMES:
        row = {}
        base = {nm: fe_fit(d, y, t, cv=(y == "sq")) for nm, t in
                (("B_AA", ["aa"]), ("B_VAA", ["vaa"]), ("B_both", ["aa", "vaa"]))}
        row["baseline_r2"] = {k: round(v["r2"], 5) for k, v in base.items()}
        if y == "sq":
            row["baseline_oof_r2"] = {k: round(v["oof_r2"], 5) for k, v in base.items()}
        for m in ("m1", "m2"):
            f = fe_fit(d, y, ["aa", "vaa", m], boot=B if y == "sq" else 300, rng=rng, cv=(y == "sq"))
            bt, iqr = f["coef"][m], res["iqr"][m]
            lo, hi = np.percentile(f["boot"], [2.5, 97.5])
            r = {"beta": bt, "ci": [lo, hi], "effect_iqr": bt * iqr, "effect_ci": [lo * iqr, hi * iqr],
                 "r2_gain": f["r2"] - base["B_both"]["r2"], "n": f["n"]}
            if y == "sq":
                r["oof_r2_gain"] = f["oof_r2"] - base["B_both"]["oof_r2"]
                r["pass"] = bool(hi < 0 and abs(bt * iqr) >= min_effect and r["oof_r2_gain"] > 0)
            row[m] = r
        res["outcomes"][y] = row
    return res


def observe(d, m, rng):
    """Reported, not gated: beta(M) by pitch group, plate_z tercile and month; FF flat-VAA x steep-AA cells."""
    o = {}
    def b(s):
        f = fe_fit(s, "sq", ["aa", "vaa", m], boot=200, rng=rng)
        iqr = d[m].quantile(.75) - d[m].quantile(.25)
        lo, hi = np.percentile(f["boot"], [2.5, 97.5]) * iqr
        return {"effect_iqr": round(f["coef"][m] * iqr, 4), "ci": [round(lo, 4), round(hi, 4)], "n": f["n"]}
    o["by_group"] = {g: b(d[d["grp"] == g]) for g in ("FF", "SI", "FC", "SL", "CU", "CH")}
    zt = pd.qcut(d["plate_z"], 3, labels=["low", "mid", "high"])
    o["by_height"] = {str(t): b(d[zt == t]) for t in ("low", "mid", "high")}
    o["by_month"] = {int(mo): b(d[d["month"] == mo]) for mo in range(4, 10)}
    # FF cells: residual of squared-up from the additive model (B_both), by VAA tercile x AA tercile
    ff = d[d["grp"] == "FF"].copy()
    g = pd.factorize(ff["hs"])[0]
    X, _ = design(ff, ["aa", "vaa"]); X = demean(X, g)
    yv = demean(ff["sq"].values, g)[:, 0]
    ff["res"] = yv - X @ np.linalg.lstsq(X, yv, rcond=None)[0]
    ff["vt"] = pd.qcut(ff["vaa"], 3, labels=["steep", "mid", "flat"])
    ff["at"] = pd.qcut(ff["attack_angle"], 3, labels=["flat", "mid", "steep"])
    cells = ff.groupby(["vt", "at"], observed=True).agg(res=("res", "mean"), sq=("sq", "mean"), n=("sq", "size"))
    o["ff_cells"] = [{"vaa": v, "aa": a, "resid_pp": round(100 * r.res, 2), "sq": round(r.sq, 4), "n": int(r.n)}
                     for (v, a), r in cells.iterrows()]
    o["ff_tercile_edges"] = {"vaa": ff["vaa"].quantile([1 / 3, 2 / 3]).round(2).tolist(),
                             "aa": ff["attack_angle"].quantile([1 / 3, 2 / 3]).round(1).tolist()}
    return o


def trait(d, m, rng):
    """Split-half reliability of each hitter-season's own sensitivity to mismatch (>= 300 contact swings)."""
    g = pd.factorize(d["hs"])[0]
    X, names = design(d, ["aa", "vaa"]); X = demean(X, g)
    mv = demean(d[m].values, g)[:, 0]; yv = demean(d["sq"].values, g)[:, 0]
    bm = np.linalg.lstsq(X, mv, rcond=None)[0]; by = np.linalg.lstsq(X, yv, rcond=None)[0]
    t = pd.DataFrame({"hs": d["hs"], "rm": mv - X @ bm, "ry": yv - X @ by, "half": rng.integers(0, 2, len(d))})
    t = t[t.groupby("hs")["rm"].transform("size") >= 300]
    sl = t.groupby(["hs", "half"]).apply(lambda s: (s.rm * s.ry).sum() / (s.rm ** 2).sum()).unstack()
    r = sl[0].corr(sl[1])
    return {"hitter_seasons": len(sl), "split_half_r": round(r, 3), "spearman_brown": round(2 * r / (1 + r), 3)}


def _round(o):
    if isinstance(o, dict):
        return {k: _round(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_round(v) for v in o]
    if isinstance(o, (float, np.floating)):
        return round(float(o), 6)
    return o


def test():
    m1, m2 = mismatch(np.array([5.0, 10.0, 0.0]), np.array([-5.0, -5.0, -5.0]), np.array([0.0, 0.0, 60.0]))
    assert np.allclose(m1, [0, 5, 5]) and abs(m2[0]) < 1e-12 and m2[1] > m2[0]
    assert abs(m2[2] - np.tan(np.radians(5))) < 1e-9                     # AA 0: heading irrelevant
    rng = np.random.default_rng(0)
    n = 20000
    d = pd.DataFrame({"batter": rng.integers(0, 50, n), "season": 2025, "grp": "FF", "pspeed": 90.0,
                      "plate_z": rng.normal(2.5, .5, n), "plate_x": rng.normal(0, .5, n), "balls": 0, "strikes": 0,
                      "depth_c": rng.normal(0, 9, n), "attack_angle": rng.normal(10, 7, n), "vaa": rng.normal(-6, 2, n)})
    d["hs"] = d["batter"].astype(str)
    d["m1"], _ = mismatch(d["attack_angle"], d["vaa"], 0)
    d["sq"] = 0.3 + 0.002 * d["batter"] - 0.01 * d["m1"] + rng.normal(0, .3, n)
    f = fe_fit(d, "sq", ["aa", "vaa", "m1"], boot=50, rng=rng, cv=True)
    assert abs(f["coef"]["m1"] + 0.01) < 0.003 and (f["boot"] < 0).all(), f["coef"]["m1"]
    print("plane_match: self-check passes")


def research(which):
    rng = np.random.default_rng(SEED)
    res = json.loads(RES.read_text()) if RES.exists() else {}
    if which == "dev":
        d = load((2024, 2025))
        r = gate_read(d, "development 2024-25", MIN_EFFECT, rng)
        best = max(("m1", "m2"), key=lambda m: r["outcomes"]["sq"][m]["oof_r2_gain"])
        r["best"] = best
        r["observe"] = observe(d, best, rng)
        if any(r["outcomes"]["sq"][m]["pass"] for m in ("m1", "m2")):
            r["trait"] = {m: trait(d, m, rng) for m in ("m1", "m2")}
        res["dev"] = _round(r)
    else:
        assert "holdout" not in res, "2026 holdout already read once (§90)"
        d = load((2026,))
        res["holdout"] = _round(gate_read(d, "holdout 2026", MIN_EFFECT / 2, rng))
    RES.parent.mkdir(exist_ok=True)
    RES.write_text(json.dumps(res, indent=1))
    print(json.dumps(res.get(which if which == "dev" else "holdout"), indent=1)[:6000])


if __name__ == "__main__":
    {"test": test, "dev": lambda: research("dev"), "holdout": lambda: research("holdout")}[sys.argv[1]]()
