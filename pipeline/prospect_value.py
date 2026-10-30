"""§106: what a top-100 rank returns — prospect value in the site's own §85 WAR.

    python prospect_value.py            # -> results/prospect_value_SEALED.json

Cohorts 2016-2021, tiers by best rank (1-10 / 11-25 / 26-50 / 51-100), value = §85
own-WAR by years since listing inside the 2020-2024 window. First-3-seasons is the
headline column (complete for every cohort); the 4th-5th columns under-count later
cohorts and say so. Descriptive throughout.
"""
import json
import sys
from pathlib import Path

import pandas as pd

PIPE = Path(__file__).resolve().parent
sys.path.insert(0, str(PIPE))
from prospect_spine import load_prospects, load_war, WINDOW  # noqa: E402

TIERS = ["1-10", "11-25", "26-50", "51-100"]


def main() -> None:
    war = load_war()
    pros = load_prospects()  # side comes from Pipeline's position, not from MLB presence

    rows = []
    for r in pros.itertuples():
        w = war[war["id"] == r.id]
        for yrs in range(1, 6):
            m = w[(w["season"] >= r.first_year) & (w["season"] < r.first_year + yrs)]
            rows.append({"id": r.id, "tier": str(r.tier), "side": r.side,
                         "first_year": r.first_year, "yrs": yrs,
                         "war": float(m["war"].sum()), "reached": int((w["pa_ip"] > 0).any())})
    p = pd.DataFrame(rows)

    def tier_table(sub: pd.DataFrame) -> dict:
        out = {}
        for tier in TIERS:
            t = sub[sub["tier"] == tier]
            if not len(t):
                continue
            per = t[t["yrs"] == 1].set_index("id")["war"]
            ids = per.index
            entry = {"n": int(len(ids)),
                     "reached_mlb": round(float(t[t.yrs == 1].set_index("id")["reached"].mean()), 3)}
            for yrs in (1, 2, 3, 5):
                gg = t[t["yrs"] == yrs].set_index("id")["war"].reindex(ids)
                entry[f"war_{yrs}y"] = round(float(gg.mean()), 2)
                entry[f"war_{yrs}y_med"] = round(float(gg.median()), 2)
                entry[f"ge1war_{yrs}y"] = round(float((gg >= 1).mean()), 3)
            out[tier] = entry
        return out

    res = {
        "section": "§106 (prospect value)",
        "window": WINDOW, "cohorts": "2016-2021 (first-3-seasons columns complete)",
        "batters": tier_table(p[p.side == "hitters"]),
        "pitchers": tier_table(p[p.side == "pitchers"]),
        "caveat": ("the 4- and 5-year columns under-count later cohorts (the window ends 2024); "
                   "the first-3-seasons columns are complete for every cohort"),
    }
    print(json.dumps(res, indent=1))
    (PIPE / "results" / "prospect_value_SEALED.json").write_text(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
