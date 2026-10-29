"""D-39 speed tool profile (descriptive): a public-input Speed Score, sprint context, and the
Savant Jump components, per position-player season. RESULTS-MLB has no gate for this — it is a
composition of published Savant aggregates plus two rates computed locally. Reliability is
reported (year-to-year stickiness), not gated: the inputs are season aggregates, so a split-half
within season is not computable from them.

    python speed_tool.py            # writes results/speed_players.csv + results/speed_aging.csv
                                    # and prints the reported YoY

Components (each ranked within its season among players with the component, percentile 0-100):
  sprint  — Savant sprint speed (ft/s)
  sb      — stolen-base runs per PA (lb_baserunning_run_value.runner_runs_SBX; min 100 PA)
  xb      — extra-bases-taken runs per PA (lb_baserunning_run_value.runner_runs_XB; min 100 PA)
  x3b     — triples per ball in play (pitches_all; min 50 BIP)
Speed Score = the mean of the components a player has (sprint required). PA/BIP use the site's
gates (events not null, no truncated PA). Jump (outfielders): Savant's burst / reaction / routing
/ bootup, relative to league — shown beside our range runs per §100, never as a model feature.
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

from paths import MART_DIR  # noqa: E402
sys.path.insert(0, str(MART_DIR))
import mart  # noqa: E402

RES = Path(__file__).resolve().parent / "results"
SEASONS = range(2020, 2027)
MIN_PA, MIN_BIP = 100, 50
MIN_JUMP = 20  # Jump rows: minimum plays (n) to carry the components


def pct(s: pd.Series) -> pd.Series:
    return 100 * s.rank(pct=True)


def main():
    con = mart.connect()
    pa = con.sql("""
        SELECT batter AS id, season, COUNT(DISTINCT CASE WHEN events IS NOT NULL AND events <> 'truncated_pa'
            THEN (game_pk, at_bat_number) END) AS pa,
            COUNT(*) FILTER (WHERE type = 'X') AS bip,
            COUNT(*) FILTER (WHERE events = 'triple') AS x3b
        FROM pitches_all WHERE game_type = 'R' AND season IN (2020, 2021, 2022, 2023, 2024, 2025, 2026)
        GROUP BY 1, 2
    """).df()

    parts = []
    for s in SEASONS:
        sp = con.sql(f"SELECT player_id, sprint_speed, hp_to_1b, bolts, competitive_runs, age, position "
                     f"FROM lb_sprint_speed_{s}").df().rename(columns={"player_id": "id"})
        try:
            brv = con.sql(f"SELECT player_id, runner_runs_SBX, runner_runs_XB FROM lb_baserunning_run_value_{s}"
                          ).df().rename(columns={"player_id": "id"})
        except Exception:  # noqa: BLE001 — a missing season of a board is no-data
            brv = pd.DataFrame(columns=["id", "runner_runs_SBX", "runner_runs_XB"])
        try:
            jump = con.sql(f"SELECT resp_fielder_id, rel_league_burst_distance, rel_league_reaction_distance, "
                           f"rel_league_routing_distance, rel_league_bootup_distance, n FROM lb_outfield_jump_{s}"
                           f" WHERE n >= {MIN_JUMP}").df().rename(columns={"resp_fielder_id": "id"})
        except Exception:  # noqa: BLE001
            jump = pd.DataFrame(columns=["id"])
        d = pa[pa["season"] == s].merge(sp, on="id", how="inner")
        if len(brv):
            d = d.merge(brv, on="id", how="left")
        else:
            d["runner_runs_SBX"] = np.nan
            d["runner_runs_XB"] = np.nan
        d = d.merge(jump, on="id", how="left")
        d["sb_pa"] = np.where(d["pa"] >= MIN_PA, d["runner_runs_SBX"] / d["pa"], np.nan)
        d["xb_pa"] = np.where(d["pa"] >= MIN_PA, d["runner_runs_XB"] / d["pa"], np.nan)
        d["x3b_bip"] = np.where(d["bip"] >= MIN_BIP, d["x3b"] / d["bip"], np.nan)
        # within-season percentiles; sprint is the anchor and required
        d["p_sprint"] = pct(d["sprint_speed"])
        d["p_sb"], d["p_xb"], d["p_x3b"] = pct(d["sb_pa"]), pct(d["xb_pa"]), pct(d["x3b_bip"])
        d["speedScore"] = d[["p_sprint", "p_sb", "p_xb", "p_x3b"]].mean(axis=1, skipna=True).round(1)
        d["season"] = s
        parts.append(d)
    out = pd.concat(parts, ignore_index=True)
    out = out.rename(columns={"sprint_speed": "sprint", "hp_to_1b": "hp1b", "runner_runs_SBX": "sbRuns",
                              "runner_runs_XB": "xbRuns", "x3b": "triples",
                              "rel_league_burst_distance": "jumpBurst", "rel_league_reaction_distance": "jumpReaction",
                              "rel_league_routing_distance": "jumpRouting", "rel_league_bootup_distance": "jumpBootup"})
    keep = ["id", "season", "age", "position", "pa", "bip", "triples", "sprint", "hp1b", "bolts", "competitive_runs",
            "sbRuns", "xbRuns", "sb_pa", "xb_pa", "x3b_bip", "speedScore",
            "jumpBurst", "jumpReaction", "jumpRouting", "jumpBootup"]
    out[keep].round(3).to_csv(RES / "speed_players.csv", index=False)

    # league sprint aging curve (per age, seasons pooled, min 20 player-seasons per age cell)
    age = (out.dropna(subset=["sprint"]).groupby("age")["sprint"]
           .agg(["mean", "std", "count"]).reset_index())
    age = age[age["count"] >= 20]
    age.round(3).to_csv(RES / "speed_aging.csv", index=False)

    rep = {"rows": int(len(out)), "with_sprint": int(out["sprint"].notna().sum()),
           "with_jump": int(out["jumpBurst"].notna().sum()),
           "speedScore_yoy": None, "sprint_yoy": None}
    n = out.assign(season=out["season"] - 1)[["id", "season", "speedScore", "sprint"]]
    j = out.merge(n, on=["id", "season"], suffixes=("", "_next"))
    rep["speedScore_yoy"] = round(float(j["speedScore"].corr(j["speedScore_next"])), 3)
    rep["sprint_yoy"] = round(float(j["sprint"].corr(j["sprint_next"])), 3)
    rep["yoy_n"] = int(len(j))
    (RES / "speed_tool.json").write_text(json.dumps(rep, indent=1))
    print(json.dumps(rep, indent=1))


if __name__ == "__main__":
    main()
