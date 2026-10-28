"""D-12/D-13 profile files: defense/{id}-{season}.json.gz in the web export, from defense_mlb.py's outputs.

    python defense_export.py [--out DIR]   # default data/export/web
    python defense_export.py --demo        # self-check of the interval and the percentile

Ships only what passed its gate: a range group (IF / OF) if its §80 (else §75) verdict is CONFIRMED, framing
if §76 is. Per card: runs and OAA (raw, shrunk by the measured k), a 90% interval, a within-position
percentile among qualified players (reliability >= .25), and the chance list for the drill map. Catchers: framing
runs, Framing+, a 0.25 ft called-minus-expected grid (shrunk, k 20) and per-game lines.
"""
import gzip
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

PIPE = Path(__file__).resolve().parent
RES, CACHE = PIPE / "results", PIPE.parent / "cache"
POS = {3: "1b", 4: "2b", 5: "3b", 6: "ss", 7: "lf", 8: "cf", 9: "rf"}
GROUP = {p: ("IF" if p <= 6 else "OF") for p in POS}
Z90, CELL, CELL_K, MIN_CHANCES, MIN_TAKEN = 1.645, 0.25, 20, 20, 500


def jwrite_gz(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(gzip.compress(json.dumps(obj, separators=(",", ":"), sort_keys=True).encode(), mtime=0))


def rnd(x, nd=2):
    return None if x is None or not np.isfinite(x) else round(float(x), nd) + 0.0


def interval(value_shrunk, sd, w):
    """90% interval of a shrunk total: shrunk +/- 1.645 x sd x the shrink weight."""
    return value_shrunk - Z90 * sd * w, value_shrunk + Z90 * sd * w


def pct_rank(v: pd.Series) -> pd.Series:
    return (100 * v.rank(pct=True, method="average")).round()


def verdicts() -> tuple[set, bool, dict]:
    v2 = RES / "defense_v2_SEALED.json"
    rng = json.loads((v2 if v2.exists() else RES / "defense_SEALED.json").read_text())["range"]
    fr = json.loads((RES / "defense_SEALED.json").read_text())["framing"]
    ok = {g for g, r in rng.items() if r["verdict"] == "CONFIRMED"}
    return ok, fr["verdict"] == "CONFIRMED", {g: r["reliability"]["k"] for g, r in rng.items()} | {"C": fr["reliability"]["k"]}


def demo():
    lo, hi = interval(2.0, 3.0, 0.5)
    assert np.isclose(lo, 2 - 1.645 * 1.5) and np.isclose(hi, 2 + 1.645 * 1.5)
    assert list(pct_rank(pd.Series([1.0, 2.0, 3.0, 4.0]))) == [25, 50, 75, 100]
    print("demo ok")


def main(out: Path):
    ok, framing_ok, k = verdicts()
    ch = pd.read_parquet(CACHE / "defense_chances.parquet")
    ch = ch[ch["pos"].map(GROUP).isin(ok)].copy()
    rv = np.where(ch["oaa"] != 0, ch["runs"] / ch["oaa"].replace(0, np.nan), 0.78)
    ch["var_oaa"] = ch["chances"] * ch["p"] * (1 - ch["p"])
    ch["var_runs"] = ch["var_oaa"] * np.nan_to_num(rv, nan=0.78) ** 2
    cards = ch.groupby(["mlbam", "season", "pos"]).agg(
        chances=("chances", "sum"), oaa=("oaa", "sum"), runs=("runs", "sum"), v_oaa=("var_oaa", "sum"),
        v_runs=("var_runs", "sum")).reset_index()
    cards["k"] = cards["pos"].map(GROUP).map(k)
    cards["w"] = cards["chances"] / (cards["chances"] + cards["k"])
    cards["oaa_s"], cards["runs_s"] = cards["oaa"] * cards["w"], cards["runs"] * cards["w"]
    cards["qualified"] = cards["w"] >= 0.25
    q = cards[cards["qualified"]]
    cards["pct"] = q.groupby(["season", "pos"])["runs_s"].transform(pct_rank)
    files: dict = {}
    for c in cards[cards["chances"] >= MIN_CHANCES].itertuples():
        lo, hi = interval(c.runs_s, np.sqrt(c.v_runs), c.w)
        sub = ch[(ch["mlbam"] == c.mlbam) & (ch["season"] == c.season) & (ch["pos"] == c.pos) & (ch["chances"] >= 0.2)]
        of = c.pos >= 7
        chances = [{"x": rnd(r.fx, 1) if of else None, "y": rnd(r.fy, 1) if of else None,
                    "dir": None if of else rnd(r.spray, 1), "ev": rnd(r.ev, 1), "la": rnd(r.la, 0),
                    "p": rnd(r.p, 3), "made": bool(r.made), "share": rnd(r.chances, 2), "credit": rnd(r.oaa, 3),
                    "runs": rnd(r.runs, 3), "date": r.date, "inning": int(r.inning), "half": r.half,
                    "outs": int(r.outs), "bats": r.stand, "event": r.event}
                   for r in sub.sort_values(["date", "inning", "p"]).itertuples()]
        files.setdefault((int(c.mlbam), int(c.season)), {"cards": [], "catcher": None})["cards"].append({
            "pos": POS[c.pos], "group": GROUP[c.pos], "chances": rnd(c.chances, 1), "qualified": bool(c.qualified),
            "oaa": rnd(c.oaa, 2), "oaaShrunk": rnd(c.oaa_s, 2), "runs": rnd(c.runs, 2), "runsShrunk": rnd(c.runs_s, 2),
            "lo": rnd(lo, 2), "hi": rnd(hi, 2), "reliability": rnd(c.w, 2), "pct": rnd(c.pct, 0) if c.qualified else None,
            "chanceList": chances})

    if framing_ok:
        fc = pd.read_csv(RES / "defense_framing.csv")
        fp = pd.read_parquet(CACHE / "framing_pitches.parquet")
        fq = fc[fc["n"] >= 2000]
        fc["pct"] = fq.groupby("season")["runs_shrunk"].transform(pct_rank)
        for c in fc[fc["n"] >= MIN_TAKEN].itertuples():
            sub = fp[(fp["mlbam"] == c.mlbam) & (fp["season"] == c.season)]
            sub = sub.assign(cx=(np.floor(sub["x"] / CELL) + 0.5) * CELL, cz=(np.floor(sub["z"] / CELL) + 0.5) * CELL,
                             d=sub["cs"] - sub["p"])
            sub = sub[sub["cx"].abs().le(1.5) & sub["cz"].between(1.0, 4.25)]
            cells = [{"cx": rnd(a, 3), "cz": rnd(b, 3), "n": int(g["d"].size),
                      "v": rnd(100 * g["d"].sum() / (g["d"].size + CELL_K), 1)}
                     for (a, b), g in sub.groupby(["cx", "cz"])]
            allp = fp[(fp["mlbam"] == c.mlbam) & (fp["season"] == c.season)]
            games = allp.groupby("date").agg(n=("runs", "size"), runs=("runs", "sum"), sv=("cs", "sum"),
                                             ex=("p", "sum")).reset_index()
            w = c.n / (c.n + k["C"])
            v = (allp["runs"] / (allp["cs"] - allp["p"])).replace([np.inf, -np.inf], np.nan).fillna(0)  # count's ball-strike swing
            sd = np.sqrt((allp["p"] * (1 - allp["p"]) * v ** 2).sum())
            lo, hi = interval(c.runs_shrunk, sd, w)
            files.setdefault((int(c.mlbam), int(c.season)), {"cards": [], "catcher": None})["catcher"] = {
                "taken": int(c.n), "runs": rnd(c.runs, 2), "runsShrunk": rnd(c.runs_shrunk, 2), "lo": rnd(lo, 2),
                "hi": rnd(hi, 2), "per100": rnd(c.per100, 3), "framingPlus": rnd(c.framing_plus, 1),
                "qualified": bool(c.n >= 2000), "pct": rnd(c.pct, 0) if c.n >= 2000 else None, "reliability": rnd(w, 2),
                "cells": cells, "games": [{"date": g.date, "n": int(g.n), "runs": rnd(g.runs, 2),
                                           "strikesVsExp": rnd(g.sv - g.ex, 1)} for g in games.itertuples()]}

    for (pid, s), doc in files.items():
        doc.update(_comment="D-12/D-13 (RESULTS-MLB §75/§76/§80): site defense models refit on Statcast; runs vs an "
                            "average fielder at the position; framing vs an average catcher on the same pitches",
                   id=str(pid), season=s)
        jwrite_gz(out / "defense" / f"{pid}-{s}.json.gz", doc)
    print(f"defense files: {len(files)} (range groups shipped: {sorted(ok) or 'none'}; framing: {framing_ok})")


if __name__ == "__main__":
    if "--demo" in sys.argv:
        demo()
    else:
        o = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else PIPE.parent / "data" / "export" / "web"
        main(Path(o))
