"""RESULTS-MLB §110 read (once): B-Ref batting-runs gate, out-of-sample checks, projected-wRC+ calibration.

    python pipeline/wrc_read.py [EXPORT_DIR]   # reads a baked hitters.json + benchmarks/wrc.json -> results/wrc_110.json

Board values are rounded (wOBA .001, PF .1), so wRC+ is recomputed here unrounded from them (error < 0.5 point);
the CI rule is applied to unrounded bootstrap bounds.
"""
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
from hitter_proj import SQL as PROJ_SQL, marcel  # noqa: E402
from stack import pooled_dr  # noqa: E402
from wrc import AL  # noqa: E402

ROOT = PIPE.parent
WEB = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "data" / "export" / "web"


def ci_rule(lo: np.ndarray, hi: np.ndarray, tol: float) -> str:
    """BaseballGOAT model-roles CI rule on UNROUNDED bounds."""
    if ((lo > tol) | (hi < -tol)).any():
        return "FAIL"
    if ((hi - lo) / 2 > tol).any():
        return "UNDERPOWERED"
    return "PASS"


def board() -> tuple[pd.DataFrame, dict]:
    c = {int(k): v for k, v in json.loads((WEB / "benchmarks" / "wrc.json").read_text()).items() if k.isdigit()}
    b = pd.DataFrame(json.loads((WEB / "hitters.json").read_text()))
    b = b[b["wrcPlus"].notna()].copy()
    b["mlbam"], b["season"] = b["id"].astype(int), b["season"].astype(int)
    b["pf"] = b["parkFactor"] / 100
    b["D"] = [c[s]["denAL"] if t in AL else c[s]["denNL"] for s, t in zip(b["season"], b["team"])]
    k = lambda col: b["season"].map({s: v[col] for s, v in c.items()})  # noqa: E731
    lg, sc, rpa = k("lgWoba"), k("scale"), k("lgRpa")
    b["wrc_on"] = 100 * ((b["woba"] - lg) / sc + rpa + rpa * (1 - b["pf"])) / b["D"]
    b["wrc_off"] = 100 * ((b["woba"] - lg) / sc + rpa) / b["D"]
    b["wraa_park"] = b["wraa"] + rpa * (1 - b["pf"]) * b["pa"]
    return b, c


def bref_gate(b: pd.DataFrame) -> dict:
    d = pd.read_csv(ROOT / "data" / "milb" / "bref" / "war_daily_bat.txt", low_memory=False)
    d = d[(d["pitcher"] == "N") & d["year_ID"].between(2020, 2026)]
    d["runs_bat"] = pd.to_numeric(d["runs_bat"], errors="coerce")
    r = d.groupby(["year_ID", "mlb_ID"])["runs_bat"].sum().reset_index()
    m = b.merge(r, left_on=["season", "mlbam"], right_on=["year_ID", "mlb_ID"])
    m = m[m["pa"] >= np.where(m["season"] == 2020, 100, 300)]
    diff = (m["wraa_park"] - m["runs_bat"]) / m["pa"] * 600
    by = {str(s): round(float(np.corrcoef(g["wraa_park"], g["runs_bat"])[0, 1]), 4) for s, g in m.groupby("season")}
    pooled = float(np.corrcoef(m["wraa_park"], m["runs_bat"])[0, 1])
    return {"n": len(m), "r": round(pooled, 4), "by_season": by, "seasons_in_bref": sorted(int(s) for s in m["season"].unique()),
            "diff_per600_mean": round(float(diff.mean()), 2), "diff_per600_sd": round(float(diff.std()), 2),
            "verdict": "PASS" if pooled >= .95 and min(by.values()) >= .95 else "FAIL"}


def pairs(b: pd.DataFrame) -> pd.DataFrame:
    x = b[b["pa"] >= 100][["mlbam", "season", "woba", "wrc_on", "wrc_off", "pf", "D", "pa"]]
    y = x.assign(season=x["season"] - 1).drop(columns=["pf", "D"]).add_suffix("_next").rename(
        columns={"mlbam_next": "mlbam", "season_next": "season"})
    return x.merge(y, on=["mlbam", "season"])


def oos(p: pd.DataFrame) -> dict:
    out = {}
    for y in ("woba_next", "wrc_on_next", "wrc_off_next"):
        for x in ("wrc_on", "wrc_off"):
            out[f"{x}_vs_woba->{y}"] = pooled_dr(p, "woba", x, y)
    out["yoy"] = {f"{s}->{s + 1}": {c: round(float(np.corrcoef(g[c], g[f"{c}_next"])[0, 1]), 4) for c in ("woba", "wrc_on", "wrc_off")}
                  for s, g in p.groupby("season")}
    return out


def calibration(p: pd.DataFrame, c: dict, draws=2000, seed=13) -> dict:
    ev = mart.connect().sql(PROJ_SQL.format(tbl="pitches_all")).df()
    m = marcel(ev)[["mlbam", "season", "m_woba"]]
    lg_sav = (ev.groupby("season")["wn"].sum() / ev.groupby("season")["den"].sum()).to_dict()
    d = p.merge(m, on=["mlbam", "season"])
    k = lambda col, s: d[s].map({x: v[col] for x, v in c.items()})  # noqa: E731
    sc, rpa = k("scale", "season"), k("lgRpa", "season")
    d["pred"] = 100 * ((d["m_woba"] - d["season"].map(lg_sav)) / sc + rpa + rpa * (1 - d["pf"])) / d["D"]
    rng = np.random.default_rng(seed)
    res = {}
    for s, g in d.groupby("season"):
        t = s + 1
        tol = 100 * .010 / (c[t]["scale"] * c[t]["lgRpa"])
        g = g.assign(dec=pd.qcut(g["pred"], 10, labels=False), e=g["wrc_on_next"] - g["pred"])
        lo, hi, pt = [], [], []
        for _, q in g.groupby("dec"):
            e = q["e"].to_numpy()
            bs = e[rng.integers(0, len(e), (draws, len(e)))].mean(1)
            lo.append(np.percentile(bs, 2.5)); hi.append(np.percentile(bs, 97.5)); pt.append(e.mean())
        lo, hi = np.array(lo), np.array(hi)
        res[f"{s}->{t}"] = {"n": len(g), "tol": tol, "verdict": ci_rule(lo, hi, tol),
                            "point_rule": bool(np.abs(pt).max() <= tol), "level": float(g["e"].mean()),
                            "slope": float(np.polyfit(g["pred"], g["wrc_on_next"], 1)[0]),
                            "deciles": [{"e": float(a), "lo": float(x), "hi": float(y), "hw": float((y - x) / 2)}
                                        for a, x, y in zip(pt, lo, hi)]}
    prim = res.get("2025->2026", {}).get("verdict")
    res["proven"] = prim == "PASS" and all(v["verdict"] != "FAIL" for k_, v in res.items() if isinstance(v, dict))
    return res


def main():
    b, c = board()
    check = (b["wrc_on"] - b["wrcPlus"]).abs()
    p = pairs(b)
    res = {"recompute_vs_shipped_max_abs": round(float(check.max()), 3), "recompute_share_within_1": round(float((check <= 1).mean()), 4),
           "bref": bref_gate(b), "oos": oos(p), "calibration": calibration(p, c)}
    (PIPE / "results" / "wrc_110.json").write_text(json.dumps(res, indent=1, default=float))
    print(json.dumps(res, indent=1, default=float))


if __name__ == "__main__":
    main()
