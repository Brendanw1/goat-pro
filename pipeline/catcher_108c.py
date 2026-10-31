"""§108c (RESULTS-MLB, pre-registered 671ea06 before any fit or read): catcher judging upgrades + sealed reads.

    python pipeline/catcher_108c.py --loso     # 2020-26 only: floor re-report, joint model, deterrence, throwing runs
    python pipeline/catcher_108c.py --freeze   # fit the frozen v2 on all 2020-26, write its hash + the 2027 forecast
    python pipeline/catcher_108c.py --hpre     # the ONE sealed read of 2016-19 (refuses if SEAL.json says opened)
    python pipeline/catcher_108c.py --demo     # self-checks of the RE walk and the opportunity labelling

catcher_models.py is frozen (f9aa4d0 / blob e4043b6) and only imported. The joint model runs in ~/.venvs/goat-bayes
through catcher_joint.py (subprocess). Results sealed to results/catcher_108c_*_SEALED.json; each mode runs once.
"""
import hashlib
import json
import subprocess
import sys
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
from lightgbm import Booster, LGBMClassifier
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import log_loss
from sklearn.model_selection import GroupKFold

PIPE = Path(__file__).resolve().parent
sys.path.insert(0, str(PIPE))
from catcher_models import (CACHE, FEATS_V2, PARAMS_V2, RES, decile_gap, lead_other,  # noqa: E402
                            shrunk_rate)
from paths import MART_DIR  # noqa: E402

LO, HI = .005, .995
SEALED_DIR = CACHE / "sealed"
FROZEN = CACHE / "v2_frozen"
VENV = Path.home() / ".venvs" / "goat-bayes" / "bin" / "python"
TRAIN = range(2020, 2027)
K_SHRINK_2027 = 60


def floor(p):
    return np.clip(np.asarray(p, dtype=float), LO, HI)


def logit(p):
    p = floor(p)
    return np.log(p / (1 - p))


def sig(x):
    return 1 / (1 + np.exp(-x))


def connect():
    sys.path.insert(0, str(MART_DIR))
    import mart
    con = mart.connect()
    con.execute("SET threads TO 4")
    return con


# ---------------------------------------------------------------- attempts (the v2 population)
def boards(dirs):
    b = pd.concat([pd.read_parquet(p) for d in dirs for p in sorted(d.glob("pitcher_running_*.parquet"))],
                  ignore_index=True)
    b = b[b["r_sec_minus_prim_lead"].notna() & (b["n_init"] > 0)].assign(
        n=lambda d: d["n_init"].astype(float), nx=lambda d: d["n_init"] * d["r_sec_minus_prim_lead"].astype(float))
    b["pitcher_id"], b["season"] = b["pitcher_id"].astype(int), b["season"].astype(int)
    return b


def attempts(d: Path, seasons) -> pd.DataFrame:
    """v2 population exactly as catcher_models.xcs_v2: pitchouts out, 2B/3B, dedup, prior_pk by (play_id, runner_id)."""
    th = pd.concat([pd.read_parquet(d / f"throwing_{s}.parquet") for s in seasons], ignore_index=True)
    th = th[(th["is_pitchout"] != 1) & th["target_base"].isin(["2B", "3B"])].drop_duplicates(
        ["game_pk", "at_bat_number", "play_init_seq", "runner_id"]).rename(columns={"catcher_id": "catcher", "year": "season"})
    pk = pd.concat([pd.read_parquet(d / f"pickoffs_{s}.parquet") for s in seasons]).drop_duplicates(["play_id", "runner_id"])
    th = th.merge(pk[["play_id", "runner_id", "prior_pk"]], on=["play_id", "runner_id"], how="left").reset_index(drop=True)
    th["pitcher_id"], th["season"] = th["pitcher_id"].astype(int), th["season"].astype(int)
    th["base3"] = (th["target_base"] == "3B").astype(int)
    th["lhp"] = (th["pitch_hand"] == "L").astype(int)
    return th


def v2_loso() -> pd.DataFrame:
    """The §108a-v2 LOSO predictions joined back to their labels, floored."""
    th = attempts(CACHE, TRAIN)
    pr = pd.read_parquet(CACHE / "xcs_v2_pred.parquet")
    k = ["game_pk", "at_bat_number", "play_init_seq", "runner_id"]
    m = th.merge(pr[k + ["p"]], on=k, how="inner", validate="1:1")
    assert len(m) == len(th) == len(pr), (len(m), len(th), len(pr))
    m["p_raw"], m["p"] = m["p"], floor(m["p"])
    return m


