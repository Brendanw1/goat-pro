"""D-16 (+ Savant defense): baserunning, fielding and catcher run values from Savant's own leaderboards, per
player-season. Descriptive: these are Savant's published numbers, not site models (D-12/D-13 build those).

    python savant_fielding.py --demo   # prints a few known 2025 leaders

Each lb_* table is one row per qualified player (checked 2026-10-28), so the joins are 1:1.
"""
import sys

from paths import MART_DIR  # noqa: E402
sys.path.insert(0, str(MART_DIR))
import mart  # noqa: E402

# (table stem, id column, {source column: (site key, decimals)})
BOARDS = [
    ("baserunning_run_value", "player_id", {"runner_runs_tot": ("bsrRuns", 2), "runner_runs_XB": ("xbRuns", 2),
                                            "runner_runs_SBX": ("sbRuns", 2)}),
    ("fielding_run_value", "id", {"total_runs": ("frvRuns", 2)}),
    ("outs_above_average", "player_id", {"outs_above_average": ("oaa", 0), "primary_pos_formatted": ("oaaPos", None)}),
    ("catcher_framing", "id", {"rv_tot": ("framingRuns", 2), "pct_tot": ("framingStrikePct", 2)}),
    ("catcher_blocking", "player_id", {"catcher_blocking_runs": ("blockingRuns", 1),
                                       "blocks_above_average": ("blocksAboveAvg", 0)}),
    ("catcher_throwing", "player_id", {"catcher_stealing_runs": ("throwingRuns", 2), "pop_time": ("popTime", 2),
                                       "arm_strength": ("catcherArm", 2)}),
]


def _num(v, nd):
    if v is None or nd is None:
        return v
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return None if x != x else round(x, nd) + 0.0  # + 0.0: no -0.0 in the JSON


def fielding(con, seasons) -> dict:
    """{(mlbam, season): {site key: value}} over every board and season the mart has."""
    have = {r[0] for r in con.sql("SELECT table_name FROM information_schema.tables").fetchall()}
    out: dict = {}
    for stem, idc, cols in BOARDS:
        for s in seasons:
            t = f"lb_{stem}_{s}"
            if t not in have:
                continue
            sel = ", ".join(f'"{c}"' for c in cols)
            for row in con.sql(f'SELECT "{idc}", {sel} FROM {t} WHERE "{idc}" IS NOT NULL').fetchall():
                d = out.setdefault((int(row[0]), int(s)), {})
                for (c, (key, nd)), v in zip(cols.items(), row[1:]):
                    d[key] = _num(v * 100 if c == "pct_tot" and v is not None else v, nd)  # shadow-zone strike rate, as %
    return out


def demo():
    f = fielding(mart.connect(), [2025])
    carroll, bailey = f[(682998, 2025)], f[(672275, 2025)]
    assert carroll["bsrRuns"] == 10.09 and bailey["frvRuns"] == 31.47 and bailey["framingRuns"] is not None, (carroll, bailey)
    print("demo ok", carroll, bailey)


if __name__ == "__main__":
    demo()
