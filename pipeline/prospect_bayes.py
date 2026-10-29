"""prospect_bayes.py — §99 NumPyro latent-skill prospect model (hitters and pitchers).

    PY=~/.venvs/goat-bayes/bin/python
    $PY pipeline/prospect_bayes.py --prior-check                 # prior predictive: org spread in K%
    $PY pipeline/prospect_bayes.py --folds arr:2015 val:2013     # SVI fit per fold -> results/prospect_99_npy_*.parquet
    $PY pipeline/prospect_bayes.py --nuts                        # NUTS diagnostics on a subsample of one dev fold

Spec (frozen in RESULTS-MLB §99e). One latent entity per (player, as-of) row, seeing only lines with avail <= as-of.
  skills     hitters K, BB+HBP, HR per PA; pitchers K, BB+HBP, HR per BF and GB per ball in play (GO+AO)
  theta      theta[e,0] = mu_s + X_e b_s + sd0_s z;  theta[e,t] = theta[e,t-1] + d0_s + d1_s (age - 22) + u_org[s] + sd_eta_s z
             mu_s ~ N(logit AAA rate_s, 0.1): theta is AAA-equivalent skill (the anchor)
  lines      count ~ Binomial(n, sigmoid(theta[e,t] + alpha[level] + gamma[level, season] + nu[league]))
             alpha[AAA] = 0 (anchor); gamma centred over seasons within level; nu centred over leagues within level
  org        u_org ~ N(0, sd_org), sd_org ~ HalfNormal(0.02) per season step (prior check in §99e)
  scouting   list bucket (unlisted < org 21-30 < org 11-20 < org 1-10 < top 100) ~ ordered logit(theta_last . w + w_age age_rel,
             noise sd_rank[level])
  arrival    debut within 4 seasons ~ Bernoulli(a + theta_last . c + d_lvl[level] + d_age age_rel + e_state[bucket]
             + e_top log top rank + e_pick log pick)
  value      log1p(control-years FSE) | debut ~ Normal(v0 + theta_last . vc + v_state[bucket] + v_lvl[level], v_sd), censored
             rows as P(Y > y)
Unlisted training negatives are subsampled with inverse-rate weights on the outcome and scouting terms.
"""
import argparse
import json
import os
import sys
import time
from pathlib import Path

os.environ.setdefault("XLA_FLAGS", "--xla_cpu_multi_thread_eigen=false intra_op_parallelism_threads=2")
import jax  # noqa: E402
import jax.numpy as jnp  # noqa: E402
import numpy as np  # noqa: E402
import numpyro  # noqa: E402
import numpyro.distributions as dist  # noqa: E402
import pandas as pd  # noqa: E402
from numpyro.infer import MCMC, NUTS, SVI, Predictive, Trace_ELBO, autoguide  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
import prospect_backtest as bt  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
MILB = ROOT / "data" / "milb"
RES = ROOT / "pipeline" / "results"
LVL = {"ROK": 0, "A-": 1, "A": 2, "A+": 3, "AA": 4, "AAA": 5}
CAP = 20000          # training entities per role and fold
STEPS = 4000


def lines(pitcher):
    kind = "pitchers" if pitcher else "hitters"
    L = pd.concat([pd.read_parquet(MILB / f"hist_{kind}.parquet"), pd.read_parquet(MILB / f"{kind}.parquet")])
    L = L[L.level.isin(LVL) & (L.league_name != "MEX")]
    if pitcher:
        L = L[L.BF > 0].reset_index(drop=True)
        cnt = np.stack([L.SO, L.BB + L.HBP, L.HR, L.GO], 1)
        den = np.stack([L.BF, L.BF, L.BF, L.GO + L.AO], 1)
    else:
        L = L[L.PA > 0].reset_index(drop=True)
        cnt = np.stack([L.SO, L.BB + L.HBP, L.HR], 1)
        den = np.stack([L.PA, L.PA, L.PA], 1)
    return L, cnt.astype(np.float32), den.astype(np.float32)


def bucket(d):
    return np.select([d.list_state == "top100", d.org_rank <= 10, d.org_rank <= 20, d.org_rank.notna()], [4, 3, 2, 1], 0)


