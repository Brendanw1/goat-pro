"""Framing+ (D-13 leg 1): our called-strike model, pre-registered.

    python framing_plus.py            # fit, score, gate; writes results/framing_plus.json

Design, gates and kill criteria: PREREG-framing-plus.md (written first).
Catcher-grouped 5-fold LightGBM over taken pitches 2020-26; per catcher-season
strikes above expectation and run-valued framing runs; validated against
Baseball Savant's catcher-framing board (agreement + year-to-year stickiness).
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from lightgbm import LGBMClassifier
from sklearn.metrics import brier_score_loss, roc_auc_score
from sklearn.model_selection import GroupKFold

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "pipeline"))
sys.path.insert(0, str(ROOT / "pipeline" / "results"))
sys.path.insert(0, str(Path.home() / "Projects" / "vt_baseball" / "savant_mart"))
import mart  # noqa: E402

RESULTS = ROOT / "pipeline" / "results"
MIN_TAKEN = 2500
SEED = 7
PARAMS = dict(n_estimators=400, learning_rate=0.06, num_leaves=63,
              min_child_samples=200, subsample=0.9, subsample_freq=1,
              colsample_bytree=0.9, random_state=SEED, n_jobs=4, verbose=-1)

SC_TO_SITE = {"FF": "FF", "SI": "SI", "FC": "CT", "SL": "SL", "SW": "SW", "ST": "SW",
              "SV": "SL", "CU": "CB", "KC": "CB", "CH": "CH", "FS": "FS", "FO": "FS"}


def load_taken(con):
    df = con.sql("""
        SELECT season, fielder_2 AS catcher, plate_x, plate_z, sz_top, sz_bot,
               balls, strikes, stand, p_throws, pitch_type, release_speed,
               pfx_x, pfx_z, description, delta_run_exp
        FROM pitches_all
        WHERE game_type = 'R' AND season BETWEEN 2020 AND 2026
          AND description IN ('called_strike', 'ball')
          AND fielder_2 IS NOT NULL AND plate_x IS NOT NULL AND plate_z IS NOT NULL
          AND sz_top > sz_bot AND balls BETWEEN 0 AND 3 AND strikes BETWEEN 0 AND 2
    """).df()
    df["is_strike"] = (df["description"] == "called_strike").astype(int)
    df["fam"] = df["pitch_type"].map(SC_TO_SITE).fillna("OT")
    mid = (df["sz_top"] + df["sz_bot"]) / 2
    half_h = (df["sz_top"] - df["sz_bot"]) / 2
    df["z_h"] = (df["plate_z"] - mid) / half_h          # height in zone half-heights
    df["x_w"] = df["plate_x"] / 0.83                    # half-widths of a true-width zone
    df["fam"] = df["fam"].astype("category")
    df["stand"] = df["stand"].astype("category")
    df["p_throws"] = df["p_throws"].astype("category")
    df["season_c"] = df["season"].astype("category")
    return df


FEATS = ["plate_x", "plate_z", "z_h", "x_w", "sz_top", "sz_bot", "balls", "strikes",
         "stand", "p_throws", "fam", "release_speed", "pfx_x", "pfx_z", "season_c"]


def rv_gaps(df):
    """Per season x count: mean delta_run_exp on called strikes minus on balls."""
    rv = df.groupby(["season", "balls", "strikes", "is_strike"])["delta_run_exp"].mean().reset_index()
    piv = rv.pivot_table(index=["season", "balls", "strikes"], columns="is_strike",
                         values="delta_run_exp").reset_index()
    # delta_run_exp is batting-team framed, so mean(ball) - mean(strike) > 0:
    # the run value of stealing a strike, catcher-positive.
    piv["gap"] = piv[0] - piv[1]
    return piv.set_index(["season", "balls", "strikes"])["gap"]


def main() -> None:
    con = mart.connect()
    con.execute("SET threads TO 4")
    df = load_taken(con)
    print(f"taken pitches: {len(df):,} | catchers: {df.catcher.nunique()}")

    gk = GroupKFold(n_splits=5)
    p_hat = np.zeros(len(df))
    gains_acc = []
    for tr, te in gk.split(df, df["is_strike"], groups=df["catcher"]):
        m = LGBMClassifier(**PARAMS)
        m.fit(df.iloc[tr][FEATS], df.iloc[tr]["is_strike"])
        p_hat[te] = m.predict_proba(df.iloc[te][FEATS])[:, 1]
        gains_acc.append(dict(zip(FEATS, m.booster_.feature_importance(importance_type="gain"))))
    df["p_hat"] = p_hat

    auc = float(roc_auc_score(df["is_strike"], p_hat))
    brier = float(brier_score_loss(df["is_strike"], p_hat))
    gains = {k: float(np.mean([g[k] for g in gains_acc])) for k in FEATS}
    top = sorted(gains.items(), key=lambda kv: -kv[1])[:5]
    print(f"OOF AUC {auc:.4f} | Brier {brier:.4f} | top gains: {[k for k, _ in top]}")

    gaps = rv_gaps(df)
    df["gap"] = [gaps.get((s, b, st), 0.13) for s, b, st in
                 zip(df["season"], df["balls"], df["strikes"])]
    df["resid"] = df["is_strike"] - df["p_hat"]
    df["resid_rv"] = df["resid"] * df["gap"]

    cs = df.groupby(["catcher", "season"]).agg(
        taken=("resid", "size"), strikes_above=("resid", "sum"),
        runs=("resid_rv", "sum")).reset_index()
    cs = cs[cs["taken"] >= MIN_TAKEN].copy()

    # Gate 1: per-season agreement with Savant's framing runs
    sav = {}
    for s in range(2020, 2027):
        try:
            t = con.sql(f"SELECT id, rv_tot, pitches FROM lb_catcher_framing_{s}").df()
            t["season"] = s
            sav[s] = t
        except Exception:  # noqa: BLE001
            continue
    sav_df = pd.concat(sav.values(), ignore_index=True)
    gate1 = []
    merged_all = None
    for s in sorted(cs["season"].unique()):
        ours = cs[cs["season"] == s].rename(columns={"catcher": "id"})
        m = ours.merge(sav_df[sav_df["season"] == s][["id", "rv_tot"]], on="id")
        if len(m) < 20:
            continue
        r = float(m["runs"].corr(m["rv_tot"]))
        rho = float(m["runs"].corr(m["rv_tot"], method="spearman"))
        gate1.append({"season": int(s), "n": len(m), "r": round(r, 3), "spearman": round(rho, 3)})
        merged_all = m if merged_all is None else pd.concat([merged_all, m])
    mean_r = float(np.mean([g["r"] for g in gate1])) if gate1 else 0.0

    # Gate 2: YTY stickiness ours vs Savant's
    def yty(col):
        a = cs.rename(columns={"catcher": "id"})[["id", "season", col]]
        b = a.copy()
        b["season"] = b["season"] - 1
        j = a.merge(b, on=["id", "season"], suffixes=("", "_n"))
        j = j[(j["season"] >= 2021)]
        return float(j[col].corr(j[col + "_n"]))

    ours_yty = yty("runs")
    sav_cs = sav_df.rename(columns={"id": "catcher"})[["catcher", "season", "rv_tot"]]
    sav_cs = sav_cs[(sav_cs["season"] >= 2021)]
    a = sav_cs.copy()
    b = sav_cs.copy()
    b["season"] = b["season"] - 1
    jj = a.merge(b, on=["catcher", "season"], suffixes=("", "_n"))
    sav_yty = float(jj["rv_tot"].corr(jj["rv_tot_n"]))

    gate2_ratio = ours_yty / sav_yty if sav_yty else 0.0
    g1_pass = mean_r >= 0.85 and all(g["r"] >= 0.70 for g in gate1)
    g1_kill = mean_r < 0.80 or any(g["r"] < 0.60 for g in gate1)
    g2_pass = gate2_ratio >= 0.75
    g2_kill = ours_yty < 0.45
    loc_top = top[0][0] in ("plate_x", "plate_z", "z_h", "x_w") and top[1][0] in ("plate_x", "plate_z", "z_h", "x_w")

    # Framing+ display scale among that season's scored catchers (only with passes)
    cs["plus"] = 100 + 10 * (cs["runs"] - cs.groupby("season")["runs"].transform("mean")) / cs.groupby("season")["runs"].transform("std")
    cs = cs.round({"strikes_above": 1, "runs": 2, "plus": 1})
    cs.to_csv(RESULTS / "framing_plus.csv", index=False)

    # the visual: 5x5 residual grid over the zone (+margins) — where he steals
    # strikes. x in plate half-widths (-1.75..1.75), z in zone half-heights
    # (-1.5..2.5); cells keep >= 40 taken pitches.
    XB = [-1.75, -1.05, -0.35, 0.35, 1.05, 1.75]
    ZB = [-1.5, -0.5, 0.5, 1.5, 2.0, 2.5]
    df["xi"] = np.digitize(df["x_w"].clip(XB[0], XB[-1] - 1e-6), XB) - 1
    df["zi"] = np.digitize(df["z_h"].clip(ZB[0], ZB[-1] - 1e-6), ZB) - 1
    scored = set(zip(cs["catcher"], cs["season"]))
    zone = (df[[True if (c, s) in scored else False for c, s in zip(df["catcher"], df["season"])]]
            .groupby(["catcher", "season", "zi", "xi"])["resid"]
            .agg(["mean", "size"]).reset_index())
    zone = zone[zone["size"] >= 40]
    zone = zone.rename(columns={"mean": "resid_mean", "size": "n"})
    zone = zone.round({"resid_mean": 4})
    zone.to_parquet(RESULTS / "framing_zone.parquet")

    verdict = ("SHIP" if (g1_pass and g2_pass) else
               "DESCRIPTIVE-ONLY" if not g1_kill and not g2_kill else "KILL")
    out = {
        "prereg": "pipeline/PREREG-framing-plus.md",
        "n_taken": int(len(df)), "min_taken": MIN_TAKEN, "seed": SEED,
        "oof_auc": round(auc, 4), "brier": round(brier, 4),
        "top_gains": [(k, round(v, 1)) for k, v in top],
        "location_dominant": bool(loc_top),
        "gate1_agreement": gate1, "gate1_mean_r": round(mean_r, 3),
        "gate1_pass": bool(g1_pass), "gate1_kill": bool(g1_kill),
        "gate2_ours_yty": round(ours_yty, 3), "gate2_savant_yty": round(sav_yty, 3),
        "gate2_ratio": round(gate2_ratio, 3), "gate2_pass": bool(g2_pass), "gate2_kill": bool(g2_kill),
        "verdict": verdict,
        "scored_catcher_seasons": int(len(cs)),
        "rv_gap_mean": round(float(df["gap"].mean()), 4),
    }
    (RESULTS / "framing_plus.json").write_text(json.dumps(out, indent=1))
    print(json.dumps({k: out[k] for k in ("oof_auc", "gate1_mean_r", "gate1_pass",
                                          "gate2_ours_yty", "gate2_savant_yty", "verdict")}, indent=1))


if __name__ == "__main__":
    main()
