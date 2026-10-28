"""GOAT-Pro model pipeline: Stuff+ and Pitching+ trained on MLB Statcast.

Ports the VT A_noev design (research/stuff-model/) to public data, per the
port spec verified against that codebase. Deviations, each from the 2026-10-25
era audit or a documented port constraint:

  - Training window 2023-24, validation 2025, test 2026 — the 2023 Hawk-Eye
    upgrade moved induced break (-0.45 in on FF) and extension (+0.12 ft), so
    pre-2023 pitches never enter training.
  - spin_axis is EXCLUDED: it drifts ~16° on sliders across 2023-26 and the
    vendor conventions are not comparable. Movement in inches carries shape.
  - hvaa is computed from the Statcast nine parameters (trajectory integrated
    to the plate) and residualized against plate height on TRAIN — the D1
    hand-set line does not transfer. (The v1 residualization had polyfit's
    slope/intercept swapped, leaving hvaa ~= raw VAA: fixed 2026-10-25, see
    pipeline/RESULTS-MLB.md §5 — that bug WAS the v1 location leak.)
  - Pitch class key: Statcast pitch_type folded to three classes (FB {FF,SI,FC},
    BB {SL,CU,KC,SW,SV,ST}, CH {CH,FS,FO,EP}) — the college result that the
    three-class landscape carries the signal, graded per class x batter side.
  - Run values come from Statcast's own delta_run_exp negated to
    pitcher-positive, replacing the D1 run-environment tables.

Everything else is the college design: count-normalized CSW target
(csw / E[CSW | count], E from TRAIN only), monotone LightGBM (velo +1, ext +1)
per class x side with a pooled fallback under 3,000 rows, frozen per-cell
100-centered scale on TRAIN pitcher cells, one absolute pooled reference,
pitch-weighted overall grade clipped once, and the gate suite (YoY, vs naive
persistence, location-leak check).

TARGET SELECTION is owned by pipeline/bakeoff.py (the college §14 experiment,
run 2026-10-25): csw_norm kept — best clean-pair forecasting of CSW%/K%/whiff%,
best reliability; the rv and rv_cnorm designs are significantly worse on the
whiff family and buy no RV/100 edge; whiff_norm is stickier but loses CSW and
reads pitch location through shape. pipeline/physics.py adds the drag/Magnus
decomposition of the nine parameters (spin_eff, mag_ivb, mag_hb, a_drag) as
candidate features — tested and REJECTED (worse on every grade statistic),
matching the college shadow test.

Usage:
    python train_mlb.py all      # features, train, grades, gates (default)
    python bakeoff.py bake       # the target bake-off (4 targets + physics arm)
    python bakeoff.py export --target csw_norm   # winning design -> data/export
"""

import hashlib
import inspect
import json
import os
import sys
from pathlib import Path

import duckdb  # noqa: F401  (mart imports it)
import numpy as np
import pandas as pd

from paths import MART_DIR  # noqa: E402
sys.path.insert(0, str(MART_DIR))
import mart  # noqa: E402

PIPE = Path(__file__).resolve().parent
MODELS = PIPE / "models"
EXPORT = PIPE.parent / "data" / "export"
# feature frame + booster cache; keyed on mart contents + code + spec, so it
# self-invalidates. GOAT_NO_CACHE=1 forces a rebuild.
CACHE = PIPE / "cache"
USE_CACHE = os.environ.get("GOAT_NO_CACHE") != "1"

TRAIN_SEASONS = (2023, 2024)
LO = int(os.environ.get("GOAT_LO", 2023))  # 2021: score the untouched 2021-22 holdout (never trained on)
VALID_SEASON = 2025
TEST_SEASON = 2026
GRADE_SEASONS = (2023, 2024, 2025, 2026)

STUFF_FEATURES = ["velo", "ivb", "hb", "spin", "ext", "rel_h", "rel_s",
                  "velo_diff", "ivb_diff", "hb_diff", "hvaa"]
