"""Stuff+ v2: the mechanism-study structures, re-gated.

    python stuff_v2.py          # gate suite -> results/stuff_v2.json
    python stuff_v2.py --oof    # + out-of-fold train-season study -> results/oof_v2.json

Adds exactly two things to the csw_norm winner, per MECHANISM-MLB.md:
  1. spin_eff — active spin, per-class monotone direction (+1 FB, -1 BB, 0 CH;
     gyro helps sliders whiff, ride helps fastballs). A measurement college
     TrackMan could not make; the college "below noise" verdict does not carry.
  2. velo_x_ivb — the multiplicative velo x shape term (shape spread widens
     2.2 -> 6.1 pts across velo terciles).

Everything else identical to the v1 winner (csw_norm target, frozen per-cell
scale, GRADE_SEASONS). Reuses train_mlb's loaders/grading/gates untouched;
this file owns only the feature list and the per-class constraints — and
bakeoff.export now reads them from here (prepare/train_boosters/FEATURES/
CLASS_MONO), so the shipping artifact and this gate run cannot drift.
Output: results/stuff_v2.json + the gate comparison vs v1.

--oof: out-of-fold training-season grades, college semantics (research/
stuff-model harness.py oof_train). 4 whole-game crc folds over the TRAIN
seasons (crc32(game_pk) % 1000, banded into 4); per class x side cell, fit on
3 folds' taken pitches, predict the held fold -> an out-of-sample prediction
for every training-season pitch. Training-season grades are then graded from
those predictions with the production frozen scale, so the 2023->2024 and
2024->2025 YoY pairs stop being in-sample and become comparable with
2025->2026 (which involves no training season and must not move). Writes
results/oof_v2.json with the before (in-sample) / after (OOF) numbers.
"""

import argparse
import json
import sys
import zlib
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from physics import add_physics  # noqa: E402
from train_mlb import (  # noqa: E402
    GRADE_SEASONS, LGBM_PARAMS, MONO, frozen_scale, load_features, season_grades)

RESULTS = Path(__file__).resolve().parent / "results"

FEATURES = ["velo", "ivb", "hb", "spin", "ext", "rel_h", "rel_s",
            "velo_diff", "ivb_diff", "hb_diff", "hvaa", "spin_eff", "velo_x_ivb"]

# per-class monotone constraints: the mechanism study's directions
CLASS_MONO = {
    "FB": {**MONO, "spin_eff": 1, "velo_x_ivb": 1},
    "BB": {**MONO, "spin_eff": -1, "velo_x_ivb": 0},
    "CH": {**MONO, "spin_eff": 0, "velo_x_ivb": 0},
}

PAIRS = ((2023, 2024), (2024, 2025), (2025, 2026))
OOF_FOLDS = 4


# ------------------------------------------------------------ v2 design ----
def prepare(df):
    """The v2 frame: the velo_x_ivb interaction plus the csw_norm target with
    its count baseline fitted on TRAIN only. One definition shared by main(),
    the --oof study and bakeoff.export."""
    df = df.copy()
    df["velo_x_ivb"] = df["velo"] * df["ivb"]
    e_csw = (df[df["train_season"] & (df["pa_taken"] == 1)]
             .groupby(["balls", "strikes"])["csw"].mean().rename("e_csw_count"))
    df = df.join(e_csw, on=["balls", "strikes"])
    df["csw_norm"] = np.where(df["pa_taken"] == 1, df["csw"] / df["e_csw_count"], np.nan)
    return df


def train_boosters(df):
    """The v2 stuff leg: one monotone LightGBM per class x batter side with
    per-class constraint directions (CLASS_MONO). No pooled fallback — train
    cells are hundreds of thousands of rows. Deterministic (LightGBM's default
    seed), which the OOF study's before/after comparison relies on."""
    import lightgbm as lgb
    train = df[df["train_season"] & df["csw_norm"].notna()]
    boosters = {}
    for pclass in ("FB", "BB", "CH"):
        constraints = [CLASS_MONO[pclass].get(f, 0) for f in FEATURES]
        for side in ("R", "L"):
            key = f"{pclass}_vs_{'LHH' if side == 'L' else 'RHH'}"
            cell = train[(train["pclass"] == pclass) & (train["stand"] == side)]
            boosters[key] = lgb.LGBMRegressor(
                monotone_constraints=constraints, **LGBM_PARAMS
            ).fit(cell[FEATURES], cell["csw_norm"])
            print(f"  {key}: {len(cell):,} rows")
    return boosters