# ---------------------------------------------------------------- (1) joint model
def run_joint(df: pd.DataFrame, tag: str) -> tuple[pd.DataFrame, dict]:
    """df: y, off, catcher, pitcher_id, runner_id, fit -> posterior-mean effects per fit (NumPyro in goat-bayes)."""
    inp, out = CACHE / f"joint_in_{tag}.parquet", CACHE / f"joint_eff_{tag}.parquet"
    df[["y", "off", "catcher", "pitcher_id", "runner_id", "fit"]].to_parquet(inp)
    subprocess.run(["nice", "-n", "10", str(VENV), str(PIPE / "catcher_joint.py"), str(inp), str(out)], check=True)
    return pd.read_parquet(out), json.loads(Path(str(out) + ".json").read_text())


def add_effects(df, eff, fit_col="fit"):
    """Attach u (catcher), v (pitcher), w (runner) posterior means for each row's fit; unseen entities get 0."""
    out = df.copy()
    for kind, col in (("catcher", "u"), ("pitcher_id", "v"), ("runner_id", "w")):
        e = eff[eff["kind"] == kind][["fit", "id", "eff"]].rename(columns={"id": kind, "eff": col, "fit": fit_col})
        e[kind] = e[kind].astype(int)
        out = out.merge(e, on=[fit_col, kind], how="left")
        out[col] = out[col].fillna(0.0)
    return out


def credits(df):
    """Per-attempt credit (CS added) for catcher and pitcher from one fit's effects, holding the other effects."""
    base_c = df["off"] + df["v"] + df["w"]
    base_p = df["off"] + df["u"] + df["w"]
    return df.assign(cc=sig(base_c + df["u"]) - sig(base_c), pc=sig(base_p + df["v"]) - sig(base_p))


def yty(per, col, key, min_n):
    q = per[per["n"] >= min_n]
    pp = q.merge(q.assign(season=q["season"] - 1), on=[key, "season"], suffixes=("", "_n"))
    return pp, (float(pp[col].corr(pp[col + "_n"])) if len(pp) > 2 else float("nan"))


def joint_gates(df):
    """df: per-season fit effects attached (fit = season), y, p (v2, floored). J1 and J2 on the same pairs."""
    df = credits(df)
    df["v2c"] = df["y"] - df["p"]
    cpc = df.groupby(["catcher", "season"]).agg(n=("y", "size"), joint=("cc", "mean"), v2=("v2c", "mean")).reset_index()
    pairs, j1 = yty(cpc, "joint", "catcher", 30)
    v2r = float(pairs["v2"].corr(pairs["v2_n"]))
    ppc = df.groupby(["pitcher_id", "season"]).agg(n=("y", "size"), pcred=("pc", "mean")).reset_index()
    ppairs, j2 = yty(ppc, "pcred", "pitcher_id", 15)
    return {"j1_pairs": int(len(pairs)), "j1_joint_yty": round(j1, 3), "j1_v2_yty_same_pairs": round(v2r, 3),
            "j1_bar": round(v2r + .05, 3), "j1_pass": bool(j1 >= v2r + .05),
            "j2_pairs": int(len(ppairs)), "j2_pitcher_yty": round(j2, 3), "j2_pass": bool(j2 >= .30)}, cpc


def joint_loso(att):
    att = att.assign(y=att["is_runner_cs"].astype(int), off=logit(att["p"]))
    # per-season fits (YTY) + one pooled fit per left-out season (out-of-fold) + the pooled 2020-26 fit (for H-pre)
    per = att.assign(fit=att["season"])
    loso = pd.concat([att[att["season"] != t].assign(fit=10000 + t) for t in TRAIN])
    allfit = att.assign(fit=99999)
    eff, diag = run_joint(pd.concat([per, loso, allfit], ignore_index=True), "loso")
    g, cpc = joint_gates(add_effects(per, eff))
    te = add_effects(att.assign(fit=10000 + att["season"]), eff)
    te["pj"] = floor(sig(te["off"] + te["u"] + te["v"] + te["w"]))
    ll_j, ll_v = float(log_loss(te["y"], te["pj"])), float(log_loss(te["y"], te["p"]))
    g.update({"j3_loso_logloss_joint": round(ll_j, 5), "j3_loso_logloss_v2_floored": round(ll_v, 5),
              "j3_pass": bool(ll_j <= ll_v)})
    rh = max(d["rhat_effect_max"] for d in diag.values())
    g["rhat_max_effect"], g["rhat_max_sigma"] = rh, max(d["rhat_sigma_max"] for d in diag.values())
    g["convergence_pass"] = bool(rh <= 1.01 and g["rhat_max_sigma"] <= 1.01)
    g["sigma_per_season"] = {k: v["sigma"] for k, v in diag.items() if int(k) < 10000}
    g["verdict_loso"] = "PASS" if all(g[f"j{i}_pass"] for i in (1, 2, 3)) and g["convergence_pass"] else "FAIL"
    eff[eff["fit"] == 99999].to_parquet(CACHE / "joint_eff_all2020_26.parquet")
    return g, te


