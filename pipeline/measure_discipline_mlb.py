"""measure_discipline_mlb.py — re-measure the plate-discipline half-signal
constants on MLB (wave 3), replacing the college numbers the fork inherited.

METHOD (fixed before looking at any result):
  - Split each season at the median game_date; a rate per pitcher per half.
  - Pearson r between halves across pitchers with >= 25 events in BOTH halves.
  - Fisher-z average r across the three complete seasons 2023-2025, back to r.
  - Spearman-Brown: a full season is both halves, r_full = 2r/(1+r).
  - halfSignal k solves r_full = D/(D+k) with D = the mean FULL-season
    denominator of the measured population -> k = D(1 - r_full)/r_full.
  - 2026 is held out: reported, not pooled, as a stability check.

A metric whose r_full <= 0 ships k = None (the shrinkage would be meaningless;
the surface must not rank it). The gates in lib/discipline.ts stay as they are
until these constants are wired.

    python pipeline/measure_discipline_mlb.py [--out web/lib/measured-mlb.json]
"""
import argparse
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from statistics import NormalDist

ROOT = Path(__file__).resolve().parents[1]
MART_DIR = Path("/Users/brendanwaterval/Projects/vt_baseball/savant_mart")

import sys  # noqa: E402
sys.path.insert(0, str(MART_DIR))
import mart  # noqa: E402

SWING = ("swinging_strike", "swinging_strike_blocked", "foul", "foul_tip",
         "foul_bunt", "missed_bunt", "bunt_foul_tip", "hit_into_play")
WHIFF = ("swinging_strike", "swinging_strike_blocked", "foul_tip")

# rate -> numerator / denominator expressions over a (pitcher, half) aggregate.
# Keys match the board's raw rates (web/lib/boards/pitchers.ts DISCIPLINE_COLUMNS).
METRICS = {
    "zonePct": ("SUM(zone BETWEEN 1 AND 9)", "COUNT(*)"),
    "chasePct": ("SUM(zone BETWEEN 10 AND 14 AND description IN {SWING})", "SUM(zone BETWEEN 10 AND 14)"),
    "zSwingPct": ("SUM(zone BETWEEN 1 AND 9 AND description IN {SWING})", "SUM(zone BETWEEN 1 AND 9)"),
    "zWhiffPct": ("SUM(zone BETWEEN 1 AND 9 AND description IN ('swinging_strike','swinging_strike_blocked','foul_tip'))",
                  "SUM(zone BETWEEN 1 AND 9 AND description IN {SWING})"),
    "oWhiffPct": ("SUM(zone BETWEEN 10 AND 14 AND description IN ('swinging_strike','swinging_strike_blocked','foul_tip'))",
                  "SUM(zone BETWEEN 10 AND 14 AND description IN {SWING})"),
    "zContactPct": ("SUM(zone BETWEEN 1 AND 9 AND description IN {SWING}) - SUM(zone BETWEEN 1 AND 9 AND description IN ('swinging_strike','swinging_strike_blocked','foul_tip'))",
                    "SUM(zone BETWEEN 1 AND 9 AND description IN {SWING})"),
    "oContactPct": ("SUM(zone BETWEEN 10 AND 14 AND description IN {SWING}) - SUM(zone BETWEEN 10 AND 14 AND description IN ('swinging_strike','swinging_strike_blocked','foul_tip'))",
                    "SUM(zone BETWEEN 10 AND 14 AND description IN {SWING})"),
    "swStrPct": ("SUM(description IN ('swinging_strike','swinging_strike_blocked','foul_tip'))", "COUNT(*)"),
    "calledStrikePct": ("SUM(description = 'called_strike')",
                        "SUM(description IN ('called_strike','ball','hit_by_pitch','swinging_strike','foul','foul_tip','swinging_strike_blocked','foul_bunt','missed_bunt','bunt_foul_tip'))"),
    "firstPitchStrikePct": ("SUM(balls = 0 AND strikes = 0 AND type = 'S')", "SUM(balls = 0 AND strikes = 0)"),
    "putawayPct": ("SUM(strikes = 2 AND description IN ('called_strike','swinging_strike','swinging_strike_blocked','foul_tip'))",
                   "SUM(strikes = 2)"),
    "swingPct": ("SUM(description IN {SWING})", "COUNT(*)"),
    "whiffPct": ("SUM(description IN ('swinging_strike','swinging_strike_blocked','foul_tip'))",
                 "SUM(description IN {SWING})"),
}
MIN_HALF_DEN = 25
MEASURE_SEASONS = [2023, 2024, 2025]
HOLDOUT = 2026

