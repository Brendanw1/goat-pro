"""Catcher defense files: catcher/{id}-{season}.json.gz + catcher/board.json in the web export.

    python pipeline/catcher_export.py --check            # bake twice into temp dirs, diff
    python pipeline/catcher_export.py --check --write    # ...and on PASS replace data/export/web/catcher (BAKE_LOCK)
    python pipeline/catcher_export.py --demo             # self-checks of the region rule and the shrink

Three legs, plan in docs/catcher-defense-plan.md:
- framing splits from the §76 model's per-pitch called-strike probabilities (cache/framing_pitches.parquet,
  catcher-grouped OOF), joined back to pitcher / hands / pitch type by re-running §76's own FRAME_SQL (row order
  is identical; asserted per season, a season that does not align is skipped, never guessed);
- blocking and throwing from Savant's per-play drill-down rows (pipeline/catcher_fetch.py). Blocking is priced by
  our §108b expected WP+PB (passed its gates; Savant's xPBWP ships beside it); throwing stays descriptive with Savant's
  expected CS labelled (§108a failed G2);
- running-game opportunities from the pitch mart (a pitch with a runner on 1B or 2B and the next base open).
Shrunk rates pull toward zero with k pseudo-pitches; n always ships beside them.
"""
import contextlib
import shutil
import sys
import tempfile
from pathlib import Path

import numpy as np
import pandas as pd

PIPE = Path(__file__).resolve().parent
sys.path.insert(0, str(PIPE))
from paths import MART_DIR  # noqa: E402
from web_export import bake_lock, jwrite, jwrite_gz  # noqa: E402

ROOT, CACHE, RES = PIPE.parent, PIPE.parent / "cache", PIPE / "results"
SITE_FAM = {"FF": "FF", "SI": "SI", "FC": "CT", "SL": "SL", "SW": "SW", "ST": "SW", "SV": "SL", "CU": "CB", "KC": "CB",
            "CS": "CB", "CH": "CH", "FS": "FS", "FO": "FS"}
K_SPLIT, MIN_TAKEN, MIN_SPLIT, MIN_ATT_RANK, MIN_DIRT_RANK = 100, 500, 50, 15, 100
VIDEO = "https://baseballsavant.mlb.com/sporty-videos?playId="


def rnd(x, nd=2):
    return None if x is None or not np.isfinite(x) else round(float(x), nd) + 0.0


def flip(name):
    """Savant's "Last, First" -> "First Last"."""
    return " ".join(reversed(name.split(", ", 1))) if isinstance(name, str) else None


def per100(d: pd.Series, k=K_SPLIT):
    """Strikes above expected per 100 taken, shrunk toward 0 by k pseudo-pitches."""
    return 100 * d.sum() / (d.size + k)


def region(x: np.ndarray, pz: np.ndarray) -> np.ndarray:
    """Edge region of a taken pitch, catcher's view: the shadow band around the zone where framing lives.
    Heart and far-off pitches are None. x in ft (plate half-width .83), pz in zone heights (0 bottom, 1 top)."""
    ring = (np.abs(x) <= 1.15) & (pz >= -0.3) & (pz <= 1.3)
    heart = (np.abs(x) < 0.5) & (pz > 0.22) & (pz < 0.78)
    v = np.where(pz >= 0.78, "top", np.where(pz <= 0.22, "bottom", ""))
    h = np.where(x <= -0.5, "left", np.where(x >= 0.5, "right", ""))
    lab = np.char.add(np.char.add(v.astype(str), np.where((v != "") & (h != ""), "-", "")), h.astype(str))
    return np.where(ring & ~heart, lab, None)


def pct_rank(v: pd.Series, higher_good=True) -> pd.Series:
    r = v.rank(pct=True, method="average") if higher_good else (-v).rank(pct=True, method="average")
    return (100 * r).round()


def parts(kind: str) -> pd.DataFrame:
    return pd.concat([pd.read_parquet(p) for p in sorted((CACHE / "catcher").glob(f"{kind}_*.parquet"))], ignore_index=True)