# ---------------------------------------------------------------- RE24 + throwing runs
def re_tables(con, seasons):
    import baserunning_runs as br
    out = {}
    for s in seasons:
        br.SEASONS = [s]
        out[s] = br.re_table(con)
    return out


def re_of(t, b1, b2, b3, outs):
    return 0.0 if outs >= 3 else t[(b1, b2, b3, outs)]


def swing(t, b1, b2, b3, outs, frm):
    """RE(after SB) - RE(after CS) for the runner on base `frm` (1 or 2) going one base."""
    bases = [b1, b2, b3]
    sb = bases.copy(); sb[frm - 1] = 0; sb[frm] = 1  # noqa: E702
    cs = bases.copy(); cs[frm - 1] = 0  # noqa: E702
    before = re_of(t, b1, b2, b3, outs)
    return re_of(t, *sb, outs) - before, re_of(t, *cs, outs + 1) - before


def attempt_states(con, att):
    """Base-out state at the attempt: the mart pitch at (game_pk, at_bat_number) with the latest pitch_number <= play_init_seq."""
    con.register("att_k", att[["game_pk", "at_bat_number", "play_init_seq"]].drop_duplicates())
    st = con.sql("""SELECT a.game_pk, a.at_bat_number, a.play_init_seq,
            arg_max(CASE WHEN p.on_1b IS NULL THEN 0 ELSE 1 END, p.pitch_number) b1,
            arg_max(CASE WHEN p.on_2b IS NULL THEN 0 ELSE 1 END, p.pitch_number) b2,
            arg_max(CASE WHEN p.on_3b IS NULL THEN 0 ELSE 1 END, p.pitch_number) b3,
            arg_max(p.outs_when_up, p.pitch_number) outs
        FROM att_k a JOIN pitches_all p ON p.game_pk = a.game_pk AND p.at_bat_number = a.at_bat_number
            AND p.pitch_number <= a.play_init_seq AND p.game_type = 'R'
        GROUP BY 1, 2, 3""").df()
    return att.merge(st, on=["game_pk", "at_bat_number", "play_init_seq"], how="left")


def add_swing(att, tables):
    """d_sb, d_cs per attempt; unmatched (or inconsistent: runner's base empty) -> season x base league mean."""
    att = att.copy()
    att["d_sb"], att["d_cs"] = np.nan, np.nan
    for i, r in att.iterrows():
        if pd.isna(r["outs"]):
            continue
        frm = 2 if r["base3"] else 1
        b = [int(r["b1"]), int(r["b2"]), int(r["b3"])]
        if not b[frm - 1] or int(r["outs"]) > 2:
            continue
        att.at[i, "d_sb"], att.at[i, "d_cs"] = swing(tables[r["season"]], *b, int(r["outs"]), frm)
    matched = att["d_sb"].notna()
    for c in ("d_sb", "d_cs"):
        att[c] = att[c].fillna(att.groupby(["season", "base3"])[c].transform("mean"))
    return att, float(matched.mean())


# ---------------------------------------------------------------- (2) deterrence
FEATS_D = ["sprint", "lead2", "b1", "b2", "b3", "outs", "inning", "score_diff", "lhp", "lead_gain", "season", "log_exp"]


def lead_map(pitcher, season, t, board):
    """lead_other evaluated once per distinct (pitcher, season), then mapped back (same numbers, far fewer calls)."""
    u = pd.DataFrame({"p": pitcher, "s": season}).drop_duplicates()
    u["v"] = lead_other(u["p"].to_numpy(), u["s"].to_numpy(), t, board)
    return pd.DataFrame({"p": pitcher, "s": season}).merge(u, on=["p", "s"], how="left")["v"].to_numpy()


def fit_cal_f(tr, label, feats):
    """catcher_models.fit_cal with a feature list: PARAMS_V2 LightGBM + isotonic on inner catcher-grouped OOF."""
    oof = np.zeros(len(tr))
    for a, b in GroupKFold(n_splits=5).split(tr, tr[label], groups=tr["catcher"]):
        m = LGBMClassifier(**PARAMS_V2).fit(tr.iloc[a][feats], tr.iloc[a][label])
        oof[b] = m.predict_proba(tr.iloc[b][feats])[:, 1]
    iso = IsotonicRegression(y_min=0, y_max=1, out_of_bounds="clip").fit(oof, tr[label])
    m = LGBMClassifier(**PARAMS_V2).fit(tr[feats], tr[label])
    return lambda X: floor(iso.predict(m.predict_proba(X[feats])[:, 1]))


