"""D-20: the pitch plan — what he throws and how each count plays, descriptive (RESULTS-MLB §61–63).

    python pitch_plan.py            # -> results/pitch_plan.csv (pitcher-season x count) + league rows

§61–63 found MLB pitch usage near equilibrium (no optimal-pitch-edge left to call), so this is a
record, not a recommendation: per pitcher-season and count, his type mix, CSW% and RV/100 with the
league's same-season per-count line beside them. The web panel labels it descriptive.
"""
import sys
from pathlib import Path

import pandas as pd

PIPE = Path(__file__).resolve().parent
sys.path.insert(0, str(PIPE))
from paths import MART_DIR  # noqa: E402
sys.path.insert(0, str(MART_DIR))
import mart  # noqa: E402

SEASONS = list(range(2020, 2027))
MIN_PITCHES = 400  # the site's HIGH-confidence floor for a plan
CSW = ("called_strike", "swinging_strike", "swinging_strike_blocked", "foul_tip")
SITE_OF = {"FF": "FF", "SI": "SI", "FC": "CT", "SL": "SL", "SW": "SW", "ST": "SW",
           "SV": "SL", "CU": "CB", "KC": "CB", "CH": "CH", "FS": "FS", "FO": "FS"}

SQL = """
SELECT pitcher, season, balls, strikes, pitch_type,
       count(*) AS n,
       count(*) FILTER (WHERE description IN ('called_strike','swinging_strike','swinging_strike_blocked','foul_tip')) AS csw,
       sum(CASE WHEN delta_run_exp IS NOT NULL THEN -delta_run_exp ELSE 0 END) AS rv
FROM pitches_all
WHERE game_type = 'R' AND season IN ({seasons}) AND pitcher IS NOT NULL AND pitch_type IS NOT NULL
  AND balls IS NOT NULL AND strikes IS NOT NULL
GROUP BY 1, 2, 3, 4, 5
"""


def main() -> None:
    df = mart.connect().sql(SQL.format(seasons=",".join(map(str, SEASONS)))).df()
    df["site"] = df["pitch_type"].map(SITE_OF).fillna("other")
    df["count"] = df["balls"].astype(str) + "-" + df["strikes"].astype(str)

    # league per-count lines (all pitch types pooled), per season
    lg = df.groupby(["season", "count"]).agg(n=("n", "sum"), csw=("csw", "sum"), rv=("rv", "sum")).reset_index()
    lg["cswPct"] = (100 * lg["csw"] / lg["n"]).round(1)
    lg["rv100"] = (100 * lg["rv"] / lg["n"]).round(2)
    lg[["season", "count", "n", "cswPct", "rv100"]].to_csv(PIPE / "results" / "pitch_plan_league.csv", index=False)

    g = df.groupby(["pitcher", "season", "count"]).agg(n=("n", "sum"), csw=("csw", "sum"), rv=("rv", "sum")).reset_index()
    g = g[g["n"] >= 25]  # a count line under 25 pitches is a footnote, not a rate
    tot = df.groupby(["pitcher", "season"])["n"].sum().rename("total")
    g = g.join(tot, on=["pitcher", "season"])
    g = g[g["total"] >= MIN_PITCHES]
    # his type mix per count: top types by share (up to 3, >= 15%)
    mix = (df.groupby(["pitcher", "season", "count", "site"])["n"].sum().rename("tn").reset_index())
    mix = mix.merge(g[["pitcher", "season", "count", "n"]], on=["pitcher", "season", "count"])
    mix["share"] = 100 * mix["tn"] / mix["n"]
    top = (mix[mix["share"] >= 15].sort_values(["pitcher", "season", "count", "tn"], ascending=[True, True, True, False])
           .groupby(["pitcher", "season", "count"]).head(3)
           .groupby(["pitcher", "season", "count"])["site"]
           .apply(lambda s: " ".join(f"{a} {b:.0f}%" for a, b in
                                     zip(s, mix.loc[s.index].sort_values("tn", ascending=False)["share"]))))
    g = g.merge(top.rename("mix"), on=["pitcher", "season", "count"])
    g["cswPct"] = (100 * g["csw"] / g["n"]).round(1)
    g["rv100"] = (100 * g["rv"] / g["n"]).round(2)
    out = g[["pitcher", "season", "count", "n", "mix", "cswPct", "rv100"]].sort_values(
        ["pitcher", "season", "count"])
    out.to_csv(PIPE / "results" / "pitch_plan.csv", index=False)
    lg_rows = len(lg)
    print(f"pitch_plan.csv: {len(out):,} pitcher-season-count rows; league: {lg_rows} season-count rows")


if __name__ == "__main__":
    main()
