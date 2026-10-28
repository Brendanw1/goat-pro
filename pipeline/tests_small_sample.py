"""Small-sample regime test: does Stuff+ beat observed CSW% when the sample is thin?

    python tests_small_sample.py

tests_naive.py's thin cell (n=65, season-to-season) could not answer this. Here
the design is within-season, on out-of-train seasons (2025 primary; 2026 shown
but flagged -- its plate_z convention shift moves hvaa):

  For each pitcher-season, take his first N pitches (chronological). Grade them
  with the frozen v1 Stuff+ (fastball anchors recomputed on those N pitches
  only, so no future pitch leaks in), and compute his CSW% on the same N.
  Target: CSW% over the REST of that season (>= 300 taken pitches remaining).

At each N: r(grade, rest), r(naive CSW%, rest), and 5-fold CV R^2 of
naive-only vs naive + grade. Within one N every pitcher has the same sample,
so shrinking naive toward the mean is a linear map and cannot change r --
the comparison is fair. Subset "debut": no pitches in the prior season.

Writes results/small_sample.json.
"""

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from train_mlb import (  # noqa: E402
    STUFF_FEATURES, crossfit, frozen_scale, load_features, season_grades, train_boosters)

RESULTS = Path(__file__).resolve().parent / "results"
NS = (25, 50, 100, 200, 400)
MIN_REST = int(next((a for a in sys.argv[1:] if a.isdigit()), 300))  # survivorship sensitivity
SEASONS = (2025, 2026)
# --aaa: keep demoted pitchers -- their rest-of-season AAA CSW% (low-altitude parks)
# minus the paired MLB-AAA level gap (RESULTS-MLB §14/§15) fills the missing MLB rest
AAA_FILL = "--aaa" in sys.argv
CROSSFIT = "--crossfit" in sys.argv
# --dump: also write every (season, N, pitcher) row for blend_eb.py; adds 2024 (cross-fit grades
# are honest there) as the season the blend is fitted on
DUMP = "--dump" in sys.argv
AAA_GAP = -0.018  # MLB - AAA CSW, within pitcher-season, 2023-26 (-1.6 to -2.0 pts)
TAKEN = ("called_strike", "ball", "hit_by_pitch", "swinging_strike", "foul", "foul_tip",
         "swinging_strike_blocked", "foul_bunt", "missed_bunt", "bunt_foul_tip")
CSW = ("called_strike", "swinging_strike", "swinging_strike_blocked")


def aaa_rest(season: int, cut: pd.Series) -> pd.DataFrame:
    """Per pitcher: AAA taken pitches after his cut date -> csw sum, size."""
    import mart
    con = mart.connect()
    a = con.sql(f"SELECT pitcher, CAST(game_date AS DATE) AS d, description FROM pitches_aaa "
                f"WHERE game_type = 'R' AND CAST(game_year AS INT) = {season} "
                f"AND home_team NOT IN ('ABQ','RNO','SL','ELP','LV') "
                f"AND description IN {TAKEN}").df()
    a = a.join(cut.rename("cut"), on="pitcher").dropna(subset=["cut"])
    # the MLB frame (`pitches` view) can end before the season does (2026: Aug 7);
    # AAA after that date would read as a demotion
    mlb_end = con.sql(f"SELECT max(CAST(game_date AS DATE)) FROM pitches_all "
                      f"WHERE season = {season} AND game_type = 'R'").fetchone()[0]
    a = a[(a["d"] > a["cut"]) & (a["d"] <= pd.Timestamp(mlb_end))]
    a["csw"] = a["description"].isin(CSW).astype(float)
    return a.groupby("pitcher")["csw"].agg(aaa_sum="sum", aaa_n="size")


def reanchor(sub: pd.DataFrame) -> pd.DataFrame:
    """Recompute the pitcher fastball anchors (train_mlb.load_features) on sub only."""
    sub = sub.copy()
    sub["fb_velo"] = sub.groupby("pitcher")["velo"].transform(lambda s: s.quantile(0.95))
    sub["velo_diff"] = sub["velo"] - sub["fb_velo"]
    near = sub[(sub["velo"] - sub["fb_velo"]).abs() <= 2.5]
    means = near.groupby("pitcher")[["ivb", "hb"]].mean().rename(
        columns={"ivb": "ivb_ref", "hb": "hb_ref"})
    sub = sub.join(means, on="pitcher")
    sub["ivb_diff"] = sub["ivb"] - sub["ivb_ref"].fillna(sub["ivb"])
    sub["hb_diff"] = sub["hb"] - sub["hb_ref"].fillna(sub["hb"])
    return sub.drop(columns=["ivb_ref", "hb_ref"])


def cv_r2(y, X, k=5, seed=0):
    """Out-of-fold R^2 of OLS y ~ X (intercept added)."""
    idx = np.random.default_rng(seed).permutation(len(y))
    pred = np.empty(len(y))
    for f in np.array_split(idx, k):
        tr = np.setdiff1d(idx, f)
        X1 = np.column_stack([np.ones(len(tr)), X[tr]])
        beta, *_ = np.linalg.lstsq(X1, y[tr], rcond=None)
        pred[f] = np.column_stack([np.ones(len(f)), X[f]]) @ beta
    return 1 - np.sum((y - pred) ** 2) / np.sum((y - y.mean()) ** 2)