LOC_FEATURES = STUFF_FEATURES + ["plate_x", "plate_z", "balls", "strikes"]
# grading cells; crossfit_v2.py --by-type swaps in Statcast pitch types (pclass relabelled)
CLASSES = ("FB", "BB", "CH")
MONO = {"velo": 1, "ext": 1}  # harder and more extension may only help
CLASS_OF = {"FF": "FB", "SI": "FB", "FC": "FB", "SL": "BB", "CU": "BB",
            "KC": "BB", "SW": "BB", "SV": "BB", "ST": "BB", "CH": "CH",
            "FS": "CH", "FO": "CH", "EP": "CH"}
CSW_DESCRIPTIONS = ("called_strike", "swinging_strike", "swinging_strike_blocked")
MIN_ROWS = 3000
LGBM_PARAMS = dict(n_estimators=800, learning_rate=0.03, num_leaves=63,
                   min_child_samples=100, subsample=0.8, subsample_freq=1,
                   colsample_bytree=0.8, verbose=-1)

FEATURE_SQL = """
SELECT season, game_pk, at_bat_number, pitch_number, CAST(game_date AS DATE) AS game_date, pitcher,
       p_throws, stand, pitch_type,
       release_speed AS velo, pfx_z * 12 AS ivb, pfx_x * 12 AS hb,
       release_spin_rate AS spin, spin_axis, arm_angle, release_extension AS ext,
       release_pos_z AS rel_h, release_pos_x AS rel_s,
       plate_x, plate_z, balls, strikes,
       CASE WHEN description IN ('called_strike','swinging_strike',
                                 'swinging_strike_blocked') THEN 1 ELSE 0 END AS csw,
       CASE WHEN description IN ('swinging_strike','swinging_strike_blocked')
            THEN 1 ELSE 0 END AS whiff,
       CASE WHEN description IN ('swinging_strike','swinging_strike_blocked',
                                 'foul','foul_tip','foul_bunt','missed_bunt',
                                 'bunt_foul_tip','hit_into_play')
            THEN 1 ELSE 0 END AS swing,
       CASE WHEN description IN ('called_strike','ball','hit_by_pitch',
                                 'swinging_strike','foul','foul_tip',
                                 'swinging_strike_blocked','foul_bunt',
                                 'missed_bunt','bunt_foul_tip')
            THEN 1 ELSE 0 END AS pa_taken,
       -delta_run_exp AS rv,
       CASE WHEN events IN ('strikeout','strikeout_double_play') THEN 1 ELSE 0 END AS is_k,
       CASE WHEN events IS NOT NULL THEN 1 ELSE 0 END AS pa_end,
       estimated_woba_using_speedangle AS xwoba,
       vx0, vy0, vz0, ax, ay, az
FROM pitches_all  -- full seasons + day-files after 2026-08-07 (mart.py)
WHERE game_type = 'R'
  AND season BETWEEN {lo} AND {hi}
  AND pitch_type IN ('FF','SI','FC','SL','CU','KC','SW','SV','ST','CH','FS','FO','EP')
  AND release_speed BETWEEN 55 AND 105
  AND release_extension > 3
  AND pfx_z IS NOT NULL AND pfx_x IS NOT NULL AND release_spin_rate IS NOT NULL
  AND p_throws IN ('L','R') AND stand IN ('L','R')
  AND pitcher IS NOT NULL
ORDER BY game_pk, at_bat_number, pitch_number
"""


def _features_key() -> str:
    import physics
    sig = mart.connect().sql("SELECT max(CAST(game_date AS DATE)), count(*) FROM pitches_all "
                             f"WHERE season BETWEEN {LO} AND 2026").fetchone()
    src = FEATURE_SQL + inspect.getsource(_load_features) + inspect.getsource(physics)
    return hashlib.sha1(f"{sig}{src}".encode()).hexdigest()[:12]


