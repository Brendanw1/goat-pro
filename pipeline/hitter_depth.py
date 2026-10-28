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
  SELECT {who} AS id, season, stand, pitch_type, description, events, bb_type, launch_speed AS ev,
         launch_angle AS la, launch_speed_angle, hc_x, hc_y, release_speed, bat_speed, swing_length, attack_angle,
         attack_direction, swing_path_tilt, intercept_ball_minus_batter_pos_y_inches AS depth,
         CAST(estimated_ba_using_speedangle AS DECIMAL(9, 4)) AS xba, CAST(estimated_slg_using_speedangle AS DECIMAL(9, 4)) AS xslg,
         CAST(estimated_woba_using_speedangle AS DECIMAL(9, 4)) AS xw, CAST(woba_value AS DECIMAL(9, 4)) AS woba_value, woba_denom,
         CAST(delta_run_exp AS DECIMAL(18, 6)) AS rv,  -- exact sums: parallel DOUBLE sums flipped a 3-dp rounding between bakes
         description = 'hit_into_play' AS bip,
         description IN ('swinging_strike','swinging_strike_blocked','foul','foul_tip','hit_into_play') AS swing,
         CASE WHEN hc_x IS NOT NULL THEN degrees(atan2(hc_x - 125.42, 198.27 - hc_y))
                * CASE WHEN stand = 'L' THEN 1 ELSE -1 END END AS pull_ang,   -- + = pulled
         CASE WHEN pitch_type IN ('FF','SI') THEN 'fb' WHEN pitch_type = 'FC' THEN 'ct'
              WHEN pitch_type IN ('SL','ST','SV','CU','KC') THEN 'br'
              WHEN pitch_type IN ('CH','FS','FO','SC') THEN 'os' END AS fam
  FROM {tbl}
  WHERE game_type = 'R' AND season IN ({seasons}) AND {who} IS NOT NULL
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
         avg((ev >= 95)::INT) FILTER (WHERE bip AND ev IS NOT NULL) AS hard_hit,
         avg((launch_speed_angle = 6)::INT) FILTER (WHERE bip AND launch_speed_angle IS NOT NULL) AS barrel,
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
    d = con.sql(SQL.format(tbl=tbl, who="batter", seasons=",".join(map(str, seasons)))).df()
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


def pitcher_depth(con=None, seasons=(2023, 2024, 2025, 2026), level: str = "mlb") -> pd.DataFrame:
    """The same roll-up from the mound (>= 50 batters faced): contact and bat tracking AGAINST him.
    rv100 is flipped to pitcher-positive, like every pitcher run value on the site."""
    con = con or mart.connect()
    tbl = "pitches_aaa" if level == "aaa" else "pitches_all"
    d = con.sql(SQL.format(tbl=tbl, who="pitcher", seasons=",".join(map(str, seasons)))).df()
    pct = ["gb", "ld", "fb", "pu", "pull", "oppo", "pull_air", "sweet_spot", "squared_up", "blast", "hard_hit", "barrel"]
    d[pct] = 100 * d[pct]
    d.loc[d["n_tracked"].fillna(0) < 50, ["bat_speed", "squared_up", "blast"]] = None
    rv = ["rv100", "rv100_fb", "rv100_ct", "rv100_br", "rv100_os"]
    d[rv] = -d[rv]
    for fam in ("fb", "ct", "br", "os"):
        d.loc[d[f"n_{fam}"] < 100, f"rv100_{fam}"] = None
    d["xwoba_gap"] = d["woba"] - d["xwoba"]
    return d.sort_values(["id", "season"]).reset_index(drop=True)


