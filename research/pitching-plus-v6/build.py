"""Pitching+ v6 frame: one row per MLB pitch 2021-2026, features + labels, no grade computed.

    nice -n 10 python research/pitching-plus-v6/build.py       # -> cache/frame.parquet, cache/outcomes.parquet

Shape features come from the goat-pro feature cache (pipeline/train_mlb.load_features, LO=2021: fastball
differentials, hvaa, physics spin_eff); outcome and context columns are joined from savant_mart `pitches_all`
by (game_pk, at_bat_number, pitch_number). Writes the split columns (lockbox, fold) from the PREREG salts.
"""
import sys
import zlib
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
CACHE = HERE / "cache"
FEAT = Path.home() / "Projects/goat-pro/pipeline/cache/features_2021_872789c2e380.parquet"
sys.path.insert(0, str(Path.home() / "Projects/vt_baseball/savant_mart"))
import mart  # noqa: E402

KEY = ["game_pk", "at_bat_number", "pitch_number"]
TYPES = ["FF", "SI", "FC", "SL", "CU", "KC", "SW", "SV", "ST", "CH", "FS", "FO", "EP"]
# terminal outcome classes for the softmax model; BIP split by Savant xwOBA (EV/LA) bins
CLASSES = ["ball", "hbp", "cs", "whiff", "foul", "bip0", "bip1", "bip2", "bip3"]
BIP_EDGES = [0.1, 0.3, 0.7]


def lockbox(p):
    return zlib.crc32(f"ppv6-lockbox:{p}".encode()) % 10 < 3


def fold(p):
    return zlib.crc32(f"ppv6-fold:{p}".encode()) % 5


def label(desc, xw):
    d = pd.Series(desc)
    out = pd.Series(np.nan, index=d.index)
    out[d.isin(["ball", "blocked_ball"])] = 0
    out[d == "hit_by_pitch"] = 1
    out[d == "called_strike"] = 2
    out[d.isin(["swinging_strike", "swinging_strike_blocked", "foul_tip", "missed_bunt"])] = 3
    out[d.isin(["foul", "foul_bunt", "bunt_foul_tip"])] = 4
    bip = d == "hit_into_play"
    out[bip] = 5 + np.digitize(pd.Series(xw)[bip].fillna(-1).clip(lower=0), BIP_EDGES)
    out[bip & pd.Series(xw).isna()] = np.nan  # no EV/LA: no BIP class (kept for T0 only)
    return out


def harmonize(df):
    """Feature-only shift correction at the documented Hawk-Eye boundaries (PREREG)."""
    g = df.groupby(["pitcher", "pitch_type", "season"])[["ivb", "ext", "rel_h"]].agg(["mean", "size"])
    shifts = {}
    for col in ("ivb", "ext", "rel_h"):
        m = g[(col, "mean")].unstack("season")
        n = g[(col, "size")].unstack("season")
        d = {s: float((m[s + 1] - m[s])[(n[s] >= 50) & (n[s + 1] >= 50)].median()) for s in range(2021, 2026)}
        shifts[col] = d
    fixes = {("ivb", 2022), ("ext", 2022), ("rel_h", 2025)}
    log = {}
    for col, s in fixes:
        base = np.median([v for k, v in shifts[col].items() if (col, k) not in fixes])
        delta = shifts[col][s] - base
        df.loc[df["season"] <= s, col] += delta  # move the earlier era onto the later one
        log[f"{col}@{s}|{s + 1}"] = round(delta, 3)
    return df, shifts, log


