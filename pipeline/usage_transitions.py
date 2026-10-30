"""D-11: pitch-usage back-to-back — what follows what, within a plate appearance. Per pitcher-season,
transition counts between pitch types on consecutive pitches of the same PA, and the same-year league
baseline per transition for contrast (§57 found sequencing sticky but not forecast-useful, so this
ships descriptive beside the arsenal, never as a recommendation).

    python usage_transitions.py     # writes results/pitcher_transitions.csv (+ league rows, lg=1)

Rows: (id, season, lg, from, to, n, p) where p = P(to | from) within PA; a pitcher's rows carry his
pairs with n >= 8, the league rows every pair the same season (any n). Types use the site's SC->site
crosswalk; catch-all types (OO/UN/PO etc.) are dropped.
"""
import sys
from pathlib import Path

import pandas as pd

from paths import MART_DIR  # noqa: E402
sys.path.insert(0, str(MART_DIR))
import mart  # noqa: E402

RES = Path(__file__).resolve().parent / "results"
SEASONS = "2020, 2021, 2022, 2023, 2024, 2025, 2026"
MIN_PAIR = 8
SITE = {"FF": "FF", "SI": "SI", "FC": "CT", "SL": "SL", "SW": "SW", "ST": "SW", "SV": "SL",  # web_export.SC_TO_SITE; EP -> OS (other)
        "CU": "CB", "KC": "CB", "CH": "CH", "FS": "FS", "FO": "FS", "EP": "OS"}


def main():
    con = mart.connect()
    d = con.sql(f"""
        SELECT pitcher AS id, season, game_pk, at_bat_number, pitch_number, pitch_type
        FROM pitches_all
        WHERE game_type = 'R' AND season IN ({SEASONS}) AND pitcher IS NOT NULL
          AND pitch_type IN ('FF','SI','FC','SL','SW','ST','SV','CU','KC','CH','FS','FO','EP')
          AND release_speed BETWEEN 55 AND 105
        ORDER BY game_pk, at_bat_number, pitch_number
    """).df()
    d["from"] = d["pitch_type"].map(SITE)
    d["to"] = d.groupby(["game_pk", "at_bat_number"])["from"].shift(-1)
    d = d.dropna(subset=["from", "to"])
    pairs = (d.groupby(["id", "season", "from", "to"]).size().rename("n").reset_index())
    lg = (d.groupby(["season", "from", "to"]).size().rename("n").reset_index().assign(id=-1, lg=1))
    allp = pd.concat([pairs.assign(lg=0), lg], ignore_index=True)
    allp["p"] = allp["n"] / allp.groupby(["id", "season", "lg", "from"])["n"].transform("sum")
    mine = allp[(allp["lg"] == 0) & (allp["n"] >= MIN_PAIR)].copy()
    lgp = allp[allp["lg"] == 1][["season", "from", "to", "p"]].rename(columns={"p": "lgP"})
    mine = mine.merge(lgp, on=["season", "from", "to"], how="left")
    out = pd.concat([mine, lg], ignore_index=True)
    out[["id", "season", "lg", "from", "to", "n", "p", "lgP"]].round(4).to_csv(RES / "pitcher_transitions.csv", index=False)
    print(f"rows: {len(out)} (pitcher pairs {len(mine)}, league {len(lg)})")


if __name__ == "__main__":
    main()
