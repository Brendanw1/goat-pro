"""RESULTS-MLB §98 (D-49): is our range residual skill? Our OAA (defense_players_v3, OF) minus Savant's,
per fielder-season, against Savant's Jump components (burst / reaction / routing / bootup, rel league).
Descriptive — no gate.

    python range_residual_jump.py   # writes results/range_residual_jump.json
"""
import json
import sys
from pathlib import Path

import pandas as pd

from paths import MART_DIR  # noqa: E402
sys.path.insert(0, str(MART_DIR))
import mart  # noqa: E402

from defense_mlb import boot_r  # noqa: E402  (§75's player-clustered bootstrap)

RES = Path(__file__).resolve().parent / "results"
SEASONS = range(2020, 2027)
COLS = {"rel_league_burst_distance": "burst", "rel_league_reaction_distance": "reaction",
        "rel_league_routing_distance": "routing", "rel_league_bootup_distance": "bootup"}


def main():
    con = mart.connect()
    dv = pd.read_csv(RES / "defense_players_v3.csv")
    dv = dv[dv["g"] == "OF"]
    js = []
    for s in SEASONS:
        try:
            j = con.sql(f"SELECT resp_fielder_id, year, outs_above_average, rel_league_burst_distance, "
                        f"rel_league_reaction_distance, rel_league_routing_distance, rel_league_bootup_distance "
                        f"FROM lb_outfield_jump_{s}").df()
        except Exception:  # noqa: BLE001 — a missing season view is no-data, not an outage
            continue
        js.append(j.rename(columns=COLS).assign(season=s).rename(columns={"resp_fielder_id": "mlbam"}))
    j = pd.concat(js, ignore_index=True)
    m = dv.merge(j, on=["mlbam", "season"])
    m["resid"] = m["oaa"] - m["outs_above_average"]
    out = {"n": int(len(m)), "n_players": int(m["mlbam"].nunique()), "resid_vs": {}, "oaa_ours_vs": {}}
    for c in ("burst", "reaction", "routing", "bootup"):
        out["resid_vs"][c] = boot_r(m["resid"], m[c], m["mlbam"])
        out["oaa_ours_vs"][c] = boot_r(m["oaa"], m[c], m["mlbam"])
    out["resid_vs"]["savant_oaa"] = boot_r(m["resid"], m["outs_above_average"], m["mlbam"])
    (RES / "range_residual_jump.json").write_text(json.dumps(out, indent=1))
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