# Batter side: rates over pitches SEEN (denominators are event counts against
# him). Directions live in the web lib; this only measures reliability.
BATTER_METRICS = {
    "whiffPct": ("SUM(description IN ('swinging_strike','swinging_strike_blocked','foul_tip'))",
                 "SUM(description IN {SWING})"),
    "contactPct": ("SUM(description IN {SWING}) - SUM(description IN ('swinging_strike','swinging_strike_blocked','foul_tip'))",
                   "SUM(description IN {SWING})"),
    "zWhiffPct": ("SUM(zone BETWEEN 1 AND 9 AND description IN ('swinging_strike','swinging_strike_blocked','foul_tip'))",
                  "SUM(zone BETWEEN 1 AND 9 AND description IN {SWING})"),
    "zContactPct": ("SUM(zone BETWEEN 1 AND 9 AND description IN {SWING}) - SUM(zone BETWEEN 1 AND 9 AND description IN ('swinging_strike','swinging_strike_blocked','foul_tip'))",
                    "SUM(zone BETWEEN 1 AND 9 AND description IN {SWING})"),
    "oSwingPct": ("SUM(zone BETWEEN 10 AND 14 AND description IN {SWING})", "SUM(zone BETWEEN 10 AND 14)"),
    "oContactPct": ("SUM(zone BETWEEN 10 AND 14 AND description IN {SWING}) - SUM(zone BETWEEN 10 AND 14 AND description IN ('swinging_strike','swinging_strike_blocked','foul_tip'))",
                    "SUM(zone BETWEEN 10 AND 14 AND description IN {SWING})"),
    "swStrPct": ("SUM(description IN ('swinging_strike','swinging_strike_blocked','foul_tip'))", "COUNT(*)"),
    "swingPct": ("SUM(description IN {SWING})", "COUNT(*)"),
    "firstPitchSwingPct": ("SUM(balls = 0 AND strikes = 0 AND description IN {SWING})",
                           "SUM(balls = 0 AND strikes = 0)"),
    "twoKChasePct": ("SUM(strikes = 2 AND zone BETWEEN 10 AND 14 AND description IN {SWING})",
                     "SUM(strikes = 2 AND zone BETWEEN 10 AND 14)"),
    "zonePctSeen": ("SUM(zone BETWEEN 1 AND 9)", "COUNT(*)"),
}


def pearson(xs, ys) -> float:
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    sxx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    syy = math.sqrt(sum((y - my) ** 2 for y in ys))
    return sxy / (sxx * syy) if sxx > 0 and syy > 0 else float("nan")


