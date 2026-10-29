"""Postseason view: brackets, series results, game reports with lineups, and postseason leaders, 2020-26.

    python pipeline/postseason.py               # bake data/export/web/postseason/
    python pipeline/web_export.py --only postseason   # the same, as a bake family

Sources: the MLB Stats API (schedule/postseason/series for the bracket and scores, game/{pk}/boxscore for
batting orders and the official box lines) and the Statcast mart (game_type F/D/L/W pitches) for the PA table,
win probability and run value. Completed boxscores are cached in data/milb/postseason_box.json; the schedule
is re-read each run, so a rerun after the daily ingest picks up new games. A game the mart has not ingested yet
ships its box score and lineups with an empty PA table.

Outputs (postseason/):
  index.json            {seasons: {YYYY: {series[], leaders{hitters,pitchers}}}, lineups{abbr: latest lineup}}
  games/{gid}.json.gz   the games/{gid} schema (g, d, home, away, final [home, away], p, b, pas) plus
                        lineups, series, wpa {timeline, moments}
Leaders are postseason WPA and Statcast run value (delta_run_exp; pitchers negated). Descriptive.
"""
import gzip
import json
import sys
import urllib.request
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
PIPE = ROOT / "pipeline"
sys.path.insert(0, str(PIPE))
from paths import MART_DIR  # noqa: E402

OUT = ROOT / "data" / "export" / "web" / "postseason"
BOX_CACHE = ROOT / "data" / "milb" / "postseason_box.json"
SCHED_CACHE = ROOT / "data" / "milb" / "postseason_series.json"
SEASONS = range(2020, 2027)
ROUND = {"F": "Wild Card", "D": "Division Series", "L": "Championship Series", "W": "World Series"}
# trades.py's id -> abbreviation table; the mart's own abbreviation wins where the game is in the mart
TEAM = {108: "LAA", 109: "AZ", 110: "BAL", 111: "BOS", 112: "CHC", 113: "CIN", 114: "CLE", 115: "COL", 116: "DET",
        117: "HOU", 118: "KC", 119: "LAD", 120: "WSH", 121: "NYM", 133: "ATH", 134: "PIT", 135: "SD", 136: "SEA",
        137: "SF", 138: "STL", 139: "TB", 140: "TEX", 141: "TOR", 142: "MIN", 143: "PHI", 144: "ATL", 145: "CWS",
        146: "MIA", 147: "NYY", 158: "MIL"}
# web_export.py's PA result codes (function-local there)
PA_EVENT_CODE = {
    "strikeout": "K", "strikeout_double_play": "KD", "walk": "BB", "intentional_walk": "IBB", "intent_walk": "IBB",
    "hit_by_pitch": "HBP", "single": "1B", "double": "2B", "triple": "3B", "home_run": "HR",
    "field_out": "FO", "force_out": "FO", "other_out": "FO", "grounded_into_double_play": "GDP", "double_play": "DP",
    "grounded_into_triple_play": "GTP", "triple_play": "TP", "fielders_choice": "FC", "fielders_choice_out": "FC",
    "field_error": "E", "sac_fly": "SF", "sac_fly_double_play": "SF", "sac_bunt": "SH", "sac_bunt_double_play": "SH",
    "catcher_interf": "CI", "batter_interference": "CI", "defensive_interf": "CI", "fan_interference": "FI",
    "obstruction": "OB", "passed_ball": "PB", "wild_pitch": "WP",
    **{f"caught_stealing_{b}": "CS" for b in ("2b", "3b", "home")},
    **{f"pickoff_{b}": "PK" for b in ("1b", "2b", "3b")},
    **{f"pickoff_caught_stealing_{b}": "PCS" for b in ("2b", "3b", "home")},
}
PITCH_CODE_SQL = """CASE description
    WHEN 'ball' THEN 'B' WHEN 'intent_ball' THEN 'B' WHEN 'automatic_ball' THEN 'B' WHEN 'pitchout' THEN 'B'
    WHEN 'blocked_ball' THEN 'B' WHEN 'called_strike' THEN 'C' WHEN 'automatic_strike' THEN 'C'
    WHEN 'swinging_strike' THEN 'S' WHEN 'swinging_strike_blocked' THEN 'S' WHEN 'swinging_pitchout' THEN 'S'
    WHEN 'foul_tip' THEN 'T' WHEN 'bunt_foul_tip' THEN 'T' WHEN 'foul' THEN 'F' WHEN 'foul_bunt' THEN 'F'
    WHEN 'missed_bunt' THEN 'M' WHEN 'hit_by_pitch' THEN 'P' WHEN 'hit_into_play' THEN 'X' ELSE '?' END"""
