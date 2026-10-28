"""D-34 (docs/port-deliverables.md): the measured hitter bundle, no model.

    python pipeline/hitter_depth.py            # verify against the Savant boards, print the table
    from hitter_depth import hitter_depth      # web_export's hitters family

Per hitter-season (regular season, >= 50 PA), from pitches_all:
  batted ball   gb/ld/fb/pu %, pull/straight/oppo % (|spray| <= 15 deg = straight, from the side he
                batted on each ball), pull-air % (pulled LD+FB / BIP), sweet-spot % (LA 8-32), LA mean + SD
  expected      Savant's per-ball estimates rolled up the Savant way: xBA, xSLG, xwOBA (BIP estimate,
                else the PA's wOBA value, over the wOBA denominator), xwOBACON; attributed, descriptive
  swing         bat speed (fastest 90% of his tracked swings = Savant's competitive swings, approx.),
                fast-swing % (>= 75 mph), swing length, attack angle / direction, swing tilt,
                ideal attack angle % (5-20 deg), squared-up % and blast % per swing (Savant:
                squared up = EV >= 80% of 1.23 x bat speed + 0.23 x pitch speed; blast = squared-up %
                + bat speed >= 164), contact depth vs the plate (in); 2024+ (2023 partial)
  run value     batting runs per 100 pitches (delta_run_exp, batter-positive), overall and vs
                fastballs (FF/SI), cutters (FC), breaking (SL/ST/SV/CU/KC), offspeed (CH/FS/FO/SC)
  speed         Savant sprint speed (ft/s), HP-to-1B (lb_sprint_speed_*)
"""
import sys
from pathlib import Path

import pandas as pd

from paths import MART_DIR  # noqa: E402
sys.path.insert(0, str(MART_DIR))
import mart  # noqa: E402

