"""Arsenal / tunneling study: does how a pitcher's pitches play off each other add to Stuff+ v3?

    python arsenal.py

Pitcher-season features from shape + release only (location-free; pre-registered in COLLABORATION.md):
  tunnel_sep    inches apart at the decision point (0.167 s before the plate) when every secondary is
                re-aimed at the primary FB's mean plate spot with release held fixed, vs the FB
  tunnel_ratio  movement separation (IVB/HB) / max(tunnel_sep, 1)
  release_sep   inches between mean release points, vs the FB
  velo_gap      FB velo minus secondary velo
  n_types       types with >= 5% usage;  entropy  usage entropy
  diversity     Rao quadratic entropy over standardized (velo, ivb, hb) type means
Secondary features are usage-weighted over secondaries. Trajectories are back-propagated from the
plate with Statcast's constant-acceleration fit (v and a at y = 50 ft).

Test: ridge (alpha 1, standardized) on v3 grade [+ features], fitted on same-season K% / RV/100 with
pitcher folds crc32 % 4, scored out of fold, compared on NEXT-season outcomes by paired bootstrap.
"""

import json
import sys
import zlib
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from paired_bootstrap import compare, outcomes  # noqa: E402
from train_mlb import load_features  # noqa: E402

DECISION_S = 0.167
PLATE_Y = 17 / 12
FEATS = ["tunnel_sep", "tunnel_ratio", "release_sep", "velo_gap", "n_types", "entropy", "diversity"]
RES = HERE / "results"


def flight(v, a, y_end):
    """Time from y = 50 ft to y_end (negative for release, which is behind y = 50)."""
    return (-v - np.sqrt(v ** 2 - 2 * a * (50 - y_end))) / a


def trajectories(df):
    T = flight(df["vy0"], df["ay"], PLATE_Y)
    tr = flight(df["vy0"], df["ay"], 60.5 - df["ext"])
    td = T - DECISION_S
    out = {"T": T, "tr": tr, "td": td}
    for ax_, v, a in (("x", "vx0", "ax"), ("z", "vz0", "az")):
        plate = df["plate_" + ax_]
        for name, t in (("r", tr), ("d", td)):
            out[f"{ax_}{name}"] = plate - df[v] * (T - t) - 0.5 * df[a] * (T ** 2 - t ** 2)
    return df.assign(**out)


def type_table(df):
    g = df.groupby(["pitcher", "season", "pitch_type", "pclass"]).agg(
        n=("velo", "size"), velo=("velo", "mean"), ivb=("ivb", "mean"), hb=("hb", "mean"),
        rel_s=("rel_s", "mean"), rel_h=("rel_h", "mean"), px=("plate_x", "mean"),
        pz=("plate_z", "mean"), xd=("xd", "mean"), zd=("zd", "mean"), T=("T", "mean"),
        tr=("tr", "mean"), td=("td", "mean")).reset_index()
    g["use"] = g["n"] / g.groupby(["pitcher", "season"])["n"].transform("sum")
    return g[(g["use"] >= 0.05) & (g["n"] >= 20)]


def pitcher_features(g, sd):
    rows = []
    for (p, s), t in g.groupby(["pitcher", "season"]):
        t = t.sort_values("n", ascending=False)
        fb = t[t["pclass"] == "FB"]
        f = (fb if len(fb) else t).iloc[0]
        u = t["use"].to_numpy() / t["use"].sum()
        z = (t[["velo", "ivb", "hb"]] / sd).to_numpy()
        d = np.sqrt(((z[:, None] - z[None]) ** 2).sum(-1))
        row = {"mlbam": p, "season": s, "n_types": len(t), "entropy": -(u * np.log(u)).sum(),
               "diversity": float(u @ d @ u)}
        sec = t[t["pitch_type"] != f["pitch_type"]]
        if len(sec):
            w = sec["use"] / sec["use"].sum()
            k = (sec["td"] - sec["tr"]) / (sec["T"] - sec["tr"])  # re-aim at FB's plate spot
            dx = sec["xd"] + (f["px"] - sec["px"]) * k - f["xd"]
            dz = sec["zd"] + (f["pz"] - sec["pz"]) * k - f["zd"]
            tun = 12 * np.hypot(dx, dz)
            mov = np.hypot(sec["ivb"] - f["ivb"], sec["hb"] - f["hb"])
            row |= {"tunnel_sep": (w * tun).sum(), "tunnel_ratio": (w * mov / tun.clip(lower=1)).sum(),
                    "release_sep": (w * 12 * np.hypot(sec["rel_s"] - f["rel_s"],
                                                      sec["rel_h"] - f["rel_h"])).sum(),
                    "velo_gap": (w * (f["velo"] - sec["velo"])).sum()}
        rows.append(row)
    return pd.DataFrame(rows)


