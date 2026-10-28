"""RESULTS-MLB §67 (D-36): hitter Marcel (wOBA on Savant's scale, K/PA, BB/PA) and its measured 80% ranges.

    python hitter_proj.py            # the §67 read (once) -> results/hitter_proj_SEALED.json + hitter_proj_bands.json
    python hitter_proj.py --demo     # self-check of marcel() on a hand-worked case
    from hitter_proj import projections   # web_export: every hitter-season's next-season projection + range

Marcel: 5/4/3 PA-weighted over S, S-1, S-2, plus 1,200 PA of that season's league rate. No age or park term.
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.model_selection import GroupKFold

from paths import MART_DIR  # noqa: E402
sys.path.insert(0, str(MART_DIR))
import mart  # noqa: E402
from stack import pooled_dr  # noqa: E402

PIPE = Path(__file__).resolve().parent
W, R = (5, 4, 3), 1200
RATES = {"woba": ("wn", "den"), "k": ("k", "pa"), "bb": ("bb", "pa")}
BINS = [100, 250, 400, 550, 10_000]
SQL = """
SELECT batter AS mlbam, season, count(*) FILTER (WHERE events IS NOT NULL) AS pa,
       count(*) FILTER (WHERE events IN ('strikeout','strikeout_double_play')) AS k,
       count(*) FILTER (WHERE events IN ('walk','intent_walk')) AS bb,
       coalesce(sum(woba_value) FILTER (WHERE woba_denom > 0), 0) AS wn, coalesce(sum(woba_denom), 0) AS den
FROM {tbl} WHERE game_type = 'R' AND batter IS NOT NULL GROUP BY 1, 2
"""


def marcel(ev: pd.DataFrame) -> pd.DataFrame:
    """Per (mlbam, season): the Marcel rate for S+1 from S, S-1, S-2 (weights 5/4/3 on the counts and the
    denominators), plus R units of denominator at that season's league rate."""
    lg = ev.groupby("season")[["wn", "den", "k", "bb", "pa"]].sum()
    hist = ev.set_index(["mlbam", "season"])
    out = ev[["mlbam", "season", "pa"]].copy()
    for name, (num, den) in RATES.items():
        n = R * (lg[num] / lg[den]).reindex(ev["season"]).to_numpy()
        d = np.full(len(ev), float(R))
        for lag, w in enumerate(W):
            idx = pd.MultiIndex.from_arrays([ev["mlbam"], ev["season"] - lag])
            h = hist.reindex(idx)
            n = n + w * h[num].fillna(0).to_numpy()
            d = d + w * h[den].fillna(0).to_numpy()
        out[f"m_{name}"] = n / d
    return out


def season_rates(ev: pd.DataFrame) -> pd.DataFrame:
    return ev.assign(woba=ev["wn"] / ev["den"].replace(0, np.nan), k=ev["k"] / ev["pa"], bb=ev["bb"] / ev["pa"])


def frame(level="mlb") -> pd.DataFrame:
    ev = mart.connect().sql(SQL.format(tbl="pitches_aaa" if level == "aaa" else "pitches_all")).df()
    m = marcel(ev)
    s = season_rates(ev)
    d = m.merge(s[["mlbam", "season", "woba", "k", "bb"]], on=["mlbam", "season"])
    nxt = s.assign(season=s["season"] - 1)[["mlbam", "season", "pa", "woba", "k", "bb"]].add_suffix("_next").rename(
        columns={"mlbam_next": "mlbam", "season_next": "season"})
    return d, nxt


def bands(d: pd.DataFrame) -> dict:
    """5-fold hitter-grouped residual quantiles by PA in S (§67). Marcel has no fitted parameters, so the
    folds only keep the procedure identical to proj_bands.py."""
    out = {}
    for name in RATES:
        res = np.empty(len(d))
        for _, te in GroupKFold(5).split(d, groups=d["mlbam"]):
            res[te] = (d[f"{name}_next"] - d[f"m_{name}"]).to_numpy()[te]
        rows = []
        for lo, hi in zip(BINS[:-1], BINS[1:]):
            b = (d["pa"] >= lo) & (d["pa"] < hi)
            if b.sum() >= 30:
                r = pd.Series(res[b.to_numpy()])
                rows.append({"lo": lo, "hi": hi, "n": int(b.sum()), "q10": round(float(r.quantile(.1)), 4),
                             "q90": round(float(r.quantile(.9)), 4), "rmse": round(float(np.sqrt((r ** 2).mean())), 4)})
        out[name] = rows
    return out