def load_features() -> pd.DataFrame:
    """The feature frame, from the parquet cache when the mart and code are unchanged."""
    if not USE_CACHE:
        return _load_features()
    path = CACHE / f"features_{LO}_{_features_key()}.parquet"
    if path.exists():
        return pd.read_parquet(path)
    df = _load_features()
    CACHE.mkdir(exist_ok=True)
    for old in CACHE.glob(f"features_{LO}_*.parquet"):
        old.unlink()
    df.to_parquet(path)
    return df


def _load_features() -> pd.DataFrame:
    con = mart.connect()
    df = con.sql(FEATURE_SQL.format(lo=LO, hi=2026)).df()
    names = con.sql("SELECT CAST(key_mlbam AS BIGINT) AS pitcher, "
                    "name_first || ' ' || name_last AS pitcher_name "
                    "FROM register WHERE key_mlbam IS NOT NULL").df()
    df["pitcher"] = pd.to_numeric(df["pitcher"], errors="coerce")
    df = df[df["pitcher"].notna()]
    df["pitcher"] = df["pitcher"].astype("int64")
    df = df.merge(names.drop_duplicates("pitcher"), on="pitcher", how="left")
    # mirrored plate side, positive = arm side (Statcast x is batter-view: RHP
    # release_pos_x < 0 and their arm-side run is also negative x, verified on
    # the mart) -- the college location check reports against plate_x_arm
    df["plate_x_arm"] = df["plate_x"] * np.where(df["p_throws"] == "L", 1.0, -1.0)
    df["pclass"] = df["pitch_type"].map(CLASS_OF)
    df = df[df["pclass"].notna()].copy()
    # vertical approach angle: integrate the nine parameters to the plate
    y_plate, y0 = 1.417, 50.0
    t = (y0 - y_plate) / (-df["vy0"])
    quad = df["ay"].abs() > 1e-6
    disc = (df["vy0"] ** 2 - 2 * df["ay"] * (y0 - y_plate)).clip(lower=0)
    t_quad = (-df["vy0"] - np.sqrt(disc)) / df["ay"].where(df["ay"] != 0, np.nan)
    df["t"] = np.where(quad, t_quad.fillna(t), t).clip(0, 3)
    vz_plate = df["vz0"] + df["az"] * df["t"]
    vy_plate = df["vy0"] + df["ay"] * df["t"]
    df["vaa"] = np.degrees(np.arctan2(vz_plate, -vy_plate))
    # pitcher-season fastball anchor: p95 velo, mean movement within 2.5 mph
    df["fb_velo"] = df.groupby(["pitcher", "season"])["velo"].transform("quantile", 0.95)
    df["velo_diff"] = df["velo"] - df["fb_velo"]
    near = df.assign(near=(df["velo"] - df["fb_velo"]).abs() <= 2.5)
    means = (near[near["near"]].groupby(["pitcher", "season"])[["ivb", "hb"]].mean()
             .rename(columns={"ivb": "ivb_ref", "hb": "hb_ref"}))
    df = df.join(means, on=["pitcher", "season"])
    df["ivb_diff"] = df["ivb"] - df["ivb_ref"].fillna(df["ivb"])
    df["hb_diff"] = df["hb"] - df["hb_ref"].fillna(df["hb"])
    df = df.drop(columns=["ivb_ref", "hb_ref"])
    # hvaa residualized on plate height per pitch class, fitted on TRAIN only:
    # the vaa-height relation has a different slope per class, and a single
    # global line leaves class structure the model exploits.
    #
    # BUG FIX (found by the college location check, 2026-10-25): v1 evaluated
    # np.polyfit's return as (intercept, slope) when it is (SLOPE, INTERCEPT),
    # so the "residual" was vaa minus (slope + intercept*plate_z) -- i.e. raw
    # vaa with a 1.2 deg/ft tilt, correlating 0.997 with plate_z within class.
    # That, not anything conceptual, was the 0.138 pooled / 0.168 within-cell
    # location leak and the 0.108 pitcher-level leak the college check found.
    df["hvaa"] = np.nan
    train_mask = df["season"].isin(TRAIN_SEASONS)
    for pc in ("FB", "BB", "CH"):
        m = train_mask & (df["pclass"] == pc)
        slope, intercept = np.polyfit(df.loc[m, "plate_z"], df.loc[m, "vaa"], 1)
        c_mask = df["pclass"] == pc
        df.loc[c_mask, "hvaa"] = (df.loc[c_mask, "vaa"]
                                  - (intercept + slope * df.loc[c_mask, "plate_z"]))
    df["train_season"] = train_mask
    # physics decomposition (pipeline/physics.py): drag / Magnus split of the
    # nine parameters, active spin and Magnus-implied movement. Candidate
    # features only; nothing in STUFF_FEATURES or LOC_FEATURES reads them yet.
    import physics
    df = physics.add_physics(df)
    return df


