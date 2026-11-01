"""afl_export.py — the /afl page: Arizona Fall League boards and "AFL vs his regular season" deltas.

    python pipeline/afl_export.py          -> data/export/web/afl/{index,<season>}.json
    python pipeline/afl_export.py --demo   # self-checks (also run by test_afl.py)

Inputs: data/afl/{pitches,box}.parquet (afl_fetch.py), the mart's MLB + AAA Statcast pitches for the same
season (regular season), data/milb box lines (milb_lines.py) for the same season's K% / BB% / OPS.

Every rate is the site's own definition, computed by ONE function (`rates`) on both sides of a delta:
the call sets are web_export's (CSW / WHIFF / SWING, foul tips are whiffs), chase = swings at zones 10-14 (Savant has no 10)
over pitches there, K% / BB% over PA, hard-hit = EV >= 95 on balls in play, EV90 = 90th percentile EV,
pitch codes folded to the site's (web_export.SC_TO_SITE). Lines (IP, slash line) are the official box.
Barrel: Savant's own flag (launch_speed_angle = 6) does not exist outside Statcast's CSV, so `barrel()`
applies Savant's published rule to the feed's rounded EV/LA (agrees with Savant's flag on 99.7% of MLB
2026 balls in play, 9,539 vs 9,561; docs/formulas.md). Spin is shown only for a pitch type whose spin was
tracked on >= half its pitches (spin is missing on part of the Scottsdale/Peoria/Salt River slate and at
Kino Stadium nothing is tracked at all); the per-park coverage ships in the file.

Descriptive only: no model is scored on AFL pitches (Whiff+ and friends need the cross-fit rerun and a gate
of their own; docs/model-inventory.md). A delta compares two systems' tracking (AFL spring parks vs MLB/AAA
Hawk-Eye) over a few weeks, so it is a lead, not a measurement.
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from web_export import CSW, SC_TO_SITE, SWING, WHIFF  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "data" / "afl"
MILB = ROOT / "data" / "milb"
OUT = ROOT / "data" / "export" / "web" / "afl"
K_EV = ("strikeout", "strikeout_double_play")
BB_EV = ("walk", "intent_walk")
MIN_TYPE_N = 10      # pitches of a type before its row (and its deltas) show
NEW_PITCH_USE = 5.0  # % of AFL pitches for a "new pitch" ...
NEW_PITCH_REG = 1.0  # ... that was under this % of his regular-season tracked pitches
REG_MIN = 100        # tracked regular-season pitches (or swings seen, hitters) before a delta shows
SPIN_COVER = 0.5


def barrel(ev, la):
    """Savant's barrel rule (launch_speed_angle 6: EV >= 98, EV*1.5 - LA >= 117, EV + LA >= 124, LA 4-50) on a
    launch angle rounded to the whole degree, as the feed carries it: barrel if any angle within +-0.5 qualifies."""
    ev, la = np.asarray(ev, float), np.asarray(la, float)
    lo = np.maximum.reduce([la - 0.5, 124 - ev, np.full_like(ev, 4.0)])
    hi = np.minimum.reduce([la + 0.5, 1.5 * ev - 117, np.full_like(ev, 50.0)])
    return (ev >= 98) & (lo <= hi)


def rates(df: pd.DataFrame) -> dict:
    """The site's pitch-level rates on one group of Statcast-schema pitches (either side of the plate)."""
    d = df["description"]
    sw, wh = d.isin(SWING), d.isin(WHIFF)
    ooz = df["zone"].between(10, 14)
    pa = df["events"].notna() & (df["events"] != "truncated_pa")
    bip = df[df["bb_type"].notna() & df["launch_speed"].notna()]
    n, nsw, nooz, npa, nbip = len(df), int(sw.sum()), int(ooz.sum()), int(pa.sum()), len(bip)
    pct = lambda a, b: 100 * a / b if b else None  # noqa: E731
    return {
        "n": n, "swings": nsw, "pa": npa, "bip": nbip,
        "cswPct": pct(d.isin(CSW).sum(), n), "whiffPct": pct(wh.sum(), nsw),
        "chasePct": pct((ooz & sw).sum(), nooz), "zonePct": pct(df["zone"].between(1, 9).sum(), n),
        "kPct": pct(df["events"].isin(K_EV).sum(), npa), "bbPct": pct(df["events"].isin(BB_EV).sum(), npa),
        "ev": bip["launch_speed"].mean() if nbip else None,
        "ev90": bip["launch_speed"].quantile(0.9) if nbip else None,
        "maxEv": bip["launch_speed"].max() if nbip else None,
        "hardHitPct": pct((bip["launch_speed"] >= 95).sum(), nbip),
        "barrelPct": pct(barrel(bip["launch_speed"], bip["launch_angle"]).sum(),
                         int(bip["launch_angle"].notna().sum())),
    }


