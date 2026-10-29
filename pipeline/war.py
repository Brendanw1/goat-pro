"""RESULTS-MLB §85: the site's own WAR, 2020-26, FanGraphs/B-Ref accounting with our components in the slots.

    python pipeline/war.py           # build, read the §85 gates once -> results/war_85.json + data/export/web/war_index.json
    python pipeline/war.py --demo    # self-check of the accounting on a toy league, no data

Position players: (batting + baserunning + fielding + positional + league + replacement) / RPW.
  batting   = own linear weights (mean delta_run_exp per PA-ending event, per season) minus the league mean per PA,
              park-adjusted per PA by the venue's home/road runs factor (S-2..S, regressed 50%)
  BsR       = Savant baserunning run value (2021+; 2020 = 0)
  fielding  = our range runs (all positions but P) + our framing runs + Savant catcher throwing and blocking runs
  positional= FanGraphs per-162 values by share of team defensive PAs; DH by games batted without a field slot
  league    = per-PA constant so the four above sum to 0; replacement = 57% of 1,000 WAR x G/2,430, by PA
Pitchers: FIP-based like fWAR (park-adjusted FIPR9, pitcher-specific RPW, role replacement 0.03/0.12, reliever
  leverage (1+gmLI)/2), scaled to 43% of the total. B-Ref's public WAR files are the gate reference, never shown.
"""
import json
import sys
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

PIPE = Path(__file__).resolve().parent
ROOT = PIPE.parent
sys.path.insert(0, str(PIPE))
from paths import MART_DIR  # noqa: E402
sys.path.insert(0, str(MART_DIR))
import mart  # noqa: E402
from park_factors import venues  # noqa: E402

WEB = ROOT / "data" / "export" / "web"
BREF = ROOT / "data" / "milb" / "bref"
SEASONS = list(range(2020, 2027))
POS_162 = {2: 12.5, 3: -12.5, 4: 2.5, 5: 2.5, 6: 7.5, 7: -7.5, 8: 2.5, 9: -7.5}
DH_162 = -17.5
BAT_EVENTS = ("single", "double", "triple", "home_run", "walk", "intent_walk", "hit_by_pitch", "strikeout",
              "strikeout_double_play", "field_out", "force_out", "grounded_into_double_play", "double_play",
              "triple_play", "fielders_choice", "fielders_choice_out", "field_error", "sac_fly",
              "sac_fly_double_play", "sac_bunt", "sac_bunt_double_play", "catcher_interf")
TEAM_ID = {108: "LAA", 109: "AZ", 110: "BAL", 111: "BOS", 112: "CHC", 113: "CIN", 114: "CLE", 115: "COL", 116: "DET",
           117: "HOU", 118: "KC", 119: "LAD", 120: "WSH", 121: "NYM", 133: "ATH", 134: "PIT", 135: "SD", 136: "SEA",
           137: "SF", 138: "STL", 139: "TB", 140: "TEX", 141: "TOR", 142: "MIN", 143: "PHI", 144: "ATL", 145: "CWS",
           146: "MIA", 147: "NYY", 158: "MIL"}
BREF_TEAM = {"ANA": "LAA", "LAA": "LAA", "ARI": "AZ", "CHW": "CWS", "KCR": "KC", "SDP": "SD", "SFG": "SF", "TBR": "TB",
             "WSN": "WSH", "OAK": "ATH", "ATH": "ATH"}