TREND_SQL = """
SELECT {who} AS id, season, substr(CAST(game_date AS VARCHAR), 6, 5) AS d,
       count(*) FILTER (WHERE events IS NOT NULL) AS pa,
       coalesce(sum(woba_value) FILTER (WHERE woba_denom > 0), 0) AS wn,
       coalesce(sum(CASE WHEN description = 'hit_into_play' AND estimated_woba_using_speedangle IS NOT NULL
                    THEN estimated_woba_using_speedangle ELSE woba_value END) FILTER (WHERE woba_denom > 0), 0) AS xn,
       coalesce(sum(woba_denom), 0) AS den, coalesce(sum(delta_run_exp), 0) AS rv,
       count(*) AS np, count(*) FILTER (WHERE sw) AS sw, count(*) FILTER (WHERE wh) AS wh,
       count(*) FILTER (WHERE zone > 10) AS oz, count(*) FILTER (WHERE zone > 10 AND sw) AS ch,
       count(*) FILTER (WHERE zone BETWEEN 1 AND 9) AS iz, count(*) FILTER (WHERE zone BETWEEN 1 AND 9 AND sw) AS izs,
       count(*) FILTER (WHERE zone BETWEEN 1 AND 9 AND sw AND NOT wh) AS izc,
       count(*) FILTER (WHERE description = 'called_strike') AS cs,
       count(*) FILTER (WHERE events IN ('strikeout', 'strikeout_double_play')) AS k,
       count(*) FILTER (WHERE events IN ('walk', 'intent_walk')) AS bb,
       count(*) FILTER (WHERE bbe) AS bbe, count(*) FILTER (WHERE bbe AND launch_speed >= 95) AS hh,
       count(*) FILTER (WHERE bbe AND launch_speed_angle = 6) AS brl,
       count(*) FILTER (WHERE bbe AND launch_angle BETWEEN 8 AND 32) AS ss,
       coalesce(sum(launch_speed) FILTER (WHERE bbe), 0) AS evs,
       list(round(launch_speed, 1)) FILTER (WHERE bbe) AS evl,
       coalesce(sum(bat_speed) FILTER (WHERE sw AND bat_speed IS NOT NULL), 0) AS bs,
       count(*) FILTER (WHERE sw AND bat_speed IS NOT NULL) AS bsn,
       coalesce(sum(release_speed) FILTER (WHERE pitch_type IN ('FF', 'SI')), 0) AS fbv,
       count(*) FILTER (WHERE pitch_type IN ('FF', 'SI') AND release_speed IS NOT NULL) AS fbn
FROM (SELECT *, description IN ('swinging_strike', 'swinging_strike_blocked', 'foul_tip', 'foul', 'foul_bunt',
                                'hit_into_play', 'missed_bunt', 'bunt_foul_tip') AS sw,
             description IN ('swinging_strike', 'swinging_strike_blocked', 'foul_tip') AS wh,
             type = 'X' AND launch_speed IS NOT NULL AS bbe
      FROM {tbl} WHERE game_type = 'R' AND season IN ({seasons}) AND {who} IS NOT NULL)
GROUP BY 1, 2, 3 ORDER BY 1, 2, 3
"""
# counts per game date after the first six (wOBA trend) columns; whiff/chase per Savant (whiff counts foul tips)
ROLL_COLS = ["np", "sw", "wh", "oz", "ch", "iz", "izs", "izc", "cs", "k", "bb", "bbe", "hh", "brl", "ss", "evs",
             "bs", "bsn", "fbv", "fbn"]
CACHE = Path(__file__).resolve().parent.parent / "cache"


def whiff_z(con, seasons) -> pd.DataFrame:
    """Per pitcher x game date: sum and count of per-pitch Whiff+ z (cache/pred_s4_bb.parquet, the cross-fit
    behind the site's Whiff+). That cache has no game key, but its rows are train_mlb.FEATURE_SQL's rows in
    order (checked: identical pitcher/season/type/stand/whiff/swing on all 4.5M rows); asserted again here.
    z = (pred - mean) / sd of TRAIN pitcher means by class x batter hand (frozen_scale); 100 + 10 x mean z
    reproduces the season grades at r .994."""
    import train_mlb as tm
    p = pd.read_parquet(CACHE / "pred_s4_bb.parquet")
    q = con.sql(f"SELECT CAST(game_date AS VARCHAR) AS gd, pitcher, season, pitch_type, stand, whiff, swing "
                f"FROM ({tm.FEATURE_SQL.format(lo=int(p.season.min()), hi=2026)})").df()
    q = q[q["pitch_type"].map(tm.CLASS_OF).notna()].reset_index(drop=True)
    assert len(q) == len(p) and all((q[c].to_numpy() == p[c].to_numpy()).all()
                                    for c in ("pitcher", "season", "pitch_type", "stand", "whiff", "swing")), "pred cache drifted"
    p["pclass"], p["d"] = p["pitch_type"].map(tm.CLASS_OF), q["gd"].str[5:10]
    tr = p[p["season"].isin(tm.TRAIN_SEASONS) & (p["swing"] == 1)]
    pm = tr.groupby(["pclass", "stand", "pitcher"])["pred"].agg(["mean", "count"])
    ref = pm[pm["count"] >= 10].groupby(["pclass", "stand"])["mean"].agg(["mean", "std"])
    r = p.join(ref, on=["pclass", "stand"])
    p["z"] = (p["pred"] - r["mean"]) / r["std"]
    p = p[p["season"].isin(seasons)]
    return p.groupby(["pitcher", "season", "d"])["z"].agg(wz="sum", wzn="count").reset_index().rename(columns={"pitcher": "id"})


def decision_drv(seasons) -> pd.DataFrame:
    """Per batter x game date: sum and count of per-pitch decision value (decision_model.py --artifacts)."""
    p = pd.read_parquet(CACHE / "decision_pitches.parquet")
    p = p[p["season"].isin(seasons)]
    return p.groupby(["batter", "season", "d"])["drv"].agg(dv="sum", dvn="count").reset_index().rename(columns={"batter": "id"})


