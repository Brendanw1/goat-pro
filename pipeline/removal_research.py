"""§105 (D-47 research): what predicts a 40-man removal at the tender deadline.

    python removal_research.py            # -> results/removal_SEALED.json (the §105 read)
    python removal_research.py --demo     # self-check of the label window logic

Population: every player on any club's 40-man at a tender-date snapshot (Nov 22),
tender cycles 2020-2024; 2025 is the held-out confirmation set. Label: absent from
every club's 40-man by the following Feb 20 = removed; on another club = traded.
Features are what the snapshots plus the mart can see (workload, production, age,
role, 60-day IL at the snapshot, seasons-on-40-man among our snapshots) — no options,
no service class, and the study says so. Gradient boosting, cross-fit grouped by
player, pooled over the cycles. Descriptive: no gate; AUC >= .70 on the 2025 cycle
is the bar for a tracker context column.
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

PIPE = Path(__file__).resolve().parent
sys.path.insert(0, str(PIPE))
from paths import MART_DIR  # noqa: E402
sys.path.insert(0, str(MART_DIR))
import mart  # noqa: E402

ROOT = PIPE.parent
R40 = ROOT / "data" / "rosters40"
CYCLES = (2020, 2021, 2022, 2023, 2024)  # Nov 22 of y -> Feb 20 of y+1
HOLDOUT_CYCLE = 2025
AGE_REF = {"2020-06-30": 2020, "2021-06-30": 2021, "2022-06-30": 2022,
           "2023-06-30": 2023, "2024-06-30": 2024, "2025-06-30": 2025}

SQL_SEASON = """
SELECT pitcher AS id, season,
       sum(CASE WHEN events IN ('field_out','force_out','grounded_into_double_play','fielders_choice','fielders_choice_out','double_play') THEN 1 ELSE 0 END) * 1.0 / 3 AS ip,
       count(*) FILTER (WHERE events IS NOT NULL) AS bf,
       count(*) FILTER (WHERE events IN ('strikeout','strikeout_double_play')) AS k,
       avg(CASE WHEN delta_run_exp IS NOT NULL THEN -delta_run_exp END) AS rv100_pitcher