def arsenal(df: pd.DataFrame) -> pd.DataFrame:
    """Per site pitch code: usage, velo, movement (Statcast pfx in inches, catcher's view like every bake),
    spin where tracked, extension, whiff / CSW / chase."""
    df = df.assign(site=df["pitch_type"].map(SC_TO_SITE)).dropna(subset=["site"])
    tot = len(df)
    out = []
    for site, g in df.groupby("site"):
        sp = g["release_spin_rate"].notna().mean()
        rr = rates(g)
        out.append({"type": site, "n": len(g), "usage": 100 * len(g) / tot if tot else None,
                    "velo": g["release_speed"].mean(), "ivb": 12 * g["pfx_z"].mean(), "hb": 12 * g["pfx_x"].mean(),
                    "spin": g["release_spin_rate"].mean() if sp >= SPIN_COVER else None, "spinCover": sp,
                    "ext": g["release_extension"].mean(),
                    **{k: rr[k] for k in ("whiffPct", "cswPct", "chasePct", "swings")}})
    return pd.DataFrame(out).sort_values("n", ascending=False) if out else pd.DataFrame()


def rnd(x, nd=1):
    if x is None or (isinstance(x, float) and not np.isfinite(x)):
        return None
    return round(float(x), nd)


THREE = {"avg", "obp", "slg", "ops", "regOps", "dOps", "spinCover"}


def clean(d: dict) -> dict:
    return {k: (int(v) if isinstance(v, (int, np.integer)) and not isinstance(v, bool)
                else rnd(v, 3 if k in THREE else 1) if isinstance(v, (float, np.floating)) else v)
            for k, v in d.items()}


def ip_of(outs: int) -> float:
    return outs // 3 + (outs % 3) / 10  # baseball notation, 12.2


def box_lines(box: pd.DataFrame, season: int) -> tuple[pd.DataFrame, pd.DataFrame]:
    b = box[box["season"] == season]
    keys = ["id"]
    p = b[b["role"] == "P"]
    h = b[b["role"] == "H"]
    pc = ["outs", "bf", "so", "bb", "ibb", "hbp", "h", "hr", "er", "r", "pitches", "gs"]
    hc = ["pa", "ab", "h", "2b", "3b", "hr", "bb", "ibb", "hbp", "sf", "sh", "so", "sb", "cs"]
    first = lambda g: g.groupby(keys)[["name", "team"]].last()  # noqa: E731 — the last AFL club
    pl = p.groupby(keys)[pc].sum().join(p.groupby(keys)["game_pk"].nunique().rename("g")).join(first(p))
    hl = h.groupby(keys)[hc].sum().join(h.groupby(keys)["game_pk"].nunique().rename("g")).join(first(h))
    return pl.reset_index(), hl.reset_index()


def slash(t) -> dict:
    tb = t["h"] + t["2b"] + 2 * t["3b"] + 3 * t["hr"]
    obp_d = t["ab"] + t["bb"] + t["hbp"] + t["sf"]
    avg = t["h"] / t["ab"] if t["ab"] else None
    obp = (t["h"] + t["bb"] + t["hbp"]) / obp_d if obp_d else None
    slg = tb / t["ab"] if t["ab"] else None
    return {"avg": avg, "obp": obp, "slg": slg, "ops": obp + slg if obp is not None and slg is not None else None}


def regular_pitches(season: int, pitchers: list[int], batters: list[int]) -> pd.DataFrame:
    """MLB + AAA Statcast pitches of these players, regular season (the site's two tracked levels)."""
    from paths import MART_DIR
    sys.path.insert(0, str(MART_DIR))
    import mart
    con = mart.connect()
    cols = ("pitcher, batter, pitch_type, description, events, zone, bb_type, launch_speed, launch_angle, "
            "release_speed, pfx_x, pfx_z, release_spin_rate, release_extension")
    ids = lambda xs: ",".join(str(int(x)) for x in xs) or "NULL"  # noqa: E731
    parts = []
    for view, lvl in (("pitches_all", "MLB"), ("pitches_aaa", "AAA")):
        parts.append(con.sql(f"""SELECT {cols}, '{lvl}' AS level FROM {view}
                                 WHERE season = {season} AND game_type = 'R'
                                   AND (pitcher IN ({ids(pitchers)}) OR batter IN ({ids(batters)}))""").df())
    return pd.concat(parts, ignore_index=True)