def grade_seasons(df, boosters, refs, seasons=GRADE_SEASONS):
    """season_grades over the requested seasons; returns (grade rows, scored)."""
    rows, scored_frames = [], []
    for season in seasons:
        r, scored = season_grades(df[df["season"] == season], "stuff",
                                  boosters, refs, FEATURES)
        rows += r
        scored_frames.append(scored)
    return rows, pd.concat(scored_frames)


# ---------------------------------------------------------------- gates ----
def yoy_tables(rows, df):
    """YoY stickiness of the season grade and grade-vs-naive-persistence
    predictiveness on CSW% — the v1 gate definitions, on any set of grade
    rows (raw, or out-of-fold for the training seasons)."""
    gw = pd.DataFrame([{"mlbam": r["mlbam"], "season": r["season"], "grade": r["grade"]}
                       for r in rows])
    wide = gw.pivot_table(index="mlbam", columns="season", values="grade")
    yoy = {}
    for a, b in PAIRS:
        if a not in wide.columns or b not in wide.columns:
            continue
        pair = wide[[a, b]].dropna()
        if len(pair) >= 30:
            yoy[f"{a}->{b}"] = float(np.corrcoef(pair[a], pair[b])[0, 1])
    actual = (df[df["pa_taken"] == 1].groupby(["pitcher", "season"])
              .apply(lambda s: 100 * s["csw"].sum() / max(1, len(s)),
                     include_groups=False).rename("csw_pct").reset_index())
    aw = actual.pivot_table(index="pitcher", columns="season", values="csw_pct")
    naive = {}
    for a, b in PAIRS:
        if a not in wide.columns or b not in wide.columns:
            continue
        have = pd.DataFrame({"grade": wide[a], "next": aw[b], "prior": aw[a]}).dropna()
        naive[f"{a}->{b}"] = {"grade": float(np.corrcoef(have["grade"], have["next"])[0, 1]),
                              "naive": float(np.corrcoef(have["prior"], have["next"])[0, 1])}
    return yoy, naive


def gates(scored, rows, df):
    """The v1 gate suite: per-pitch fit, plate leak, YoY, vs naive."""
    sub = scored[["stuff_pred", "csw", "plate_z"]].dropna()
    fit = np.corrcoef(sub["stuff_pred"], sub["csw"])[0, 1]
    leak = abs(np.corrcoef(sub["stuff_pred"], sub["plate_z"])[0, 1])
    yoy, naive = yoy_tables(rows, df)
    return {"per_pitch_fit_r": fit, "location_leak": leak, "yoy": yoy,
            "predictiveness_vs_naive": naive}


# ----------------------------------------------------------------- oof -----
def game_fold(df, k=OOF_FOLDS):
    """Whole-game fold ids: crc32(game_pk) % 1000, banded into k equal bands.
    Folding by GAME (the college harness folds games, not pitchers or pitches)
    keeps every pitch of an appearance in one fold; the % 1000 keeps banding
    stable if k ever changes."""
    gk = df["game_pk"]
    if gk.isna().any():
        raise ValueError("game_pk required for game-level OOF folds")
    return gk.map(lambda g: zlib.crc32(str(int(g)).encode()) % 1000) // (1000 // k)


class _PredTable:
    """Duck-typed booster for season_grades: predict(X) reads precomputed
    out-of-fold predictions BY ROW INDEX — two identical feature rows in
    different folds may score differently, so fold membership has to ride on
    the index, never on the features."""

    def __init__(self, pred):
        self.pred = pred

    def predict(self, X):
        return self.pred.loc[X.index].to_numpy()