SQL = """
WITH p AS (
  SELECT batter AS id, season, stand, pitch_type, description, events, bb_type, launch_speed AS ev,
         launch_angle AS la, hc_x, hc_y, release_speed, bat_speed, swing_length, attack_angle,
         attack_direction, swing_path_tilt, intercept_ball_minus_batter_pos_y_inches AS depth,
         estimated_ba_using_speedangle AS xba, estimated_slg_using_speedangle AS xslg,
         estimated_woba_using_speedangle AS xw, woba_value, woba_denom, delta_run_exp AS rv,
         description = 'hit_into_play' AS bip,
         description IN ('swinging_strike','swinging_strike_blocked','foul','foul_tip','hit_into_play') AS swing,
         CASE WHEN hc_x IS NOT NULL THEN degrees(atan2(hc_x - 125.42, 198.27 - hc_y))
                * CASE WHEN stand = 'L' THEN 1 ELSE -1 END END AS pull_ang,   -- + = pulled
         CASE WHEN pitch_type IN ('FF','SI') THEN 'fb' WHEN pitch_type = 'FC' THEN 'ct'
              WHEN pitch_type IN ('SL','ST','SV','CU','KC') THEN 'br'
              WHEN pitch_type IN ('CH','FS','FO','SC') THEN 'os' END AS fam
  FROM {tbl}
  WHERE game_type = 'R' AND season IN ({seasons}) AND batter IS NOT NULL
),
sw AS (  -- tracked swings, ranked by bat speed: the fastest 90% approximate Savant's competitive swings
  SELECT *, percent_rank() OVER (PARTITION BY id, season ORDER BY bat_speed DESC) AS r,
         ev >= 0.8 * (1.23 * bat_speed + 0.23 * release_speed) AS sq,
         100 * ev / (1.23 * bat_speed + 0.23 * release_speed) + bat_speed >= 164 AS blast
  FROM p WHERE swing AND bat_speed IS NOT NULL AND description NOT LIKE '%bunt%'
),
swa AS (
  SELECT id, season, count(*) AS n_tracked,
         avg(bat_speed) FILTER (WHERE r < 0.9) AS bat_speed,
         avg((bat_speed >= 75)::INT) FILTER (WHERE r < 0.9) AS fast_swing,
         avg(swing_length) FILTER (WHERE r < 0.9) AS swing_length,
         avg(attack_angle) FILTER (WHERE r < 0.9) AS attack_angle,
         avg(attack_direction) FILTER (WHERE r < 0.9) AS attack_direction,
         avg(swing_path_tilt) FILTER (WHERE r < 0.9) AS swing_tilt,
         avg((attack_angle BETWEEN 5 AND 20)::INT) FILTER (WHERE r < 0.9) AS ideal_aa,
         avg(depth) FILTER (WHERE r < 0.9) AS contact_depth,
         avg(coalesce(sq AND bip, false)::INT) FILTER (WHERE r < 0.9) AS squared_up,   -- per competitive swing
         avg(coalesce(blast AND bip, false)::INT) FILTER (WHERE r < 0.9) AS blast
  FROM sw GROUP BY 1, 2
),
a AS (
  SELECT id, season,
         count(*) FILTER (WHERE events IS NOT NULL) AS pa,
         count(*) FILTER (WHERE bip) AS bip,
         avg((bb_type = 'ground_ball')::INT) FILTER (WHERE bip) AS gb,
         avg((bb_type = 'line_drive')::INT) FILTER (WHERE bip) AS ld,
         avg((bb_type = 'fly_ball')::INT) FILTER (WHERE bip) AS fb,
         avg((bb_type = 'popup')::INT) FILTER (WHERE bip) AS pu,
         avg((pull_ang > 15)::INT) FILTER (WHERE bip AND pull_ang IS NOT NULL) AS pull,
         avg((abs(pull_ang) <= 15)::INT) FILTER (WHERE bip AND pull_ang IS NOT NULL) AS straight,
         avg((pull_ang < -15)::INT) FILTER (WHERE bip AND pull_ang IS NOT NULL) AS oppo,
         avg((pull_ang > 15 AND bb_type IN ('line_drive','fly_ball'))::INT) FILTER (WHERE bip AND pull_ang IS NOT NULL) AS pull_air,
         avg((la BETWEEN 8 AND 32)::INT) FILTER (WHERE bip AND la IS NOT NULL) AS sweet_spot,
         avg(la) FILTER (WHERE bip) AS la_mean, stddev_samp(la) FILTER (WHERE bip) AS la_sd,
         avg(ev) FILTER (WHERE bip) AS ev_mean,
         sum(CASE WHEN bip AND xw IS NOT NULL THEN xw ELSE woba_value END) FILTER (WHERE woba_denom > 0)
           / nullif(sum(woba_denom), 0) AS xwoba,
         avg(xw) FILTER (WHERE bip) AS xwobacon,
         sum(woba_value) FILTER (WHERE woba_denom > 0) / nullif(sum(woba_denom), 0) AS woba,
         100 * avg(rv) AS rv100,
         100 * avg(rv) FILTER (WHERE fam = 'fb') AS rv100_fb, 100 * avg(rv) FILTER (WHERE fam = 'ct') AS rv100_ct,
         100 * avg(rv) FILTER (WHERE fam = 'br') AS rv100_br, 100 * avg(rv) FILTER (WHERE fam = 'os') AS rv100_os,
         count(*) FILTER (WHERE fam = 'fb') AS n_fb, count(*) FILTER (WHERE fam = 'ct') AS n_ct,
         count(*) FILTER (WHERE fam = 'br') AS n_br, count(*) FILTER (WHERE fam = 'os') AS n_os
  FROM p GROUP BY 1, 2
),
xs AS (  -- xBA / xSLG over at-bats (Savant): BIP estimate, K = 0, other AB-ending events their value
  SELECT id, season,
         sum(CASE WHEN bip AND xba IS NOT NULL THEN xba
                  WHEN events IN ('single','double','triple','home_run') THEN 1 ELSE 0 END)
           / nullif(count(*), 0) AS xba,
         sum(CASE WHEN bip AND xslg IS NOT NULL THEN xslg WHEN events = 'single' THEN 1 WHEN events = 'double' THEN 2
                  WHEN events = 'triple' THEN 3 WHEN events = 'home_run' THEN 4 ELSE 0 END)
           / nullif(count(*), 0) AS xslg
  FROM p WHERE events IS NOT NULL AND events NOT IN ('walk','intent_walk','hit_by_pitch','sac_fly','sac_bunt',
         'catcher_interf','sac_fly_double_play','sac_bunt_double_play','truncated_pa')
  GROUP BY 1, 2
)
SELECT a.*, xs.xba, xs.xslg, swa.* EXCLUDE (id, season)
FROM a LEFT JOIN xs USING (id, season) LEFT JOIN swa USING (id, season)
WHERE a.pa >= 50
"""