def pa_table(con) -> pd.DataFrame:
    """One row per plate appearance (and per PA-ending non-batting event, flagged), with state and fielders."""
    ev = ",".join(f"'{e}'" for e in BAT_EVENTS)
    return con.sql(f"""
        WITH p AS (
          SELECT season, game_pk, at_bat_number, pitch_number, inning, inning_topbot, outs_when_up, batter, pitcher,
                 events, delta_run_exp, delta_home_win_exp, bat_score, post_bat_score, home_score, away_score,
                 on_1b, on_2b, on_3b, fielder_2, fielder_3, fielder_4, fielder_5, fielder_6, fielder_7, fielder_8, fielder_9,
                 CASE WHEN inning_topbot = 'Top' THEN away_team ELSE home_team END AS bat_team,
                 CASE WHEN inning_topbot = 'Top' THEN home_team ELSE away_team END AS fld_team
          FROM pitches_all WHERE game_type = 'R')
        SELECT season, game_pk, at_bat_number, inning, inning_topbot, batter, pitcher, bat_team, fld_team,
               arg_max(events, pitch_number) AS events,
               arg_max(delta_run_exp, pitch_number) AS rv_end,
               sum(post_bat_score - bat_score) AS runs,
               abs(sum(delta_home_win_exp)) AS dwe,
               arg_min(outs_when_up, pitch_number) AS outs,
               arg_min((on_1b IS NOT NULL)::INT + 2*(on_2b IS NOT NULL)::INT + 4*(on_3b IS NOT NULL)::INT, pitch_number) AS bases,
               arg_min(CASE WHEN inning_topbot = 'Top' THEN away_score - home_score ELSE home_score - away_score END, pitch_number) AS diff,
               arg_max(events, pitch_number) IN ({ev}) AS is_pa,
               {", ".join(f"arg_max(fielder_{k}, pitch_number) AS f{k}" for k in range(2, 10))}
        FROM p GROUP BY ALL""").df()


def outs_per_pa(pa: pd.DataFrame) -> pd.Series:
    """Outs recorded during each PA: the next PA's outs_when_up minus this one, or 3 minus it at a half's end."""
    pa = pa.sort_values(["game_pk", "at_bat_number"])
    half = [pa["game_pk"], pa["inning"], pa["inning_topbot"]]
    nxt = pa.groupby(half)["outs"].shift(-1)
    last = nxt.isna()
    o = (nxt - pa["outs"]).where(~last, 3 - pa["outs"])
    # a walk-off half ends short of 3 outs: the last PA of the bottom 9th+ won by the home side gets its own outs only
    walkoff = last & (pa["inning"] >= 9) & (pa["inning_topbot"] == "Bot") & (pa["runs"] > 0)
    return o.where(~walkoff, 0).clip(0, 3).reindex(pa.index)


def park_factors(pa: pd.DataFrame, vmap: pd.DataFrame) -> pd.DataFrame:
    """(season, venue_id) -> runs factor: home team's home R/G over its road R/G, seasons S-2..S, regressed 50%."""
    g = pa.merge(vmap[["game_pk", "venue_id"]], on="game_pk")
    home = g.assign(home=np.where(g["inning_topbot"] == "Top", g["fld_team"], g["bat_team"]))
    per_game = home.groupby(["season", "game_pk", "venue_id", "home"])["runs"].sum().reset_index()
    rows = []
    for s in SEASONS:
        w = per_game[per_game["season"].between(s - 2, s)]
        main = w.groupby(["home", "venue_id"]).size().reset_index(name="n").sort_values("n").groupby("home").tail(1)
        for t in main.itertuples():
            at_home = w[(w["home"] == t.home) & (w["venue_id"] == t.venue_id)]
            road_games = home[home["season"].between(s - 2, s) & (home["bat_team"] == t.home) & (home["fld_team"] == home["home"])]
            road = per_game[per_game["game_pk"].isin(road_games["game_pk"].unique())]
            if len(at_home) < 60 or len(road) < 60:
                continue
            raw = at_home["runs"].mean() / road["runs"].mean()
            rows.append({"season": s, "venue_id": t.venue_id, "pf": 1 + 0.5 * (raw - 1)})  # ponytail: fixed 50% regression, EB if it matters
    return pd.DataFrame(rows)


def leverage(pa: pd.DataFrame) -> pd.Series:
    """LI per PA: mean |dWE| in its (inning<=9, half, outs, bases, diff +-4) state over the overall mean, all seasons."""
    st = pd.DataFrame({"i": pa["inning"].clip(upper=9), "h": pa["inning_topbot"], "o": pa["outs"],
                       "b": pa["bases"], "d": pa["diff"].clip(-4, 4)})
    m = pa["dwe"].groupby([st[c] for c in st]).transform("mean")
    return m / pa["dwe"].mean()