def main():
    CACHE.mkdir(exist_ok=True)
    con = duckdb.connect()
    mcon = mart.connect()
    extra = mcon.sql("""SELECT game_pk, at_bat_number, pitch_number, batter, description, events,
        launch_speed, launch_angle, sz_top, sz_bot, outs_when_up, inning, inning_topbot,
        post_bat_score - bat_score AS runs_on_pitch, woba_value, woba_denom
        FROM pitches_all WHERE game_type = 'R' AND season BETWEEN 2021 AND 2026""").df()
    cols = ["season", "game_pk", "at_bat_number", "pitch_number", "game_date", "pitcher", "p_throws", "stand",
            "pitch_type", "velo", "ivb", "hb", "spin", "arm_angle", "ext", "rel_h", "rel_s", "plate_x", "plate_z",
            "balls", "strikes", "rv", "xwoba", "vx0", "vy0", "vz0", "ax", "ay", "az", "pclass", "vaa", "fb_velo",
            "velo_diff", "ivb_diff", "hb_diff", "hvaa", "spin_eff"]
    df = con.sql(f"SELECT {', '.join(cols)} FROM read_parquet('{FEAT}')").df()
    df = df.merge(extra, on=KEY, how="left", validate="1:1")
    assert df["description"].notna().mean() > .999
    arm = np.where(df["p_throws"] == "L", 1.0, -1.0)
    df["hb_arm"] = df["hb"] * arm
    df["hb_diff_arm"] = df["hb_diff"] * arm
    df["rel_s_arm"] = df["rel_s"] * arm
    df["plate_x_arm"] = df["plate_x"] * arm
    df["same_hand"] = (df["stand"] == df["p_throws"]).astype("int8")
    df["ptype"] = df["pitch_type"].map({t: i for i, t in enumerate(TYPES)}).astype("int8")
    df["abs26"] = (df["season"] == 2026).astype("int8")
    df, shifts, log = harmonize(df)
    # zone-edge-relative location (c1)
    h = (df["sz_top"] - df["sz_bot"]).where(lambda s: s > 0.5)
    df["z_n"] = (df["plate_z"] - df["sz_bot"]) / h
    df["edge"] = np.minimum.reduce([0.83 - df["plate_x"].abs(), df["plate_z"] - df["sz_bot"], df["sz_top"] - df["plate_z"]])
    # own target, leave-one-game-out (c2: type x hand; c3: + count state); features only, no outcome
    df["cstate"] = np.sign(df["strikes"] - df["balls"]).astype("int8")  # 1 ahead, 0 even, -1 behind
    for name, keys in (("t2", ["pitcher", "season", "pitch_type", "stand"]),
                       ("t3", ["pitcher", "season", "pitch_type", "stand", "cstate"])):
        for c in ("plate_x_arm", "plate_z"):
            tot = df.groupby(keys)[c].transform("sum")
            n = df.groupby(keys)[c].transform("count")
            gtot = df.groupby(keys + ["game_pk"])[c].transform("sum")
            gn = df.groupby(keys + ["game_pk"])[c].transform("count")
            mean = (tot - gtot) / (n - gn).where(lambda s: s >= 10)
            df[f"{name}_d{c[6]}"] = df[c] - mean
        df[f"{name}_dist"] = np.hypot(df[f"{name}_dx"], df[f"{name}_dz"])
    df["cls"] = label(df["description"].to_numpy(), df["xwoba"].to_numpy())
    df["is_bip"] = (df["description"] == "hit_into_play").astype("int8")
    df["lockbox"] = df["pitcher"].map(lockbox)
    df["fold"] = df["pitcher"].map(fold).astype("int8")
    for c in df.select_dtypes("float64").columns:
        df[c] = df[c].astype("float32")
    df.to_parquet(CACHE / "frame.parquet", compression="zstd")
    print(f"frame {len(df):,} rows; lockbox pitchers {df.loc[df['lockbox'], 'pitcher'].nunique()} "
          f"of {df['pitcher'].nunique()}; harmonize {log}; adjacent shifts {shifts}")

    # pitcher-season (and first/second half) outcomes over ALL his regular-season pitches (not just graded ones)
    out = mcon.sql("""
    WITH p AS (
      SELECT season, pitcher, game_pk, CAST(game_date AS DATE) AS gd, -delta_run_exp AS rv,
             post_bat_score - bat_score AS r, outs_when_up,
             lead(outs_when_up) OVER (PARTITION BY game_pk, inning, inning_topbot ORDER BY at_bat_number, pitch_number) AS nxt,
             lead(inning) OVER (PARTITION BY game_pk, inning_topbot ORDER BY at_bat_number, pitch_number) AS nxt_inn,
             events
      FROM pitches_all WHERE game_type = 'R' AND season BETWEEN 2021 AND 2026),
    q AS (SELECT *, sum(1) OVER (PARTITION BY season, pitcher ORDER BY gd, game_pk ROWS UNBOUNDED PRECEDING) AS cum,
                 count(*) OVER (PARTITION BY season, pitcher) AS tot FROM p)
    SELECT season, pitcher,
           CASE WHEN max(cum) OVER (PARTITION BY season, pitcher, game_pk) <= tot / 2.0 THEN 1 ELSE 2 END AS half,
           rv, r, greatest(coalesce(nxt, 3) - outs_when_up, 0) AS outs, events
    FROM q""").df()
    ev = out["events"]
    out = out.assign(n=1, k=ev.isin(["strikeout", "strikeout_double_play"]), bb=ev.isin(["walk", "intent_walk"]),
                     hbp=ev.eq("hit_by_pitch"), hr=ev.eq("home_run"), pa=ev.notna()
                     & ~ev.isin(["caught_stealing_2b", "caught_stealing_3b", "caught_stealing_home", "pickoff_1b",
                                 "pickoff_2b", "pickoff_3b", "pickoff_caught_stealing_2b",
                                 "pickoff_caught_stealing_3b", "pickoff_caught_stealing_home", "stolen_base_2b",
                                 "wild_pitch", "passed_ball", "other_out"]))
    agg = dict(n=("n", "sum"), rv=("rv", "sum"), runs=("r", "sum"), outs=("outs", "sum"), k=("k", "sum"),
               bb=("bb", "sum"), hbp=("hbp", "sum"), hr=("hr", "sum"), tbf=("pa", "sum"))
    full = out.groupby(["season", "pitcher"]).agg(**agg).reset_index().assign(half=0)
    halves = out.groupby(["season", "pitcher", "half"]).agg(**agg).reset_index()
    o = pd.concat([full, halves], ignore_index=True)
    o.to_parquet(CACHE / "outcomes.parquet")
    print(f"outcomes {len(o):,} rows")


if __name__ == "__main__":
    main()