def train_boosters(df: pd.DataFrame, features: list[str], target: str,
                   mono: bool) -> dict:
    import lightgbm as lgb
    constraints = [MONO.get(f, 0) for f in features] if mono else [0] * len(features)
    train = df[df["train_season"] & df[target].notna()]
    # cache key: the exact training rows' shape + spec; LightGBM's default seed
    # makes a retrain identical, so a cached booster is the same model
    spec = f"{features}{target}{mono}{LGBM_PARAMS}{MIN_ROWS}{TRAIN_SEASONS}{train.shape}" \
           f"{float(train[target].sum())}"
    tag = hashlib.sha1(spec.encode()).hexdigest()[:12]
    files = {f"{pc}_vs_{h}": CACHE / f"bst_{tag}_{pc}_vs_{h}.txt"
             for pc in CLASSES for h in ("RHH", "LHH")}
    if USE_CACHE and all(f.exists() for f in files.values()):
        print(f"  boosters from cache ({tag})")
        boosters = {k: lgb.Booster(model_file=str(f)) for k, f in files.items()}
        for b in boosters.values():
            b.booster_ = b  # callers that save via .booster_ (bakeoff export) keep working
        return boosters
    boosters = {}
    for pclass in CLASSES:
        for side in ("R", "L"):
            key = f"{pclass}_vs_{'LHH' if side == 'L' else 'RHH'}"
            cell = train[(train["pclass"] == pclass) & (train["stand"] == side)]
            if len(cell) < MIN_ROWS:
                cell = train[train["pclass"] == pclass]
            boosters[key] = lgb.LGBMRegressor(
                monotone_constraints=constraints, **LGBM_PARAMS
            ).fit(cell[features], cell[target])
            print(f"  {key}: {len(cell):,} rows")
    if USE_CACHE:
        CACHE.mkdir(exist_ok=True)
        for k, b in boosters.items():
            b.booster_.save_model(str(files[k]))
    return boosters


class FoldBooster:
    """Scores each row with the fold model that never saw its pitcher.
    Rows must keep the feature frame's index (fold is indexed the same)."""

    def __init__(self, models, fold):
        self.models, self.fold = models, fold

    def predict(self, X):
        f = self.fold.loc[X.index].to_numpy()
        out = np.empty(len(X))
        for k, m in enumerate(self.models):
            if (f == k).any():
                out[f == k] = m.predict(X[f == k])
        return out


def crossfit(df: pd.DataFrame, fit, k: int = 4) -> dict:
    """Pitcher-grouped cross-fitting (RESULTS-MLB §17): fold = crc32(pitcher) % k;
    fit(df) trains on rows flagged train_season, so each fold's set is trained
    with that fold's pitchers unflagged. Returns {cell: FoldBooster}. The boosters
    otherwise recognize pitchers (per-pitch r .38 seen vs .055 unseen)."""
    import zlib
    fold = df["pitcher"].map(lambda p: zlib.crc32(str(p).encode()) % k)
    full = df["train_season"].copy()
    sets = []
    try:
        for i in range(k):
            df["train_season"] = full & (fold != i)
            sets.append(fit(df))
    finally:
        df["train_season"] = full
    return {key: FoldBooster([s[key] for s in sets], fold) for key in sets[0]}