def main() -> None:
    df = load_features()
    e_csw = (df[df["train_season"] & (df["pa_taken"] == 1)]
             .groupby(["balls", "strikes"])["csw"].mean().rename("e_csw_count"))
    df = df.join(e_csw, on=["balls", "strikes"])
    df["csw_norm"] = np.where(df["pa_taken"] == 1, df["csw"] / df["e_csw_count"], np.nan)
    print("training stuff boosters (v1 spec)...", flush=True)
    bst = train_boosters(df, STUFF_FEATURES, "csw_norm", mono=True)
    if CROSSFIT:  # no pitcher graded by a model that saw him (RESULTS-MLB §17)
        bst = crossfit(df, lambda d: train_boosters(d, STUFF_FEATURES, "csw_norm", mono=True))
    refs = frozen_scale(df, bst, STUFF_FEATURES, "csw_norm")

    results, tables = {}, []
    for season in ((2024,) + SEASONS if DUMP else SEASONS):
        sdf = df[df["season"] == season].copy()  # already chronological (load order)
        sdf["k"] = sdf.groupby("pitcher").cumcount()
        prior = set(df.loc[df["season"] == season - 1, "pitcher"].unique())
        for n in NS:
            first, rest = sdf[sdf["k"] < n], sdf[sdf["k"] >= n]
            rest_t = rest[rest["pa_taken"] == 1].groupby("pitcher")["csw"].agg(["mean", "size"])
            # range restriction: spread of first-N CSW% among all arms vs survivors
            taken = first[first["pa_taken"] == 1].groupby("pitcher")["csw"]
            all_naive = taken.mean()[taken.size() >= n // 3]
            surv_naive = all_naive[all_naive.index.isin(rest_t.index[rest_t["size"] >= MIN_REST])]
            print(f"{season} N={n:>3} naive SD all {100 * all_naive.std():.2f} (n={len(all_naive)}) "
                  f"vs survivors {100 * surv_naive.std():.2f} (n={len(surv_naive)})")
            if AAA_FILL:
                cut = first.groupby("pitcher")["game_date"].max()
                rest_t = rest_t.join(aaa_rest(season, cut), how="outer").fillna(0)
                mlb_sum = rest_t["mean"] * rest_t["size"]
                total = rest_t["size"] + rest_t["aaa_n"]
                rest_t["mean"] = (mlb_sum + rest_t["aaa_sum"]
                                  + AAA_GAP * rest_t["aaa_n"]) / total.where(total > 0)
                rest_t["filled"] = rest_t["size"] < MIN_REST
                rest_t["size"] = total
            rest_t = rest_t[rest_t["size"] >= MIN_REST]
            first = first[first["pitcher"].isin(rest_t.index)]
            rows, _ = season_grades(reanchor(first), "stuff", bst, refs, STUFF_FEATURES)
            g = pd.DataFrame([{"pitcher": r["mlbam"], "grade": r["grade"]} for r in rows])
            taken_first = first[first["pa_taken"] == 1].groupby("pitcher")["csw"]
            naive = taken_first.mean().rename("naive")
            j = (g.join(naive, on="pitcher").join(taken_first.size().rename("n_taken"), on="pitcher")
                 .join(rest_t["mean"].rename("rest"), on="pitcher").dropna())
            j[["naive", "rest"]] *= 100
            tables.append(j.assign(season=season, N=n))
            subsets = [("all", j), ("debut", j[~j["pitcher"].isin(prior)])]
            if AAA_FILL:
                filled = set(rest_t.index[rest_t["filled"].astype(bool)])
                subsets.append(("demoted", j[j["pitcher"].isin(filled)]))
            for subset, d in subsets:
                if len(d) < 30:
                    continue
                y = d["rest"].to_numpy()
                cell = {
                    "n": len(d),
                    "grade_r": round(float(np.corrcoef(d["grade"], y)[0, 1]), 3),
                    "naive_r": round(float(np.corrcoef(d["naive"], y)[0, 1]), 3),
                    "cv_r2_naive": round(float(cv_r2(y, d[["naive"]].to_numpy())), 3),
                    "cv_r2_grade": round(float(cv_r2(y, d[["grade"]].to_numpy())), 3),
                    "cv_r2_both": round(float(cv_r2(y, d[["naive", "grade"]].to_numpy())), 3),
                }
                cell["grade_beats_naive"] = cell["grade_r"] > cell["naive_r"]
                results[f"{season} N={n} {subset}"] = cell
                print(f"{season} N={n:>3} {subset:5}: grade r={cell['grade_r']:.3f} "
                      f"naive r={cell['naive_r']:.3f} | CV R2 naive {cell['cv_r2_naive']:.3f} "
                      f"grade {cell['cv_r2_grade']:.3f} both {cell['cv_r2_both']:.3f} "
                      f"(n={cell['n']})", flush=True)

    RESULTS.mkdir(exist_ok=True)
    (RESULTS / (f"small_sample{'_aaa' if AAA_FILL else ''}{'_crossfit' if CROSSFIT else ''}"
                f"{'' if MIN_REST == 300 else f'_rest{MIN_REST}'}.json")).write_text(json.dumps(results, indent=1))
    if DUMP:
        pd.concat(tables).to_csv(RESULTS / "small_sample_rows.csv", index=False)
    print("-> results/small_sample.json")


if __name__ == "__main__":
    main()
