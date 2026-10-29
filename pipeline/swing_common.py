"""Shared measurement layer for the swing program (docs/swing-program.md).

    python swing_common.py        # Gate 0 / measurement self-check vs Savant leaderboards

Every swing-program piece imports these instead of re-deriving them:

    swing_sql(seasons, cols)       -> SQL for tracked regular-season swings (+ is_bunt)
    is_bunt(df)                    -> bool Series
    competitive_mask(df)           -> bool Series, Savant's competitive-swing rule
    competitive_swings(df)         -> df filtered to competitive swings
    pull_angle(df)                 -> spray angle in degrees, + = pull for both hands
    attack_dir_pull(df)            -> attack direction in degrees, + = pull for both hands
    depth_centered(df)             -> contact depth (in.) minus the hitter-season-side contact mean
    plate_speed(df), vaa(df)       -> pitch speed (mph) and vertical approach angle (deg) at the plate
    collision_efficiency(df)       -> EV / max possible EV (Savant's squared-up ratio)
    squared_up(df), blast(df)      -> Savant's squared-up / blast flags per swing

Conventions verified against the data (findings in docs/swing-program.md, "Gate 0"):
- attack_direction from Savant is already batter-relative: negative = pull for BOTH hands.
  Do not mirror it for LHB.
- intercept_ball_minus_batter_pos_y_inches: larger = met further out in front (toward the pitcher).
  _x_inches: larger = further from the batter's body (already handedness-normalised).
- Intercepts on whiffs are not contact points; depth_centered is contact-only.
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

SAVANT_MART = Path.home() / "Projects" / "vt_baseball" / "savant_mart"
LB_DIR = SAVANT_MART / "data" / "leaderboards"

CONTACT = ("foul", "hit_into_play")                       # Savant's bat-contact set
WHIFF = ("swinging_strike", "swinging_strike_blocked", "foul_tip")  # Savant counts foul tips as whiffs
Y_PLATE = 17.0 / 12.0                                      # front of the plate, ft


def swing_sql(seasons, cols=("bat_speed", "launch_speed", "description")) -> str:
    """Tracked regular-season swings with the minimum columns + an is_bunt flag."""
    need = {"batter", "season", "stand", "bat_speed", "launch_speed", "description"}
    cols = ", ".join(sorted(need | set(cols)))
    return f"""
        SELECT {cols},
               (description LIKE '%bunt%'
                OR (description = 'hit_into_play' AND lower(coalesce(des, '')) LIKE '%bunt%')) AS is_bunt
        FROM pitches_all
        WHERE game_type = 'R' AND season IN ({", ".join(str(int(s)) for s in seasons)})
          AND batter IS NOT NULL AND bat_speed IS NOT NULL"""


def is_bunt(df: pd.DataFrame) -> pd.Series:
    """Bunt attempts: bunt descriptions, plus balls in play whose play text says bunt."""
    if "is_bunt" in df:
        return df["is_bunt"].fillna(False).astype(bool)
    b = df["description"].str.contains("bunt", na=False)
    if "des" in df:
        b |= (df["description"] == "hit_into_play") & df["des"].str.lower().str.contains("bunt", na=False)
    return b


def competitive_mask(df: pd.DataFrame) -> pd.Series:
    """Savant: no bunts; keep the fastest 90% of a hitter-season's swings, plus any
    60+ mph swing with 90+ mph EV. The 10th-percentile cut is over the hitter-season's
    non-bunt tracked swings (pass one regular season per hitter, all game rows of it)."""
    nb = ~is_bunt(df)
    p10 = df["bat_speed"].where(nb).groupby([df["batter"], df["season"]]).transform(lambda s: s.quantile(0.1))
    keep = (df["bat_speed"] >= p10) | ((df["bat_speed"] >= 60) & (df["launch_speed"] >= 90))
    return nb & keep


def competitive_swings(df: pd.DataFrame) -> pd.DataFrame:
    return df[competitive_mask(df)]


def pull_angle(df: pd.DataFrame) -> pd.Series:
    """Spray angle from hc_x/hc_y (0 = straight away), + = pull for both hands. NaN without hit coords."""
    phi = np.degrees(np.arctan2(df["hc_x"] - 125.42, 198.27 - df["hc_y"]))  # + = toward RF
    return phi * np.where(df["stand"] == "L", 1.0, -1.0)


def attack_dir_pull(df: pd.DataFrame) -> pd.Series:
    """Savant attack_direction is batter-relative with negative = pull; flip so + = pull. No hand mirror."""
    return -df["attack_direction"]


def depth_centered(df: pd.DataFrame, col: str = "intercept_ball_minus_batter_pos_y_inches") -> pd.Series:
    """Contact depth (+ = further out front) minus the hitter's contact mean for that season and side.
    Contact swings only (foul + in play); whiffs and takes are NaN (their intercepts are projections)."""
    y = df[col].where(df["description"].isin(CONTACT))
    return y - y.groupby([df["batter"], df["season"], df["stand"]]).transform("mean")


def _plate_v(df: pd.DataFrame):
    """Velocity components (ft/s) at the front of the plate from the 9-parameter fit (train_mlb.py's solve)."""
    vy0, ay = df["vy0"], df["ay"]
    disc = (vy0 ** 2 - 2 * ay * (50.0 - Y_PLATE)).clip(lower=0)
    t_lin = (50.0 - Y_PLATE) / (-vy0)
    t = ((-vy0 - np.sqrt(disc)) / ay.where(ay.abs() > 1e-6)).fillna(t_lin)
    return df["vx0"] + df["ax"] * t, vy0 + ay * t, df["vz0"] + df["az"] * t


def plate_speed(df: pd.DataFrame) -> pd.Series:
    vx, vy, vz = _plate_v(df)
    return np.sqrt(vx ** 2 + vy ** 2 + vz ** 2) * 3600 / 5280


def vaa(df: pd.DataFrame) -> pd.Series:
    """Vertical approach angle at the plate, degrees (negative = descending), same as train_mlb.py."""
    _, vy, vz = _plate_v(df)
    return np.degrees(np.arctan2(vz, -vy))


def collision_efficiency(df: pd.DataFrame) -> pd.Series:
    """EV / max possible EV, max = 1.23*bat speed + 0.23*pitch speed at the plate (q = 0.23).
    Reproduces Savant's squared-up rate to 0.1 pp per hitter (Gate 0). NaN without EV."""
    return df["launch_speed"] / (1.23 * df["bat_speed"] + 0.23 * plate_speed(df))


def squared_up(df: pd.DataFrame) -> pd.Series:
    """Savant squared-up: a ball in play with efficiency >= 0.80 (fouls never count)."""
    return (df["description"] == "hit_into_play") & (collision_efficiency(df) >= 0.8)


def blast(df: pd.DataFrame) -> pd.Series:
    """Savant blast: squared-up and 100*efficiency + bat speed >= 164."""
    return squared_up(df) & (100 * collision_efficiency(df) + df["bat_speed"] >= 164)


def demo() -> None:
    # --- synthetic unit checks -------------------------------------------------
    t = pd.DataFrame({"stand": ["R", "L", "R", "L"], "hc_x": [60.0, 190.0, 190.0, 60.0],
                      "hc_y": [100.0] * 4, "attack_direction": [-10.0, -10.0, 10.0, 10.0]})
    pa = pull_angle(t)
    assert (pa[:2] > 30).all() and (pa[2:] < -30).all(), pa          # LF for RHB / RF for LHB = pull
    assert (attack_dir_pull(t)[:2] > 0).all()
    s = pd.DataFrame({"batter": 1, "season": 2025, "bat_speed": np.r_[np.arange(60.0, 110.0), 55.0, 70.0],
                      "launch_speed": np.r_[[np.nan] * 50, 95.0, 80.0], "description": "foul"})
    s.loc[51, "description"] = "foul_bunt"
    m = competitive_mask(s)
    assert not m[:4].any() and m[4:50].all() and not m[50] and not m[51]  # slow 10% out; no rescue under 60 mph; bunt out
    s.loc[50, "bat_speed"] = 62.0
    assert competitive_mask(s)[50]
    p = pd.DataFrame({"vx0": [5.0], "vy0": [-135.0], "vz0": [-5.0], "ax": [-10.0], "ay": [28.0], "az": [-15.0]})
    assert -7 < vaa(p).iloc[0] < -3 and 85 < plate_speed(p).iloc[0] < 92

    # --- Gate 0 against the mart + Savant leaderboards -----------------------
    sys.path.insert(0, str(SAVANT_MART))
    import mart  # noqa: E402
    con = mart.connect()
    con.execute("SET threads TO 4")
    seasons = (2024, 2025, 2026)
    cols = ("swing_length", "attack_direction", "hc_x", "hc_y", "events",
            "intercept_ball_minus_batter_pos_y_inches", "release_speed",
            "vx0", "vy0", "vz0", "ax", "ay", "az")
    d = con.sql(swing_sql(seasons, cols)).df()
    lb = pd.concat([pd.read_csv(LB_DIR / f"bat-tracking_{y}.csv").assign(season=y) for y in seasons])
    for c in ("avg_bat_speed", "swing_length"):
        lb[c] = pd.to_numeric(lb[c])
    c = competitive_swings(d)
    c = c.assign(sq=squared_up(c), bl=blast(c), ct=c["description"].isin(CONTACT))
    a = (c.groupby(["batter", "season"])
          .agg(n=("bat_speed", "size"), bs=("bat_speed", "mean"), sl=("swing_length", "mean"),
               ct=("ct", "sum"), sq=("sq", "sum"), bl=("bl", "sum"))
          .reset_index().rename(columns={"batter": "id"}))
    g = lb.merge(a, on=["id", "season"])
    dn = g["n"] - g["swings_competitive"]
    bse = (g["bs"] - g["avg_bat_speed"]).abs()
    sqe = 100 * (g["sq"] / g["ct"] - g["squared_up_per_bat_contact"])
    ble = 100 * (g["bl"] / g["ct"] - g["blast_per_bat_contact"])
    print(f"Gate 0 ({len(g)} hitter-seasons): competitive exact {(dn == 0).mean():.3f}, "
          f"|d|<=2 {(dn.abs() <= 2).mean():.3f}, |d|<=5 {(dn.abs() <= 5).mean():.3f}, mean {dn.mean():+.2f}, "
          f"by season {dn.groupby(g['season']).mean().round(2).to_dict()}")
    print(f"  avg bat speed within 0.1 mph {(bse <= 0.1).mean():.3f} (MAE {bse.mean():.3f}); "
          f"swing length MAE {(g['sl'] - g['swing_length']).abs().mean():.4f} ft")
    print(f"  squared-up/contact MAE {sqe.abs().mean():.2f} pp (bias {sqe.mean():+.2f}); "
          f"blast/contact MAE {ble.abs().mean():.2f} pp (bias {ble.mean():+.2f})")
    assert (bse <= 0.1).mean() >= 0.95 and abs(dn.mean()) < 3
    assert sqe.abs().mean() < 0.5 and ble.abs().mean() < 0.5

    # handedness: pull HRs, attack direction vs spray
    d["pull"], d["adp"] = pull_angle(d), attack_dir_pull(d)
    hr = d[d["events"] == "home_run"]
    print(f"  HR pulled share {(hr['pull'] > 0).mean():.3f}; HR median attack_dir_pull "
          f"R {hr.loc[hr.stand == 'R', 'adp'].median():+.1f} L {hr.loc[hr.stand == 'L', 'adp'].median():+.1f}")
    bip = d[d["description"] == "hit_into_play"].dropna(subset=["pull", "adp"])
    r_ok = bip["pull"].corr(bip["adp"])
    r_bad = bip["pull"].corr(bip["adp"] * np.where(bip["stand"] == "L", -1, 1))  # the double-mirror error
    print(f"  corr(attack_dir_pull, pull_angle) {r_ok:+.3f}; with an extra LHB mirror {r_bad:+.3f}; "
          f"by hand {bip.groupby('stand').apply(lambda x: x['pull'].corr(x['adp'])).round(3).to_dict()}")
    assert (hr["pull"] > 0).mean() > 0.6 and r_ok > 0.25 and abs(r_bad) < 0.1

    # depth: sign (out front = pull), contact-only centring
    d["dc"] = depth_centered(d)
    rd = bip.join(d["dc"])[["dc", "pull"]].dropna().corr().iloc[0, 1]
    w = d["description"].isin(WHIFF[:2])
    yy = d["intercept_ball_minus_batter_pos_y_inches"]
    print(f"  corr(depth_centered, pull) {rd:+.3f}; depth SD contact {yy[d.description.isin(CONTACT)].std():.1f} "
          f"vs whiff {yy[w].std():.1f} in, mean {yy[d.description.isin(CONTACT)].mean():.1f} vs {yy[w].mean():.1f}")
    assert rd > 0.25 and d.loc[w, "dc"].isna().all()
    assert abs(d.groupby(["batter", "season", "stand"])["dc"].mean().abs().max()) < 1e-6

    # VAA: published 4-seam average about -4.5 to -5 deg
    v = con.sql("""SELECT vx0, vy0, vz0, ax, ay, az FROM pitches_all
                   WHERE game_type = 'R' AND season = 2025 AND pitch_type = 'FF' USING SAMPLE 100000""").df()
    ff = vaa(v).mean()
    print(f"  4-seam VAA 2025 mean {ff:.2f} deg")
    assert -5.2 < ff < -4.3
    print("swing_common: all checks pass")


if __name__ == "__main__":
    demo()