def trends(con=None, seasons=(2023, 2024, 2025, 2026), who: str = "batter", level: str = "mlb") -> dict:
    """{(id, season): {"cols", "rows", "lg"}}: one row per game date, [mm-dd, PA, wOBA numerator, xwOBA
    numerator, wOBA denominator, run value, *ROLL_COLS, EV list, model sums], RV signed good-for-him
    (batter-positive for hitters, pitcher-positive for pitchers). Model sums (MLB only, else 0): pitchers
    Whiff+ z sum/count, hitters dRV sum/count. "lg": that season's league wOBA, xwOBA, the column sums
    (rates for the reference line) and EV90, plus Decision+'s season mean/SD of dRV/100."""
    con = con or mart.connect()
    tbl = "pitches_aaa" if level == "aaa" else "pitches_all"
    g = con.sql(TREND_SQL.format(tbl=tbl, who=who, seasons=",".join(map(str, seasons)))).df()
    sign = 1 if who == "batter" else -1
    mk, mn = ("wz", "wzn") if who == "pitcher" else ("dv", "dvn")
    try:
        m = (whiff_z(con, seasons) if who == "pitcher" else decision_drv(seasons)) if level == "mlb" else None
    except FileNotFoundError:
        m = None
    g = g.merge(m, on=["id", "season", "d"], how="left") if m is not None else g.assign(**{mk: 0.0, mn: 0})
    g[[mk, mn]] = g[[mk, mn]].fillna(0)
    cols = ["d", "pa", "wn", "xn", "den", "rv", *ROLL_COLS, "evl", mk, mn]
    dec = {}
    if who == "batter" and level == "mlb" and (Path(__file__).resolve().parent / "results" / "decisions_hitters.csv").exists():
        dh = pd.read_csv(Path(__file__).resolve().parent / "results" / "decisions_hitters.csv")
        dh = dh[dh["pa"] >= 100]
        dec = {int(s): {"mu": round(float(x.drv100.mean()), 4), "sd": round(float(x.drv100.std()), 4)}
               for s, x in dh.groupby("season")}
    lg = {}
    for s, x in g.groupby("season"):
        if x.den.sum() <= 0:
            continue
        evs = pd.Series([v for l in x["evl"] if hasattr(l, "__len__") for v in l])
        lg[int(s)] = {"woba": round(float(x.wn.sum() / x.den.sum()), 3), "xwoba": round(float(x.xn.sum() / x.den.sum()), 3),
                      "sums": {c: round(float(x[c].sum()), 1) for c in ["pa", "den", "xn", "wn", *ROLL_COLS, mk, mn]},
                      "ev90": round(float(evs.quantile(.9)), 1) if len(evs) else None, "dec": dec.get(int(s))}
    out = {}
    for (i, s), x in g.groupby(["id", "season"]):
        out[(int(i), int(s))] = {
            "cols": cols, "lg": lg.get(int(s)),
            "rows": [[r.d, int(r.pa), round(float(r.wn), 2), round(float(r.xn), 3), int(r.den), round(sign * float(r.rv), 3),
                      *[round(float(getattr(r, c)), 1) if c in ("evs", "bs", "fbv") else int(getattr(r, c)) for c in ROLL_COLS],
                      [float(v) for v in r.evl] if hasattr(r.evl, "__len__") else [], round(float(getattr(r, mk)), 3), int(getattr(r, mn))]
                     for r in x.itertuples()]}
    return out


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


def demo(con) -> None:
    """Self-check: trend rows sum back to the season roll-up, and the pitcher RV sign flips."""
    h = hitter_depth(con, seasons=(2025,)).set_index("id")
    t = trends(con, seasons=(2025,), who="batter")[(592450, 2025)]
    wn, xn, den = (sum(r[k] for r in t["rows"]) for k in (2, 3, 4))
    assert abs(wn / den - h.loc[592450, "woba"]) < 0.002 and abs(xn / den - h.loc[592450, "xwoba"]) < 0.002
    p = pitcher_depth(con, seasons=(2025,)).set_index("id")
    tp = trends(con, seasons=(2025,), who="pitcher")[(554430, 2025)]
    rv = sum(r[5] for r in tp["rows"])
    assert abs(100 * rv / p.loc[554430, "n_fb":"n_os"].sum() - p.loc[554430, "rv100"]) < 0.3, rv
    print("demo ok")


if __name__ == "__main__":
    con = mart.connect()
    if "--demo" in sys.argv:
        demo(con)
        sys.exit()
    d = hitter_depth(con)
    print(d.groupby("season").size().to_dict())
    verify(d, con)
    j = d[(d["id"] == 592450) & (d["season"] == 2025)].T
    print(j.to_string())