# Statcast pitch_type -> site type (web_export.SC_TO_SITE); per-type grades (RESULTS-MLB §38)
SITE_OF = {"FF": "FF", "SI": "SI", "FC": "CT", "SL": "SL", "SV": "SL", "SW": "SW", "ST": "SW",
           "CU": "CB", "KC": "CB", "CH": "CH", "FS": "FS", "FO": "FS"}
TYPE_SHRINK = 150  # pitches of weight on the class prediction (pre-registered, §38)


def shrunk_type_preds(sdf: pd.DataFrame, pred: str) -> pd.DataFrame:
    """Pitcher x season x site type: own-type mean prediction pulled toward the pitcher's class
    mean with weight TYPE_SHRINK (§38). Columns pitcher, season, site, n, shrunk."""
    d = sdf[sdf[pred].notna()].assign(site=sdf["pitch_type"].map(SITE_OF))
    cls = d.groupby(["pitcher", "season", "pclass"])[pred].mean().rename("class_pred")
    t = (d.groupby(["pitcher", "season", "site", "pclass"])[pred].agg(["mean", "size"])
         .reset_index().join(cls, on=["pitcher", "season", "pclass"]))
    t["shrunk"] = (t["size"] * t["mean"] + TYPE_SHRINK * t["class_pred"]) / (t["size"] + TYPE_SHRINK)
    return t.rename(columns={"size": "n"})[["pitcher", "season", "site", "n", "shrunk"]]


def frozen_scale(df: pd.DataFrame, boosters: dict, features: list[str],
                 target: str, min_pitches_type: int = 10,
                 min_pitchers_cell: int = 20) -> dict:
    """Per-cell reference: mean/sd of TRAIN pitcher mean predictions (the
    college frozen scale); one pooled absolute reference over 100+-pitch arms."""
    train = df[df["train_season"] & df[target].notna()]
    refs = {}
    for key, bst in boosters.items():
        pclass, side = key.split("_vs_")
        stand = "L" if side == "LHH" else "R"
        cell = train[(train["pclass"] == pclass) & (train["stand"] == stand)].copy()
        cell["pred"] = bst.predict(cell[features])
        per_pitcher = cell.groupby("pitcher")["pred"].agg(["mean", "count"])
        per_pitcher = per_pitcher[per_pitcher["count"] >= min_pitches_type]
        if len(per_pitcher) >= min_pitchers_cell:
            refs[key] = {"mean": float(per_pitcher["mean"].mean()),
                         "sd": float(per_pitcher["mean"].std()),
                         "n": int(len(per_pitcher))}
    allpred = np.concatenate([
        bst.predict(train[(train["pclass"] == k.split("_vs_")[0])
                          & (train["stand"] == ("L" if k.split("_vs_")[1] == "LHH" else "R"))][features])
        for k, bst in boosters.items()])
    refs["_absolute"] = {"mean": float(np.mean(allpred)), "sd": float(np.std(allpred))}
    # per site type: shrunk pitcher x season x type predictions, >= 50 pitches (§38)
    tr = train.copy()
    for key, bst in boosters.items():
        pclass, side = key.split("_vs_")
        m = (tr["pclass"] == pclass) & (tr["stand"] == ("L" if side == "LHH" else "R"))
        tr.loc[m, "_p"] = bst.predict(tr.loc[m, features])
    st = shrunk_type_preds(tr, "_p")
    for site, g in st[st["n"] >= 50].groupby("site"):
        refs[f"_type:{site}"] = {"mean": float(g["shrunk"].mean()), "sd": float(g["shrunk"].std()),
                                 "n": int(len(g))}
    return refs


def grade(value: float) -> float:
    return float(np.clip(100 + 10 * value, 50, 175))