def profile_ids() -> tuple[set[int], set[int]]:
    """Who has a page: MLB Statcast 2020+ (/player/{id}, either role) and any MiLB line (/minors/player/{id})."""
    from paths import MART_DIR
    sys.path.insert(0, str(MART_DIR))
    import mart
    w = "season >= 2020 AND game_type = 'R'"  # spring training rows would hand a prospect an empty profile
    mlb = set(mart.connect().sql(f"""SELECT DISTINCT pitcher AS id FROM pitches_all WHERE {w}
                                     UNION SELECT DISTINCT batter FROM pitches_all WHERE {w}""").df()["id"])
    milb = set()
    for kind in ("pitchers", "hitters"):
        if (MILB / f"{kind}.parquet").exists():
            milb |= set(pd.read_parquet(MILB / f"{kind}.parquet", columns=["mlbam_id"])["mlbam_id"])
    return {int(x) for x in mlb}, {int(x) for x in milb}


def season_lines(season: int) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Every 2026-style box line of the season (Rookie..AAA + MLB), summed per player with his levels listed."""
    out = []
    for kind in ("pitchers", "hitters"):
        frames = [pd.read_parquet(MILB / f"{kind}.parquet")]
        if (MILB / f"mlb_{kind}.parquet").exists():
            frames.append(pd.read_parquet(MILB / f"mlb_{kind}.parquet").assign(level="MLB"))
        df = pd.concat(frames, ignore_index=True)
        df = df[df["season"] == season]
        cnt = ["BF", "SO", "BB"] if kind == "pitchers" else ["PA", "AB", "H", "2B", "3B", "HR", "BB", "HBP", "SF", "SO"]
        order = {"MLB": 0, "AAA": 1, "AA": 2, "A+": 3, "A": 4, "ROK": 5}
        g = df.groupby("mlbam_id")
        agg = g[cnt].sum().join(g["level"].agg(lambda s, o=order: ", ".join(sorted(set(s), key=lambda x: o.get(x, 9)))))
        main_team = df.sort_values(cnt[0], ascending=False).groupby("mlbam_id")["team_name"].first()
        out.append(agg.join(main_team.rename("regTeam")))
    return out[0], out[1]


def pct_or_none(a, b):
    return 100 * a / b if b else None


def build(season: int, pitches: pd.DataFrame, box: pd.DataFrame, reg: pd.DataFrame | None,
          lines: tuple[pd.DataFrame, pd.DataFrame] | None, profiles: tuple[set, set] = (set(), set())) -> dict:
    px = pitches[pitches["season"] == season]
    pl, hl = box_lines(box, season)
    reg = reg if reg is not None else pd.DataFrame(columns=px.columns.tolist() + ["level"])
    rp_lines, rh_lines = lines if lines is not None else (pd.DataFrame(), pd.DataFrame())
    throws = px.groupby("pitcher")["p_throws"].agg(lambda s: s.mode().iat[0] if len(s.mode()) else None)
    bats = px.groupby("batter")["stand"].agg(lambda s: "S" if s.nunique() > 1 else s.iat[0])

    page = lambda i: "mlb" if i in profiles[0] else "minors" if i in profiles[1] else None  # noqa: E731
    pitchers, hitters = [], []
    for t in pl.to_dict("records"):
        mine = px[px["pitcher"] == t["id"]]
        tracked = mine[mine["release_speed"].notna()]
        rr = rates(mine)
        ars = arsenal(tracked)
        row = {"id": str(t["id"]), "name": t["name"], "page": page(t["id"]), "team": t["team"],
               "throws": throws.get(t["id"]),
               "g": int(t["g"]), "gs": int(t["gs"]), "ip": ip_of(int(t["outs"])), "outs": int(t["outs"]),
               "bf": int(t["bf"]), "era": 9 * t["er"] / (t["outs"] / 3) if t["outs"] else None,
               "kPct": pct_or_none(t["so"], t["bf"]), "bbPct": pct_or_none(t["bb"], t["bf"]),
               "nPitches": len(mine), "nTracked": len(tracked),
               **{k: rr[k] for k in ("cswPct", "whiffPct", "chasePct", "zonePct", "swings")},
               "evAg": rr["ev"], "hardHitPctAg": rr["hardHitPct"],
               "arsenal": [clean(a) for a in ars.to_dict("records")] if len(ars) else []}
        row["kBbPct"] = row["kPct"] - row["bbPct"] if row["kPct"] is not None else None
        fb = ars[ars["type"].isin(["FF", "SI"])] if len(ars) else ars
        row["fbVelo"] = float(fb.iloc[0]["velo"]) if len(fb) and fb.iloc[0]["n"] >= MIN_TYPE_N else None
        row["delta"] = pitcher_delta(row, ars, reg[reg["pitcher"] == t["id"]], rp_lines, t["id"])
        pitchers.append(clean(row))
    for t in hl.to_dict("records"):
        mine = px[px["batter"] == t["id"]]
        rr = rates(mine)
        row = {"id": str(t["id"]), "name": t["name"], "page": page(t["id"]), "team": t["team"],
               "bats": bats.get(t["id"]),
               "g": int(t["g"]), "pa": int(t["pa"]), **{k: v for k, v in slash(t).items()},
               "hr": int(t["hr"]), "sb": int(t["sb"]),
               "kPct": pct_or_none(t["so"], t["pa"]), "bbPct": pct_or_none(t["bb"], t["pa"]),
               "nPitches": len(mine), "bip": rr["bip"], "swings": rr["swings"],
               **{k: rr[k] for k in ("ev", "ev90", "maxEv", "hardHitPct", "barrelPct", "whiffPct", "chasePct")}}
        row["delta"] = hitter_delta(row, reg[reg["batter"] == t["id"]], rh_lines, t["id"])
        hitters.append(clean(row))
    cover = (px.groupby("venue").agg(games=("game_pk", "nunique"), pitches=("game_pk", "size"),
                                     tracked=("release_speed", lambda s: s.notna().mean()),
                                     spin=("release_spin_rate", lambda s: s.notna().mean()),
                                     ext=("release_extension", lambda s: s.notna().mean()))
             .reset_index().sort_values("pitches", ascending=False))
    dates = px["game_date"]
    return {"season": season, "games": int(px["game_pk"].nunique()), "pitches": len(px),
            "from": dates.min() if len(px) else None, "to": dates.max() if len(px) else None,
            "parks": [{**c, "tracked": rnd(c["tracked"], 3), "spin": rnd(c["spin"], 3), "ext": rnd(c["ext"], 3)}
                      for c in cover.to_dict("records")],
            "pitchers": pitchers, "hitters": hitters}


def pitcher_delta(row: dict, afl_ars: pd.DataFrame, reg: pd.DataFrame, lines: pd.DataFrame, pid: int) -> dict | None:
    out = {}
    if pid in lines.index:
        ln = lines.loc[pid]
        out.update({"levels": ln["level"], "regTeam": ln["regTeam"], "regBf": int(ln["BF"]),
                    "regKPct": pct_or_none(ln["SO"], ln["BF"]), "regBbPct": pct_or_none(ln["BB"], ln["BF"])})
        if out["regKPct"] is not None and row["kPct"] is not None:
            out["dKPct"] = row["kPct"] - out["regKPct"]
            out["dBbPct"] = row["bbPct"] - out["regBbPct"]
    reg = reg[reg["release_speed"].notna()]
    if len(reg) >= REG_MIN:
        rr = rates(reg)
        out.update({"regTracked": len(reg), "regLevel": "+".join(sorted(reg["level"].unique(), reverse=True)),
                    "regWhiffPct": rr["whiffPct"], "regChasePct": rr["chasePct"], "regCswPct": rr["cswPct"]})
        for k in ("whiffPct", "chasePct", "cswPct"):
            if row[k] is not None and rr[k] is not None:
                out["d" + k[0].upper() + k[1:]] = row[k] - rr[k]
        ra = arsenal(reg).set_index("type")
        types, new = [], []
        for a in afl_ars.to_dict("records") if len(afl_ars) else []:
            if a["n"] < MIN_TYPE_N:
                continue
            r = ra.loc[a["type"]] if a["type"] in ra.index else None
            if (r is None or r["usage"] < NEW_PITCH_REG) and a["usage"] >= NEW_PITCH_USE:
                new.append(a["type"])
            if r is not None and r["n"] >= MIN_TYPE_N:
                types.append({"type": a["type"], "n": int(a["n"]), "regN": int(r["n"]),
                              "dVelo": a["velo"] - r["velo"], "dIvb": a["ivb"] - r["ivb"], "dHb": a["hb"] - r["hb"],
                              "dUsage": a["usage"] - r["usage"],
                              "dSpin": a["spin"] - r["spin"] if a["spin"] is not None and r["spin"] is not None else None})
        dropped = [t for t, r in ra.iterrows() if r["usage"] >= NEW_PITCH_USE
                   and (t not in set(afl_ars["type"]) if len(afl_ars) else True)]
        out.update({"types": [clean(t) for t in types], "newPitches": new, "dropped": dropped})
        fb = [t for t in types if t["type"] in ("FF", "SI")]
        if fb:
            out["dFbVelo"] = max(fb, key=lambda t: t["n"])["dVelo"]
    return clean(out) if out else None


def hitter_delta(row: dict, reg: pd.DataFrame, lines: pd.DataFrame, bid: int) -> dict | None:
    out = {}
    if bid in lines.index:
        ln = lines.loc[bid]
        s = slash({"h": ln["H"], "2b": ln["2B"], "3b": ln["3B"], "hr": ln["HR"], "ab": ln["AB"], "bb": ln["BB"],
                   "hbp": ln["HBP"], "sf": ln["SF"]})
        out.update({"levels": ln["level"], "regTeam": ln["regTeam"], "regPa": int(ln["PA"]),
                    "regOps": s["ops"], "regKPct": pct_or_none(ln["SO"], ln["PA"]),
                    "regBbPct": pct_or_none(ln["BB"], ln["PA"])})
        for k, rk in (("ops", "regOps"), ("kPct", "regKPct"), ("bbPct", "regBbPct")):
            if row[k] is not None and out[rk] is not None:
                out["d" + k[0].upper() + k[1:]] = row[k] - out[rk]
    if len(reg) >= REG_MIN:
        rr = rates(reg)
        out.update({"regPitches": len(reg), "regLevel": "+".join(sorted(reg["level"].unique(), reverse=True)),
                    "regEv": rr["ev"], "regHardHitPct": rr["hardHitPct"], "regWhiffPct": rr["whiffPct"],
                    "regChasePct": rr["chasePct"]})
        for k in ("ev", "hardHitPct", "whiffPct", "chasePct"):
            if row[k] is not None and rr[k] is not None:
                out["d" + k[0].upper() + k[1:]] = row[k] - rr[k]
    return clean(out) if out else None


def demo() -> None:
    # barrel rule: 98 mph needs 26-30 deg, 110 mph 14-48
    assert list(barrel([98.0, 98.0, 98.0, 97.9, 110.0, 110.0], [28, 31, 24, 28, 14, 51])) == \
        [True, False, False, False, True, False]
    df = pd.DataFrame({
        "description": ["swinging_strike", "foul", "ball", "called_strike", "hit_into_play", "foul_tip"],
        "zone": [12, 5, 13, 5, 6, 11], "events": [None, None, None, None, "single", "strikeout"],
        "bb_type": [None, None, None, None, "line_drive", None], "launch_speed": [None, None, None, None, 101.0, None],
        "launch_angle": [None, None, None, None, 25.0, None]})
    r = rates(df)
    assert r["swings"] == 4 and abs(r["whiffPct"] - 50) < 1e-9          # foul tip is a whiff, as on the site
    assert abs(r["chasePct"] - 200 / 3) < 1e-9                        # 2 swings of 3 pitches in zones 10-14
    assert abs(r["cswPct"] - 50) < 1e-9 and r["pa"] == 2 and r["kPct"] == 50
    assert r["hardHitPct"] == 100 and r["barrelPct"] == 100
    print("afl_export demo ok")


def main() -> None:
    if "--demo" in sys.argv:
        demo()
        return
    pitches = pd.read_parquet(SRC / "pitches.parquet")
    box = pd.read_parquet(SRC / "box.parquet")
    OUT.mkdir(parents=True, exist_ok=True)
    seasons = sorted(int(s) for s in pitches["season"].unique())
    index, profiles = [], profile_ids()
    for s in seasons:
        ids = box[box["season"] == s]
        reg = regular_pitches(s, ids.loc[ids["role"] == "P", "id"].unique(), ids.loc[ids["role"] == "H", "id"].unique())
        lines = season_lines(s) if (MILB / "pitchers.parquet").exists() else None
        doc = build(s, pitches, box, reg, lines, profiles)
        (OUT / f"{s}.json").write_text(json.dumps(doc, separators=(",", ":"), default=str))
        index.append({k: doc[k] for k in ("season", "games", "pitches", "from", "to")}
                     | {"pitchers": len(doc["pitchers"]), "hitters": len(doc["hitters"])})
        print(f"{s}: {doc['games']} games, {doc['pitches']} pitches, {len(doc['pitchers'])} P / "
              f"{len(doc['hitters'])} H; deltas P {sum(r['delta'] is not None for r in doc['pitchers'])}, "
              f"H {sum(r['delta'] is not None for r in doc['hitters'])}", flush=True)
    (OUT / "index.json").write_text(json.dumps({"seasons": index[::-1]}, separators=(",", ":"), default=str))


if __name__ == "__main__":
    main()