def opportunities(con):
    """PA x lead runner (the pre-registered fallback unit: pitch-level attempt mapping was 88.3% < 95%).
    Lead runner = on 2B with 3B open, else on 1B with 2B open, at the PA's first pitch; catcher = fielder_2 then.
    Exposure = pitches in the PA with that runner still on that base. Only catcher-seasons whose throwing rows were
    fetched (done.json), so an attempt can never be missing for want of a fetch."""
    done = json.loads((CACHE / "done.json").read_text())
    fetched = pd.DataFrame([(int(k.split(":")[1]), int(k.split(":")[2])) for k in done if k.startswith("throwing:")],
                           columns=["season", "catcher"])
    con.register("fetched", fetched)
    op = con.sql("""WITH pa AS (  -- the PA's first pitch (row_number, not arg_min: arg_min skips NULL bases)
        SELECT game_pk, at_bat_number, season, on_1b r1, on_2b r2, on_3b r3, outs_when_up outs, inning,
            bat_score - fld_score score_diff, p_throws, pitcher pitcher_id, fielder_2 catcher
        FROM pitches_all WHERE game_type = 'R' AND season BETWEEN 2020 AND 2026
        QUALIFY row_number() OVER (PARTITION BY game_pk, at_bat_number ORDER BY pitch_number) = 1)
      SELECT pa.*, CASE WHEN r2 IS NOT NULL AND r3 IS NULL THEN r2 ELSE r1 END runner_id,
             CASE WHEN r2 IS NOT NULL AND r3 IS NULL THEN 1 ELSE 0 END lead2
      FROM pa JOIN fetched f ON f.season = pa.season AND f.catcher = pa.catcher
      WHERE (r2 IS NOT NULL AND r3 IS NULL) OR (r1 IS NOT NULL AND r2 IS NULL)""").df()
    con.register("op_k", op[["game_pk", "at_bat_number", "runner_id", "lead2"]])
    ex = con.sql("""SELECT o.game_pk, o.at_bat_number, count(*) exposure FROM op_k o JOIN pitches_all p
        ON p.game_pk = o.game_pk AND p.at_bat_number = o.at_bat_number AND p.game_type = 'R'
        AND ((o.lead2 = 1 AND p.on_2b = o.runner_id) OR (o.lead2 = 0 AND p.on_1b = o.runner_id)) GROUP BY 1, 2""").df()
    op = op.merge(ex, on=["game_pk", "at_bat_number"], how="left")
    op["exposure"] = op["exposure"].fillna(1).clip(lower=1)
    for c in ("r1", "r2", "r3"):
        op["b" + c[1]] = op[c].notna().astype(int)
    op["lhp"] = (op["p_throws"] == "L").astype(int)
    op["log_exp"] = np.log(op["exposure"])
    for c in ("catcher", "pitcher_id", "runner_id", "season"):
        op[c] = op[c].astype(int)
    sp = pd.concat([con.sql(f"SELECT player_id runner_id, sprint_speed sprint FROM lb_sprint_speed_{s}").df()
                    .assign(season=s) for s in TRAIN])
    sp["runner_id"] = sp["runner_id"].astype(int)
    op = op.merge(sp.drop_duplicates(["runner_id", "season"]), on=["runner_id", "season"], how="left")
    return op


def label_attempts(op, th_all):
    """y = 1 if the lead runner has any SB-attempt row (any target, pitchouts included) in that PA."""
    a = th_all[["game_pk", "at_bat_number", "runner_id"]].drop_duplicates().assign(y=1)
    out = op.merge(a, on=["game_pk", "at_bat_number", "runner_id"], how="left")
    out["y"] = out["y"].fillna(0).astype(int)
    return out


