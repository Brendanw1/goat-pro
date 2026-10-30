"""§107: fringe trades — who gets moved in the tender window and what they do after.

    python trade_study.py            # -> results/trade_study_SEALED.json

Population: the §105 labels (moved between clubs' 40-mans within the Nov 22 -> Feb 20
window, cycles 2020-2024) against the retained pool. Outcomes are §85 WAR. Matched
comparison: age band x prior-WAR bucket. Descriptive throughout (§107).
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

PIPE = Path(__file__).resolve().parent
sys.path.insert(0, str(PIPE))
from prospect_spine import load_prospects, load_war  # noqa: E402

ROOT = PIPE.parent
R40 = ROOT / "data" / "rosters40"
CYCLES = (2020, 2021, 2022, 2023, 2024)  # 2025's outcomes are not in the 2020-24 WAR window


def age_of(bd, pid: int, y: int) -> float:
    if bd is None:
        return np.nan
    v = bd.reindex([int(pid)])
    b = pd.to_datetime(v.iloc[0], errors="coerce") if len(v) else pd.NaT
    return (pd.Timestamp(f"{y}-06-30") - b).days / 365.25 if pd.notna(b) else np.nan


def main() -> None:
    war = load_war()
    war_idx = war.set_index(["id", "season"])["war"]
    pros = load_prospects()
    prospect_ids = set(pros.loc[(pros["last_year"] >= 2017) & (pros["first_year"] <= 2024), "id"])

    rows = []
    ppl_f = ROOT / "data" / "milb" / "people.parquet"
    bd = None
    if ppl_f.exists():
        ppl = pd.read_parquet(ppl_f)
        if "birth" in ppl.columns:
            ok = ppl.dropna(subset=["birth"])
            bd = ok.set_index(ok["id"].astype(int))["birth"]

    for y in CYCLES:
        tender = pd.read_parquet(R40 / f"snap_{y}-11-22.parquet")
        spring = pd.read_parquet(R40 / f"snap_{y + 1}-02-20.parquet")
        all_spring = set(spring["id"].astype(int))
        moved = []
        for r in tender.itertuples():
            pid = int(r.id)
            if pid in all_spring and int(spring.loc[spring["id"] == pid, "team_id"].iloc[0]) != int(r.team_id):
                moved.append({"id": pid, "cycle": y})
        prior = war[war["season"] == y].drop_duplicates("id").set_index("id")
        next_ = war[war["season"] == y + 1].drop_duplicates("id").set_index("id")
        on40 = set(tender["id"].astype(int))
        for m_ in moved:
            pid = m_["id"]
            rows.append({"id": str(pid), "cycle": y, "moved": 1,
                         "prior_war": float(prior["war"].get(str(pid), 0.0)),
                         "next_war": float(next_["war"].get(str(pid), 0.0)),
                         "prospect": str(pid) in prospect_ids,
                         "age": age_of(bd, pid, y)})
        # retained comparison pool: on the same club both dates, sampled 2:1
        stayed = [pid for pid in on40
                  if pid in all_spring and int(spring.loc[spring["id"] == pid, "team_id"].iloc[0]) == int(tender.loc[tender["id"] == pid, "team_id"].iloc[0])]
        rng = np.random.default_rng(13)
        for pid in rng.choice(stayed, size=min(2 * len(moved), len(stayed)), replace=False):
            rows.append({"id": str(int(pid)), "cycle": y, "moved": 0,
                         "prior_war": float(prior["war"].get(str(int(pid)), 0.0)),
                         "next_war": float(next_["war"].get(str(int(pid)), 0.0)),
                         "prospect": str(int(pid)) in prospect_ids,
                         "age": age_of(bd, int(pid), y)})
    d = pd.DataFrame(rows)
    d = d.dropna(subset=["age"])
    d["age_band"] = pd.cut(d["age"], [0, 26, 29, 32, 99], labels=["<=26", "27-29", "30-32", "33+"])
    d["war_band"] = pd.cut(d["prior_war"], [-99, 0, 1, 2, 99], labels=["<=0", "0-1", "1-2", "2+"])

    traded, kept = d[d.moved == 1], d[d.moved == 0]
    out = {"section": "§107 (fringe trades)", "n_traded": int(len(traded)), "n_retained": int(len(kept))}

    # who gets moved: shares by band
    def shares(sub: pd.DataFrame, col: str) -> dict:
        return {str(k): round(float(v), 3) for k, v in sub[col].value_counts(normalize=True).sort_index().items()}
    out["moved_shares"] = {"age_band": shares(traded, "age_band"), "war_band": shares(traded, "war_band")}
    out["retained_shares"] = {"age_band": shares(kept, "age_band"), "war_band": shares(kept, "war_band")}

    # what they do after: matched on age band x prior-WAR bucket
    m = traded.merge(kept, on=["age_band", "war_band"], suffixes=("_t", "_k"))
    matched_next_t = m["next_war_t"].mean()
    matched_next_k = m["next_war_k"].mean()
    out["next_war_mean"] = {"traded": round(float(traded["next_war"].mean()), 2),
                            "retained": round(float(kept["next_war"].mean()), 2),
                            "traded_matched": round(float(matched_next_t), 2),
                            "retained_matched": round(float(matched_next_k), 2)}
    out["returned_ge_prior"] = {"traded": round(float((traded["next_war"] >= traded["prior_war"]).mean()), 3),
                                "retained": round(float((kept["next_war"] >= kept["prior_war"]).mean()), 3)}

    # the prospect angle: traded top-100 alums vs the §106 tier table
    pt = traded[traded["prospect"]]
    out["traded_prospects"] = {"n": int(len(pt)),
                               "next_war_mean": round(float(pt["next_war"].mean()), 2),
                               "share_ge1war_next": round(float((pt["next_war"] >= 1).mean()), 3)}
    print(json.dumps(out, indent=1, default=str))
    (PIPE / "results" / "trade_study_SEALED.json").write_text(json.dumps(out, indent=1, default=str))


if __name__ == "__main__":
    main()