def measure_side(con, metrics: dict, group_col: str) -> tuple[dict, dict]:
    """One side (pitcher or batter): per-season half aggregates -> constants."""
    per_season = {}
    for season in MEASURE_SEASONS + [HOLDOUT]:
        df = con.sql(f"""
            SELECT {group_col} AS id,
                   CASE WHEN game_date <= (SELECT median(game_date) FROM pitches_all
                                           WHERE game_type = 'R' AND season = {season})
                        THEN 1 ELSE 2 END AS half,
                   {", ".join(expr.replace("{SWING}", repr(SWING)).replace("{WHIFF}", repr(WHIFF)) + f" AS m_{k}"
                              for k, (expr, _den) in metrics.items())},
                   {", ".join(den.replace("{SWING}", repr(SWING)).replace("{WHIFF}", repr(WHIFF)) + f" AS d_{k}"
                              for k, (_num, den) in metrics.items() if den != "COUNT(*)")},
                   COUNT(*) AS d_count
            FROM pitches_all
            WHERE game_type = 'R' AND season = {season} AND {group_col} IS NOT NULL
              AND description IS NOT NULL
            GROUP BY 1, 2
        """).df()
        per_season[season] = df
        print(f"  {season}: {len(df)} half rows ({group_col})")

    results, report = {}, {}
    for key in metrics:
        rs, ns = [], []
        rs_hold = []
        for season, df in per_season.items():
            den_col = "d_count" if metrics[key][1] == "COUNT(*)" else f"d_{key}"
            halves = {}
            for h in (1, 2):
                sub = df[df["half"] == h]
                halves[h] = sub[["id", f"m_{key}", den_col]].copy()
            j = halves[1].merge(halves[2], on="id", suffixes=("_1", "_2"))
            j = j[(j[f"{den_col}_1"] >= MIN_HALF_DEN) & (j[f"{den_col}_2"] >= MIN_HALF_DEN)]
            if len(j) < 60:
                continue
            x = (j[f"m_{key}_1"] / j[f"{den_col}_1"]).tolist()
            y = (j[f"m_{key}_2"] / j[f"{den_col}_2"]).tolist()
            r = pearson(x, y)
            if season in MEASURE_SEASONS:
                rs.append(r)
                ns.append(len(j))
            else:
                rs_hold.append(r)
        if not rs:
            print(f"  {key}: insufficient data")
            continue
        z = [0.5 * math.log((1 + r) / (1 - r)) for r in rs]
        w = list(ns)
        zbar = sum(zi * wi for zi, wi in zip(z, w)) / sum(w)
        r_half = (math.exp(2 * zbar) - 1) / (math.exp(2 * zbar) + 1)
        r_full = 2 * r_half / (1 + r_half)
        dens = []
        for season in MEASURE_SEASONS:
            dk = "d_count" if metrics[key][1] == "COUNT(*)" else f"d_{key}"
            d = per_season[season].groupby("id")[dk].sum()
            dens.extend(d[d >= 2 * MIN_HALF_DEN].tolist())
        D = sum(dens) / len(dens)
        k = round(D * (1 - r_full) / r_full) if r_full > 0 else None
        results[key] = k
        r_hold = rs_hold[0] if rs_hold else None
        r_full_hold = (2 * r_hold / (1 + r_hold)) if r_hold is not None and r_hold > 0 else None
        report[key] = {"r_half": round(r_half, 3), "r_full": round(r_full, 3), "D": round(D),
                       "n_per_season": ns, "k": k,
                       "holdout_2026_r_full": round(r_full_hold, 3) if r_full_hold else None}
        print(f"  {key:<22} r_half {r_half:.3f} -> r_full {r_full:.3f}  D {D:>6.0f}  k {k}")
    return results, report


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "web" / "lib" / "measured-mlb.json"))
    args = ap.parse_args()
    con = mart.connect()
    con.execute("SET threads TO 1")  # same determinism rule as the bake

    print("pitchers:")
    p_results, p_report = measure_side(con, METRICS, "pitcher")
    print("batters:")
    h_results, h_report = measure_side(con, BATTER_METRICS, "batter")

    doc = {
        "measured": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "method": ("split-half at the season's median game_date, min 25 events per half per player; "
                   "Pearson r across players, Fisher-z pooled over 2023-2025; Spearman-Brown to the "
                   "full season; k = D(1-r_full)/r_full on the mean full-season denominator. "
                   "2026 held out as a stability check, not pooled."),
        "script": "pipeline/measure_discipline_mlb.py",
        "min_half_den": MIN_HALF_DEN,
        "DISCIPLINE_HALF_PITCHER_MLB": p_results,
        "DISCIPLINE_HALF_HITTER_MLB": h_results,
        "report_pitcher": p_report,
        "report_hitter": h_report,
    }
    out = Path(args.out)
    out.write_text(json.dumps(doc, indent=2, sort_keys=True))
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