def framing_frame(con) -> pd.DataFrame:
    from defense_mlb import FRAME_SQL
    fp = pd.read_parquet(CACHE / "framing_pitches.parquet")
    sql = FRAME_SQL.replace("SELECT game_pk,", "SELECT game_pk, pitcher,")
    out = []
    for s, f in fp.groupby("season", sort=True):
        d = con.sql(sql.format(s=int(s))).df()
        if len(d) != len(f) or not (d["game_pk"].to_numpy() == f["game_pk"].to_numpy()).all() or \
                not np.allclose(d["plate_x"].to_numpy(), f["x"].to_numpy()):
            print(f"framing splits: {s} does not align with framing_pitches — skipped")
            continue
        f = f.reset_index(drop=True).assign(pitcher=d["pitcher"].to_numpy(), lhp=d["lhp"].to_numpy(),
                                            fam=d["pitch_type"].map(SITE_FAM).fillna("OT").to_numpy())
        out.append(f)
    fr = pd.concat(out, ignore_index=True)
    fr["d"] = fr["cs"] - fr["p"]
    fr["region"] = region(fr["x"].to_numpy(), fr["pz"].to_numpy())
    return fr


def split_rows(g: pd.DataFrame, key: str, labels=None) -> list[dict]:
    rows = []
    for k, s in g.groupby(key, observed=True):
        if len(s) < MIN_SPLIT:
            continue
        rows.append({"k": labels.get(k, k) if labels else (k if isinstance(k, str) else int(k)), "n": int(len(s)),
                     "v": rnd(per100(s["d"]), 1), "runs": rnd(s["runs"].sum(), 2)})
    return rows


def running_opps(con) -> pd.DataFrame:
    """Pitches with a runner who could steal (on 1B with 2B open, or on 2B with 3B open), per catcher x pitcher."""
    return con.sql("""SELECT fielder_2 AS catcher, pitcher, season, count(*) AS opps FROM pitches_all
        WHERE game_type = 'R' AND fielder_2 IS NOT NULL
          AND ((on_1b IS NOT NULL AND on_2b IS NULL) OR (on_2b IS NOT NULL AND on_3b IS NULL))
        GROUP BY 1, 2, 3""").df()