def deterrence(con, board, v2att, tables):
    th_all = pd.concat([pd.read_parquet(CACHE / f"throwing_{s}.parquet") for s in TRAIN], ignore_index=True)
    op = label_attempts(opportunities(con), th_all)
    covered = th_all.drop_duplicates(["game_pk", "at_bat_number", "runner_id"]).merge(
        op[["game_pk", "at_bat_number", "runner_id"]], how="inner").shape[0] / th_all.drop_duplicates(
        ["game_pk", "at_bat_number", "runner_id"]).shape[0]
    parts = []
    for t in TRAIN:
        te = op[op["season"] == t].copy()
        trall = op[op["season"] != t].copy()
        trall["lead_gain"] = lead_map(trall["pitcher_id"].to_numpy(), trall["season"].to_numpy(), t, board)
        te["lead_gain"] = lead_map(te["pitcher_id"].to_numpy(), te["season"].to_numpy(), t, board)
        te["p"] = np.nan
        for _, b in GroupKFold(n_splits=5).split(te, te["y"], groups=te["catcher"]):
            idx = te.index[b]
            tr = trall[~trall["catcher"].isin(te.loc[idx, "catcher"].unique())].reset_index(drop=True)
            te.loc[idx, "p"] = fit_cal_f(tr, "y", FEATS_D)(te.loc[idx])
        near = op[op["season"] == (t - 1 if t > 2020 else 2021)]
        lg = near.groupby(["b1", "b2", "b3"])["y"].mean()
        te["p_league"] = floor([lg.get(k, near["y"].mean()) for k in zip(te["b1"], te["b2"], te["b3"])])
        parts.append(te)
        print(f"deterrence fold {t}: {len(te)} opportunities", flush=True)
    pr = pd.concat(parts, ignore_index=True)
    ll_m, ll_l = float(log_loss(pr["y"], pr["p"])), float(log_loss(pr["y"], pr["p_league"]))
    cs = pr.groupby(["catcher", "season"]).agg(n=("y", "size"), pitches=("exposure", "sum"), act=("y", "sum"),
                                               exp=("p", "sum")).reset_index()
    cs["det"] = cs["exp"] - cs["act"]
    cs["rate"] = cs["det"] / cs["n"]
    big = cs[cs["pitches"] >= 2000]
    pairs = big.merge(big.assign(season=big["season"] - 1), on=["catcher", "season"], suffixes=("", "_n"))
    d1 = float(pairs["rate"].corr(pairs["rate_n"]))
    pop = v2att.groupby(["catcher", "season"])["pop_time"].mean().rename("pop").reset_index()
    q = big.merge(pop, on=["catcher", "season"])
    d2 = float(q["rate"].corr(q["pop"]))
    # league run value of one attempt to the offence, per season: realized mix of SB and CS swings
    va = v2att.assign(v=np.where(v2att["is_runner_cs"] == 1, v2att["d_cs"], v2att["d_sb"])).groupby("season")["v"].mean()
    cs["det_runs"] = cs["det"] * cs["season"].map(va)
    out = {"unit": "PA x lead runner (pitch-level attempt mapping 88.3% < 95%)", "n_opportunities": int(len(pr)),
           "attempt_coverage_by_opportunities": round(covered, 4), "attempt_rate": round(float(pr["y"].mean()), 4),
           "share_at_floor": round(float((pr["p"] <= LO).mean()), 4),
           "d3_logloss_model": round(ll_m, 5), "d3_logloss_league": round(ll_l, 5), "d3_pass": bool(ll_m < ll_l),
           "d1_pairs": int(len(pairs)), "d1_yty": round(d1, 3), "d1_pass": bool(d1 >= .30),
           "d2_n": int(len(q)), "d2_pop_r": round(d2, 3), "d2_pass": bool(d2 < 0),
           "run_value_per_attempt_by_season": {int(k): round(float(v), 4) for k, v in va.items()},
           "catcher_seasons_2000_pitches": int(len(big))}
    out["verdict_loso"] = "PASS" if out["d1_pass"] and out["d2_pass"] and out["d3_pass"] else "FAIL"
    return out, cs


def throwing_runs(con, att, det_cs):
    att = att.assign(csaa_runs=(att["is_runner_cs"] - att["p"]) * (att["d_sb"] - att["d_cs"]))
    ours = att.groupby(["catcher", "season"]).agg(n=("p", "size"), csaa_runs=("csaa_runs", "sum")).reset_index()
    ours = ours.merge(det_cs[["catcher", "season", "det_runs"]], on=["catcher", "season"], how="left")
    ours["det_runs"] = ours["det_runs"].fillna(0.0)
    ours["throw_runs"] = ours["csaa_runs"] + ours["det_runs"]
    sav = pd.concat([con.sql(f"SELECT player_id catcher, catcher_stealing_runs sav FROM lb_catcher_throwing_{s}").df()
                     .assign(season=s) for s in TRAIN])
    j = ours[ours["n"] >= 30].merge(sav, on=["catcher", "season"])
    r1, r_cs = float(j["throw_runs"].corr(j["sav"])), float(j["csaa_runs"].corr(j["sav"]))
    return {"n_catcher_seasons": int(len(j)), "r1_throw_runs_vs_savant": round(r1, 3),
            "csaa_runs_alone_vs_savant": round(r_cs, 3), "r1_pass": bool(r1 >= .70),
            "sd_csaa_runs": round(float(j["csaa_runs"].std()), 2), "sd_det_runs": round(float(j["det_runs"].std()), 2),
            "verdict_loso": "PASS" if r1 >= .70 else "FAIL"}, ours