LEADERS = 25


def get(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def r3(x, nd=3):
    return None if x is None or x != x else round(float(x), nd)


def schedule() -> dict:
    """{season: series list} from the Stats API, falling back to the last good copy per season."""
    cache = json.loads(SCHED_CACHE.read_text()) if SCHED_CACHE.exists() else {}
    for y in SEASONS:
        try:
            cache[str(y)] = get(f"https://statsapi.mlb.com/api/v1/schedule/postseason/series?season={y}&sportId=1")["series"]
        except Exception as e:  # noqa: BLE001 - offline rerun keeps the cached bracket
            print(f"postseason: schedule {y} fetch failed ({e}); using cache")
    SCHED_CACHE.parent.mkdir(parents=True, exist_ok=True)
    SCHED_CACHE.write_text(json.dumps(cache))
    return cache


def box_lines(gid: int) -> dict:
    """Compact boxscore: per side the starting lineup, subs, batting and pitching lines."""
    b = get(f"https://statsapi.mlb.com/api/v1/game/{gid}/boxscore")
    out = {}
    for side in ("away", "home"):
        t = b["teams"][side]
        pl = t["players"]
        bats = []
        for key, p in pl.items():
            bo = p.get("battingOrder")
            st = p.get("stats", {}).get("batting", {})
            if not bo:
                continue
            bats.append({"id": p["person"]["id"], "n": p["person"]["fullName"], "pos": p.get("position", {}).get("abbreviation"),
                         "bo": int(bo), "pa": st.get("plateAppearances", 0), "h": st.get("hits", 0), "hr": st.get("homeRuns", 0),
                         "bb": st.get("baseOnBalls", 0), "k": st.get("strikeOuts", 0)})
        pits = []
        for pid in t.get("pitchers", []):
            p = pl[f"ID{pid}"]
            st = p.get("stats", {}).get("pitching", {})
            pits.append({"id": pid, "n": p["person"]["fullName"], "outs": st.get("outs", 0), "h": st.get("hits", 0),
                         "r": st.get("runs", 0), "bb": st.get("baseOnBalls", 0), "k": st.get("strikeOuts", 0),
                         "hr": st.get("homeRuns", 0), "bf": st.get("battersFaced", 0), "pc": st.get("numberOfPitches", 0)})
        out[side] = {"abbr": t["team"].get("abbreviation"), "bats": sorted(bats, key=lambda x: x["bo"]), "pitchers": pits}
    return out


def bake(con=None, out: Path = OUT) -> int:
    if con is None:
        sys.path.insert(0, str(MART_DIR))
        import mart
        con = mart.connect()
    sched = schedule()
    box = json.loads(BOX_CACHE.read_text()) if BOX_CACHE.exists() else {}

    seasons_list = ",".join(map(str, SEASONS))
    pas = con.sql(f"""
        SELECT game_pk, season, at_bat_number,
               arg_min(inning, pitch_number) AS inn, arg_min(inning_topbot, pitch_number) AS tb,
               arg_min(outs_when_up, pitch_number) AS outs,
               arg_min(on_1b, pitch_number) AS on_1b, arg_min(on_2b, pitch_number) AS on_2b,
               arg_min(on_3b, pitch_number) AS on_3b,
               arg_max(post_home_score, pitch_number) AS sc_h, arg_max(post_away_score, pitch_number) AS sc_a,
               max(home_team) AS home, max(away_team) AS away, max(game_date) AS game_date,
               arg_max(events, pitch_number) AS ev, arg_max(des, pitch_number) AS des,
               max(pitcher) AS pitcher, max(batter) AS batter,
               arg_min(home_win_exp, pitch_number) AS we0, sum(delta_home_win_exp) AS dwe,
               sum(delta_run_exp) AS rv, sum(woba_value) AS wv, sum(woba_denom) AS wd,
               avg(CASE WHEN description = 'hit_into_play' THEN launch_speed END) AS ev_avg,
               count(CASE WHEN description = 'hit_into_play' AND launch_speed IS NOT NULL THEN 1 END) AS n_ev,
               list(struct_pack(t := pitch_type, v := round(release_speed, 1), c := {PITCH_CODE_SQL})
                    ORDER BY pitch_number) AS pitches
        FROM pitches_all
        WHERE game_type IN ('F', 'D', 'L', 'W') AND season IN ({seasons_list})
          AND pitcher IS NOT NULL AND batter IS NOT NULL
        GROUP BY game_pk, season, at_bat_number
        ORDER BY game_pk, at_bat_number""").df()
    pas["swing"] = pas["dwe"].where(pas["tb"] == "Bot", -pas["dwe"])
    by_game = {int(k): g for k, g in pas.groupby("game_pk", sort=True)}

    (out / "games").mkdir(parents=True, exist_ok=True)
    index: dict = {"seasons": {}, "lineups": {}}
    n_files = 0
    for y in SEASONS:
        series_out = []
        abbr: dict = {}
        for s in sched.get(str(y), []):
            for gm in s["games"]:
                g = by_game.get(gm["gamePk"])
                if g is not None:
                    abbr[gm["teams"]["home"]["team"]["id"]] = g["home"].iloc[0]
                    abbr[gm["teams"]["away"]["team"]["id"]] = g["away"].iloc[0]
        ab = lambda tid: abbr.get(tid) or TEAM.get(tid, str(tid))  # noqa: E731
        for s in sched.get(str(y), []):
            games = sorted(s["games"], key=lambda gm: (gm.get("seriesGameNumber", 0), gm["gamePk"]))
            if not games:
                continue
            g0 = games[0]
            ttype = s["series"].get("gameType") or g0["gameType"]
            need = (g0.get("gamesInSeries", 1) // 2) + 1
            wins: dict = {}
            teams = [g0["teams"]["away"]["team"]["id"], g0["teams"]["home"]["team"]["id"]]
            games_out = []
            for gm in games:
                fin = gm["status"]["abstractGameState"] == "Final" and gm["status"].get("codedGameState") not in ("D", "C")
                a, h = gm["teams"]["away"], gm["teams"]["home"]
                if fin:
                    w = a if a.get("isWinner") else h if h.get("isWinner") else None
                    if w:
                        wins[w["team"]["id"]] = wins.get(w["team"]["id"], 0) + 1
                gid = gm["gamePk"]
                has = False
                if fin:
                    if str(gid) not in box:
                        try:
                            box[str(gid)] = box_lines(gid)
                        except Exception as e:  # noqa: BLE001
                            print(f"postseason: boxscore {gid} failed ({e})")
                    if str(gid) in box:
                        has = True
                        n_files += write_game(out, gid, gm, s, ab, box[str(gid)], by_game.get(gid), index["lineups"])
                games_out.append({"gid": str(gid), "n": gm.get("seriesGameNumber"), "date": gm.get("officialDate"),
                                  "away": ab(a["team"]["id"]), "home": ab(h["team"]["id"]),
                                  "awayScore": a.get("score"), "homeScore": h.get("score"),
                                  "status": gm["status"]["detailedState"], "final": fin, "report": has,
                                  "pitchData": gid in by_game, "ifNecessary": gm.get("ifNecessary") == "Y",
                                  "sp": {sd: {"id": str(box[str(gid)][sd]["pitchers"][0]["id"]), "n": box[str(gid)][sd]["pitchers"][0]["n"]}
                                         for sd in ("away", "home") if has and box[str(gid)][sd]["pitchers"]} or None})
            winner = next((ab(t) for t in teams if wins.get(t, 0) >= need), None)
            desc = g0.get("seriesDescription", ROUND.get(ttype, ttype))
            series_out.append({"id": s["series"]["id"], "round": ttype, "label": desc,
                               "league": "AL" if desc.startswith("AL") else "NL" if desc.startswith("NL") else None,
                               "bestOf": g0.get("gamesInSeries"),
                               "teams": [{"abbr": ab(t), "wins": wins.get(t, 0)} for t in teams],
                               "winner": winner, "games": games_out})
        if not series_out:
            continue
        series_out.sort(key=lambda s: ("FDLW".index(s["round"]) if s["round"] in "FDLW" else 9, s["league"] or "Z", s["id"]))
        index["seasons"][str(y)] = {"series": series_out, "leaders": leaders(pas[pas["season"] == y], box, abbr)}

    BOX_CACHE.parent.mkdir(parents=True, exist_ok=True)
    BOX_CACHE.write_text(json.dumps(box, sort_keys=True))
    (out / "index.json").write_text(json.dumps({
        "_comment": ("postseason brackets from the Stats API; leaders over Statcast postseason pitches: WPA = batting-team "
                     "win-probability swing per PA (pitchers negated), RV = summed delta_run_exp (pitchers negated). "
                     "Descriptive: small samples, context not skill. lineups = each club's latest postseason starting lineup."),
        **index}, sort_keys=True, separators=(",", ":")))
    print(f"postseason: {len(index['seasons'])} seasons, {n_files} game files -> {out}")
    return n_files


def write_game(out: Path, gid: int, gm: dict, s: dict, ab, bx: dict, g: pd.DataFrame | None, lineups: dict) -> int:
    a_id, h_id = gm["teams"]["away"]["team"]["id"], gm["teams"]["home"]["team"]["id"]
    away, home = ab(a_id), ab(h_id)
    tm = {"away": away, "home": home}
    ev = {}
    pas_out, wpa = [], None
    if g is not None:
        for t in g.itertuples():
            pas_out.append({"i": int(t.inn), "h": "t" if t.tb == "Top" else "b", "o": int(t.outs),
                            "b": (0 if pd.isna(t.on_1b) else 1) + (0 if pd.isna(t.on_2b) else 2) + (0 if pd.isna(t.on_3b) else 4),
                            "s": [int(t.sc_h), int(t.sc_a)], "r": PA_EVENT_CODE.get(t.ev, "?") if t.ev else "?",
                            "p": [[e["t"], e["v"], e["c"]] for e in t.pitches], "bt": int(t.batter), "pt": int(t.pitcher)})
        e = g[g["n_ev"] > 0].assign(s=lambda d: d["ev_avg"] * d["n_ev"]).groupby("batter")[["s", "n_ev"]].sum()
        ev = {int(k): round(float(v.s / v.n_ev), 1) for k, v in e.iterrows()}
        w = g[g["dwe"].notna()].copy()
        if len(w):
            w["we1"] = w["we0"] + w["dwe"]
            names = {p["id"]: p["n"] for sd in bx.values() for p in sd["bats"] + sd["pitchers"]}
            mom = w.reindex(w["swing"].abs().sort_values(ascending=False).index).head(8)
            wpa = {"home": home, "away": away,
                   "timeline": [{"inning": int(k), "homeWe": r3(v)} for k, v in w.groupby("inn", sort=True)["we1"].last().items()],
                   "moments": [{"inning": int(m.inn), "half": m.tb, "batter": names.get(int(m.batter), str(int(m.batter))),
                                "batterId": str(int(m.batter)), "pitcher": names.get(int(m.pitcher), str(int(m.pitcher))),
                                "pitcherId": str(int(m.pitcher)), "des": m.des, "swing": r3(m.swing),
                                "weBefore": r3(m.we0 if m.tb == "Bot" else 1 - m.we0),
                                "weAfter": r3(m.we1 if m.tb == "Bot" else 1 - m.we1)}
                               for m in mom.itertuples() if abs(m.swing) >= 0.05]}
    p_rows = [{"id": str(p["id"]), "n": p["n"], "tm": tm[sd], "ip": round(p["outs"] / 3, 1), "h": p["h"], "r": p["r"],
               "bb": p["bb"], "k": p["k"], "hr": p["hr"], "bf": p["bf"], "pc": p["pc"]}
              for sd in ("away", "home") for p in bx[sd]["pitchers"]]
    b_rows = [{"id": str(b["id"]), "n": b["n"], "tm": tm[sd], "pa": b["pa"], "h": b["h"], "hr": b["hr"], "bb": b["bb"],
               "k": b["k"], "ev": ev.get(b["id"])} for sd in ("away", "home") for b in bx[sd]["bats"]]
    lu = {}
    for sd in ("away", "home"):
        lu[sd] = [{"id": str(b["id"]), "n": b["n"], "pos": b["pos"], "slot": b["bo"] // 100, "sub": b["bo"] % 100 != 0}
                  for b in bx[sd]["bats"]]
        sp = bx[sd]["pitchers"][0] if bx[sd]["pitchers"] else None
        lu[f"{sd}Sp"] = {"id": str(sp["id"]), "n": sp["n"]} if sp else None
        starters = [b["id"] for b in lu[sd] if not b["sub"]]
        prev = lineups.get(tm[sd])
        if starters and (prev is None or (gm["officialDate"], gid) >= (prev["date"], int(prev["gid"]))):
            lineups[tm[sd]] = {"gid": str(gid), "date": gm["officialDate"], "season": int(gm["season"]), "ids": starters}
    a, h = gm["teams"]["away"].get("score", 0), gm["teams"]["home"].get("score", 0)
    doc = {"g": gid, "d": gm["officialDate"], "home": home, "away": away, "final": [h, a],
           "p": p_rows, "b": b_rows, "pas": pas_out, "lineups": lu, "wpa": wpa, "postseason": True,
           "series": {"id": s["series"]["id"], "label": gm.get("seriesDescription"), "n": gm.get("seriesGameNumber"),
                      "season": int(gm["season"])}}
    (out / "games" / f"{gid}.json.gz").write_bytes(gzip.compress(json.dumps(doc, sort_keys=True, separators=(",", ":")).encode(), mtime=0))
    return 1


def leaders(p: pd.DataFrame, box: dict, abbr: dict) -> dict:
    """Postseason WPA and run value per batter and pitcher for one season."""
    names = {p0["id"]: p0["n"] for b in box.values() for sd in ("away", "home") for p0 in b[sd]["bats"] + b[sd]["pitchers"]}
    p = p.assign(bat_tm=p["away"].where(p["tb"] == "Top", p["home"]), fld_tm=p["home"].where(p["tb"] == "Top", p["away"]),
                 k=p["ev"].isin(["strikeout", "strikeout_double_play"]))
    out = {}
    for who, tm, sign, key in (("batter", "bat_tm", 1, "hitters"), ("pitcher", "fld_tm", -1, "pitchers")):
        a = p.groupby(who).agg(pa=("at_bat_number", "size"), wpa=("swing", "sum"), rv=("rv", "sum"), wv=("wv", "sum"),
                               wd=("wd", "sum"), k=("k", "sum"), g=("game_pk", "nunique"), tm=(tm, "last")).reset_index()
        top = set(a.sort_values("wpa", ascending=sign < 0).head(LEADERS)[who]) | set(a.sort_values("rv", ascending=sign < 0).head(LEADERS)[who])
        rows = [{"id": str(int(getattr(t, who))), "name": names.get(int(getattr(t, who)), str(int(getattr(t, who)))),
                 "team": t.tm, "g": int(t.g), "pa": int(t.pa), "wpa": r3(sign * t.wpa, 2), "rv": r3(sign * t.rv, 1),
                 "woba": r3(t.wv / t.wd) if t.wd else None, "k": int(t.k)}
                for t in a[a[who].isin(top)].itertuples()]
        out[key] = sorted(rows, key=lambda r: (-(r["wpa"] or 0), r["id"]))   # top 25 by WPA plus top 25 by run value
    return out


if __name__ == "__main__":
    bake()