def season_grades(sdf, model, bst, refs, features):
    """Score one season: per-cell z from the frozen refs, pitch-weighted overall."""
    sdf = sdf.copy()
    for pclass in CLASSES:
        for side in ("R", "L"):
            cell = sdf[(sdf["pclass"] == pclass) & (sdf["stand"] == side)]
            if cell.empty:
                continue
            key = f"{pclass}_vs_{'LHH' if side == 'L' else 'RHH'}"
            sdf.loc[cell.index, f"{model}_pred"] = bst[key].predict(cell[features])
    by_type = {}
    if any(k.startswith("_type:") for k in refs):
        for row in shrunk_type_preds(sdf, f"{model}_pred").itertuples():
            ref = refs.get(f"_type:{row.site}")
            if ref:
                by_type.setdefault(row.pitcher, []).append(
                    {"type": row.site, "n": int(row.n), "grade": grade((row.shrunk - ref["mean"]) / ref["sd"])})
    out = []
    for pid, g in sdf.groupby("pitcher"):
        total = len(g)
        if total < 5 or g[f"{model}_pred"].notna().sum() == 0:
            continue
        per_cell = []
        for pclass in CLASSES:
            c = g[(g["pclass"] == pclass) & g[f"{model}_pred"].notna()]
            if c.empty:
                continue
            # §82: each pitch against its own batter hand's reference (was: the class's first pitch's hand)
            zs_ = []
            for side, ch in c.groupby("stand"):
                ref = refs.get(f"{pclass}_vs_{'LHH' if side == 'L' else 'RHH'}") or refs["_absolute"]
                zs_.append((ch[f"{model}_pred"] - ref["mean"]) / ref["sd"])
            z = float(pd.concat(zs_).mean())
            per_cell.append({"class": pclass, "n": len(c), "z": z, "grade": grade(z)})
        zs = np.array([c["z"] for c in per_cell])
        ns = np.array([c["n"] for c in per_cell])
        overall_z = float((zs * ns).sum() / ns.sum())
        abs_ref = refs["_absolute"]
        out.append({
            "mlbam": int(pid), "name": g["pitcher_name"].iloc[0],
            "season": int(sdf["season"].iloc[0]),
            "p_throws": g["p_throws"].iloc[0], "pitches_graded": total,
            "overall_z": overall_z, "grade": grade(overall_z),
            "abs_grade": float(np.clip(100 + 10 * (g[f"{model}_pred"].mean()
                                                   - abs_ref["mean"]) / abs_ref["sd"], 50, 175)),
            "by_class": [{k: c[k] for k in ("class", "n", "grade")} for c in per_cell],
            "by_type": by_type.get(pid, []),
            "confidence": ("HIGH" if total >= 400 else "MODERATE" if total >= 150
                           else "LOW" if total >= 50 else "MINIMAL"),
        })
    return out, sdf