def loso():
    sealed = RES / "catcher_108c_loso_SEALED.json"
    if sealed.exists():
        raise SystemExit(f"{sealed} exists: §108c LOSO is read once")
    con = connect()
    att = v2_loso()
    y = att["is_runner_cs"].to_numpy()
    floor_note = {"n_at_floor_or_ceiling": int(((att["p_raw"] < LO) | (att["p_raw"] > HI)).sum()),
                  "loso_logloss_unfloored": round(float(log_loss(y, att["p_raw"])), 5),
                  "loso_logloss_floored": round(float(log_loss(y, att["p"])), 5),
                  "decile_gap_floored": round(decile_gap(y, att["p"].to_numpy()), 4)}
    print("floor", floor_note, flush=True)
    jg, _ = joint_loso(att)
    print("joint", json.dumps(jg), flush=True)
    tables = re_tables(con, TRAIN)
    att = attempt_states(con, att)
    att, re_match = add_swing(att, tables)
    board = boards([CACHE])
    dg, det_cs = deterrence(con, board, att, tables)
    print("deterrence", json.dumps(dg), flush=True)
    rg, ours = throwing_runs(con, att, det_cs)
    rg["attempt_state_match"] = round(re_match, 4)
    rg["re_source"] = "baserunning_runs.re_table per season 2020-26 (site RE24, mart, regular season)"
    print("runs", json.dumps(rg), flush=True)
    ours.to_parquet(CACHE / "throwing_runs_108c.parquet")
    det_cs.to_parquet(CACHE / "deterrence_108c.parquet")
    res = {"prereg": "RESULTS-MLB §108c (671ea06, before any fit or read)", "date": str(date.today()),
           "floor": floor_note, "joint": jg, "deterrence": dg, "runs": rg}
    sealed.write_text(json.dumps(res, indent=1))


# ---------------------------------------------------------------- frozen v2 + 2027 forecast
def freeze():
    if (FROZEN / "model.txt").exists():
        raise SystemExit("v2 already frozen")
    FROZEN.mkdir(parents=True, exist_ok=True)
    th = attempts(CACHE, TRAIN)
    board = boards([CACHE])
    th["lead_gain"] = lead_other(th["pitcher_id"].to_numpy(), th["season"].to_numpy(), -1, board)
    oof = np.zeros(len(th))
    for a, b in GroupKFold(n_splits=5).split(th, th["is_runner_cs"], groups=th["catcher"]):
        m = LGBMClassifier(**PARAMS_V2).fit(th.iloc[a][FEATS_V2], th.iloc[a]["is_runner_cs"])
        oof[b] = m.predict_proba(th.iloc[b][FEATS_V2])[:, 1]
    iso = IsotonicRegression(y_min=0, y_max=1, out_of_bounds="clip").fit(oof, th["is_runner_cs"])
    m = LGBMClassifier(**PARAMS_V2).fit(th[FEATS_V2], th["is_runner_cs"])
    (FROZEN / "model.txt").write_text(m.booster_.model_to_string())
    (FROZEN / "isotonic.json").write_text(json.dumps({"x": iso.X_thresholds_.tolist(), "y": iso.y_thresholds_.tolist()}))
    h = frozen_hash()
    att = v2_loso()
    rec = att[att["season"].isin([2025, 2026])].assign(c=lambda d: d["is_runner_cs"] - d["p"])
    f = rec.groupby("catcher").agg(n=("c", "size"), raw=("c", "mean")).reset_index()
    f = f[f["n"] >= 30]
    f["pred_2027"] = f["raw"] * f["n"] / (f["n"] + K_SHRINK_2027)
    (RES / "catcher_2027_forecast.json").write_text(json.dumps({
        "prereg": "RESULTS-MLB §108c H-2027", "made": str(date.today()), "model_sha256": h, "k": K_SHRINK_2027,
        "rows": [{"catcher": int(r.catcher), "n_2025_26": int(r.n), "pred_cs_above_xcs_per_attempt": round(r.pred_2027, 4)}
                 for r in f.itertuples()]}, indent=1))
    (RES / "catcher_v2_frozen.json").write_text(json.dumps({
        "sha256": h, "n_train": int(len(th)), "features": FEATS_V2, "floor": [LO, HI], "date": str(date.today()),
        "lead_gain_train": "pitcher board 2020-26 seasons other than his own, k = 300"}, indent=1))
    print("frozen", h, "forecast catchers", len(f))


def frozen_hash():
    return hashlib.sha256((FROZEN / "model.txt").read_bytes() + (FROZEN / "isotonic.json").read_bytes()).hexdigest()


def frozen_predict(X):
    b = Booster(model_file=str(FROZEN / "model.txt"))
    iso = json.loads((FROZEN / "isotonic.json").read_text())
    return floor(np.interp(b.predict(X[FEATS_V2]), iso["x"], iso["y"]))