def bake(out: Path) -> dict:
    sys.path.insert(0, str(MART_DIR))
    import mart
    con = mart.connect()
    con.execute("SET threads TO 4")
    names = pd.read_parquet(ROOT / "data" / "milb" / "people.parquet")[["id", "name"]]
    nm = dict(zip(names["id"].astype(int), names["name"]))
    th_all = parts("throwing")  # Savant's own names fill ids the people table lacks (recent call-ups)
    for idc, namec in (("runner_id", "runner_name"), ("pitcher_id", "pitcher_name"), ("fielder_id", "fielder_name")):
        for i, n in zip(th_all[idc], th_all[namec]):
            if pd.notna(i) and int(i) not in nm and isinstance(n, str):
                nm[int(i)] = flip(n)
    for s in range(2020, 2027):
        for i, n in con.sql(f"SELECT player_id, player_name FROM lb_catcher_throwing_{s}").fetchall():
            nm.setdefault(int(i), flip(n))
    fc =pd.read_csv(RES / "defense_framing.csv")
    fq = fc[fc["n"] >= 2000]
    fc["pct"] = fq.groupby("season")["runs_shrunk"].transform(pct_rank)
    fr = framing_frame(con)
    th = parts("throwing")
    th = th[(th["is_pitchout"] != 1)].drop_duplicates(["game_pk", "at_bat_number", "play_init_seq", "runner_id"])
    bl = parts("blocking").drop_duplicates(["play_id"])
    # §108b passed its gates: our expected WP+PB replaces Savant's as the bar; theirs ships beside it, labelled.
    # Pitches with no location (no §108b prediction) keep Savant's number, a ~0.0% share.
    ours = pd.read_parquet(CACHE / "catcher" / "xpbwp_pred.parquet")[["play_id", "p"]]
    bl = bl.merge(ours, on="play_id", how="left")
    bl["x_sav"] = bl["x_runner_pbwp"]
    bl["x_runner_pbwp"] = bl["p"].fillna(bl["x_sav"])
    opps = running_opps(con)
    lb = {s: con.sql(f"SELECT player_id, pop_time, exchange_time, arm_strength, caught_stealing_above_average FROM "
                     f"lb_catcher_throwing_{s}").df() for s in range(2020, 2027)}
    lbb = {s: con.sql(f"SELECT player_id, blocks_above_average, catcher_blocking_runs FROM lb_catcher_blocking_{s}").df()
           for s in range(2021, 2027)}

    # season totals per catcher -> the board and the percentile pools
    fr_cs = fr.groupby(["mlbam", "season"]).size().rename("taken")
    t_cs = th.groupby(["catcher_id", "year"]).agg(att=("is_runner_cs", "size"), cs=("is_runner_cs", "sum"),
                                                  sb=("is_runner_sb", "sum"), xcs=("exp_cs", "sum"),
                                                  pop=("pop_time", "mean"), lead=("r_primary_lead", "mean"))
    t_cs["csaa"] = t_cs["cs"] - t_cs["xcs"]
    b_cs = bl.groupby(["catcher_id", "year"]).agg(opp=("is_runner_pbwp", "size"), dirt=("is_pitch_ground", "sum"),
                                                  pbwp=("is_runner_pbwp", "sum"), x=("x_runner_pbwp", "sum"),
                                                  xsav=("x_sav", "sum"))
    b_cs["baa"] = b_cs["x"] - b_cs["pbwp"]  # WP+PB prevented vs our §108b expectation: + is good for the catcher
    o_cs = opps.groupby(["catcher", "season"])["opps"].sum()
    t_cs["opps"] = [o_cs.get((c, s), np.nan) for c, s in t_cs.index]
    t_cs["att100"] = 100 * t_cs["att"] / t_cs["opps"]
    tq, bq = t_cs[t_cs["att"] >= MIN_ATT_RANK], b_cs[b_cs["dirt"] >= MIN_DIRT_RANK]
    t_cs["pct"] = tq.groupby(level=1)["csaa"].transform(pct_rank)
    t_cs["pct_rate"] = tq.groupby(level=1)["att100"].transform(lambda v: pct_rank(v, higher_good=False))
    b_cs["pct"] = bq.groupby(level=1)["baa"].transform(pct_rank)
    fpct = fc.set_index(["mlbam", "season"])

    keys = set(fr_cs[fr_cs >= MIN_TAKEN].index) | set(t_cs.index) | set(b_cs[b_cs["opp"] >= 200].index)
    board: dict = {}
    files = 0
    for cid, s in sorted(keys):
        cid, s = int(cid), int(s)
        doc = {"id": str(cid), "season": s, "name": nm.get(cid),
               "_comment": "Catcher defense (docs/catcher-defense-plan.md): framing splits from the §76 model; "
                           "blocking and throwing descriptive from Savant's per-play rows (their expectations labelled)"}
        f = fpct.loc[(cid, s)] if (cid, s) in fpct.index else None
        g = fr[(fr["mlbam"] == cid) & (fr["season"] == s)]
        if len(g) >= MIN_TAKEN:
            trend = fc[fc["mlbam"] == cid].sort_values("season")
            doc["framing"] = {
                "taken": int(len(g)), "per100": rnd(per100(g["d"], 0), 2), "runs": rnd(g["runs"].sum(), 2),
                "byPitcherHand": split_rows(g, "lhp", {0: "RHP", 1: "LHP"}),
                "byBatterHand": split_rows(g, "lhh", {0: "RHB", 1: "LHB"}),
                "byPitch": sorted(split_rows(g, "fam"), key=lambda r: -r["n"]),
                "byRegion": split_rows(g[g["region"].notna()], "region"),
                "byPitcher": sorted([{**r, "name": nm.get(r["k"])} for r in split_rows(g, "pitcher")],
                                    key=lambda r: -r["n"])[:25],
                "trend": [{"season": int(t.season), "taken": int(t.n), "runs": rnd(t.runs_shrunk, 2),
                           "plus": rnd(t.framing_plus, 1)} for t in trend.itertuples()],
                "pct": rnd(f["pct"], 0) if f is not None and pd.notna(f["pct"]) else None,
            }
        if (cid, s) in b_cs.index:
            b = bl[(bl["catcher_id"] == cid) & (bl["year"] == s)]
            t = b_cs.loc[(cid, s)]
            sv = lbb.get(s)
            svr = sv[sv["player_id"] == cid] if sv is not None else pd.DataFrame()
            pit = b.groupby("pitcher_id").agg(opp=("is_runner_pbwp", "size"), dirt=("is_pitch_ground", "sum"),
                                              pbwp=("is_runner_pbwp", "sum"), x=("x_runner_pbwp", "sum")).reset_index()
            show = b[(b["is_pitch_ground"] == 1) | (b["is_runner_pbwp"] == 1)]
            doc["blocking"] = {
                "opp": int(t.opp), "dirt": int(t.dirt), "pbwp": int(t.pbwp), "x": rnd(t.x, 1), "aa": rnd(t.baa, 1), "xSav": rnd(t.xsav, 1),
                "per100dirt": rnd(100 * t.pbwp / t.dirt, 1) if t.dirt else None,
                "pct": rnd(t.pct, 0) if pd.notna(t.pct) else None,
                "savant": {"baa": rnd(svr.iloc[0]["blocks_above_average"], 0), "runs": rnd(svr.iloc[0]["catcher_blocking_runs"], 1)}
                if len(svr) else None,
                "pts": [{"x": rnd(r.location_x, 2), "z": rnd(r.location_z, 2), "g": int(r.is_pitch_ground),
                         "wp": int(r.is_runner_pbwp), "xp": rnd(r.x_runner_pbwp, 3), "t": r.api_pitch_type_subgroup,
                         "date": r.game_date, "pid": r.play_id if r.is_runner_pbwp == 1 else None}
                        for r in show.itertuples() if np.isfinite(r.location_x) and np.isfinite(r.location_z)],
                "byPitcher": [{"id": int(r.pitcher_id), "name": nm.get(int(r.pitcher_id)), "opp": int(r.opp),
                               "dirt": int(r.dirt), "pbwp": int(r.pbwp), "x": rnd(r.x, 1)}
                              for r in pit.sort_values("dirt", ascending=False).itertuples() if r.dirt >= 5],
            }
        if (cid, s) in t_cs.index:
            e = th[(th["catcher_id"] == cid) & (th["year"] == s)].sort_values(["game_date", "game_pk", "at_bat_number"])
            t = t_cs.loc[(cid, s)]
            sv = lb.get(s)
            svr = sv[sv["player_id"] == cid] if sv is not None else pd.DataFrame()
            o = opps[(opps["catcher"] == cid) & (opps["season"] == s)].set_index("pitcher")["opps"]
            pit = e.groupby("pitcher_id").agg(att=("is_runner_cs", "size"), sb=("is_runner_sb", "sum"),
                                              cs=("is_runner_cs", "sum"), lead=("r_primary_lead", "mean"),
                                              spd=("seasonal_sprint_speed", "mean"), xcs=("exp_cs", "sum")).reset_index()
            doc["throwing"] = {
                "att": int(t.att), "sb": int(t.sb), "cs": int(t.cs), "csPct": rnd(100 * t.cs / t.att, 1),
                "xcs": rnd(t.xcs, 1), "csaa": rnd(t.csaa, 1), "opps": None if pd.isna(t.opps) else int(t.opps),
                "att100": rnd(t.att100, 2), "pct": rnd(t.pct, 0) if pd.notna(t.pct) else None,
                "pctRate": rnd(t.pct_rate, 0) if pd.notna(t.pct_rate) else None,
                "pop": rnd(e["pop_time"].mean(), 2), "exchange": rnd(e["pos2_f_exchange"].mean(), 2),
                "arm": rnd(e["pos2_f_arm_strength"].mean(), 1), "lead": rnd(t.lead, 1),
                "savant": {k: rnd(svr.iloc[0][c], nd) for k, c, nd in
                           (("pop", "pop_time", 2), ("exchange", "exchange_time", 2), ("arm", "arm_strength", 1),
                            ("csaa", "caught_stealing_above_average", 1))} if len(svr) else None,
                "byPitcher": [{"id": int(r.pitcher_id), "name": nm.get(int(r.pitcher_id)), "att": int(r.att),
                               "sb": int(r.sb), "cs": int(r.cs), "lead": rnd(r.lead, 1), "spd": rnd(r.spd, 1),
                               "xcs": rnd(r.xcs, 1), "opps": int(o.get(r.pitcher_id, 0))}
                              for r in pit.sort_values("att", ascending=False).itertuples()],
                "events": [{"date": r.game_date, "base": r.target_base, "runner": flip(r.runner_name), "rid": int(r.runner_id),
                            "pitcher": flip(r.pitcher_name), "pitcherId": int(r.pitcher_id), "spd": rnd(r.seasonal_sprint_speed, 1),
                            "lead": rnd(r.r_primary_lead, 1), "pop": rnd(r.pop_time, 2),
                            "exch": rnd(r.pos2_f_exchange, 2), "arm": rnd(r.pos2_f_arm_strength, 1),
                            "res": "CS" if r.is_runner_cs == 1 else "SB", "held": int(r.is_throw_held == 1),
                            "xcs": rnd(r.exp_cs, 3), "pid": r.play_id if isinstance(r.play_id, str) else None}
                           for r in e.itertuples()],
            }
        if not any(k in doc for k in ("framing", "blocking", "throwing")):
            continue
        jwrite_gz(out / "catcher" / f"{cid}-{s}.json.gz", doc, sort_keys=True)
        files += 1
        fb, bb, tb = doc.get("framing"), doc.get("blocking"), doc.get("throwing")
        board.setdefault(str(s), []).append({
            "id": str(cid), "name": nm.get(cid),
            "taken": fb["taken"] if fb else None,
            "framingRuns": rnd(f["runs_shrunk"], 1) if f is not None else None,
            "framingPlus": rnd(f["framing_plus"], 0) if f is not None else None, "framingPct": fb["pct"] if fb else None,
            "dirt": bb["dirt"] if bb else None, "pbwp": bb["pbwp"] if bb else None, "blockAA": bb["aa"] if bb else None,
            "blockPct": bb["pct"] if bb else None,
            "att": tb["att"] if tb else None, "sb": tb["sb"] if tb else None, "cs": tb["cs"] if tb else None,
            "csaa": tb["csaa"] if tb else None, "throwPct": tb["pct"] if tb else None,
            "att100": tb["att100"] if tb else None, "pop": tb["pop"] if tb else None, "arm": tb["arm"] if tb else None})
    jwrite(out / "catcher" / "board.json", {
        "_comment": "Catcher board: framing = §76 site model (shrunk runs); blocking = WP+PB prevented vs our §108b "
                    "expectation; throwing = CS above Savant's exp_cs. Per-play rows: Savant's public leaderboard drill-downs.",
        "video": VIDEO, "seasons": board}, sort_keys=True)
    return {"files": files, "board_rows": sum(len(v) for v in board.values())}


