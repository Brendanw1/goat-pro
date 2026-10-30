"""hoops_export.py — bake the basketball Phase-1 surfaces from the hoops mart.

    python pipeline/hoops_export.py             # full bake -> data/export/web/hoops/
    python pipeline/hoops_export.py --check     # verify a re-bake is a no-op, write nothing

Descriptive Phase 1 (docs/basketball-site-plan.md): box scores, game lists,
the x/y shot chart, the play feed — every number is a raw mart value or a
plain average/per-36. No model outputs; those arrive with pre-registered
phases. The mart is validated against LUMA (hoops_mart luma_check.py, gate
passed 2026-10-29) and meta.json carries that credit.

Files (hoops/… on R2; the baseball keys never collide):
  hoops/meta.json                    seasons, counts, validation + LUMA credit
  hoops/games_{season}.json          every game of a season (landing + finders)
  hoops/game/{gid}.json.gz           the game report: header, boxes, shots, plays
  hoops/teams.json                   team-season aggregates (the teams board)
  hoops/team/{abbr}.json.gz          one club: season aggregates + game list
  hoops/players.json                 player-season board rows (leaderboard)
  hoops/player/{id}.json.gz          one player: season lines + game log
"""

import argparse
import gzip
import json
import os
import sys
import tempfile
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "export" / "web"
MART = Path(os.environ.get("HOOPS_MART",
                           Path.home() / "Projects" / "vt_baseball" / "hoops_mart" / "data" / "mart"))

TYPE_LABEL = {1: "preseason", 2: "regular", 3: "postseason"}
# ESPN abbreviations -> franchise names (static; the mart carries ids/abbrs
# only). ESPN spells them GS/NO/NY/SA/UTAH/WSH — not LUMA's GSW/NOP/….
NBA_TEAMS = {
    "ATL": "Hawks", "BOS": "Celtics", "BKN": "Nets", "CHA": "Hornets", "CHI": "Bulls",
    "CLE": "Cavaliers", "DAL": "Mavericks", "DEN": "Nuggets", "DET": "Pistons",
    "GS": "Warriors", "HOU": "Rockets", "IND": "Pacers", "LAC": "Clippers",
    "LAL": "Lakers", "MEM": "Grizzlies", "MIA": "Heat", "MIL": "Bucks",
    "MIN": "Timberwolves", "NO": "Pelicans", "NY": "Knicks", "OKC": "Thunder",
    "ORL": "Magic", "PHI": "76ers", "PHX": "Suns", "POR": "Trail Blazers",
    "SAC": "Kings", "SA": "Spurs", "TOR": "Raptors", "UTAH": "Jazz", "WSH": "Wizards",
}


