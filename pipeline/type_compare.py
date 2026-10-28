"""S1 per-type verdict (COLLABORATION.md S1): candidate vs baseline, one pitch type at a time.

    python type_compare.py results/crossfit_v2_holdout_base_pt.csv results/crossfit_v2_X_pt.csv

Per site type (FF SI CT SL SW CB CH FS) and period (selection: pairs starting 2023-25;
confirmation: 2021-22): r(shrunk type grade, next-season whiff/swing) for both models on the same
pairs, paired pitcher bootstrap of the difference (1000 draws, seed 13), YoY of the type grade,
change-test r. IMPROVES: dr >= 0 both periods, neither CI-negative, change r >= base - .02;
HURT: either period CI-negative; else NEUTRAL.
"""
import json
import sys

import numpy as np
import pandas as pd

from change_test import pairs as change_pairs
from type_grades import MIN_N, SITE, type_table

PERIODS = {"selection": (2023, 2024, 2025), "confirmation": (2021, 2022), "sealed": (2020,)}


def next_pairs(path):
    t, _ = type_table(path)
    nxt = t.assign(season=t["season"] - 1)[["pitcher", "season", "site", "wps", "n_sw", "type_grade"]]
    j = t.merge(nxt, on=["pitcher", "season", "site"], suffixes=("", "_next"))
    return j[(j["n_sw"] >= MIN_N) & (j["n_sw_next"] >= MIN_N)]


def wcorr(x, y, w):
    mx, my = np.average(x, weights=w), np.average(y, weights=w)
    return np.average((x - mx) * (y - my), weights=w) / np.sqrt(
        np.average((x - mx) ** 2, weights=w) * np.average((y - my) ** 2, weights=w))


def boot_dr(g, rng, n=1000):
    """Paired pitcher bootstrap: multinomial pitcher counts as row weights."""
    codes, uniq = pd.factorize(g["pitcher"])
    a, b, y = g["pred_b"].to_numpy(), g["pred_c"].to_numpy(), g["wps_next"].to_numpy()
    d = []
    for _ in range(n):
        w = rng.multinomial(len(uniq), np.full(len(uniq), 1 / len(uniq)))[codes]
        if (w > 0).sum() > 3:
            d.append(wcorr(b, y, w) - wcorr(a, y, w))
    return np.percentile(d, [2.5, 97.5])


def main(base, cand):
    rng = np.random.default_rng(13)
    jb, jc = next_pairs(base), next_pairs(cand)
    keys = ["pitcher", "season", "site"]
    j = jb[keys + ["type_pred", "wps_next", "type_grade", "type_grade_next"]].merge(
        jc[keys + ["type_pred", "type_grade", "type_grade_next"]], on=keys, suffixes=("_b", "_c"))
    j = j.rename(columns={"type_pred_b": "pred_b", "type_pred_c": "pred_c"})
    cb, cc = change_pairs(base), change_pairs(cand)
    rows = []
    for site in ("FF", "SI", "CT", "SL", "SW", "CB", "CH", "FS"):
        for per, seasons in PERIODS.items():
            g = j[(j["site"] == site) & j["season"].isin(seasons)]
            if len(g) < 30:
                continue
            rb, rc = g["pred_b"].corr(g["wps_next"]), g["pred_c"].corr(g["wps_next"])
            lo, hi = boot_dr(g, rng)
            ch = {}
            for tag, c in (("b", cb), ("c", cc)):
                c = c[c["pitch_type"].map(SITE).eq(site) & c["season"].isin(seasons)]
                ch[tag] = c["dp"].corr(c["dr"]) if len(c) >= 30 else np.nan
            rows.append({"site": site, "period": per, "pairs": len(g), "r_base": rb, "r_cand": rc,
                         "dr": rc - rb, "lo": lo, "hi": hi,
                         "yoy_base": g["type_grade_b"].corr(g["type_grade_next_b"]),
                         "yoy_cand": g["type_grade_c"].corr(g["type_grade_next_c"]),
                         "change_base": ch["b"], "change_cand": ch["c"]})
    r = pd.DataFrame(rows)
    verdict = {}
    for site, g in r.groupby("site", sort=False):
        if (g["hi"] < 0).any():
            verdict[site] = "HURT"
        elif {"selection", "confirmation"} <= set(g["period"]) and (g["dr"] >= 0).all() and (g["dr"] > 0).any() and (g["change_cand"] >= g["change_base"] - .02).all():
            verdict[site] = "IMPROVES"
        else:
            verdict[site] = "NEUTRAL"
    print(r.round(3).to_string(index=False))
    print("verdict:", verdict)
    tag = cand.split("crossfit_v2_")[-1].replace("_pt.csv", "")
    out = cand.replace(f"crossfit_v2_{tag}_pt.csv", f"type_compare_{tag}.json")
    with open(out, "w") as f:
        json.dump({"rows": r.round(4).to_dict("records"), "verdict": verdict}, f, indent=1)


if __name__ == "__main__":
    main(*sys.argv[1:3])