def prep(E, LC):
    """E: entity rows (snapshot rows) with train flag and weight w; one latent entity each, lines avail <= as_of."""
    L, cnt, den = LC
    E = E.reset_index(drop=True).copy()
    E["e"] = np.arange(len(E))
    m = E[["e", "id", "as_of"]].merge(L[["mlbam_id", "season"]].reset_index(), left_on="id", right_on="mlbam_id")
    m = m[pd.to_datetime(m.season.astype(str) + "-10-01") <= m.as_of]
    m["t"] = m.groupby("e").season.rank(method="dense").astype(int) - 1
    T = int(m.t.max()) + 1
    li = m["index"].values
    seasons = sorted(L.season.unique())
    sidx = {s: k for k, s in enumerate(seasons)}
    leagues = L.league_name.fillna("?")
    lg_codes = {g: k for k, g in enumerate(sorted(leagues.unique()))}
    lg_level = (L.assign(lg=leagues.map(lg_codes), lv=L.level.map(LVL)).groupby("lg").lv
                .agg(lambda s: s.mode()[0]))
    age_l = ((pd.to_datetime(L.season.astype(str) + "-07-01") - pd.to_datetime(L.birth_date, errors="coerce"))
             .dt.days / 365.25).values[li]
    A = np.full((len(E), T), 22.0, dtype=np.float32)
    A[m.e.values, m.t.values] = np.nan_to_num(age_l, nan=22.0)
    last_t = m.groupby("e").t.max().reindex(E.e).fillna(0).astype(int).values
    orgs = {o: k for k, o in enumerate(sorted(E.org_id.fillna(-1).unique()))}
    aaa = (L.level == "AAA").values
    r = cnt[aaa].sum(0) / den[aaa].sum(0)
    d = dict(
        e=m.e.values, t=m.t.values, lvl_line=L.level.map(LVL).values[li],
        season=np.array([sidx[s] for s in m.season]), lg=leagues.map(lg_codes).values[li],
        lg_level=lg_level.reindex(range(len(lg_codes))).fillna(0).astype(int).values,
        cnt=cnt[li], den=den[li], age=A, last_t=last_t, has=E.e.isin(m.e).values.astype(np.float32),
        X=np.stack([(np.log(E.pick.fillna(1500)) - 6) / 1.5, E.drafted.astype(float), (E.age.fillna(21) - 21) / 3], 1)
        .astype(np.float32),
        state=bucket(E), lvl=E.lvl.fillna(0).astype(int).values,
        age_rel=E.age_rel.fillna(0).clip(-6, 6).values.astype(np.float32),
        logtop=((np.log(E.top_rank.fillna(150)) - 4) * E.top_rank.notna()).values.astype(np.float32),
        logpick=((np.log(E.pick.fillna(1500)) - 6) / 1.5).values.astype(np.float32),
        org=E.org_id.fillna(-1).map(orgs).values,
        y_arr=np.nan_to_num(E.y_arr.values).astype(np.float32), y_val=np.log1p(E.y_val.fillna(0).values),
        reach=(E.y_val.fillna(0) > 0).values, cens=E.value_censored.fillna(False).values.astype(bool),
        train=E.train.values.astype(bool), w=E.w.values.astype(np.float32),
        mu0=np.log(r / (1 - r)).astype(np.float32),
        live=np.flatnonzero((np.arange(T)[None, :] >= 1) & (np.arange(T)[None, :] <= last_t[:, None])),
        dims=(len(E), T, cnt.shape[1], len(seasons), len(lg_codes), len(orgs)))
    return d, E


def ordered_logit_lp(lin, cut, y):
    """Stable log P(y = k) for an ordered logit (numpyro's OrderedLogistic underflows in float32)."""
    hi = jnp.concatenate([cut, jnp.array([40.0])])[y] - lin
    lo = jnp.concatenate([jnp.array([-40.0]), cut])[y] - lin
    lsh, lsl = jax.nn.log_sigmoid(hi), jax.nn.log_sigmoid(lo)
    return lsh + jnp.log1p(-jnp.exp(jnp.minimum(lsl - lsh, -1e-6)))


def centred(x, groups, n_groups):
    s = jax.ops.segment_sum(x, groups, n_groups)
    c = jax.ops.segment_sum(jnp.ones(x.shape[0]), groups, n_groups)
    return x - (s / jnp.maximum(c, 1)[:, None])[groups]