def accounting(pos: pd.DataFrame, pit: pd.DataFrame, games: float, rpw: float) -> tuple[pd.DataFrame, pd.DataFrame]:
    """League + replacement for one season. pos needs pa, bat, bsr, fld, posn (runs); pit needs ip, waa_raw, rep_raw
    (wins). Returns both with `war` set so the totals are 1,000 x G/2,430 split 57/43."""
    total = 1000 * games / 2430
    pos = pos.copy()
    pos["lg"] = -(pos[["bat", "bsr", "fld", "posn"]].to_numpy().sum()) / pos["pa"].sum() * pos["pa"]
    pos["rep"] = 0.57 * total * rpw / pos["pa"].sum() * pos["pa"]
    pos["war"] = pos[["bat", "bsr", "fld", "posn", "lg", "rep"]].sum(axis=1) / rpw
    pit = pit.copy()
    raw = pit["waa_raw"] + pit["rep_raw"]
    pit["adj"] = (0.43 * total - raw.sum()) / pit["ip"].sum() * pit["ip"]  # season constant per IP
    pit["war"] = raw + pit["adj"]
    return pos, pit


def build():
    con = mart.connect()
    print("PA table ...", flush=True)
    pa = pa_table(con)
    pa["outs_made"] = outs_per_pa(pa)
    pa["li"] = leverage(pa)
    vmap = venues(SEASONS)
    pf = park_factors(pa, vmap)
    pa = pa.merge(vmap[["game_pk", "venue_id"]], on="game_pk", how="left").merge(pf, on=["season", "venue_id"], how="left")
    pa["pf"] = pa["pf"].fillna(1.0)

    # pitchers' own PAs (batted in a game they pitched, under 100 PA that season) leave the hitting pool
    pitched = pa[["season", "game_pk", "pitcher"]].drop_duplicates().rename(columns={"pitcher": "batter"})
    pitched["pitched"] = True
    bp = pa[pa["is_pa"]].merge(pitched, on=["season", "game_pk", "batter"], how="left")
    season_pa = bp.groupby(["season", "batter"])["is_pa"].transform("size")
    bp = bp[~(bp["pitched"].fillna(False) & (season_pa < 100))]

    lw = bp.groupby(["season", "events"])["rv_end"].mean().rename("lw")
    bp = bp.join(lw, on=["season", "events"])
    lg_lw = bp.groupby("season")["lw"].transform("mean")
    lg_rpa = pa.groupby("season")["runs"].sum() / pa[pa["is_pa"]].groupby("season").size()
    bp["bat"] = bp["lw"] - lg_lw
    bp["bat_park"] = bp["bat"] - (bp["pf"] - 1) * bp["season"].map(lg_rpa)

    lg = pd.DataFrame({"runs": pa.groupby("season")["runs"].sum(), "outs": pa.groupby("season")["outs_made"].sum(),
                       "games": pa.groupby("season")["game_pk"].nunique()})
    lg["ra9"] = 27 * lg["runs"] / lg["outs"]
    lg["rpw"] = 9 * (lg["runs"] / (lg["outs"] / 3)) * 1.5 + 3
    lg["team_pa"] = pa[pa["is_pa"]].groupby("season").size() / 30
    lg["team_games"] = 2 * lg["games"] / 30

    # positional: defensive PAs at each slot; DH = games batted with no field slot that game
    long = pa[pa["is_pa"]].melt(id_vars=["season", "game_pk"], value_vars=[f"f{k}" for k in range(2, 10)],
                                var_name="slot", value_name="id").dropna()
    long["slot"] = long["slot"].str[1:].astype(int)
    dpa = long.groupby(["season", "id", "slot"]).size().rename("n").reset_index()
    dpa["posn"] = dpa.apply(lambda r: POS_162[r.slot] * r.n / lg.at[r.season, "team_pa"] * lg.at[r.season, "team_games"] / 162, axis=1)
    fielded = long[["season", "game_pk", "id"]].drop_duplicates().assign(f=True)
    bg = bp[["season", "game_pk", "batter"]].drop_duplicates().rename(columns={"batter": "id"}).merge(
        fielded, on=["season", "game_pk", "id"], how="left")
    dh = bg[bg["f"].isna()].groupby(["season", "id"]).size().rename("dh_g").reset_index()
    dh["posn"] = DH_162 / 162 * dh["dh_g"]
    main_pos = dpa.sort_values("n").groupby(["season", "id"]).tail(1).set_index(["season", "id"])["slot"]

    hit = bp.groupby(["season", "batter"]).agg(pa=("is_pa", "size"), bat=("bat_park", "sum"), bat_raw=("bat", "sum"),
                                             team=("bat_team", lambda s: s.mode().iat[0])).reset_index().rename(columns={"batter": "id"})
    posn = pd.concat([dpa[["season", "id", "posn"]], dh[["season", "id", "posn"]]]).groupby(["season", "id"])["posn"].sum()
    hit = hit.join(posn, on=["season", "id"]).join(dh.set_index(["season", "id"])["dh_g"], on=["season", "id"])
    hit["posn"] = hit["posn"].fillna(0)

    def index(name, pick):
        doc = json.loads((WEB / name).read_text())
        return pd.DataFrame([{"season": int(s), "id": int(r["id"]), **pick(r)} for s, rows in doc["seasons"].items() for r in rows])
    rng = index("defense_index.json", lambda r: {"range": r.get("runs") or 0.0, "pos": r.get("pos")})
    rng = rng[rng["pos"] != "P"].groupby(["season", "id"])["range"].sum()
    frm = index("framing_plus.json", lambda r: {"framing": r.get("runs") or 0.0}).groupby(["season", "id"])["framing"].sum()
    hj = pd.DataFrame(json.loads((WEB / "hitters.json").read_text()))
    hj["id"] = hj["id"].astype(int)
    sav = hj.set_index(["season", "id"])[["bsrRuns", "throwingRuns", "blockingRuns"]].astype(float).fillna(0.0)
    hit = hit.join(rng, on=["season", "id"]).join(frm, on=["season", "id"]).join(sav, on=["season", "id"])
    hit[["range", "framing", "bsrRuns", "throwingRuns", "blockingRuns"]] = hit[["range", "framing", "bsrRuns", "throwingRuns", "blockingRuns"]].fillna(0.0)
    hit["bsr"] = hit["bsrRuns"]
    hit["fld"] = hit["range"] + hit["framing"] + hit["throwingRuns"] + hit["blockingRuns"]

    # pitchers
    pp = pa.copy()
    pp["k"] = pp["events"].isin(["strikeout", "strikeout_double_play"])
    pp["bb"] = pp["events"].eq("walk")
    pp["hbp"] = pp["events"].eq("hit_by_pitch")
    pp["hr"] = pp["events"].eq("home_run")
    first = pa.sort_values("at_bat_number").groupby(["game_pk", "fld_team"]).head(1)[["game_pk", "pitcher"]].assign(gs=1)
    app = pa.sort_values("at_bat_number").groupby(["season", "game_pk", "pitcher"]).head(1)[["season", "game_pk", "pitcher", "li"]]
    app = app.merge(first, on=["game_pk", "pitcher"], how="left").fillna({"gs": 0})
    pit = pp.groupby(["season", "pitcher"]).agg(outs=("outs_made", "sum"), k=("k", "sum"), bb=("bb", "sum"), hbp=("hbp", "sum"),
                                                hr=("hr", "sum"), bf=("is_pa", "sum"), pf=("pf", "mean"),
                                                team=("fld_team", lambda s: s.mode().iat[0])).reset_index()
    ga = app.groupby(["season", "pitcher"]).agg(g=("game_pk", "size"), gs=("gs", "sum"),
                                                gmli=("li", lambda s: s[app.loc[s.index, "gs"] == 0].mean())).reset_index()
    pit = pit.merge(ga, on=["season", "pitcher"]).rename(columns={"pitcher": "id"})
    pit = pit[pit["outs"] > 0].copy()
    pit["ip"] = pit["outs"] / 3
    pit["fip_raw"] = (13 * pit["hr"] + 3 * (pit["bb"] + pit["hbp"]) - 2 * pit["k"]) / pit["ip"]
    lgfip = pit.groupby("season").apply(lambda d: (13 * d["hr"].sum() + 3 * (d["bb"].sum() + d["hbp"].sum()) - 2 * d["k"].sum()) / d["ip"].sum())
    pit["fipr9"] = (pit["fip_raw"] + pit["season"].map(lg["ra9"] - lgfip)) / pit["pf"]
    pit["fip"] = pit["fip_raw"] + pit["season"].map(lg["ra9"] - lgfip)  # RA9-scaled FIP, unadjusted, for display
    ra9 = pit["season"].map(lg["ra9"])
    ipg = pit["ip"] / pit["g"]
    drpw = (((18 - ipg) * ra9 + ipg * pit["fipr9"]) / 18 + 2) * 1.5
    gs_share = pit["gs"] / pit["g"]
    lev = 1 + (1 - gs_share) * ((1 + pit["gmli"].fillna(1.0)) / 2 - 1)
    pit["waa_raw"] = (ra9 - pit["fipr9"]) / drpw * pit["ip"] / 9 * lev
    pit["rep_raw"] = (0.03 * (1 - gs_share) + 0.12 * gs_share) * pit["ip"] / 9 * lev

    outs_h, outs_p = [], []
    for s in SEASONS:
        h, p = accounting(hit[hit["season"] == s], pit[pit["season"] == s], lg.at[s, "games"], lg.at[s, "rpw"])
        outs_h.append(h)
        outs_p.append(p)
    hit, pit = pd.concat(outs_h), pd.concat(outs_p)
    hit["main_pos"] = [main_pos.get((s, i)) for s, i in zip(hit["season"], hit["id"])]
    return hit, pit, lg, pa