def tree(d: Path) -> dict:
    return {p.relative_to(d).as_posix(): p.read_bytes() for p in d.rglob("*") if p.is_file()}


def main():
    real = ROOT / "data" / "export" / "web"
    if "--check" not in sys.argv:
        raise SystemExit("use --check (and --write to publish); see the docstring")
    write = "--write" in sys.argv
    with bake_lock(real) if write else contextlib.nullcontext(), \
            tempfile.TemporaryDirectory() as a, tempfile.TemporaryDirectory() as b:
        ca, cb = bake(Path(a)), bake(Path(b))
        ta, tb = tree(Path(a)), tree(Path(b))
        diff = sorted(k for k in set(ta) | set(tb) if ta.get(k) != tb.get(k))
        print(f"check: {ca} | {len(diff)} differing files {'PASS' if not diff else 'FAIL ' + str(diff[:5])}")
        if diff or not write:
            return
        shutil.rmtree(real / "catcher", ignore_errors=True)
        shutil.copytree(Path(a) / "catcher", real / "catcher")
        print(f"wrote {real / 'catcher'}")


def demo():
    r = region(np.array([0.0, 0.0, -0.9, 0.9, 0.0, 3.0]), np.array([0.5, 0.95, 0.1, 0.5, 0.1, 0.5]))
    assert list(r) == [None, "top", "bottom-left", "right", "bottom", None], r
    assert per100(pd.Series([1.0] * 100)) == 50.0 and per100(pd.Series([1.0] * 100), 0) == 100.0
    print("demo ok")


if __name__ == "__main__":
    demo() if "--demo" in sys.argv else main()