# ---------------------------------------------------------------- the one sealed read
def hpre():
    seal_p = SEALED_DIR / "SEAL.json"
    seal = json.loads(seal_p.read_text())
    if seal["status"] != "not opened":
        raise SystemExit("SEAL.json says opened: H-pre is read once")
    want = json.loads((RES / "catcher_v2_frozen.json").read_text())["sha256"]
    assert frozen_hash() == want, "frozen v2 hash mismatch"
    import pyarrow.parquet as pq  # noqa: F401
    for name, meta in seal["files"].items():
        assert hashlib.sha256((SEALED_DIR / name).read_bytes()).hexdigest() == meta["sha256"], name
    commit = subprocess.run(["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True,
                            cwd=PIPE.parent).stdout.strip()
    seal.update({"status": "opened", "opened": str(date.today()), "opened_by_commit": commit,
                 "opened_by": "pipeline/catcher_108c.py --hpre (v2 + joint, one run)"})
    seal_p.write_text(json.dumps(seal, indent=1))  # marked before any outcome is touched

    hold = range(2016, 2020)
    th = attempts(SEALED_DIR, hold)
    board_all = boards([CACHE, SEALED_DIR])
    th["lead_gain"] = lead_other(th["pitcher_id"].to_numpy(), th["season"].to_numpy(), -1, board_all)
    th["p"] = frozen_predict(th)
    y = th["is_runner_cs"].astype(int).to_numpy()
    # G1 baselines: holdout season's own league rate by base; catcher's other-season rate 2016-26, k = 30
    lg = th.groupby(["season", "base3"])["is_runner_cs"].transform("mean")
    th["p_league"] = floor(lg)
    allc = pd.concat([th[["catcher", "season", "is_runner_cs"]],
                      v2_loso()[["catcher", "season", "is_runner_cs"]]], ignore_index=True)
    tot = allc.groupby("catcher")["is_runner_cs"].agg(["sum", "size"])
    own = allc.groupby(["catcher", "season"])["is_runner_cs"].agg(["sum", "size"])
    slr = th.groupby("season")["is_runner_cs"].mean()
    pc = []
    for c, s in zip(th["catcher"], th["season"]):
        h, n = tot.loc[c, "sum"] - own.loc[(c, s), "sum"], tot.loc[c, "size"] - own.loc[(c, s), "size"]
        pc.append(shrunk_rate(h, n, slr[s], 30))
    th["p_catcher"] = floor(pc)
    ll = {k: float(log_loss(y, th[c])) for k, c in (("model", "p"), ("league", "p_league"), ("catcher_only", "p_catcher"))}
    g1 = ll["model"] <= .97 * ll["league"] and ll["model"] < ll["catcher_only"]
    gap = decile_gap(y, th["p"].to_numpy())
    citl = {int(s): round(float(g["p"].mean() - g["is_runner_cs"].mean()), 4) for s, g in th.groupby("season")}
    dec = pd.DataFrame({"y": y, "p": th["p"], "q": pd.qcut(th["p"].rank(method="first"), 10, labels=False)}
                       ).groupby("q").mean()
    cs = th.groupby(["catcher", "season"]).agg(n=("p", "size"), y=("is_runner_cs", "sum"), p=("p", "sum"),
                                               sav=("cs_aa", "sum"), pop=("pop_time", "mean")).reset_index()
    cs["credit"] = cs["y"] - cs["p"]
    cs["rate"], cs["sav_rate"] = cs["credit"] / cs["n"], cs["sav"] / cs["n"]
    q = cs[cs["n"] >= 30]
    g3 = float(q["credit"].corr(q["sav"]))
    pairs = q.merge(q.assign(season=q["season"] - 1), on=["catcher", "season"], suffixes=("", "_n"))
    v2 = {"n": int(len(th)), "loglos": {k: round(v, 5) for k, v in ll.items()},
          "g1_rel_vs_league": round(1 - ll["model"] / ll["league"], 4), "g1_pass": bool(g1),
          "decile_gap": round(gap, 4), "g2_pass": bool(gap <= .03), "calibration_in_the_large": citl,
          "decile_table": {int(i): [round(float(r["p"]), 4), round(float(r["y"]), 4)] for i, r in dec.iterrows()},
          "g3_n": int(len(q)), "g3_r": round(g3, 3), "g3_per_season": {int(s): round(float(g["credit"].corr(g["sav"])), 3)
                                                                      for s, g in q.groupby("season")},
          "g3_pass": bool(g3 >= .80),
          "g4_reported_yty_ours": round(float(pairs["rate"].corr(pairs["rate_n"])), 3),
          "g4_reported_yty_savant": round(float(pairs["sav_rate"].corr(pairs["sav_rate_n"])), 3),
          "g4_pairs": int(len(pairs)), "g5_reported_pop_r": round(float(q["rate"].corr(q["pop"])), 3),
          "per_season_logloss": {int(s): round(float(log_loss(g["is_runner_cs"], g["p"], labels=[0, 1])), 4)
                                 for s, g in th.groupby("season")},
          "lead_gain_other_season_coverage": round(float(th["pitcher_id"].isin(board_all["pitcher_id"]).mean()), 4)}
    v2["verdict"] = "CONFIRMED" if g1 and gap <= .03 and g3 >= .80 else "NOT CONFIRMED"
    print("hpre v2", json.dumps(v2), flush=True)

    # joint: J3 with the pooled 2020-26 effects; J1/J2 from per-season 2016-19 fits on the frozen-v2 offset
    th = th.assign(y=y, off=logit(th["p"]))
    eff_all = pd.read_parquet(CACHE / "joint_eff_all2020_26.parquet").assign(fit=0)
    te = add_effects(th.assign(fit=0), eff_all)
    pj = floor(sig(te["off"] + te["u"] + te["v"] + te["w"]))
    eff, diag = run_joint(th.assign(fit=th["season"]), "hpre")
    jg, _ = joint_gates(add_effects(th.assign(fit=th["season"]), eff))
    jg.update({"j3_logloss_joint": round(float(log_loss(y, pj)), 5), "j3_logloss_v2": round(ll["model"], 5),
               "j3_pass": bool(log_loss(y, pj) <= ll["model"]),
               "rhat_max_effect": max(d["rhat_effect_max"] for d in diag.values()),
               "rhat_max_sigma": max(d["rhat_sigma_max"] for d in diag.values())})
    jg["verdict"] = "PASS" if all(jg[f"j{i}_pass"] for i in (1, 2, 3)) else "FAIL"
    print("hpre joint", json.dumps(jg), flush=True)

    # R1 on 2019: CS-above-xCS runs with 2020-22 league-mean swing per target base (no pre-2020 RE table)
    con = connect()
    a = v2_loso()
    a = a[a["season"].isin([2020, 2021, 2022])]
    a, _ = add_swing(attempt_states(con, a), re_tables(con, [2020, 2021, 2022]))
    sw = (a["d_sb"] - a["d_cs"]).groupby(a["base3"]).mean()
    t19 = th[th["season"] == 2019].assign(r=lambda d: (d["is_runner_cs"] - d["p"]) * d["base3"].map(sw))
    o19 = t19.groupby("catcher").agg(n=("r", "size"), runs=("r", "sum")).reset_index()
    s19 = con.sql("SELECT player_id catcher, catcher_stealing_runs sav FROM lb_catcher_throwing_2019").df()
    j19 = o19[o19["n"] >= 30].merge(s19, on="catcher")
    rr = {"n": int(len(j19)), "r_csaa_runs_vs_savant_2019": round(float(j19["runs"].corr(j19["sav"])), 3),
          "note": "deterrence has no pre-2020 data (blocked), so this is CS-above-xCS runs only"}
    rr["r1_pass"] = bool(rr["r_csaa_runs_vs_savant_2019"] >= .70)
    print("hpre runs", json.dumps(rr), flush=True)
    (RES / "catcher_108c_hpre_SEALED.json").write_text(json.dumps(
        {"prereg": "RESULTS-MLB §108c (671ea06)", "opened_by_commit": commit, "date": str(date.today()),
         "frozen_v2_sha256": want, "v2": v2, "joint": jg, "runs_2019": rr,
         "deterrence": "blocked: no pre-2020 pitch-level mart"}, indent=1))


def demo():
    t = {(b1, b2, b3, o): .5 * (b1 + b2 + b3) + .3 * (2 - o) for b1 in (0, 1) for b2 in (0, 1) for b3 in (0, 1)
         for o in range(3)}
    d_sb, d_cs = swing(t, 1, 0, 0, 0, 1)
    assert abs(d_sb - 0) < 1e-9 and abs(d_cs - (-.5 - .3)) < 1e-9, (d_sb, d_cs)
    assert swing(t, 0, 1, 0, 2, 2)[1] == -t[(0, 1, 0, 2)]  # CS for the third out wipes the inning
    op = pd.DataFrame({"game_pk": [1, 1], "at_bat_number": [3, 4], "runner_id": [9, 9]})
    th = pd.DataFrame({"game_pk": [1, 1], "at_bat_number": [3, 3], "runner_id": [9, 9]})
    assert label_attempts(op, th)["y"].tolist() == [1, 0]
    assert floor([0, 1, .5]).tolist() == [LO, HI, .5]
    print("demo ok")


if __name__ == "__main__":
    {"--loso": loso, "--freeze": freeze, "--hpre": hpre}.get(next((a for a in sys.argv[1:]), ""), demo)()
