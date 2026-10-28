"""Head-to-head: our MLB Stuff+ vs TJStuff+ (Nestico tjStuff v3 LightGBM dump).

    nice -n 10 python pipeline/benchmark_tjstuff.py

Reconstruction (validated against the published 2026 per-pitch-type file):
  features = start_speed, spin_rate, extension, az, ax (mirrored to RHP view),
  x0 (abs release_pos_x), z0, and speed/az/ax minus the pitcher-season mean of
  his most-thrown fastball (FF or SI). Scaled by the model's scaler, summed
  over the 1000 trees (own tree walker). Raw output is run-value-like (lower is
  better), so TJ+ = 100 - 10*(raw - mu)/sd with mu/sd over all 2023-26 pitches.
Writes results/benchmark_tjstuff.json.
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, "/Users/brendanwaterval/Projects/vt_baseball/savant_mart")
sys.path.insert(0, str(Path(__file__).resolve().parent))
import mart  # noqa: E402
from train_mlb import load_features  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
TJ = Path("/Users/brendanwaterval/Projects/vt_baseball")
PAIRS = ((2023, 2024), (2024, 2025), (2025, 2026))
TYPES = "'FF','SI','FC','SL','CU','KC','SW','SV','ST','CH','FS','FO','EP'"
MODEL = json.load(open(TJ / "tjstuff_lgbm_model.json"))
CEN, SCL = np.array(MODEL["scaler"]["center"]), np.array(MODEL["scaler"]["scale"])


def _walk(node, X, idx, out):
    if "leaf_value" in node:
        out[idx] = node["leaf_value"]
        return
    v = X[idx, node["split_feature"]]
    left = (v <= node["threshold"]) | (np.isnan(v) if node["default_left"] else False)
    _walk(node["left_child"], X, idx[left], out)
    _walk(node["right_child"], X, idx[~left], out)


def predict(X):
    out = np.zeros(len(X))
    for t in MODEL["tree_info"]:
        o = np.zeros(len(X))
        _walk(t["tree_structure"], X, np.arange(len(X)), o)
        out += o
    return out


def score_pitches(season_filter):
    d = mart.connect().sql(f"""
        SELECT CAST(game_year AS INT) AS season, pitcher, pitch_type, p_throws,
               release_speed v, release_spin_rate sp, release_extension ext,
               az, ax, release_pos_x x0, release_pos_z z0
        FROM pitches_all WHERE game_type='R' AND CAST(game_year AS INT) {season_filter}
          AND pitch_type IN ({TYPES}) AND release_speed IS NOT NULL
          AND release_spin_rate IS NOT NULL AND release_extension IS NOT NULL
          AND ax IS NOT NULL AND az IS NOT NULL AND pitcher IS NOT NULL""").df()
    d["axm"] = d["ax"] * np.where(d["p_throws"] == "L", -1, 1)
    d["x0m"] = d["x0"].abs()
    fb = d[d["pitch_type"].isin(["FF", "SI"])]
    n = fb.groupby(["season", "pitcher", "pitch_type"]).size().rename("n").reset_index()
    main = n.sort_values("n").drop_duplicates(["season", "pitcher"], keep="last")[
        ["season", "pitcher", "pitch_type"]]
    ref = (fb.merge(main, on=["season", "pitcher", "pitch_type"])
           .groupby(["season", "pitcher"])[["v", "az", "axm"]].mean().add_suffix("_fb"))
    d = d.join(ref, on=["season", "pitcher"])
    X = np.column_stack([d.v, d.sp, d.ext, d.az, d.axm, d.x0m, d.z0,
                         (d.v - d.v_fb).fillna(0), (d.az - d.az_fb).fillna(0),
                         (d.axm - d.axm_fb).fillna(0)])
    d["raw"] = predict((X - CEN) / SCL)
    return d[["season", "pitcher", "pitch_type", "raw"]]


def r(a, b):
    return round(float(np.corrcoef(a, b)[0, 1]), 3)


def main():
    pit = score_pitches("BETWEEN 2023 AND 2026")
    mu, sd = pit["raw"].mean(), pit["raw"].std()
    pit["tj"] = 100 - 10 * (pit["raw"] - mu) / sd

    # 1. validate on 2026 per pitch type
    pub = json.load(open(TJ / "tjstuff_mlb_2026.json"))
    pub = pd.DataFrame(pub["rows"], columns=pub["cols"]).query("count >= 100")
    g = pit[pit.season == 2026].groupby(["pitcher", "pitch_type"])["tj"].mean().reset_index()
    j = g.merge(pub, left_on=["pitcher", "pitch_type"], right_on=["player_id", "pitch_type"])
    val_r = r(j["tj"], j["tj_stuff_plus"])
    slope, icpt = np.polyfit(j["tj"], j["tj_stuff_plus"], 1)
    print(f"validation r={val_r} n={len(j)} (published ~ {icpt:.1f} + {slope:.2f}*ours)")
    out = {"validation": {"r": val_r, "n_pitcher_pitchtypes": len(j), "min_count": 100,
                          "published_vs_ours_slope": round(float(slope), 3),
                          "published_vs_ours_intercept": round(float(icpt), 2),
                          "published_sd": round(float(j["tj_stuff_plus"].std()), 2),
                          "ours_sd": round(float(j["tj"].std()), 2)}}
    if val_r < 0.9:
        out["stopped"] = "validation r < .9"
        (ROOT / "pipeline/results/benchmark_tjstuff.json").write_text(json.dumps(out, indent=1))
        return

    # 2. pitcher-season TJ+ (pitch-count weighted over types == mean over pitches)
    tjs = pit.groupby(["pitcher", "season"])["tj"].mean().rename("tj").reset_index()
    ours = pd.DataFrame(json.load(open(ROOT / "data/export/mlb_pitcher_grades.json"))["grades"])
    ours = ours.rename(columns={"mlbam": "pitcher", "grade": "stuff"})[["pitcher", "season", "stuff"]]
    # honest grades: pitcher-grouped cross-fit (crossfit_v2.py, RESULTS-MLB §17)
    cf = pd.read_csv(ROOT / "pipeline/results/crossfit_v2_grades.csv").rename(
        columns={"mlbam": "pitcher", "grade": "stuff_cf"})
    ours = ours.merge(cf, on=["pitcher", "season"])
    df = load_features()
    pa = df[df.pa_taken == 1]
    oc = pa.groupby(["pitcher", "season"]).agg(n=("csw", "size"), csw=("csw", "sum"),
                                              k=("is_k", "sum")).reset_index()
    oc["csw_pct"], oc["k_pct"] = 100 * oc.csw / oc.n, 100 * oc.k / oc.n
    t = ours.merge(tjs, on=["pitcher", "season"]).merge(oc[["pitcher", "season", "n", "csw_pct", "k_pct"]],
                                                        on=["pitcher", "season"])
    t = t[t.n >= 50]

    out["within_season_r_stuff_vs_tj"] = {}
    for s, x in t.groupby("season"):
        out["within_season_r_stuff_vs_tj"][int(s)] = {"r": r(x.stuff, x.tj), "n": len(x)}
    out["pairs"] = {}
    for a, b in PAIRS:
        A, B = t[t.season == a].set_index("pitcher"), t[t.season == b].set_index("pitcher")
        h = A.join(B, lsuffix="_a", rsuffix="_b", how="inner")
        res = {"n": len(h), "stuff_vs_tj_r_season_a": r(h.stuff_a, h.tj_a)}
        for name, col in (("our_stuff", "stuff"), ("our_stuff_crossfit", "stuff_cf"), ("tjstuff", "tj")):
            res[name] = {"yoy_r": r(h[f"{col}_a"], h[f"{col}_b"]),
                         "r_next_csw": r(h[f"{col}_a"], h.csw_pct_b),
                         "r_next_k": r(h[f"{col}_a"], h.k_pct_b)}
        res["naive"] = {"r_next_csw": r(h.csw_pct_a, h.csw_pct_b), "r_next_k": r(h.k_pct_a, h.k_pct_b)}
        out["pairs"][f"{a}->{b}"] = res
        print(a, b, json.dumps(res))
    out["notes"] = {
        "tj_scale": "100 - 10*(raw-mu)/sd over all 2023-26 pitches (raw is run-value-like, lower=better)",
        "population": "pitchers with a Stuff+ grade and >=50 pa_taken pitches in both seasons of the pair",
        "tj_training_window": "not stated in the model JSON or the KB copy; undetermined",
    }
    (ROOT / "pipeline/results/benchmark_tjstuff.json").write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