def model(d, task="arr", sd_org_scale=0.02):
    P, T, S, NS, NLG, NORG = d["dims"]
    nl = len(LVL)
    mu = numpyro.sample("mu", dist.Normal(jnp.asarray(d["mu0"]), 0.1))
    b = numpyro.sample("b", dist.Normal(0, 0.3).expand([3, S]))
    sd0 = numpyro.sample("sd0", dist.HalfNormal(0.5).expand([S]))
    sde = numpyro.sample("sd_eta", dist.HalfNormal(0.2).expand([S]))
    d0 = numpyro.sample("drift0", dist.Normal(0, 0.05).expand([S]))
    d1 = numpyro.sample("drift1", dist.Normal(0, 0.02).expand([S]))
    sdo = numpyro.sample("sd_org", dist.HalfNormal(sd_org_scale).expand([S]))
    u_org = numpyro.sample("u_org_z", dist.Normal(0, 1).expand([NORG, S])) * sdo
    z0 = numpyro.sample("z0", dist.Normal(0, 1).expand([P, S]))
    if d.get("compact"):   # §99 speed: z_eta only where theta is read (1 <= t <= last_t); the rest is prior-only, so exact
        zl = numpyro.sample("z_eta_live", dist.Normal(0, 1).expand([len(d["live"]), S]))
        ze = jnp.zeros((P * T, S)).at[jnp.asarray(d["live"])].set(zl).reshape(P, T, S)
    else:
        ze = numpyro.sample("z_eta", dist.Normal(0, 1).expand([P, T, S]))
    th0 = mu + jnp.asarray(d["X"]) @ b + sd0 * z0
    step = d0 + d1 * (jnp.asarray(d["age"])[..., None] - 22) + u_org[jnp.asarray(d["org"])][:, None, :] + sde * ze
    theta = th0[:, None, :] + jnp.cumsum(step.at[:, 0, :].set(0.0), axis=1)
    a_free = numpyro.sample("alpha_free", dist.Normal(0, 0.5).expand([nl - 1, S]))
    alpha = jnp.concatenate([a_free, jnp.zeros((1, S))], 0)                      # AAA = 0 (anchor)
    sdg = numpyro.sample("sd_gamma", dist.HalfNormal(0.1).expand([S]))
    gz = numpyro.sample("gamma_z", dist.Normal(0, 1).expand([nl, NS, S])) * sdg
    gamma = gz - gz.mean(axis=1, keepdims=True)                                   # centred over seasons
    sdl = numpyro.sample("sd_lg", dist.HalfNormal(0.1).expand([S]))
    nu = centred(numpyro.sample("nu_z", dist.Normal(0, 1).expand([NLG, S])) * sdl, jnp.asarray(d["lg_level"]), nl)
    e, t, lv = jnp.asarray(d["e"]), jnp.asarray(d["t"]), jnp.asarray(d["lvl_line"])
    eta = theta[e, t] + alpha[lv] + gamma[lv, jnp.asarray(d["season"])] + nu[jnp.asarray(d["lg"])]
    den, cnt = jnp.asarray(d["den"]), jnp.asarray(d["cnt"])
    ok = den > 0
    numpyro.factor("lines", jnp.sum(jnp.where(ok, dist.Binomial(jnp.where(ok, den, 1.0), logits=eta)
                                              .log_prob(jnp.where(ok, cnt, 0.0)), 0.0)))
    th_last = theta[jnp.arange(P), jnp.asarray(d["last_t"])] * jnp.asarray(d["has"])[:, None]
    w = jnp.asarray(d["w"])
    lvl, ar, st = jnp.asarray(d["lvl"]), jnp.asarray(d["age_rel"]), jnp.asarray(d["state"])
    wr = numpyro.sample("w_rank", dist.Normal(0, 1).expand([S]))
    wa = numpyro.sample("w_age", dist.Normal(0, 1))
    sdr = numpyro.sample("sd_rank", dist.LogNormal(0, 0.5).expand([nl]))
    cut = numpyro.sample("cut", dist.TransformedDistribution(dist.Normal(0, 3).expand([4]),
                                                             dist.transforms.OrderedTransform()))
    numpyro.factor("rank", jnp.sum(w * ordered_logit_lp((th_last @ wr + wa * ar) / sdr[lvl], cut, st)))
    a = numpyro.sample("a", dist.Normal(-1, 2))
    c = numpyro.sample("c", dist.Normal(0, 1).expand([S]))
    dl = numpyro.sample("d_lvl", dist.Normal(0, 1).expand([nl]))
    da = numpyro.sample("d_age", dist.Normal(0, 1))
    es = numpyro.sample("e_state", dist.Normal(0, 1).expand([5]))
    et = numpyro.sample("e_top", dist.Normal(0, 1))
    ep = numpyro.sample("e_pick", dist.Normal(0, 1))
    lo = a + th_last @ c + dl[lvl] + da * ar + es[st] + et * jnp.asarray(d["logtop"]) + ep * jnp.asarray(d["logpick"])
    numpyro.deterministic("p_debut", jax.nn.sigmoid(lo))
    tr = jnp.asarray(d["train"])
    numpyro.factor("arrival", jnp.sum(jnp.where(tr, w * dist.Bernoulli(logits=lo).log_prob(jnp.asarray(d["y_arr"])),
                                                0.0)))
    if task == "val":
        v0 = numpyro.sample("v0", dist.Normal(1, 1))
        vc = numpyro.sample("vc", dist.Normal(0, 1).expand([S]))
        vst = numpyro.sample("v_state", dist.Normal(0, 1).expand([5]))
        vl = numpyro.sample("v_lvl", dist.Normal(0, 1).expand([nl]))
        vs = numpyro.sample("v_sd", dist.HalfNormal(1))
        mv = v0 + th_last @ vc + vst[st] + vl[lvl]
        y = jnp.asarray(d["y_val"])
        lp = jnp.where(jnp.asarray(d["cens"]), jax.scipy.special.log_ndtr((mv - y) / vs),
                       dist.Normal(mv, vs).log_prob(y))
        numpyro.factor("value", jnp.sum(jnp.where(tr & jnp.asarray(d["reach"]), w * lp, 0.0)))
        numpyro.deterministic("e_val", jnp.expm1(mv + vs ** 2 / 2))


