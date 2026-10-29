"""prospect_snapshots.py — §99 point-in-time feature store for the prospect model (phase 1).

    python pipeline/prospect_snapshots.py --fetch     # team->org/league/venue + MiLB fielding -> data/milb/*.parquet
    python pipeline/prospect_snapshots.py             # snapshots -> data/milb/prospect_snapshots.parquet + coverage json

Universe: every MiLB player (Rookie..AAA, 2010-19 + 2021-26), listed or not. One row per player x as-of date:
  * 'list' snapshots, one per Pipeline list year (as_of = LIST_DATES), every active undebuted player plus every listed one;
  * 'eos' snapshots, Oct 1 of each MiLB season, players with a line that season who are NOT on that year's list.
Every source table carries an availability date (`avail`); `features_asof` filters every table to avail <= as_of
before computing anything. test_prospect_snapshots.py checks that dropping all later rows changes nothing.
Public data only (MLB Stats API lines/transactions/draft, Pipeline lists, the Savant AAA mart via the baked AAA files).
B-Ref WAR is never read. Targets are built in `targets` and are never an input to `features_asof`.
"""
import argparse
import json
import re
import time
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

import prospect_model as pm  # v0: eb_features (level x season shrunk z-scores) is reused unchanged

ROOT = Path(__file__).resolve().parents[1]
MILB = ROOT / "data" / "milb"
WEB = ROOT / "data" / "export" / "web"
OUT = MILB / "prospect_snapshots.parquet"
COVER = ROOT / "pipeline" / "results" / "prospect_99_coverage.json"
DATA_END = 2026                       # last complete season in every store
LIST_YEARS = range(2011, 2027)
# Archived lists 2011-25 carry ~no same-season draftees -> preseason versions (publication ~mid Feb, approximate).
# The 2026 archive holds 130 2026 draftees -> it is the post-draft version; as-of after the season.
LIST_DATES = {y: pd.Timestamp(f"{y}-02-15") for y in range(2011, 2026)} | {2026: pd.Timestamp("2026-10-01")}
LVL = pm.LEVEL_ORD


def eos(season) -> pd.Series:
    return pd.to_datetime(pd.Series(season).astype(int).astype(str) + "-10-01")


# ------------------------------------------------------------------ fetch (light: ~120 Stats API calls)
def _get(url):
    for a in range(4):
        try:
            with urllib.request.urlopen(url, timeout=90) as r:
                return json.load(r)
        except Exception:
            if a == 3:
                raise
            time.sleep(5 * (a + 1))


def fetch():
    seasons = [s for s in range(2010, DATA_END + 1) if s != 2020]
    rows = []
    for s in seasons:
        for t in _get(f"https://statsapi.mlb.com/api/v1/teams?sportIds=11,12,13,14,15,16&season={s}")["teams"]:
            rows.append({"season": s, "team_id": t["id"], "org_id": t.get("parentOrgId"),
                         "league_id": t.get("league", {}).get("id"), "venue_id": t.get("venue", {}).get("id")})
        time.sleep(0.3)
    pd.DataFrame(rows).to_parquet(MILB / "team_orgs.parquet", compression="zstd")
    rows = []
    for s in seasons:
        for sid in (11, 12, 13, 14, 15, 16):
            sp = _get(f"https://statsapi.mlb.com/api/v1/stats?stats=season&group=fielding&season={s}"
                      f"&sportId={sid}&playerPool=ALL&gameType=R&limit=10000")["stats"][0]["splits"]
            assert len(sp) < 10000, "limit hit"
            for x in sp:
                st = x["stat"]
                rows.append({"mlbam_id": x["player"]["id"], "season": s, "sport_id": sid,
                             "team_id": x.get("team", {}).get("id"), "pos": x.get("position", {}).get("abbreviation"),
                             "G": int(st.get("gamesPlayed") or 0), "PO": int(st.get("putOuts") or 0),
                             "A": int(st.get("assists") or 0), "E": int(st.get("errors") or 0),
                             "inn": float(str(st.get("innings") or "0").replace(".1", ".333").replace(".2", ".667"))})
            print("fielding", s, sid, len(sp), flush=True)
            time.sleep(0.3)
    pd.DataFrame(rows).to_parquet(MILB / "fielding.parquet", compression="zstd")