def ridge_oof(X, y, folds, alpha=1.0):
    pred = np.empty(len(y))
    for k in range(4):
        tr, te = folds != k, folds == k
        mu, sd = X[tr].mean(0), X[tr].std(0) + 1e-9
        A = (X[tr] - mu) / sd
        beta = np.linalg.solve(A.T @ A + alpha * np.eye(A.shape[1]), A.T @ (y[tr] - y[tr].mean()))
        pred[te] = (X[te] - mu) / sd @ beta
    return pred


def main():
    df = load_features()
    df = trajectories(df[["pitcher", "season", "game_pk", "pitch_type", "pclass", "velo", "ivb", "hb",
                          "ext", "rel_s", "rel_h", "plate_x", "plate_z",
                          "vx0", "vy0", "vz0", "ax", "ay", "az"]].dropna())
    err = {c: float((df[c + "r"] - df[r]).abs().median()) for c, r in (("x", "rel_s"), ("z", "rel_h"))}
    print("back-propagated release vs Statcast, median abs ft", err)
    assert max(err.values()) < 0.5, err  # trajectory math check
    g = type_table(df)
    feats = pitcher_features(g, g[["velo", "ivb", "hb"]].std())
    feats[FEATS] = feats[FEATS].fillna(feats[FEATS].median())  # one-pitch arms: no secondary
    role = (df.groupby(["pitcher", "season"]).size() / df.groupby(["pitcher", "season"])["game_pk"].nunique())
    feats = feats.merge(role.rename("ppg").reset_index().rename(columns={"pitcher": "mlbam"}))

    oc = outcomes()
    v3 = pd.read_csv(RES / "crossfit_v2_wps_dml_grades.csv")
    d = v3.merge(feats, on=["mlbam", "season"]).merge(oc, on=["mlbam", "season"])
    folds = d["mlbam"].map(lambda p: zlib.crc32(str(p).encode()) % 4).to_numpy()

    yoy = {}
    for f in FEATS + ["ppg"]:
        w = d.pivot_table(index="mlbam", columns="season", values=f)
        yoy[f] = round(float(np.nanmean([w[s].corr(w[s + 1]) for s in (2023, 2024, 2025)])), 3)
    print("feature YoY", yoy)

    result = {"yoy": yoy, "release_check_ft": err, "n": len(d)}
    for tgt in ("k", "rv100"):
        for tag, extra in (("", []), ("_role", ["ppg"])):
            for name, cols in (("base", ["grade"] + extra), ("full", ["grade"] + extra + FEATS)):
                d["pred"] = ridge_oof(d[cols].to_numpy(float), d[tgt].to_numpy(float), folds)
                d[["mlbam", "season", "pred"]].rename(columns={"pred": "grade"}).to_csv(
                    RES / f"arsenal_{tgt}{tag}_{name}_grades.csv", index=False)
            print(f"=== {tgt}{tag}: full vs base (read the {tgt} rows)")
            res = compare(RES / f"arsenal_{tgt}{tag}_base_grades.csv",
                          RES / f"arsenal_{tgt}{tag}_full_grades.csv", oc)
            result[f"{tgt}{tag}"] = {k: v for k, v in res.items() if k.endswith(" " + tgt)}
        X = d[["grade"] + FEATS].to_numpy(float)
        A = (X - X.mean(0)) / X.std(0)
        beta = np.linalg.solve(A.T @ A + np.eye(A.shape[1]), A.T @ (d[tgt] - d[tgt].mean()))
        result[f"coef_{tgt}"] = dict(zip(["grade"] + FEATS, np.round(beta / d[tgt].std(), 3).tolist()))
        print(f"standardized coefs ({tgt}, in outcome SDs)", result[f"coef_{tgt}"])
    (RES / "arsenal.json").write_text(json.dumps(result, indent=1))


if __name__ == "__main__":
    main()
