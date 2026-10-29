"""Deception+ (model request 2): swing disruption as a pitcher trait.

    python deception_plus.py        # metrics, reliability, forecast gates

Pre-registered (PREREG-deception-plus.md, written first). Reproduces the
deception family's batter-normed bat-tracking deltas as pitcher-season traits,
adds shrinkage (K=400), then tests split-half and year-to-year reliability and
— the grade gate — whether the traits add to forecasting next-season CSW%
beyond naive persistence and cross-fit Stuff+.
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import LinearRegression
from sklearn.model_selection import GroupKFold

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "pipeline"))
sys.path.insert(0, str(Path.home() / "Projects" / "vt_baseball" / "savant_mart"))
import mart  # noqa: E402

RESULTS = ROOT / "pipeline" / "results"
MIN_SWINGS = 200
K_SHRINK = 400.0
SEED = 11

CSW = "('called_strike', 'swinging_strike', 'swinging_strike_blocked', 'foul_tip')"
K_EVENTS = "('strikeout', 'strikeout_double_play')"


def main() -> None:
    con = mart.connect()
    con.execute("SET threads TO 4")

    # traits: the shipped family's computation, with swing parity for split-half
    sw = con.sql(f"""
        WITH norms AS (
            SELECT season, batter, avg(bat_speed) AS bs,
                   avg(intercept_ball_minus_batter_pos_y_inches) AS ic
            FROM pitches_all
            WHERE game_type = 'R' AND season BETWEEN 2023 AND 2026 AND bat_speed IS NOT NULL
            GROUP BY 1, 2 HAVING count(*) >= 100
        ),
        seq AS (
            SELECT p.pitcher, p.season, p.bat_speed - n.bs AS d_bs,
                   abs(p.intercept_ball_minus_batter_pos_y_inches - n.ic) AS d_ic,
                   row_number() OVER (PARTITION BY p.season, p.pitcher
                                      ORDER BY game_pk, at_bat_number, pitch_number) AS k
            FROM pitches_all p JOIN norms n ON n.season = p.season AND n.batter = p.batter
            WHERE p.game_type = 'R' AND p.season BETWEEN 2023 AND 2026 AND p.bat_speed IS NOT NULL
        )
        SELECT pitcher, season,
               count(*) AS n,
               avg(d_bs) AS d_bs, avg(d_ic) AS d_ic,
               avg(CASE WHEN k % 2 = 1 THEN d_bs END) AS d_bs_odd,
               avg(CASE WHEN k % 2 = 0 THEN d_bs END) AS d_bs_even,
               avg(CASE WHEN k % 2 = 1 THEN d_ic END) AS d_ic_odd,
               avg(CASE WHEN k % 2 = 0 THEN d_ic END) AS d_ic_even
        FROM seq GROUP BY 1, 2 HAVING count(*) >= {MIN_SWINGS}
    """).df()

    # outcomes: CSW% per pitch and K% per PA per pitcher-season
    out = con.sql(f"""
        SELECT pitcher, season,
               100.0 * count(*) FILTER (WHERE description IN {CSW}) / count(*) AS csw,
               count(*) AS np_
        FROM pitches_all
        WHERE game_type = 'R' AND season BETWEEN 2023 AND 2026
          AND description IS NOT NULL AND pitcher IS NOT NULL
        GROUP BY 1, 2 HAVING count(*) >= 500
    """).df()
    pa = con.sql(f"""
        WITH p AS (
            SELECT game_pk, pitcher, season, at_bat_number, max(events) AS ev
            FROM pitches_all
            WHERE game_type = 'R' AND season BETWEEN 2023 AND 2026 AND pitcher IS NOT NULL
            GROUP BY 1, 2, 3, 4
        )
        SELECT pitcher, season, count(*) AS pa,
               100.0 * count(*) FILTER (WHERE ev IN {K_EVENTS}) / count(*) AS kpct
        FROM p GROUP BY 1, 2 HAVING count(*) >= 150
    """).df()

    grades = pd.DataFrame(json.loads((ROOT / "data" / "export" / "mlb_pitcher_grades.json").read_text())["grades"])
    grades = grades[["mlbam", "season", "stuff_plus_abs"]]

    df = (sw.merge(out, on=["pitcher", "season"])
             .merge(pa, on=["pitcher", "season"])
             .merge(grades, left_on=["pitcher", "season"], right_on=["mlbam", "season"], how="left")
             .drop(columns=["mlbam"]))
    for m in ("d_bs", "d_ic"):
        lg = df[m].mean()
        df[m + "_shrunk"] = lg + df["n"] / (df["n"] + K_SHRINK) * (df[m] - lg)

    # gate 1: split-half + YTY reliability
    g1 = {}
    for m in ("d_bs", "d_ic"):
        sh = df[[m + "_odd", m + "_even"]].dropna()
        g1[m] = {
            "split_half": round(float(sh[m + "_odd"].corr(sh[m + "_even"])), 3),
            "n_split": len(sh),
        }
    yty = {}
    for m in ("d_bs", "d_ic"):
        a = df[["pitcher", "season", m + "_shrunk"]].copy()
        b = a.copy()
        b["season"] -= 1
        j = a.merge(b, on=["pitcher", "season"], suffixes=("", "_n"))
        yty[m] = {"yty": round(float(j[m + "_shrunk"].corr(j[m + "_shrunk_n"])), 3), "n": len(j)}
    traits_pass = (g1["d_bs"]["split_half"] >= 0.50 and g1["d_ic"]["split_half"] >= 0.50
                   and yty["d_bs"]["yty"] >= 0.35 and yty["d_ic"]["yty"] >= 0.35)

    # gate 2: does deception add to next-season CSW% beyond naive + Stuff+?
    a = df.copy()
    b = a.copy()
    b["season"] -= 1  # (N -> N+1): join N's traits to N+1's outcomes
    pairs = (b[["pitcher", "season", "csw", "kpct"]].rename(columns={"csw": "csw_next", "kpct": "kpct_next"})
             .merge(a[["pitcher", "season", "csw", "kpct", "stuff_plus_abs",
                       "d_bs_shrunk", "d_ic_shrunk", "n"]], on=["pitcher", "season"])
             .dropna(subset=["stuff_plus_abs"]))
    def cv(cols):
        gk = GroupKFold(n_splits=5)
        preds = np.zeros(len(pairs))
        for tr, te in gk.split(pairs, pairs["csw_next"], groups=pairs["pitcher"]):
            Xtr = (pairs.iloc[tr][cols] - pairs.iloc[tr][cols].mean()) / pairs.iloc[tr][cols].std()
            Xte = (pairs.iloc[te][cols] - pairs.iloc[tr][cols].mean()) / pairs.iloc[tr][cols].std()
            m = LinearRegression().fit(Xtr, pairs.iloc[tr]["csw_next"])
            preds[te] = m.predict(Xte)
        ss = 1 - ((pairs["csw_next"] - preds) ** 2).sum() / ((pairs["csw_next"] - pairs["csw_next"].mean()) ** 2).sum()
        return float(ss)
    r2_a = cv(["csw"])
    r2_b = cv(["csw", "stuff_plus_abs"])
    r2_c = cv(["csw", "stuff_plus_abs", "d_bs_shrunk", "d_ic_shrunk"])
    delta = r2_c - r2_b
    coef = LinearRegression().fit(
        ((pairs[["csw", "stuff_plus_abs", "d_bs_shrunk", "d_ic_shrunk"]] - pairs[["csw", "stuff_plus_abs", "d_bs_shrunk", "d_ic_shrunk"]].mean()) / pairs[["csw", "stuff_plus_abs", "d_bs_shrunk", "d_ic_shrunk"]].std()),
        pairs["csw_next"]).coef_
    forecast_pass = delta >= 0.005 and coef[2] < 0

    verdict = ("SHIP" if (traits_pass and forecast_pass)
               else "TRAIT-ONLY" if traits_pass else "KILL")
    # the grade, only meaningful because the gates passed: 100/10 among
    # qualified seasons, inverted so slower-bats-against-him reads higher
    z = (df["d_bs_shrunk"] - df["d_bs_shrunk"].mean()) / df["d_bs_shrunk"].std()
    df["plus"] = (100 - 10 * z).round(1)
    df[["pitcher", "season", "n", "d_bs", "d_ic", "d_bs_shrunk", "plus"]].rename(
        columns={"d_bs": "d_bs_mean", "d_ic": "d_ic_mean"}).to_csv(
        RESULTS / "deception_plus_scores.csv", index=False)
    out_j = {
        "prereg": "pipeline/PREREG-deception-plus.md",
        "n_seasons": int(len(df)), "n_pairs": int(len(pairs)),
        "min_swings": MIN_SWINGS, "k_shrink": K_SHRINK,
        "gate1_split_half": g1, "gate1_yty": yty, "traits_pass": bool(traits_pass),
        "gate2_r2": {"naive": round(r2_a, 4), "naive_stuff": round(r2_b, 4),
                     "with_deception": round(r2_c, 4), "delta": round(delta, 4)},
        "gate2_coef_d_bs": round(float(coef[2]), 4), "gate2_coef_d_icpt": round(float(coef[3]), 4),
        "forecast_pass": bool(forecast_pass),
        "verdict": verdict,
    }
    (RESULTS / "deception_plus.json").write_text(json.dumps(out_j, indent=1))
    print(json.dumps(out_j, indent=1))


if __name__ == "__main__":
    main()