def bref():
    BREF.mkdir(parents=True, exist_ok=True)
    out = {}
    for kind in ("bat", "pitch"):
        f = BREF / f"war_daily_{kind}.txt"
        if not f.exists():
            req = urllib.request.Request(f"https://www.baseball-reference.com/data/war_daily_{kind}.txt", headers={"User-Agent": "Mozilla/5.0"})
            f.write_bytes(urllib.request.urlopen(req, timeout=120).read())
        d = pd.read_csv(f, low_memory=False)
        d = d[(d["year_ID"] >= 2020) & (d["lg_ID"].isin(["AL", "NL"]))]
        d["WAR"] = pd.to_numeric(d["WAR"], errors="coerce")
        out[kind] = d
    return out


def standings() -> pd.DataFrame:
    rows = []
    for s in SEASONS:
        url = f"https://statsapi.mlb.com/api/v1/standings?leagueId=103,104&season={s}"
        with urllib.request.urlopen(url, timeout=60) as r:
            for rec in json.load(r)["records"]:
                for t in rec["teamRecords"]:
                    rows.append({"season": s, "team": TEAM_ID.get(t["team"]["id"]), "w": t["wins"], "gp": t["wins"] + t["losses"]})
    return pd.DataFrame(rows)


def gates(hit, pit, lg, pa):
    out = {}
    tot = pd.concat([hit.groupby("season")["war"].sum().rename("pos"), pit.groupby("season")["war"].sum().rename("pit")], axis=1)
    tot["target"] = 1000 * lg["games"] / 2430
    out["G1"] = {str(s): {"pos": round(r.pos, 1), "pit": round(r.pit, 1), "target": round(r.target, 1)} for s, r in tot.iterrows()}
    g1 = bool((((tot["pos"] + tot["pit"]) / tot["target"] - 1).abs() <= 0.01).all())

    br = bref()
    bb = br["bat"][br["bat"]["pitcher"] == "N"].groupby(["year_ID", "mlb_ID"]).agg(
        bwar=("WAR", "sum"), runs_bat=("runs_bat", lambda s: pd.to_numeric(s, errors="coerce").sum()),
        runs_def=("runs_field", lambda s: pd.to_numeric(s, errors="coerce").sum()),
        runs_pos=("runs_position", lambda s: pd.to_numeric(s, errors="coerce").sum())).reset_index()
    h = hit.merge(bb, left_on=["season", "id"], right_on=["year_ID", "mlb_ID"])
    h = h[h["pa"] >= np.where(h["season"] == 2020, 100, 300)]
    r = lambda a, b: round(float(np.corrcoef(a, b)[0, 1]), 3)  # noqa: E731
    out["G2"] = {"n": len(h), "r": r(h["war"], h["bwar"]),
                 "by_season": {str(s): r(d["war"], d["bwar"]) for s, d in h.groupby("season")},
                 "batting_vs_runs_bat": r(h["bat"], h["runs_bat"]), "fld_pos_vs": r(h["fld"] + h["posn"], h["runs_def"] + h["runs_pos"])}
    bpit = br["pitch"].groupby(["year_ID", "mlb_ID"]).agg(bwar=("WAR", "sum"), ipouts=("IPouts", "sum")).reset_index()
    p = pit.merge(bpit, left_on=["season", "id"], right_on=["year_ID", "mlb_ID"])
    p = p[p["ip"] >= np.where(p["season"] == 2020, 20, 50)]
    out["G3"] = {"n": len(p), "r": r(p["war"], p["bwar"]), "by_season": {str(s): r(d["war"], d["bwar"]) for s, d in p.groupby("season")}}

    # G4: team WAR by PA / BF share, + replacement wins, vs actual wins (2021-25)
    pa_t = pa[pa["is_pa"]]
    hs = pa_t.groupby(["season", "batter", "bat_team"]).size().rename("n").reset_index()
    hs["share"] = hs["n"] / hs.groupby(["season", "batter"])["n"].transform("sum")
    ps = pa_t.groupby(["season", "pitcher", "fld_team"]).size().rename("n").reset_index()
    ps["share"] = ps["n"] / ps.groupby(["season", "pitcher"])["n"].transform("sum")
    th = hs.merge(hit[["season", "id", "war"]], left_on=["season", "batter"], right_on=["season", "id"]).assign(w=lambda d: d["war"] * d["share"]).groupby(["season", "bat_team"])["w"].sum()
    tp = ps.merge(pit[["season", "id", "war"]], left_on=["season", "pitcher"], right_on=["season", "id"]).assign(w=lambda d: d["war"] * d["share"]).groupby(["season", "fld_team"])["w"].sum()
    st = standings()
    st["ours"] = [th.get((s, t), 0) + tp.get((s, t), 0) + 0.294 * gp for s, t, gp in zip(st["season"], st["team"], st["gp"])]
    bt = pd.concat([br["bat"][br["bat"]["pitcher"] == "N"][["year_ID", "team_ID", "WAR"]], br["pitch"][["year_ID", "team_ID", "WAR"]]])
    bt["team"] = bt["team_ID"].map(lambda t: BREF_TEAM.get(t, t))
    bsum = bt.groupby(["year_ID", "team"])["WAR"].sum()
    st["bref"] = [bsum.get((s, t), np.nan) + 0.294 * gp for s, t, gp in zip(st["season"], st["team"], st["gp"])]
    w = st[st["season"].between(2021, 2025)].dropna()
    out["G4"] = {"n": len(w), "r": r(w["ours"], w["w"]), "control_bref_r": r(w["bref"], w["w"])}

    # reported: year-to-year rates beside bWAR's; leaders
    def yty(d, rate_col, vol, floor):
        d = d[d[vol] >= floor].assign(rate=lambda x: x[rate_col] / x[vol])
        m = d[["season", "id", "rate"]].merge(d[["season", "id", "rate"]].assign(season=lambda x: x["season"] - 1), on=["season", "id"])
        return r(m["rate_x"], m["rate_y"]) if len(m) > 10 else None
    hh = h.assign(bw=h["bwar"])
    out["yty"] = {"hitters_ours": yty(hh, "war", "pa", 300), "hitters_bref": yty(hh, "bw", "pa", 300),
                  "pitchers_ours": yty(p, "war", "ip", 50), "pitchers_bref": yty(p.assign(bw=p["bwar"]), "bw", "ip", 50)}
    out["leaders"] = {str(s): {"hitters": d.nlargest(5, "war")[["id", "war"]].round(1).values.tolist()} for s, d in hit.groupby("season")}
    out["leaders_pit"] = {str(s): d.nlargest(5, "war")[["id", "war"]].round(1).values.tolist() for s, d in pit.groupby("season")}
    out["verdict"] = {"G1": g1, "G2": out["G2"]["r"] >= .85, "G3": out["G3"]["r"] >= .75, "G4": out["G4"]["r"] >= .80}
    return out