def clean(obj):
    """NaN floats (parquet Nones round-tripped) -> None; allow_nan=False stays honest."""
    if isinstance(obj, float):
        return None if obj != obj else obj
    if isinstance(obj, dict):
        return {k: clean(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [clean(v) for v in obj]
    return obj


def jwrite(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(clean(obj), allow_nan=False, sort_keys=True))


def jwrite_gz(path: Path, obj) -> None:
    """mtime=0 keeps the archive byte-identical across bakes (the --check no-op)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    data = json.dumps(clean(obj), allow_nan=False, sort_keys=True).encode()
    path.write_bytes(gzip.compress(data, mtime=0))


def iv(x):
    """NaN/pd.NA-safe int (parquet round-trips None as NaN in object columns)."""
    try:
        if x is None or pd.isna(x):
            return None
    except (TypeError, ValueError):
        pass
    return int(x)


def fv(x):
    try:
        if x is None or pd.isna(x):
            return None
    except (TypeError, ValueError):
        pass
    return round(float(x), 1)


def season_label(y: int) -> str:
    return f"{y - 1}-{str(y)[2:]}"


def per36(total, minutes) -> float | None:
    return round(36.0 * total / minutes, 1) if minutes and minutes > 0 else None


def sv(x):
    """NaN-safe str for labels like abbreviations (some preseason foes lack one)."""
    try:
        if x is None or pd.isna(x):
            return None
    except (TypeError, ValueError):
        pass
    return str(x)


def game_row(r, gid=None) -> dict:
    n_per = iv(r.n_periods)
    return {"id": str(gid if gid is not None else r.game_id), "date": r.date_et, "season": int(r.season_year),
            "type": TYPE_LABEL.get(int(r.season_type), str(r.season_type)),
            "away": sv(r.away_abbr), "home": sv(r.home_abbr),
            "away_score": iv(r.away_score), "home_score": iv(r.home_score),
            "ot": (n_per - 4) if n_per and n_per > 4 else None}


def load():
    g = pd.read_parquet(MART / "games.parquet")
    tg = pd.read_parquet(MART / "team_game.parquet")
    pg = pd.read_parquet(MART / "player_game.parquet")
    pb = pd.read_parquet(MART / "pbp.parquet")
    sh = pd.read_parquet(MART / "shots.parquet")
    g = g[g.completed].copy()
    id2abbr = {}
    for c_id, c_ab in (("home_team_id", "home_abbr"), ("away_team_id", "away_abbr")):
        for a, b in zip(g[c_id], g[c_ab]):
            if pd.notna(a) and pd.notna(b):
                id2abbr[str(int(a))] = b
    gg = g.set_index("game_id")
    tgx = tg.join(gg[["season_year"]], on="game_id")
    pgx = pg.join(gg[["season_year"]], on="game_id")
    return g, gg, tg, tgx, pg, pgx, pb, sh, id2abbr


def bake(out_dir: Path | None = None) -> dict:
    out = out_dir or OUT
    g, gg, tg, tgx, pg, pgx, pb, sh, id2abbr = load()
    counts = {}

    # meta --------------------------------------------------------------------
    luma = {}
    luma_f = MART.parent / "luma_check.json"
    if luma_f.exists():
        lc = json.loads(luma_f.read_text())
        a, b, c = lc.get("A_backfill_2024_25", {}), lc.get("B_current_2026_27", {}), lc.get("C_stat_agreement", {})
        luma = {"gate": "passed 2026-10-29",
                "games_2024_25": f"{a.get('score_exact')}/{a.get('scored_both')} exact",
                "games_2026_27": f"{b.get('score_exact')}/{b.get('scored_both')} exact",
                "boxes": lc.get("C_boxes_compared"),
                "credit": "LUMA Basketball Research (ARC v3.1, LOKI v3.3)"}
        ast = c.get("ast", {})
        luma["boxes_ast_note"] = f"assists exact_rate {ast.get('exact_rate')} (scorer judgment)"
    jwrite(out / "hoops" / "meta.json", {
        "seasons": {int(s): {"games": int(len(ss)), "first": str(ss.date_et.min()),
                             "last": str(ss.date_et.max())}
                    for s, ss in g.groupby("season_year")},
        "validation": luma,
        "note": "descriptive Phase 1: raw box values, averages and per-36 only",
    })

    # games_{season}.json -------------------------------------------------------
    for season, ss in g.groupby("season_year"):
        rows = [game_row(r) for r in ss.sort_values("date_et", ascending=False).itertuples()]
        jwrite(out / "hoops" / f"games_{season}.json", {"season": int(season),
                                                        "label": season_label(int(season)),
                                                        "games": rows})
        counts[f"games_{season}"] = len(rows)

    # teams.json + team/{abbr}.json.gz ------------------------------------------
    season_rows = {}
    team_seasons = {}
    for (season, team_id), rows in tgx.groupby(["season_year", "team_id"]):
        abbr = id2abbr.get(str(int(team_id)))
        if not abbr or abbr not in NBA_TEAMS:  # 30 franchises only (exhibitions out)
            continue
        tid = str(int(team_id))
        reg_gids = [gid for gid in rows.game_id if gg.loc[gid].season_type == 2]
        w = l = 0
        pts_all, opp_all = [], []
        games_list = []
        for gid in sorted(reg_gids, key=lambda k: gg.loc[k].date_et, reverse=True):
            gr = gg.loc[gid]
            home = str(int(gr.home_team_id)) == tid
            pts = int(gr.home_score) if home else int(gr.away_score)
            ops = int(gr.away_score) if home else int(gr.home_score)
            w += pts > ops
            l += pts < ops
            pts_all.append(pts)
            opp_all.append(ops)
            games_list.append({"id": str(gid), "date": gr.date_et, "type": "regular",
                               "opp": sv(gr.away_abbr if home else gr.home_abbr), "home": home,
                               "pts": pts, "opp_pts": ops,
                               "res": "W" if pts > ops else ("L" if pts < ops else "T")})
        reg = rows[rows.game_id.isin(reg_gids)]
        agg = {"abbr": abbr, "name": NBA_TEAMS.get(abbr, abbr), "g": len(reg_gids), "w": w, "l": l,
               "pts": round(sum(pts_all) / max(len(pts_all), 1), 1),
               "opp_pts": round(sum(opp_all) / max(len(opp_all), 1), 1),
               "fgm": fv(reg["fieldGoalsMade-fieldGoalsAttempted_made"].mean()),
               "fga": fv(reg["fieldGoalsMade-fieldGoalsAttempted_att"].mean()),
               "tpm": fv(reg["threePointFieldGoalsMade-threePointFieldGoalsAttempted_made"].mean()),
               "tpa": fv(reg["threePointFieldGoalsMade-threePointFieldGoalsAttempted_att"].mean()),
               "ftm": fv(reg["freeThrowsMade-freeThrowsAttempted_made"].mean()),
               "fta": fv(reg["freeThrowsMade-freeThrowsAttempted_att"].mean()),
               "reb": fv(reg["totalRebounds"].mean()), "ast": fv(reg["assists"].mean()),
               "tov": fv(reg["totalTurnovers"].mean()), "stl": fv(reg["steals"].mean()),
               "blk": fv(reg["blocks"].mean()),
               "paint": fv(reg["pointsInPaint"].mean()) if "pointsInPaint" in reg else None,
               "fastbreak": fv(reg["fastBreakPoints"].mean()) if "fastBreakPoints" in reg else None}
        season_rows.setdefault(int(season), []).append(agg)
        team_seasons.setdefault(abbr, {})[int(season)] = {**agg, "games": games_list}
    for s in season_rows:
        season_rows[s].sort(key=lambda r: -(r["w"] + r["l"]))
    jwrite(out / "hoops" / "teams.json", {"seasons": season_rows})
    for abbr, seasons in team_seasons.items():
        jwrite_gz(out / "hoops" / "team" / f"{abbr.lower()}.json.gz", {"seasons": seasons})
    counts["teams"] = len(team_seasons)

    # players.json board ----------------------------------------------------------
    board = {}
    pgx_played = pgx[pgx.pts.notna()]
    for (season, ath), rows in pgx_played.groupby(["season_year", "athlete_id"]):
        team = rows.team_id.mode()
        abbr = id2abbr.get(str(int(team.iloc[0]))) if len(team) else None
        gp = len(rows)
        mins = float(rows["min"].sum())
        pos = rows.position.mode()
        row = {"id": str(ath), "name": rows.name.iloc[0],
               "pos": pos.iloc[0] if len(pos) else None,
               "team": abbr, "gp": gp, "gs": int(rows.starter.sum()), "min": fv(mins / gp),
               "pts": fv(rows.pts.mean()), "reb": fv(rows.reb.mean()), "ast": fv(rows.ast.mean()),
               "stl": fv(rows.stl.mean()), "blk": fv(rows.blk.mean()), "tov": fv(rows["to"].mean()),
               "pts36": per36(rows.pts.sum(), mins), "reb36": per36(rows.reb.sum(), mins),
               "ast36": per36(rows.ast.sum(), mins)}
        board.setdefault(int(season), []).append(row)
    for s in board:
        board[s].sort(key=lambda r: -r["pts"])
    jwrite(out / "hoops" / "players.json", {"seasons": board})
    counts["players"] = sum(len(v) for v in board.values())

    # player/{id}.json.gz ------------------------------------------------------------
    for ath, rows in pgx_played.groupby("athlete_id"):
        seasons = {}
        for season, srows in rows.groupby("season_year"):
            games = []
            for r in srows.itertuples():
                gr = gg.loc[r.game_id]
                home = str(int(gr.home_team_id)) == str(int(r.team_id))
                pts = int(gr.home_score) if home else int(gr.away_score)
                ops = int(gr.away_score) if home else int(gr.home_score)
                games.append({"id": str(r.game_id), "date": gr.date_et,
                              "opp": sv(gr.away_abbr if home else gr.home_abbr), "home": home,
                              "res": "W" if pts > ops else "L", "min": fv(r.min), "pts": iv(r.pts),
                              "reb": iv(r.reb), "ast": iv(r.ast), "stl": iv(r.stl), "blk": iv(r.blk),
                              "tov": iv(r.to), "pf": iv(r.pf), "pm": iv(r.plus_minus),
                              "fg": f"{iv(r.fgm)}-{iv(r.fga)}", "tp": f"{iv(r.tpm)}-{iv(r.tpa)}",
                              "ft": f"{iv(r.ftm)}-{iv(r.fta)}"})
            mins = float(srows["min"].sum())
            team = srows.team_id.mode()
            seasons[int(season)] = {
                "team": id2abbr.get(str(int(team.iloc[0]))) if len(team) else None,
                "gp": len(srows), "gs": int(srows.starter.sum()),
                "totals": {"min": round(mins, 1), "pts": int(srows.pts.sum()),
                           "reb": int(srows.reb.sum()), "ast": int(srows.ast.sum()),
                           "stl": int(srows.stl.sum()), "blk": int(srows.blk.sum()),
                           "tov": int(srows["to"].sum())},
                "per_game": {"min": fv(mins / len(srows)), "pts": fv(srows.pts.mean()),
                             "reb": fv(srows.reb.mean()), "ast": fv(srows.ast.mean()),
                             "stl": fv(srows.stl.mean()), "blk": fv(srows.blk.mean()),
                             "tov": fv(srows["to"].mean())},
                "per36": {"pts": per36(srows.pts.sum(), mins), "reb": per36(srows.reb.sum(), mins),
                          "ast": per36(srows.ast.sum(), mins)},
                "games": games}
        name = rows.name.dropna().iloc[-1]
        jwrite_gz(out / "hoops" / "player" / f"{ath}.json.gz",
                  {"id": str(ath), "name": name, "seasons": seasons})
    counts["player_files"] = pgx_played.athlete_id.nunique()

    # game/{gid}.json.gz -----------------------------------------------------------------
    pg_by = {k: v for k, v in pgx.groupby("game_id")}
    sh_by = {k: v for k, v in sh.groupby("game_id")}
    tg_by = {k: v for k, v in tg.groupby("game_id")}
    n_games = 0
    for gid, gss in pb.groupby("game_id"):
        gr = gg.loc[gid]
        boxes = {}
        for team_id, prow in pg_by.get(gid, pd.DataFrame()).groupby("team_id"):
            abbr = id2abbr.get(str(int(team_id))) or f"t{int(team_id)}"
            rows = []
            for r in prow.sort_values(["starter", "pts"], ascending=[False, False],
                                      na_position="last").itertuples():
                rows.append({"name": r.name, "pos": sv(r.position), "starter": bool(r.starter),
                             "dnp": bool(r.did_not_play), "min": fv(r.min), "pts": iv(r.pts),
                             "reb": iv(r.reb), "ast": iv(r.ast), "stl": iv(r.stl), "blk": iv(r.blk),
                             "tov": iv(r.to), "pf": iv(r.pf), "pm": iv(r.plus_minus),
                             "fg": None if iv(r.fga) is None else f"{iv(r.fgm)}-{iv(r.fga)}",
                             "tp": None if iv(r.tpa) is None else f"{iv(r.tpm)}-{iv(r.tpa)}",
                             "ft": None if iv(r.fta) is None else f"{iv(r.ftm)}-{iv(r.fta)}"})
            boxes[abbr] = rows
        shooter = {str(r.athlete_id): r.name
                   for r in pg_by.get(gid, pd.DataFrame()).itertuples() if pd.notna(r.name)}
        shots = [{"p": iv(r.period), "t": fv(r.period_elapsed), "x": fv(r.x), "y": fv(r.y),
                  "m": bool(r.made), "v": iv(r.points_made) or 0, "pa": iv(r.points_attempted),
                  "a": id2abbr.get(str(int(r.team_id))) if pd.notna(r.team_id) else None,
                  "s": shooter.get(str(r.shooter_id)),
                  "ty": r.shot_type}
                 for r in sh_by.get(gid, pd.DataFrame()).itertuples()]
        plays = [{"p": iv(r.period), "t": fv(r.period_elapsed), "ty": r.type_text, "tx": r.text,
                  "a": id2abbr.get(str(int(r.team_id))) if pd.notna(r.team_id) else None,
                  "hs": iv(r.home_score), "as": iv(r.away_score)}
                 for r in gss.sort_values("seq").itertuples()]
        teams_out = []
        for r in tg_by.get(gid, pd.DataFrame()).itertuples():
            teams_out.append({"abbr": id2abbr.get(str(int(r.team_id))), "side": r.home_away,
                              "points": iv(r.points),
                              "paint": iv(getattr(r, "pointsInPaint", None)),
                              "fastbreak": iv(getattr(r, "fastBreakPoints", None)),
                              "reb": iv(getattr(r, "totalRebounds", None)),
                              "ast": iv(getattr(r, "assists", None)),
                              "tov": iv(getattr(r, "totalTurnovers", None))})
        jwrite_gz(out / "hoops" / "game" / f"{gid}.json.gz", {
            "game": game_row(gr, gid), "teams": teams_out, "boxes": boxes,
            "shots": shots, "plays": plays})
        n_games += 1
    counts["game_files"] = n_games
    return counts


def check() -> int:
    """Rebuild every payload in a temp dir; report keys whose bytes would change."""
    before = {}
    if (OUT / "hoops").exists():
        for p in (OUT / "hoops").rglob("*"):
            if p.is_file():
                before[str(p.relative_to(OUT))] = p.read_bytes()
    with tempfile.TemporaryDirectory() as td:
        bake(Path(td))
        after = {str(p.relative_to(Path(td))): p.read_bytes()
                 for p in Path(td).rglob("*") if p.is_file()}
    drift = sorted(k for k in set(before) | set(after) if before.get(k) != after.get(k))
    print(f"hoops bake check: {len(after)} files, {len(drift)} would change")
    for k in drift[:20]:
        print("  ", k)
    return 1 if drift else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="verify a re-bake is a no-op")
    a = ap.parse_args()
    if a.check:
        sys.exit(check())
    print(bake())