# ------------------------------------------------------------------ source tables, each with `avail`
def load_tables() -> dict:
    T = {}
    for kind in ("hitters", "pitchers"):
        d = pd.concat([pd.read_parquet(MILB / f"hist_{kind}.parquet"), pd.read_parquet(MILB / f"{kind}.parquet")],
                      ignore_index=True)
        d = d[d.level.isin(LVL) & (d.league_name != "MEX")].copy()   # sportId 11 held the unaffiliated Mexican League to 2020
        d["avail"] = eos(d.season).values
        T[kind] = d
        m = pd.concat([pd.read_parquet(MILB / f"hist_mlb_{kind}.parquet"), pd.read_parquet(MILB / f"mlb_{kind}.parquet")])
        m = m.drop_duplicates(["mlbam_id", "season", "team_id"])
        m["avail"] = eos(m.season).values
        T[f"mlb_{kind}"] = m
    for name in ("team_orgs", "fielding"):
        p = MILB / f"{name}.parquet"
        T[name] = pd.read_parquet(p) if p.exists() else pd.DataFrame(columns=["season", "team_id"])
        T[name]["avail"] = (pd.to_datetime(T[name].season.astype(int).astype(str) + "-03-01") if name == "team_orgs"
                            else eos(T[name].season).values)
    # Pipeline lists -> long table
    lists, rows = json.loads((MILB / "prospects.json").read_text()), []
    for y in LIST_YEARS:
        for key, recs in lists[str(y)].items():
            for r in recs:
                g = {x["key"]: x["value"] for x in (r.get("gradesHitting") or []) + (r.get("gradesPitching") or []) if x.get("key")}
                rows.append({"id": r["id"], "year": y, "list": key, "rank": r["rank"], "n_list": len(recs),
                             "eta": pd.to_numeric(r.get("eta"), errors="coerce"),
                             **{f"g_{k.strip().lower()}": pd.to_numeric(v, errors="coerce") for k, v in g.items()}})
    L = pd.DataFrame(rows)
    L["avail"] = L.year.map(LIST_DATES)
    T["lists"] = L
    # draft (latest pick a player signed from; July 20 of the draft year)
    dr = [p for ps in json.loads((MILB / "draft.json").read_text()).values() for p in ps if p.get("id")]
    D = pd.DataFrame(dr)
    D["bonus"] = pd.to_numeric(D.get("bonus"), errors="coerce")
    D["round_n"] = pd.to_numeric(D["round"].astype(str).str.extract(r"(\d+)")[0], errors="coerce")
    D["avail"] = pd.to_datetime(D.year.astype(str) + "-07-20")
    T["draft"] = D
    tr = pd.read_parquet(MILB / "transactions.parquet")
    tr["avail"] = pd.to_datetime(tr.date)
    T["tx"] = tr[["id", "avail", "type", "desc"]]
    # AAA Statcast season aggregates (baked from the mart; 2023+)
    for kind, cols in (("hitters", ["ev90", "maxEv", "laSd", "oSwingPct", "contactPct", "whiffPct", "xwobacon",
                                    "barrelPct", "pa"]),
                       ("pitchers", ["stuffPlus", "kPlus", "preventionPlus", "whiffPct", "chasePct", "velo",
                                     "zContactPct", "nPitches"])):
        a = pd.DataFrame(json.loads((WEB / "aaa" / f"{kind}.json").read_text()))
        a = a[["id", "season"] + cols].copy()
        a["id"] = a.id.astype(int)
        a["avail"] = eos(a.season).values
        T[f"aaa_{kind}"] = a
    T["people"] = pd.read_parquet(MILB / "people.parquet")[["id", "birth", "debut"]]   # targets + birth only
    return T


def truncate(T: dict, as_of) -> dict:
    return {k: (v[v.avail <= as_of] if "avail" in v else v) for k, v in T.items()}


# ------------------------------------------------------------------ features at one as-of date
EB_CACHE: dict = {}


def _eb(lines, pitcher):
    # eb_features uses only each season's own lines (level x season means), so it is computed and cached per
    # season; the key holds the row count, so a truncated season would be recomputed, never reused.
    out = []
    for s, d in lines.groupby("season"):
        key = (pitcher, s, len(d))
        if key not in EB_CACHE:
            EB_CACHE[key] = pm.eb_features(d, pitcher)
        out.append(EB_CACHE[key])
    return pd.concat(out)