def oof_train(df, k=OOF_FOLDS):
    """College --oof (harness.oof_train) on the v2 design: k game-crc folds
    over TRAIN seasons; per class x side cell, fit on the k-1 other folds'
    taken pitches, then predict EVERY train-season pitch of the held fold
    (grades average over all pitches, as production grading does). Returns a
    prediction Series aligned to df (NaN off train seasons); coverage of train
    rows is total by construction."""
    import lightgbm as lgb
    fold = game_fold(df, k)
    out = pd.Series(np.nan, index=df.index, name="oof_pred")
    in_train = df["train_season"]
    for pclass in ("FB", "BB", "CH"):
        constraints = [CLASS_MONO[pclass].get(f, 0) for f in FEATURES]
        for side in ("R", "L"):
            key = f"{pclass}_vs_{'LHH' if side == 'L' else 'RHH'}"
            cell = in_train & (df["pclass"] == pclass) & (df["stand"] == side)
            fit_rows = cell & df["csw_norm"].notna()
            for f in range(k):
                fit = fit_rows & (fold != f)
                hold = cell & (fold == f)
                bst = lgb.LGBMRegressor(monotone_constraints=constraints,
                                        **LGBM_PARAMS)
                bst.fit(df.loc[fit, FEATURES], df.loc[fit, "csw_norm"])
                out.loc[hold] = bst.predict(df.loc[hold, FEATURES])
            print(f"  oof {key}: {int(fit_rows.sum()):,} fit rows -> "
                  f"{int(cell.sum()):,} rows covered")
    return out


def oof_study(df):
    """Before (raw in-sample) / after (out-of-fold) for every pair involving a
    training season, same run, same frozen scale — the comparison isolates the
    booster's in-sample-ness and nothing else."""
    print("v2 boosters on the full train (frozen scale + BEFORE grades)...")
    boosters = train_boosters(df)
    refs = frozen_scale(df, boosters, FEATURES, "csw_norm")
    rows_raw, _ = grade_seasons(df, boosters, refs)
    yoy_raw, naive_raw = yoy_tables(rows_raw, df)

    print("\nout-of-fold training-season predictions...")
    oof = oof_train(df)
    coverage = float(oof[df["train_season"]].notna().mean())
    fake = {k: _PredTable(oof) for k in boosters}
    rows_oof_2324, _ = grade_seasons(df, fake, refs, seasons=(2023, 2024))
    # 2025/26 grades never involve the fit — reuse the raw-run rows so the
    # after-table covers every pair; their 25->26 entries double as the
    # immovability check (must be identical by construction).
    rows_oof = rows_oof_2324 + [r for r in rows_raw if r["season"] in (2025, 2026)]
    yoy_oof, naive_oof = yoy_tables(rows_oof, df)
    assert yoy_oof["2025->2026"] == yoy_raw["2025->2026"], \
        "2025->2026 must not move: no training season is involved"

    # determinism check: the BEFORE numbers must reproduce the stored gate run
    stored = RESULTS / "stuff_v2.json"
    drift = {}
    if stored.exists():
        old = json.loads(stored.read_text())["yoy"]
        drift = {k: yoy_raw[k] - old[k] for k in old}
        print("\ndeterminism vs stored stuff_v2.json: "
              + ", ".join(f"{k} {v:+.6f}" for k, v in drift.items()))

    def pair(a, b, before, after, note=None):
        d = {"before_in_sample": before, "after_oof": after}
        if note:
            d["note"] = note
        return d

    out = {
        "design": "stuff_v2 csw_norm (13 features, per-class monotone); "
                  "college harness --oof semantics",
        "folds": OOF_FOLDS,
        "fold_def": "crc32(game_pk) % 1000 // 250 — whole games, TRAIN seasons "
                    "(2023-24) only; per cell, fit on 3 folds' taken pitches, "
                    "predict the held fold's train-season pitches (all of them, "
                    "so grade construction matches production)",
        "grade_construction": "season_grades from the OOF predictions with the "
                              "production frozen scale (per-cell league "
                              "constants, no pitcher identity — what deployment "
                              "scores new seasons with); 2025/26 grades are "
                              "out-of-sample already and untouched",
        "oof_coverage_train_rows": coverage,
        "yoy": {
            "2023->2024": pair(2023, 2024, yoy_raw["2023->2024"],
                               yoy_oof.get("2023->2024"),
                               "both seasons out-of-fold after"),
            "2024->2025": pair(2024, 2025, yoy_raw["2024->2025"],
                               yoy_oof.get("2024->2025"),
                               "2024 out-of-fold after; 2025 was never trained on"),
            "2025->2026": {"value": yoy_raw["2025->2026"],
                           "note": "no training season involved; unchanged by OOF"},
        },
        "predictiveness_vs_naive": {
            "2023->2024": {"before": naive_raw["2023->2024"],
                           "after": naive_oof.get("2023->2024")},
            "2024->2025": {"before": naive_raw["2024->2025"],
                           "after": naive_oof.get("2024->2025")},
            "2025->2026": {"value": naive_raw["2025->2026"],
                           "note": "no training season involved; unchanged by OOF"},
        },
        "determinism_delta_vs_stuff_v2_json": drift,
    }
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / "oof_v2.json").write_text(json.dumps(out, indent=1))
    print("\n=== OOF before/after (YoY of the season grade) ===")
    for k, v in out["yoy"].items():
        if "before_in_sample" in v:
            print(f"YoY {k}: in-sample {v['before_in_sample']:.3f} -> "
                  f"OOF {v['after_oof']:.3f}")
        else:
            print(f"YoY {k}: {v['value']:.3f} (unchanged: {v['note']})")
    for k, v in out["predictiveness_vs_naive"].items():
        if "before" in v and v["after"] is not None:
            b, a = v["before"], v["after"]
            print(f"predict {k}: grade {b['grade']:.3f} -> {a['grade']:.3f} "
                  f"(naive {b['naive']:.3f})")
        elif "value" in v:
            print(f"predict {k}: grade {v['value']['grade']:.3f} vs naive "
                  f"{v['value']['naive']:.3f} (unchanged)")
    print(f"oof coverage of train rows: {coverage:.4f}")
    print(f"-> results/oof_v2.json")
    return out