def demo():
    pos = pd.DataFrame({"pa": [600, 400, 200], "bat": [30.0, -5.0, -10.0], "bsr": [2.0, 0, -1], "fld": [5.0, -3, 0], "posn": [7.5, -12.5, 2.5]})
    pit = pd.DataFrame({"ip": [180.0, 60.0], "waa_raw": [3.0, 0.5], "rep_raw": [2.4, 0.2]})
    h, p = accounting(pos, pit, 2430, 10.0)
    assert abs(h[["bat", "bsr", "fld", "posn", "lg"]].to_numpy().sum()) < 1e-9
    assert abs(h["war"].sum() - 570) < 1e-6 and abs(p["war"].sum() - 430) < 1e-6
    assert h["war"].iat[0] > h["war"].iat[1]
    pa = pd.DataFrame({"game_pk": [1] * 4, "at_bat_number": [1, 2, 3, 4], "inning": [1] * 4, "inning_topbot": ["Top"] * 4,
                       "outs": [0, 0, 1, 2], "runs": [0, 0, 0, 0]})
    assert outs_per_pa(pa).tolist() == [0, 1, 1, 1]
    print("demo ok")


def main():
    hit, pit, lg, pa = build()
    res = gates(hit, pit, lg, pa)
    (PIPE / "results").mkdir(exist_ok=True)
    (PIPE / "results" / "war_85.json").write_text(json.dumps(res, indent=1, default=float))
    print(json.dumps({k: res[k] for k in ("verdict", "G2", "G3", "G4", "yty")}, indent=1, default=float))
    print("G1", res["G1"])
    keep_h = ["id", "team", "pa", "war", "bat", "bsr", "fld", "range", "framing", "throwingRuns", "blockingRuns", "posn", "lg", "rep", "main_pos", "dh_g"]
    keep_p = ["id", "team", "ip", "g", "gs", "war", "fip", "gmli", "pf"]
    doc = {"method": "RESULTS-MLB §85", "seasons": {}}
    for s in SEASONS:
        hs = hit[hit["season"] == s][keep_h].round(2)
        ps_ = pit[pit["season"] == s][keep_p].round(2)
        doc["seasons"][str(s)] = {"rpw": round(float(lg.at[s, "rpw"]), 2),
                                  "hitters": json.loads(hs.assign(id=hs["id"].astype(int).astype(str)).to_json(orient="records")),
                                  "pitchers": json.loads(ps_.assign(id=ps_["id"].astype(int).astype(str)).to_json(orient="records"))}
    (WEB / "war_index.json").write_text(json.dumps(doc, separators=(",", ":")))


if __name__ == "__main__":
    demo() if "--demo" in sys.argv else main()