def features_asof(T: dict, as_of: pd.Timestamp, ids=None) -> pd.DataFrame:
    """Every feature for every player active at `as_of`, from rows with avail <= as_of only."""
    T = truncate(T, as_of)
    H, P = T["hitters"], T["pitchers"]
    last = int(max(H.season.max(), P.season.max()))
    # role: hitter or pitcher by career volume to date
    vol = pd.concat([H.groupby("mlbam_id").PA.sum().rename("pa"), P.groupby("mlbam_id").BF.sum().rename("bf")], axis=1)
    vol = vol.fillna(0)
    Lst = T["lists"]
    Lst = Lst[Lst.year == Lst.year.max()] if len(Lst) else Lst
    vol = vol.reindex(vol.index.union(pd.Index(Lst.id.unique() if len(Lst) else []))).fillna(0)
    f = pd.DataFrame(index=vol.index)
    f.index.name = "id"
    f["pitcher"] = vol.bf > vol.pa
    if len(Lst):   # listed players with no MiLB line yet: role from the list's position
        lp = Lst[Lst.list.str.startswith("position:")].drop_duplicates("id").set_index("id").list
        nol = (vol.pa + vol.bf == 0)
        f.loc[nol, "pitcher"] = lp.reindex(f.index[nol]).isin(["position:rhp", "position:lhp"]).values
    f["career_pa"], f["career_bf"] = vol.pa, vol.bf
    lines = pd.concat([H.assign(n=H.PA), P.assign(n=P.BF)])
    first = lines.groupby("mlbam_id").season.min()
    lastseen = lines.groupby("mlbam_id").season.max()
    f["first_season"], f["last_season"] = first, lastseen
    f["yrs_pro"] = last - first + 1 - ((first <= 2020) & (last >= 2020))       # 2020 had no MiLB season
    f["yrs_since_line"] = last - lastseen
    # --- level / age / env (most recent season of each player)
    birth = pd.to_datetime(lines.groupby("mlbam_id").birth_date.first(), errors="coerce")
    f["age"] = (as_of - birth).dt.days / 365.25
    lines["lvl"] = lines.level.map(LVL)
    lines["age_s"] = (pd.to_datetime(lines.season.astype(str) + "-07-01") -
                      pd.to_datetime(lines.birth_date, errors="coerce")).dt.days / 365.25
    g = [lines.season, lines.level]
    lines["lvl_age"] = (lines.age_s * lines.n).groupby(g).transform("sum") / lines.n.groupby(g).transform("sum")
    rec = lines[lines.season == lines.mlbam_id.map(lastseen)]
    top = rec.sort_values(["lvl", "n"]).groupby("mlbam_id").tail(1).set_index("mlbam_id")
    f["lvl"], f["league"], f["team_id"] = top.lvl, top.league_name, top.team_id
    f["age_rel"] = top.age_s - top.lvl_age
    f["n_last"] = rec.groupby("mlbam_id").n.sum()
    f["n_levels_last"] = rec.groupby("mlbam_id")["level"].nunique()
    # league run environment: runs per BF of the main league-season (pitcher lines carry R)
    eg = P.groupby(["season", "league_name"])[["R", "BF"]].sum()
    env = eg.R / eg.BF.clip(lower=1)
    f["lg_r_bf"] = [env.get((s, lg), np.nan) for s, lg in zip(f.last_season, f.league)]
    TO = T["team_orgs"].drop_duplicates(["season", "team_id"]).set_index(["season", "team_id"])
    key = list(zip(f.last_season, f.team_id))
    f["org_id"] = TO.org_id.reindex(key).values if len(TO) else np.nan
    f["venue_id"] = TO.venue_id.reindex(key).values if len(TO) else np.nan
    # --- promotion speed (season grain)
    mx = lines.groupby(["mlbam_id", "season"]).lvl.max().reset_index().sort_values(["mlbam_id", "season"])
    prev = mx.groupby("mlbam_id").lvl.shift(1)
    f["lvl_gain_1y"] = f.lvl - prev.groupby(mx.mlbam_id).last().reindex(f.index)
    f["lvl_per_yr"] = (f.lvl - mx.groupby("mlbam_id").lvl.first().reindex(f.index)) / f.yrs_pro.clip(lower=1)
    # --- rate stats: v0 shrunk z, most recent season and the 2-season PA-weighted blend
    for kind, pit in (("hitters", False), ("pitchers", True)):
        eb = _eb(T[kind], pit).reset_index()
        pre = "pz_" if pit else "hz_"
        zc = [c for c in eb.columns if c.startswith("z_")]
        eb = eb.sort_values("season")
        l1 = eb.groupby("mlbam_id").tail(1).set_index("mlbam_id")
        two = eb[eb.season >= eb.mlbam_id.map(eb.groupby("mlbam_id").season.max()) - 2]
        w = np.exp(two.logn) - 1
        bl = (two[zc].mul(w, axis=0).groupby(two.mlbam_id).sum()).div(w.groupby(two.mlbam_id).sum(), axis=0)
        for c in zc:
            f.loc[l1.index.intersection(f.index), f"{pre}{c[2:]}_l1"] = l1[c]
            f.loc[bl.index.intersection(f.index), f"{pre}{c[2:]}_2y"] = bl[c]
    hz = [c for c in f if c.startswith("hz_")]
    pz = [c for c in f if c.startswith("pz_")]
    f.loc[f.pitcher, hz] = np.nan          # a pitcher's few PA (NL-affiliate leagues) are not his skill
    f.loc[~f.pitcher, pz] = np.nan
    if "pz_k_2y" in f:
        f["pz_kbb_2y"] = f.pz_k_2y - f.pz_bb_2y
    ps = P.groupby("mlbam_id").agg(gs=("GS", "sum"), g=("G", "sum"), outs=("OUTS", "sum"))
    f["gs_share"] = (ps.gs / ps.g.replace(0, np.nan)).reindex(f.index)
    f["ip_career"] = (ps.outs / 3).reindex(f.index)
    # --- MLB exposure before as_of (rookie-eligible listed players)
    f["mlb_pa_prior"] = T["mlb_hitters"].groupby("mlbam_id").PA.sum().reindex(f.index).fillna(0)
    f["mlb_bf_prior"] = T["mlb_pitchers"].groupby("mlbam_id").BF.sum().reindex(f.index).fillna(0)
    # --- AAA Statcast (latest season <= as_of; null before 2023 = not available)
    for kind, pre in (("aaa_hitters", "sc_h_"), ("aaa_pitchers", "sc_p_")):
        a = T[kind].sort_values("season").groupby("id").tail(1).set_index("id")
        for c in a.columns.difference(["season", "avail"]):
            f[pre + c] = a[c].reindex(f.index)
        f[pre + "season"] = a.season.reindex(f.index)
    # --- draft
    D = T["draft"].sort_values("year").groupby("id").tail(1).set_index("id")
    f["drafted"] = f.index.isin(D.index)
    f["pick"], f["round"], f["bonus"] = D.pick.reindex(f.index), D.round_n.reindex(f.index), D.bonus.reindex(f.index)
    f["log_pick"] = np.log(f.pick)
    f["yrs_since_draft"] = as_of.year - D.year.reindex(f.index)
    f["draft_age"] = f.age - f.yrs_since_draft
    # --- Pipeline: the latest list published by as_of
    L = Lst
    if len(L):
        top100 = L[L.list == "top100"].set_index("id")
        org = L[L.list.str.startswith("team:")].drop_duplicates("id").set_index("id")
        pos = L[L.list.str.startswith("position:")].drop_duplicates("id").set_index("id")
        f["list_year"] = int(L.year.max())
        f["top_rank"] = top100["rank"].reindex(f.index)
        f["org_rank"] = org["rank"].reindex(f.index)
        f["org_frac"] = (org["rank"] / org.n_list).reindex(f.index)
        f["org_list_len"] = org.n_list.reindex(f.index)
        f["pos_rank"] = pos["rank"].reindex(f.index)
        f["list_state"] = np.select([f.top_rank.notna(), f.org_rank.notna()], ["top100", "org"], "unlisted")
        f["eta_gap"] = org.eta.reindex(f.index) - as_of.year
        for c in [c for c in org.columns if c.startswith("g_")]:
            f[c] = org[c].reindex(f.index)
    # --- position and defense (games at position, last season seen)
    F = T["fielding"]
    if len(F):
        F = F[F.season == F.mlbam_id.map(F.groupby("mlbam_id").season.max())]
        F = F[F.pos != "P"]
        pg = F.groupby(["mlbam_id", "pos"]).G.sum().reset_index().sort_values("G")
        f["pos_main"] = pg.groupby("mlbam_id").tail(1).set_index("mlbam_id").pos.reindex(f.index)
        tot = F.groupby("mlbam_id")[["PO", "A", "E", "G", "inn"]].sum()
        f["fld_rf9"] = ((tot.PO + tot.A) * 9 / tot.inn.replace(0, np.nan)).reindex(f.index)
        f["fld_err_rate"] = (tot.E / (tot.PO + tot.A + tot.E).replace(0, np.nan)).reindex(f.index)
        prem = pg[pg.pos.isin(["C", "SS", "CF"])].groupby("mlbam_id").G.sum() / pg.groupby("mlbam_id").G.sum()
        f["premium_pos_share"] = prem.reindex(f.index).fillna(0)
    # --- health from transactions (2019-04 onward only)
    tx = T["tx"]
    il = tx[tx.desc.str.contains(r"injured list|disabled list", case=False, na=False)
            & tx.desc.str.contains("placed", case=False, na=False)]
    f["il_n_365"] = il[il.avail > as_of - pd.Timedelta(days=365)].groupby("id").size().reindex(f.index).fillna(0)
    f["il_n_career"] = il.groupby("id").size().reindex(f.index).fillna(0)
    f["il_60day_365"] = il[(il.avail > as_of - pd.Timedelta(days=365)) &
                           il.desc.str.contains("60-day", na=False)].groupby("id").size().reindex(f.index).fillna(0)
    f["health_avail"] = as_of >= pd.Timestamp("2020-04-01")       # a full year of transactions behind as_of
    # --- §88 MLE components (AAA/AA, line seasons 2021+): K%, BB%, ISO for hitters
    mle = []
    for s in range(2021, last + 1):
        p = WEB / "translation" / f"hitters-{s}.json"
        if p.exists() and pd.Timestamp(f"{s}-10-01") <= as_of:
            m = pd.DataFrame(json.loads(p.read_text())["rows"])
            mle.append(m.assign(season=s))
    if mle:
        m = pd.concat(mle)
        m["id"] = m.id.astype(int)
        m = m.sort_values(["season", "level"]).groupby("id").tail(1).set_index("id")
        for c in ("kPct", "bbPct", "iso"):
            f[f"mle_{c}"] = m[c].reindex(f.index)
    # --- universe at this date: active (line in the last 2 played seasons) and not yet debuted, plus anyone listed
    debuted = pd.concat([T["mlb_hitters"], T["mlb_pitchers"]]).groupby("mlbam_id").season.min()
    f["debuted"] = f.index.isin(debuted.index)
    active = f.yrs_since_line <= (2 if last == 2021 else 1)
    keep = (active & ~f.debuted) | (f.get("list_state", "unlisted") != "unlisted")
    f = f[keep] if ids is None else f.reindex(ids)
    f.insert(0, "as_of", as_of)
    return f.reset_index()


