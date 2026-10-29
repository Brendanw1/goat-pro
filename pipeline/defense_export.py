"""D-12/D-13 profile files: defense/{id}-{season}.json.gz in the web export, from defense_mlb.py's outputs.

    python defense_export.py [--out DIR]   # default data/export/web
    python defense_export.py --demo        # self-check of the interval and the percentile

Each chance carries its game (g), batter and play text from Statcast, and, once
pipeline/savant_play_ids.py has run, Savant's play_id (pid, for the video link) and the number of parks it
would have left (hr, Savant's homeRunBallparks). Each file also carries `savant`: that season's Savant
fielding run value components (range, arm, DP, 1B receiving, catcher) and directional OAA, labelled Savant's,
with the 1B receiving distribution of every first baseman for the strip chart.

Ships only what passed its gate: a range group (IF / OF) if its §81 (else §80, else §75) verdict is CONFIRMED, framing
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
    sealed = next(p for p in (RES / f"defense_{v}SEALED.json" for v in ("v3_", "v2_", "")) if p.exists())
    rng = json.loads(sealed.read_text())["range"]
    fr = json.loads((RES / "defense_SEALED.json").read_text())["framing"]
    ok = {g for g, r in rng.items() if r["verdict"] == "CONFIRMED"}
    return ok, fr["verdict"] == "CONFIRMED", {g: r["reliability"]["k"] for g, r in rng.items()} | {"C": fr["reliability"]["k"]}


def demo():
    lo, hi = interval(2.0, 3.0, 0.5)
    assert np.isclose(lo, 2 - 1.645 * 1.5) and np.isclose(hi, 2 + 1.645 * 1.5)
    assert list(pct_rank(pd.Series([1.0, 2.0, 3.0, 4.0]))) == [25, 50, 75, 100]
    print("demo ok")


def play_lookup(ch: pd.DataFrame) -> pd.DataFrame:
    """(game_pk, hx, hy) -> batter name, play text, and Savant play_id / HR parks when fetched. hx/hy are
    Statcast hc_x/hc_y rounded to 0.01, recovered from the chance's feet coordinates."""
    from paths import MART_DIR
    sys.path.insert(0, str(MART_DIR))
    import mart
    con = mart.connect()
    games = ",".join(map(str, sorted(ch["game_pk"].astype(int).unique())))
    lk = con.sql(f"""SELECT game_pk, round(hc_x, 2) AS hx, round(hc_y, 2) AS hy, at_bat_number, pitch_number,
                            any_value(player_name) AS batter, any_value(des) AS des
                     FROM pitches_all WHERE game_pk IN ({games}) AND hc_x IS NOT NULL AND events IS NOT NULL
                     GROUP BY ALL""").df()
    bip = PIPE.parent / "data" / "milb" / "savant_bip.parquet"
    if bip.exists():
        sv = pd.read_parquet(bip, columns=["game_pk", "at_bat_number", "pitch_number", "play_id", "hr_parks"]).dropna(subset=["play_id"])
        sv = sv.astype({"game_pk": int, "at_bat_number": int, "pitch_number": int})
        lk = lk.merge(sv, on=["game_pk", "at_bat_number", "pitch_number"], how="left")
    return lk.drop_duplicates(["game_pk", "hx", "hy"], keep=False)