FROM pitches_all
WHERE game_type = 'R' AND pitcher IS NOT NULL
GROUP BY 1, 2
"""


def demo() -> None:
    # label window: on the tender snapshot, gone from every club by spring = removed;
    # on a different club = traded; same club = retained.
    tender = pd.DataFrame({"team_id": [147, 147, 147], "id": [1, 2, 3]})
    spring = pd.DataFrame({"team_id": [147, 158, 147], "id": [1, 2, 4]})
    lab = label_players(tender, spring)
    assert lab[lab.id == 1].label.iloc[0] == "retained"
    assert lab[lab.id == 2].label.iloc[0] == "traded"
    assert lab[lab.id == 3].label.iloc[0] == "removed"
    print("demo ok")


def label_players(tender: pd.DataFrame, spring: pd.DataFrame) -> pd.DataFrame:
    all_spring = set(spring["id"].astype(int))
    rows = []
    for r in tender.itertuples():
        pid = int(r.id)
        if pid not in all_spring:
            lab = "removed"
        elif int(spring.loc[spring["id"] == pid, "team_id"].iloc[0]) == int(r.team_id):
            lab = "retained"
        else:
            lab = "traded"
        rows.append({"id": pid, "team_id": int(r.team_id), "label": lab})
    return pd.DataFrame(rows)


def seasons_on_roster(ids: set[int], snaps: dict[str, pd.DataFrame]) -> pd.Series:
    counts = {i: 0 for i in ids}
    for df in snaps.values():
        for pid in df["id"].astype(int):
            if pid in counts:
                counts[pid] += 1
    return pd.Series(counts, name="snaps_on_40")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--demo", action="store_true")
    a = ap.parse_args()
    if a.demo:
        demo()
        return
    from sklearn.metrics import roc_auc_score
    from sklearn.model_selection import GroupKFold
    import lightgbm as lgb

    snaps = {f.stem.replace("snap_", ""): pd.read_parquet(f) for f in sorted(R40.glob("snap_*.parquet"))}
    perf = mart.connect().sql(SQL_SEASON).df()
    bats = mart.connect().sql("""
        SELECT batter AS id, season,
               count(*) FILTER (WHERE events IS NOT NULL) AS pa,
               count(*) FILTER (WHERE events IN ('strikeout','strikeout_double_play')) AS k,
               coalesce(sum(woba_value) FILTER (WHERE woba_denom > 0), 0) AS wn,
               coalesce(sum(woba_denom), 0) AS den
        FROM pitches_all WHERE game_type = 'R' AND batter IS NOT NULL GROUP BY 1, 2
    """).df()
    bats["woba"] = bats["wn"] / bats["den"].replace(0, np.nan)
    bats["kPct"] = 100 * bats["k"] / bats["pa"].replace(0, np.nan)

    cycle_rows = []
    for y in (*CYCLES, HOLDOUT_CYCLE):
        tender_f, spring_f = R40 / f"snap_{y}-11-22.parquet", R40 / f"snap_{y + 1}-02-20.parquet"
        if not (tender_f.exists() and spring_f.exists()):
            print(f"cycle {y}: snapshots missing — skipped")
            continue
        tender, spring = pd.read_parquet(tender_f), pd.read_parquet(spring_f)
        lab = label_players(tender, spring)
        il_flag = tender.assign(il=(tender["status_desc"].fillna("").str.contains("60-Day", case=False))) \
                        .groupby("id")["il"].max().rename("il60")
        pos = tender.groupby("id")["pos"].first().rename("pos")
        f = lab.join(il_flag, on="id").join(pos, on="id")
        f["cycle"] = y
        # ending-season production (the season that just finished = y)
        p_perf = perf[perf["season"] == y].set_index("id")
        b_perf = bats[bats["season"] == y].set_index("id")
        f["is_p"] = (f["pos"] == "P").astype(int)
        f["bf"] = f["id"].map(p_perf["bf"]).fillna(f["id"].map(b_perf["pa"]))
        f["kPct"] = np.where(f["is_p"] == 1,
                             f["id"].map(p_perf["k"]) / f["bf"].replace(0, np.nan) * 100,
                             f["id"].map(b_perf["kPct"]))
        f["rv100"] = np.where(f["is_p"] == 1, f["id"].map(p_perf["rv100_pitcher"]), np.nan)
        f["woba"] = np.where(f["is_p"] == 0, f["id"].map(b_perf["woba"]), np.nan)
        f["ip"] = np.where(f["is_p"] == 1, f["id"].map(p_perf["ip"]), np.nan)
        cycle_rows.append(f)
        print(f"cycle {y}: {len(f)} roster players ({(f.label == 'removed').sum()} removed, "
              f"{(f.label == 'traded').sum()} traded)")

    panel = pd.concat(cycle_rows, ignore_index=True)
    all_ids = set(panel["id"].astype(int))
    panel["snaps40"] = panel["id"].map(seasons_on_roster(all_ids, snaps))
    # age at the cycle's June 30 (the site's convention), from the people cache
    bd = None
    ppl_f = ROOT / "data" / "milb" / "people.parquet"
    if ppl_f.exists():
        ppl = pd.read_parquet(ppl_f)
        if "birth" in ppl.columns:
            ppl = ppl.rename(columns={"birth": "birthdate"})
            ok = ppl.dropna(subset=["birthdate"])
            bd = ok.set_index(ok["id"].astype(int))["birthdate"]
    if bd is not None:
        panel["age"] = np.nan
        for y in (*CYCLES, HOLDOUT_CYCLE):
            m = panel["cycle"] == y
            ref = pd.to_datetime(f"{y}-06-30")
            panel.loc[m, "age"] = (ref - pd.to_datetime(panel.loc[m, "id"].map(bd), errors="coerce")).dt.days / 365.25

    fea = panel[panel["cycle"].isin(CYCLES)].copy()
    hold = panel[panel["cycle"] == HOLDOUT_CYCLE].copy()
    COLS = ["is_p", "il60", "snaps40", "age", "bf", "kPct", "rv100", "woba", "ip"]
    fea[COLS] = fea[COLS].fillna({"bf": 0, "kPct": np.nanmean(fea["kPct"]), "rv100": 0, "woba": np.nanmean(fea["woba"]), "ip": 0})
    hold[COLS] = hold[COLS].fillna({"bf": 0, "kPct": np.nanmean(panel["kPct"]), "rv100": 0, "woba": np.nanmean(panel["woba"]), "ip": 0})

    fea["y"] = (fea["label"] == "removed").astype(int)
    fea = fea.dropna(subset=["age"])
    params = dict(n_estimators=300, learning_rate=0.04, num_leaves=15, min_child_samples=40,
                  verbose=-1, n_jobs=4)
    oof = np.full(len(fea), np.nan)
    for tr, te in GroupKFold(5).split(fea, groups=fea["id"]):
        m = lgb.LGBMClassifier(**params, random_state=13).fit(fea.iloc[tr][COLS], fea.iloc[tr]["y"])
        oof[te] = m.predict_proba(fea.iloc[te][COLS])[:, 1]
    auc_in = float(roc_auc_score(fea["y"], oof))
    fi = sorted(zip(COLS, np.round(m.feature_importances_, 0)), key=lambda x: -x[1])

    res = {"section": "§105 (D-47 removal research)",
           "cycles": {int(c): int((panel[panel.cycle == c].label == "removed").sum()) for c in panel.cycle.unique()},
           "n": int(len(fea)), "removed": int(fea["y"].sum()),
           "cv_auc_removed": round(auc_in, 3),
           "features": fi,
           "removed_vs_traded": {k: int(v) for k, v in panel.label.value_counts().items()}}
    # the held-out confirmation cycle
    if len(hold):
        hold = hold.dropna(subset=["age"])
        m = lgb.LGBMClassifier(**params, random_state=13).fit(fea[COLS], fea["y"])
        hold["p"] = m.predict_proba(hold[COLS])[:, 1]
        hold_y = (hold["label"] == "removed").astype(int)
        if hold_y.nunique() == 2:
            res["holdout_2025_auc"] = round(float(roc_auc_score(hold_y, hold["p"])), 3)
        res["holdout_n"] = int(len(hold))
    res["verdict"] = "descriptive" if res.get("holdout_2025_auc", 0) >= 0.70 else "research note only"
    print(json.dumps(res, indent=1, default=str))
    (PIPE / "results" / "removal_SEALED.json").write_text(json.dumps(res, indent=1, default=str))

    # the tracker column: score the CURRENT snapshot as if it were a tender deadline
    # (same frozen spec: the model refit on the five cycles, features from the ending season)
    snaps = {f.stem.replace("snap_", ""): pd.read_parquet(f) for f in sorted(R40.glob("snap_*.parquet"))}
    cur_date, cur_df = max(snaps.items())
    tender_like = cur_df.rename(columns={"name": "full_name"})
    il_flag = cur_df.assign(il=cur_df["status_desc"].fillna("").str.contains("60-Day", case=False)) \
                   .groupby("id")["il"].max().rename("il60")
    pos = cur_df.groupby("id")["pos"].first().rename("pos")
    y = int(cur_date[:4])
    season_y = y if int(cur_date[5:7]) >= 3 else y - 1  # an October snapshot ends season y
    f = cur_df[["id", "team_id"]].drop_duplicates("id").join(il_flag, on="id").join(pos, on="id")
    f["cycle"] = y
    f["is_p"] = (f["pos"] == "P").astype(int)
    p_perf = perf[perf["season"] == season_y].set_index("id")
    b_perf = bats[bats["season"] == season_y].set_index("id")
    f["bf"] = f["id"].map(p_perf["bf"]).fillna(f["id"].map(b_perf["pa"])).fillna(0)
    f["kPct"] = pd.Series(np.where(f["is_p"] == 1,
                                   f["id"].map(p_perf["k"]) / f["bf"].replace(0, np.nan) * 100,
                                   f["id"].map(b_perf["kPct"])), index=f.index)
    f["kPct"] = f["kPct"].fillna(float(np.nanmean(panel["kPct"])))
    f["rv100"] = pd.Series(np.where(f["is_p"] == 1, f["id"].map(p_perf["rv100_pitcher"]), 0), index=f.index).fillna(0)
    f["woba"] = pd.Series(np.where(f["is_p"] == 0, f["id"].map(b_perf["woba"]), float(np.nanmean(panel["woba"]))), index=f.index)
    f["ip"] = pd.Series(np.where(f["is_p"] == 1, f["id"].map(p_perf["ip"]), 0), index=f.index).fillna(0)
    f["snaps40"] = f["id"].map(seasons_on_roster(set(f["id"].astype(int)), snaps))
    f["age"] = np.nan
    if bd is not None:
        ref = pd.to_datetime(f"{y}-06-30")
        f["age"] = (ref - pd.to_datetime(f["id"].map(bd), errors="coerce")).dt.days / 365.25
    f = f.dropna(subset=["age"])
    mf = lgb.LGBMClassifier(**params, random_state=13).fit(fea[COLS], fea["y"])
    f["p_removed"] = mf.predict_proba(f[COLS])[:, 1]
    f[["id", "p_removed"]].to_parquet(ROOT / "cache" / "removal_model_scored.parquet", index=False)
    print(f"tracker scores: {len(f)} current-40-man players -> cache/removal_model_scored.parquet")


if __name__ == "__main__":
    main()