def entities(S, task, Y, pitcher, seed=99):
    tr, te = (bt.arrival_split if task == "arr" else bt.value_split)(S, Y)
    tr, te = tr[tr.pitcher == pitcher].copy(), te[te.pitcher == pitcher].copy()
    keep = (tr.list_state != "unlisted") | (tr.y_arr == 1)
    neg = tr[~keep]
    k = max(min(len(neg), CAP - int(keep.sum())), 1000)
    sub = neg.sample(min(k, len(neg)), random_state=seed)
    tr = pd.concat([tr[keep].assign(w=1.0), sub.assign(w=len(neg) / max(len(sub), 1))])
    return pd.concat([tr.assign(train=True), te.assign(w=1.0, train=False)], ignore_index=True)


def fit(d, task, steps=STEPS, seed=99):
    guide = autoguide.AutoNormal(model, init_scale=0.05)
    svi = SVI(model, guide, numpyro.optim.ClippedAdam(step_size=0.01, clip_norm=10.0), Trace_ELBO())
    return guide, svi.run(jax.random.PRNGKey(seed), steps, d, task, progress_bar=False)


def run_fold(S, task, Y):
    out, diags = [], []
    for pit in (False, True):
        t0 = time.time()
        d, E = prep(entities(S, task, Y, pit), lines(pit))
        guide, res = fit(d, task)
        sites = ["p_debut"] + (["e_val"] if task == "val" else [])
        pr = Predictive(model, guide=guide, params=res.params, num_samples=200, return_sites=sites)(
            jax.random.PRNGKey(1), d, task)
        te = ~d["train"]
        o = E.loc[te, ["id", "as_of", "tyear", "pitcher"]].copy()
        o["NPY_raw"] = np.asarray(pr["p_debut"]).mean(0)[te]
        if task == "val":
            o["NPY_ev"] = (np.asarray(pr["p_debut"]) * np.asarray(pr["e_val"])).mean(0)[te]
        med = guide.median(res.params)
        loss = np.asarray(res.losses)
        dg = {"pitcher": pit, "entities": int(len(E)), "lines": int(len(d["e"])), "T": int(d["dims"][1]),
              "secs": round(time.time() - t0), "loss_first": float(loss[:100].mean()),
              "loss_last": float(loss[-100:].mean()), "finite": bool(np.isfinite(loss[-1])),
              **{k: np.round(np.asarray(med[k]), 3).tolist() for k in ("sd_org", "c", "w_rank", "drift0", "mu")}}
        print(task, Y, dg, flush=True)
        out.append(o)
        diags.append(dg)
    pd.concat(out).to_parquet(RES / f"prospect_99_npy_{task}{Y}.parquet", compression="zstd")
    with open(RES / "prospect_99_npy_diag.jsonl", "a") as f:
        f.write(json.dumps({"task": task, "Y": Y, "diag": diags}) + "\n")