def savant_blocks(seasons) -> tuple[dict, dict]:
    """{(id, season): block} from Savant's FRV and OAA leaderboards, and {season: sorted 1B receiving runs}."""
    from paths import MART_DIR
    sys.path.insert(0, str(MART_DIR))
    import mart
    con = mart.connect()
    have = {r[0] for r in con.sql("SELECT table_name FROM information_schema.tables").fetchall()}
    out, rec = {}, {}
    num = lambda v: None if v is None or pd.isna(v) else round(float(v), 2)  # noqa: E731
    for s in seasons:
        if f"lb_fielding_run_value_{s}" in have:
            f = con.sql(f"SELECT * FROM lb_fielding_run_value_{s}").df()
            rec[int(s)] = sorted(round(float(v), 2) for v in f["fielding_runs_prevented_on_rec1b"].dropna())
            for r in f.itertuples():
                out.setdefault((int(r.id), int(s)), {})["frv"] = {
                    "total": num(r.total_runs), "range": num(r.range_runs), "arm": num(r.arm_runs), "dp": num(r.dp_runs),
                    "rec1b": num(r.fielding_runs_prevented_on_rec1b), "framing": num(r.framing_runs),
                    "throwing": num(r.throwing_runs), "blocking": num(r.blocking_runs),
                    "outs": {p: int(getattr(r, f"outs_{n}")) for n, p in ((2, "c"), (3, "1b"), (4, "2b"), (5, "3b"), (6, "ss"), (7, "lf"), (8, "cf"), (9, "rf"))
                             if getattr(r, f"outs_{n}", 0)}}
        if f"lb_outs_above_average_{s}" in have:
            o = con.sql(f"SELECT * FROM lb_outs_above_average_{s}").df()
            for r in o.to_dict("records"):
                out.setdefault((int(r["player_id"]), int(s)), {})["oaa"] = {
                    "pos": r["primary_pos_formatted"], "oaa": num(r["outs_above_average"]),
                    "front": num(r["outs_above_average_infront"]), "to3b": num(r["outs_above_average_lateral_toward3bline"]),
                    "to1b": num(r["outs_above_average_lateral_toward1bline"]), "back": num(r["outs_above_average_behind"]),
                    "rhh": num(r["outs_above_average_rhh"]), "lhh": num(r["outs_above_average_lhh"]),
                    "success": r["actual_success_rate_formatted"], "expected": r["adj_estimated_success_rate_formatted"]}
    return out, rec


def main(out: Path):
    ok, framing_ok, k = verdicts()
    v3 = CACHE / "defense_chances_v3.parquet"  # §81 fit when present
    ch = pd.read_parquet(v3 if v3.exists() and (RES / "defense_v3_SEALED.json").exists() else CACHE / "defense_chances.parquet")
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
    lk = play_lookup(ch)
    ch = ch.assign(hx=(ch["fx"] / 2.5 + 125.42).round(2), hy=(198.27 - ch["fy"] / 2.5).round(2)).merge(
        lk, on=["game_pk", "hx", "hy"], how="left")
    files: dict = {}
    for c in cards[cards["chances"] >= MIN_CHANCES].itertuples():
        lo, hi = interval(c.runs_s, np.sqrt(c.v_runs), c.w)
        sub = ch[(ch["mlbam"] == c.mlbam) & (ch["season"] == c.season) & (ch["pos"] == c.pos) & (ch["chances"] >= 0.2)]
        txt = lambda v: None if not isinstance(v, str) else v  # noqa: E731
        chances = [{"x": rnd(r.fx, 1), "y": rnd(r.fy, 1),
                    "dir": rnd(r.spray, 1), "ev": rnd(r.ev, 1), "la": rnd(r.la, 0),
                    "p": rnd(r.p, 3), "made": bool(r.made), "share": rnd(r.chances, 2), "credit": rnd(r.oaa, 3),
                    "runs": rnd(r.runs, 3), "date": r.date, "inning": int(r.inning), "half": r.half,
                    "outs": int(r.outs), "bats": r.stand, "event": r.event, "g": int(r.game_pk),
                    "batter": txt(r.batter), "des": txt(r.des),
                    "pid": txt(getattr(r, "play_id", None)),
                    "hr": None if pd.isna(getattr(r, "hr_parks", np.nan)) else int(r.hr_parks)}
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

    sv, rec = savant_blocks(sorted(cards["season"].astype(int).unique()))
    for key, blk in sv.items():  # Savant-only players (no site card) still get their Savant block
        if key in files or (blk.get("frv") or {}).get("total") is not None:
            files.setdefault(key, {"cards": [], "catcher": None})["savant"] = {**blk, "rec1bAll": rec.get(key[1]) if (blk.get("frv") or {}).get("rec1b") is not None else None}
    for (pid, s), doc in files.items():
        doc.update(_comment="D-12/D-13 (RESULTS-MLB §75/§76/§80/§81): site defense models refit on Statcast; runs vs an "
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