def sprint(con, seasons) -> pd.DataFrame:
    have = {r[0] for r in con.execute("SHOW TABLES").fetchall()}
    out = [con.sql(f"SELECT player_id AS id, {s} AS season, sprint_speed, hp_to_1b FROM lb_sprint_speed_{s}").df()
           for s in seasons if f"lb_sprint_speed_{s}" in have]
    return pd.concat(out, ignore_index=True) if out else pd.DataFrame(columns=["id", "season", "sprint_speed", "hp_to_1b"])


def hitter_depth(con=None, seasons=(2023, 2024, 2025, 2026), level: str = "mlb") -> pd.DataFrame:
    con = con or mart.connect()
    tbl = "pitches_aaa" if level == "aaa" else "pitches_all"
    d = con.sql(SQL.format(tbl=tbl, seasons=",".join(map(str, seasons)))).df()
    if level == "mlb":
        d = d.merge(sprint(con, seasons), on=["id", "season"], how="left")
    pct = ["gb", "ld", "fb", "pu", "pull", "straight", "oppo", "pull_air", "sweet_spot", "fast_swing",
           "ideal_aa", "squared_up", "blast"]
    d[pct] = 100 * d[pct]
    d.loc[d["n_tracked"].fillna(0) < 50, ["bat_speed", "fast_swing", "swing_length", "attack_angle",
                                          "attack_direction", "swing_tilt", "ideal_aa", "contact_depth",
                                          "squared_up", "blast"]] = None  # < 50 tracked swings: not shown
    for fam in ("fb", "ct", "br", "os"):
        d.loc[d[f"n_{fam}"] < 100, f"rv100_{fam}"] = None  # < 100 pitches of a family: not shown
    d["xwoba_gap"] = d["woba"] - d["xwoba"]
    return d.sort_values(["id", "season"]).reset_index(drop=True)


def verify(d: pd.DataFrame, con) -> None:
    """Our roll-ups against Savant's own boards (same players, same seasons): r and mean diff."""
    checks = [("lb_bat_tracking_{s}", "id", [("bat_speed", "avg_bat_speed", 1), ("swing_length", "swing_length", 1),
                                            ("squared_up", "squared_up_per_swing", 100), ("blast", "blast_per_swing", 100)]),
              ("lb_expected_statistics_batter_{s}", "player_id", [("xwoba", "est_woba", 1), ("xba", "est_ba", 1),
                                                                 ("xslg", "est_slg", 1), ("woba", "woba", 1)]),
              ("lb_swingpath_{s}", "id", [("attack_angle", "attack_angle", 1), ("swing_tilt", "swing_tilt", 1),
                                          ("attack_direction", "attack_direction", 1)]),
              ("lb_batted_{s}", "player_id", [("sweet_spot", "sweet_spot_percent", 1), ("gb", "groundballs_percent", 1),
                                             ("pull", "pull_percent", 1), ("la_mean", "launch_angle_avg", 1)])]
    have = {r[0] for r in con.execute("SHOW TABLES").fetchall()}
    for tpl, key, pairs in checks:
        for s in (2025,):
            t = tpl.format(s=s)
            if t not in have:
                continue
            ref = con.sql(f"SELECT * FROM {t}").df()
            if "side" in ref:
                ref = ref[ref["side"].isin(["Both", "both", "ALL", "All"])] if ref["side"].isin(["Both", "both", "ALL", "All"]).any() else ref.drop_duplicates(key)
            m = d[d["season"] == s].merge(ref.rename(columns={key: "id"}), on="id", suffixes=("", "_sv"))
            for ours, theirs, k in pairs:
                tcol = theirs + "_sv" if theirs in d.columns else theirs
                x = m[[ours, tcol]].dropna()
                if len(x) > 20:
                    print(f"{t:38s} {ours:15s} n {len(x):4d}  r {x[ours].corr(x[tcol] * k):.3f}  "
                          f"mean ours {x[ours].mean():7.3f}  savant {(x[tcol] * k).mean():7.3f}")


if __name__ == "__main__":
    con = mart.connect()
    d = hitter_depth(con)
    print(d.groupby("season").size().to_dict())
    verify(d, con)
    j = d[(d["id"] == 592450) & (d["season"] == 2025)].T
    print(j.to_string())