# ------------------------------------------------------------------ targets (never an input to features)
def targets(S: pd.DataFrame, T: dict) -> pd.DataFrame:
    mh = T["mlb_hitters"].groupby(["mlbam_id", "season"]).PA.sum()
    mp = T["mlb_pitchers"].groupby(["mlbam_id", "season"]).BF.sum()
    debut = pd.concat([mh.reset_index(), mp.reset_index()]).groupby("mlbam_id").season.min()
    ppl = T["people"].dropna(subset=["debut"])   # catches pre-2011 debuts the 2011+ MLB lines miss
    pdeb = pd.Series(pd.to_datetime(ppl.debut).dt.year.values, index=ppl.id)
    debut = pd.concat([debut, pdeb]).groupby(level=0).min()
    lines = pd.concat([T["hitters"], T["pitchers"], T["mlb_hitters"], T["mlb_pitchers"]])
    lastany = lines.groupby("mlbam_id").season.max()
    war = {}
    for s, v in json.loads((WEB / "war_index.json").read_text())["seasons"].items():
        for grp in ("hitters", "pitchers"):
            for r in v.get(grp, []):
                war[(int(r["id"]), int(s))] = war.get((int(r["id"]), int(s)), 0) + (r.get("war") or 0)
    o = S[["id", "as_of", "pitcher"]].copy()
    y0 = o.as_of.dt.year + (o.as_of.dt.month >= 10)          # first season after the as-of date
    o["debut_season"] = o.id.map(debut)
    o["t_debut"] = o.debut_season - y0                       # seasons until debut (0 = the first season after as_of)
    ex = o.id.map(lastany)
    # exit (competing risk): no line anywhere in the two seasons after his last one, and those seasons are observed
    o["exit_season"] = np.where(o.debut_season.isna() & (ex <= DATA_END - 2), ex + 1, np.nan)
    o["event"] = np.select([o.debut_season.notna() & (o.debut_season >= y0), o.exit_season.notna()],
                           ["debut", "exit"], "censored")
    o.loc[o.debut_season < y0, "event"] = "debuted_before"
    o["followup_seasons"] = DATA_END - y0 + 1
    for k in (1, 2, 3, 4, 5, 6):
        o[f"debut_k{k}"] = np.where(o.event == "debuted_before", np.nan,
                                    np.where((o.t_debut < k) & (o.t_debut >= 0), 1.0,
                                             np.where(o.followup_seasons >= k, 0.0, np.nan)))  # NaN = censored
    # value through the first 6 control seasons (debut season .. +5)
    pa, bf = [], []
    for i, d, pit in zip(o.id, o.debut_season, o.pitcher):
        if pd.isna(d):
            pa.append(0.0)
            bf.append(0.0)
            continue
        ss = range(int(d), int(d) + 6)
        src = mp if pit else mh
        tot = sum(float(src.get((i, s), 0)) for s in ss)
        (bf if pit else pa).append(tot)
        (pa if pit else bf).append(np.nan)
    o["ctrl_pa"], o["ctrl_bf"] = pa, bf
    o["ctrl_war"] = [sum(war.get((i, s), 0.0) for s in range(int(d), int(d) + 6)) if pd.notna(d) else 0.0
                     for i, d in zip(o.id, o.debut_season)]
    o["ctrl_seasons_obs"] = np.where(o.debut_season.notna(), np.clip(DATA_END - o.debut_season + 1, 0, 6), np.nan)
    o["ctrl_war_seasons_obs"] = [sum(1 for s in range(int(d), int(d) + 6) if 2020 <= s <= DATA_END)
                                 if pd.notna(d) else np.nan for d in o.debut_season]
    o["value_censored"] = (o.ctrl_seasons_obs < 6) | (o.event == "censored")
    return o.drop(columns=["pitcher"])