def main() -> None:
    command = sys.argv[1] if len(sys.argv) > 1 else "all"
    MODELS.mkdir(exist_ok=True)
    EXPORT.mkdir(parents=True, exist_ok=True)
    df = load_features()
    print(f"features loaded: {len(df):,} pitches "
          f"{df['season'].min()}-{df['season'].max()}")
    counts = df[df["train_season"]].groupby(["pclass", "stand"]).size()
    print("train cells:", {f"{a}_vs_{'LHH' if b == 'L' else 'RHH'}": int(n)
                           for (a, b), n in counts.items()})

    e_csw = (df[df["train_season"] & (df["pa_taken"] == 1)]
             .groupby(["balls", "strikes"])["csw"].mean().rename("e_csw_count"))
    df = df.join(e_csw, on=["balls", "strikes"])
    df["csw_norm"] = np.where(df["pa_taken"] == 1, df["csw"] / df["e_csw_count"], np.nan)

    print("training stuff boosters (csw_norm)...")
    stuff_bst = train_boosters(df, STUFF_FEATURES, "csw_norm", mono=True)
    stuff_refs = frozen_scale(df, stuff_bst, STUFF_FEATURES, "csw_norm")
    print("training pitching boosters (rv)...")
    pitch_bst = train_boosters(df, LOC_FEATURES, "rv", mono=False)
    pitch_refs = frozen_scale(df, pitch_bst, LOC_FEATURES, "rv")
    print(f"cells with frozen scale: stuff {len(stuff_refs) - 1}, pitching {len(pitch_refs) - 1}")

    rows, pitch_rows = [], []
    scored_stuff, scored_pitch = [], []
    for season in GRADE_SEASONS:
        sdf = df[df["season"] == season]
        s_rows, s_scored = season_grades(sdf, "stuff", stuff_bst, stuff_refs, STUFF_FEATURES)
        p_rows, p_scored = season_grades(sdf, "pitch", pitch_bst, pitch_refs, LOC_FEATURES)
        rows += s_rows
        pitch_rows += p_rows
        scored_stuff.append(s_scored)
        scored_pitch.append(p_scored)
    scored_stuff = pd.concat(scored_stuff)
    scored_pitch = pd.concat(scored_pitch)
    by_key = {(p["mlbam"], p["season"]): p for p in pitch_rows}
    merged = []
    for s in rows:
        p = by_key.get((s["mlbam"], s["season"]))
        merged.append({**{k: v for k, v in s.items() if k not in ("overall_z", "abs_grade", "by_class")},
                       "stuff_plus_abs": s["abs_grade"], "stuff_by_class": s["by_class"],
                       "pitching_plus": p["grade"] if p else None,
                       "pitching_by_class": p["by_class"] if p else []})
    out = EXPORT / "mlb_pitcher_grades.json"
    out.write_text(json.dumps({
        "model_card": {
            "name": "GOAT-Pro Stuff+ / Pitching+ v1-MLB",
            "design": "VT A_noev port; see pipeline/train_mlb.py header",
            "train": list(TRAIN_SEASONS), "valid": VALID_SEASON, "test": TEST_SEASON,
            "features_stuff": STUFF_FEATURES, "features_pitching": LOC_FEATURES,
            "excluded": ["spin_axis (era drift)", "effective_speed (barred: location leak)"],
            "class_key": CLASS_OF,
        },
        "grades": merged}, indent=1))
    print(f"grades: {len(merged)} pitcher-seasons -> {out}")

    # gates
    for label, model, scored, observed, leak_check in (
            ("stuff", "stuff", scored_stuff, "csw", True),
            ("pitching", "pitch", scored_pitch, "rv", False)):
        cols = [f"{model}_pred", observed] + (["plate_z"] if leak_check else [])
        sub = scored[cols].dropna()
        r = np.corrcoef(sub[f"{model}_pred"], sub[observed])[0, 1]
        line = f"GATE {label}: per-pitch r={r:.3f}"
        if leak_check:  # a stuff model must not see the plate
            line += f", |r vs plate_z|={abs(np.corrcoef(sub[f'{model}_pred'], sub['plate_z'])[0, 1]):.3f}"
        print(line)
    gw = pd.DataFrame([{"mlbam": r["mlbam"], "season": r["season"],
                        "grade": r["grade"]} for r in rows])
    wide = gw.pivot_table(index="mlbam", columns="season", values="grade")
    for a, b in ((2023, 2024), (2024, 2025), (2025, 2026)):
        pair = wide[[a, b]].dropna()
        if len(pair) >= 30:
            print(f"GATE stuff+ YoY {a}->{b}: r={np.corrcoef(pair[a], pair[b])[0, 1]:.3f} (n={len(pair)})")
    actual = (df[df["pa_taken"] == 1].groupby(["pitcher", "season"])
              .apply(lambda s: 100 * s["csw"].sum() / max(1, len(s)),
                     include_groups=False).rename("csw_pct").reset_index())
    aw = actual.pivot_table(index="pitcher", columns="season", values="csw_pct")
    for a, b in ((2023, 2024), (2024, 2025), (2025, 2026)):
        have = pd.DataFrame({"grade": wide[a], "actual_next": aw[b],
                             "actual_prior": aw[a]}).dropna()
        rg = np.corrcoef(have["grade"], have["actual_next"])[0, 1]
        rn = np.corrcoef(have["actual_prior"], have["actual_next"])[0, 1]
        print(f"GATE predict {b} CSW%: grade {a} r={rg:.3f} vs naive persistence r={rn:.3f} (n={len(have)})")


if __name__ == "__main__":
    main()