def prior_check(n=4000, seed=0):
    """Prior predictive spread of org development effects on K% (base 23%) after three season steps."""
    rng = np.random.default_rng(seed)
    out = {}
    for scale in (0.05, 0.02):
        sd = np.abs(rng.normal(0, scale, n))
        k = 100 / (1 + np.exp(-(np.log(0.23 / 0.77) + rng.normal(0, 1, (n, 30)) * sd[:, None] * 3)))
        s = k.std(1)
        out[f"HalfNormal({scale})"] = {"org_sd_kpct_q50": round(float(np.median(s)), 2),
                                       "org_sd_kpct_q90": round(float(np.quantile(s, .9)), 2),
                                       "best_worst_gap_q90": round(float(np.quantile(k.max(1) - k.min(1), .9)), 2)}
    print(json.dumps(out, indent=1))
    (RES / "prospect_99_prior_check.json").write_text(json.dumps(out, indent=1))


def nuts_check(S, task="arr", Y=2018, n_ent=600, seed=7):
    E = entities(S, task, Y, False)
    E = pd.concat([E[E.train].sample(n_ent, random_state=seed), E[~E.train].sample(150, random_state=seed)])
    d, E = prep(E, lines(False))
    t0 = time.time()
    mc = MCMC(NUTS(model, target_accept_prob=0.9), num_warmup=500, num_samples=500, num_chains=2,
              chain_method="sequential", progress_bar=False)
    mc.run(jax.random.PRNGKey(seed), d, task)
    from numpyro.diagnostics import summary
    sm = summary(mc.get_samples(group_by_chain=True))
    glob = ["mu", "drift0", "drift1", "sd_org", "sd_eta", "sd0", "w_rank", "c", "a", "e_state", "sd_rank", "alpha_free"]
    rep = {k: {"rhat_max": round(float(np.max(sm[k]["r_hat"])), 3), "ess_min": round(float(np.min(sm[k]["n_eff"])))}
           for k in glob}
    allr = np.concatenate([np.ravel(v["r_hat"]) for v in sm.values()])
    alle = np.concatenate([np.ravel(v["n_eff"]) for v in sm.values()])
    out = {"entities": len(E), "lines": len(d["e"]), "secs": round(time.time() - t0),
           "divergences": int(mc.get_extra_fields()["diverging"].sum()),
           "rhat_max_all": round(float(np.nanmax(allr)), 3), "ess_min_all": round(float(np.nanmin(alle))),
           "share_rhat_gt_1_01": round(float(np.mean(allr > 1.01)), 4), "global": rep}
    g, r = fit(d, task)
    med, smp = g.median(r.params), mc.get_samples()
    out["svi_vs_nuts"] = {k: {"svi": np.round(np.asarray(med[k]), 3).tolist(),
                              "nuts": np.round(np.asarray(smp[k]).mean(0), 3).tolist()} for k in ("c", "w_rank", "sd_org")}
    print(json.dumps(out, indent=1))
    (RES / "prospect_99_nuts.json").write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--prior-check", action="store_true")
    ap.add_argument("--folds", nargs="*")
    ap.add_argument("--nuts", action="store_true")
    a = ap.parse_args()
    if a.prior_check:
        prior_check()
    if a.folds or a.nuts:
        S = bt.load()
        for f in a.folds or []:
            task, y = f.split(":")
            run_fold(S, task, int(y))
        if a.nuts:
            nuts_check(S)