# ------------------------------------------------------------------ build
def build(T=None) -> pd.DataFrame:
    T = T or load_tables()
    parts = []
    for y in LIST_YEARS:
        d = LIST_DATES[y]
        f = features_asof(T, d)
        f["snap"] = "list"
        parts.append(f)
        print("list", y, len(f), flush=True)
    listed = T["lists"].groupby("year").id.apply(set)
    for s in sorted(set(T["hitters"].season) | set(T["pitchers"].season)):
        if s == DATA_END or pd.Timestamp(f"{s}-10-01") == LIST_DATES.get(s):
            continue                                  # 2026 EOS coincides with the post-draft 2026 list snapshot
        f = features_asof(T, pd.Timestamp(f"{s}-10-01"))
        f = f[(f.last_season == s) & ~f.id.isin(listed.get(s, set())) & ~f.debuted]
        f["snap"] = "eos"
        parts.append(f)
        print("eos", s, len(f), flush=True)
    S = pd.concat(parts, ignore_index=True)
    S = S.merge(targets(S, T), on=["id", "as_of"], how="left")
    return S


def coverage(T) -> dict:
    out = {}
    for kind in ("hitters", "pitchers"):
        d = T[kind]
        out[kind] = d.groupby(["season", "level"]).mlbam_id.nunique().unstack().fillna(0).astype(int).to_dict("index")
    F = T["fielding"]
    out["fielding_players_by_season"] = F.groupby("season").mlbam_id.nunique().to_dict() if len(F) else {}
    out["team_org_rows_by_season"] = T["team_orgs"].groupby("season").size().to_dict()
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fetch", action="store_true")
    a = ap.parse_args()
    if a.fetch:
        return fetch()
    T = load_tables()
    S = build(T)
    S.to_parquet(OUT, compression="zstd", index=False)
    cov = coverage(T)
    cov["snapshots"] = S.groupby(["snap", S.as_of.dt.year]).size().rename("n").reset_index().to_dict("records")
    cov["list_state"] = S[S.snap == "list"].groupby([S.as_of.dt.year, "list_state"]).size().unstack().fillna(0) \
        .astype(int).to_dict("index")
    cov["non_null_share"] = S.notna().mean().round(3).to_dict()
    cov["event_by_snap_year"] = S.groupby([S.as_of.dt.year, "event"]).size().unstack().fillna(0).astype(int) \
        .to_dict("index")
    COVER.write_text(json.dumps(cov, indent=1, default=str))
    print(len(S), "rows,", S.id.nunique(), "players ->", OUT)


if __name__ == "__main__":
    main()