def projections(level="mlb", con=None) -> dict:
    """{(mlbam, season): {...}} for every hitter-season with >= 100 PA: next-season Marcel and its 80% range
    from results/hitter_proj_bands.json, for the rates §67 shipped. Empty if the read has not run."""
    bp = PIPE / "results" / "hitter_proj_bands.json"
    if not bp.exists():
        return {}
    b = json.loads(bp.read_text())
    keep = {"woba": "wobaProj", "k": "kPctProj", "bb": "bbPctProj"}
    ev = (con or mart.connect()).sql(SQL.format(tbl="pitches_aaa" if level == "aaa" else "pitches_all")).df()
    m = marcel(ev)
    m = m[m["pa"] >= 100]
    out = {}
    for r in m.itertuples():
        row = {}
        for name in b["shipped"]:
            v = getattr(r, f"m_{name}")
            band = next((x for x in b["bands"][name] if x["lo"] <= r.pa < x["hi"]), None)
            if band is None or not np.isfinite(v):
                continue
            sc = 1 if name == "woba" else 100  # K / BB as percentages, like the profile's K% / BB%
            nd = 3 if name == "woba" else 1
            row[keep[name]] = round(float(v) * sc, nd)
            row[keep[name] + "Lo"] = round(float(max(0.0, v + band["q10"])) * sc, nd)
            row[keep[name] + "Hi"] = round(float(v + band["q90"]) * sc, nd)
        if row:
            out[(int(r.mlbam), int(r.season))] = row
    return out


def demo():
    ev = pd.DataFrame({"mlbam": [1, 1, 1, 2], "season": [2023, 2024, 2025, 2025], "pa": [600, 500, 400, 600],
                       "k": [120, 100, 80, 120], "bb": [60, 50, 40, 60], "wn": [200.0, 160, 140, 200], "den": [600, 500, 400, 600]})
    m = marcel(ev).set_index(["mlbam", "season"])
    # 2025, player 1: league K/PA 2025 = 200/1000 = .2; num = 1200*.2 + 5*80 + 4*100 + 3*120 = 1400, den = 1200 + 2000+2000+1800
    assert abs(m.loc[(1, 2025), "m_k"] - 1400 / 7000) < 1e-9, m.loc[(1, 2025), "m_k"]
    print("demo ok")


def main():
    d, nxt = frame()
    d = d.merge(nxt, on=["mlbam", "season"])
    first = int(d["season"].min()) + 2  # two prior seasons in the mart
    d = d[(d["season"] >= first) & (d["pa"] >= 100) & (d["pa_next"] >= 100)].dropna().reset_index(drop=True)
    res = {"n": int(len(d)), "pairs": d.groupby("season").size().to_dict(), "claims": {}}
    shipped = []
    for name in RATES:
        r = pooled_dr(d, name, f"m_{name}", f"{name}_next")
        won = sum(v[f"r_m_{name}"] > v[f"r_{name}"] for v in r["pairs"].values())
        ok = r["ci"][0] > 0 and won >= len(r["pairs"]) - 1
        r.update(pairs_won=won, verdict="CONFIRMED" if ok else "NOT CONFIRMED")
        res["claims"][name] = r
        if ok:
            shipped.append(name)
    print(json.dumps(res, indent=1, default=str))
    (PIPE / "results" / "hitter_proj_SEALED.json").write_text(json.dumps(res, indent=1, default=str))
    (PIPE / "results" / "hitter_proj_bands.json").write_text(json.dumps(
        {"shipped": shipped, "bands": bands(d), "method": "RESULTS-MLB §67"}, indent=1))


if __name__ == "__main__":
    demo() if "--demo" in sys.argv else main()