# ----------------------------------------------------------------- main ----
def main(oof=False):
    df = add_physics(load_features())
    df = prepare(df)
    train = df[df["train_season"] & df["csw_norm"].notna()]

    boosters = train_boosters(df)
    refs = frozen_scale(df, boosters, FEATURES, "csw_norm")

    rows, scored = grade_seasons(df, boosters, refs)

    g = gates(scored, rows, df)
    fit, leak, yoy, naive = (g["per_pitch_fit_r"], g["location_leak"],
                             g["yoy"], g["predictiveness_vs_naive"])

    if not oof:
        RESULTS.mkdir(exist_ok=True)
        (RESULTS / "stuff_v2.json").write_text(json.dumps({
            "features": FEATURES,
            "class_mono": {k: {f: v for f, v in m.items() if v}
                           for k, m in CLASS_MONO.items()},
            "per_pitch_fit_r": fit, "location_leak": leak,
            "yoy": yoy, "predictiveness_vs_naive": naive,
            "n_pitcher_seasons": len(rows)}, indent=1))
    # with --oof the stored gate artifact is left untouched: it carries the
    # historical v2b/verdict annotations AND it is the before-run the OOF
    # study checks its recomputed BEFORE numbers against.
    print(f"\nGATE v2 per-pitch r={fit:.3f} (v1: 0.284), leak={leak:.3f}")
    for k, v in yoy.items():
        print(f"YoY {k}: {v:.3f}")
    for k, v in naive.items():
        print(f"predict {k}: grade {v['grade']:.3f} vs naive {v['naive']:.3f}")
    print(f"-> {'(stuff_v2.json left as stored; --oof mode)' if oof else 'results/stuff_v2.json'} "
          f"({len(rows)} pitcher-seasons)")

    if oof:
        oof_study(df)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--oof", action="store_true",
                    help="also run the out-of-fold training-season study "
                         "(college harness --oof semantics) -> results/oof_v2.json")
    a = ap.parse_args()
    main(oof=a.oof)
