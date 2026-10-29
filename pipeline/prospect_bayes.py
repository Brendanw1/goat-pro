"""prospect_bayes.py — §99 NumPyro latent-skill prospect model (hitters), phase 1: spec + smoke test only.

    ~/.venvs/goat-bayes/bin/python pipeline/prospect_bayes.py --smoke     # small SVI fit on a subsample, < 2 min

Model (docs/prospect-model.md §6.3, RESULTS-MLB §99c):
  latent skill  theta[i, t, s], s in {K, BB, HR} per PA, a random walk over the player's seasons:
                theta[i, t0] = mu_s + b_s . prior_i + sd0_s * z;  theta[i, t] = theta[i, t-1] + drift_s(age) + u_org[s]
                + sd_eta_s * z   (org development slopes u_org)
  observations  each MiLB line: SO, BB, HR ~ Binomial(PA, sigmoid(theta + lam[level, season, s] + nu[league, s]))
  scouting      list state at the snapshot (unlisted < org 21-30 < org 11-20 < org 1-10 < top 100) ~ OrderedLogistic(
                w . theta_last + w_age * age_rel, cut) with the noise scale by level (sd_rank[level])
  outcome       hurdle: debut within 4 seasons ~ Bernoulli(sigmoid(a + c . theta_last + d_lvl[level] + d_age * age_rel));
                value | debut: log1p(control-years PA) ~ Normal, right-censored rows enter as P(Y > y_obs).
The phase-1 run is a smoke test (does it compile, does SVI converge, are the signs sane); no gate is read.
"""
import argparse
import os
from pathlib import Path

os.environ.setdefault("XLA_FLAGS", "--xla_cpu_multi_thread_eigen=false intra_op_parallelism_threads=2")
import jax  # noqa: E402
import jax.numpy as jnp  # noqa: E402
import numpy as np  # noqa: E402
import numpyro  # noqa: E402
import numpyro.distributions as dist  # noqa: E402
import pandas as pd  # noqa: E402
from numpyro.infer import SVI, Trace_ELBO, autoguide  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
MILB = ROOT / "data" / "milb"
LVL = {"ROK": 0, "A-": 1, "A": 2, "A+": 3, "AA": 4, "AAA": 5}
STATE = {"unlisted": 0, "org3": 1, "org2": 2, "org1": 3, "top100": 4}


def prep(n_players=1500, list_years=(2014, 2015, 2016), seed=99):
    S = pd.read_parquet(MILB / "prospect_snapshots.parquet")
    S = S[(S.snap == "list") & S.as_of.dt.year.isin(list_years) & ~S.pitcher & S.debut_k4.notna()]
    rng = np.random.default_rng(seed)
    listed = S[S.list_state != "unlisted"].id.unique()
    rest = S[~S.id.isin(listed)].id.unique()
    ids = np.concatenate([rng.choice(listed, min(len(listed), n_players // 2), replace=False),
                          rng.choice(rest, n_players // 2, replace=False)])
    S = S[S.id.isin(ids)].sort_values("as_of").groupby("id").head(1)          # one snapshot per player
    H = pd.concat([pd.read_parquet(MILB / "hist_hitters.parquet"), pd.read_parquet(MILB / "hitters.parquet")])
    H = H[H.mlbam_id.isin(S.id) & H.level.isin(LVL) & (H.PA > 0)]
    H = H[H.season < H.mlbam_id.map(S.set_index("id").as_of.dt.year)]           # point-in-time: lines before as_of
    S = S[S.id.isin(H.mlbam_id)]
    pid = {i: k for k, i in enumerate(S.id)}
    H = H.assign(p=H.mlbam_id.map(pid))
    seasons = sorted(H.season.unique())
    H["t"] = H.season - H.mlbam_id.map(H.groupby("mlbam_id").season.min())
    H.loc[(H.season > 2020) & (H.mlbam_id.map(H.groupby("mlbam_id").season.min()) < 2020), "t"] -= 1
    T = int(H.t.max()) + 1
    H["ls"] = H.level.map(LVL) * len(seasons) + H.season.map({s: k for k, s in enumerate(seasons)})
    lg = {g: k for k, g in enumerate(H.league_name.fillna("?").unique())}
    age = (pd.to_datetime(H.season.astype(str) + "-07-01") - pd.to_datetime(H.birth_date, errors="coerce")).dt.days
    # age by player x t (for the drift), median-filled
    A = np.full((len(S), T), 22.0)
    ag = (age / 365.25).fillna(22).values
    A[H.p.values, H.t.values] = ag
    rank = np.select([S.list_state == "top100", S.org_rank <= 10, S.org_rank <= 20, S.org_rank.notna()],
                     [4, 3, 2, 1], 0)
    last_t = H.groupby("p").t.max().reindex(range(len(S))).values
    org = {o: k for k, o in enumerate(S.org_id.fillna(-1).unique())}
    d = dict(
        p=H.p.values, t=H.t.values, ls=H.ls.values, lg=H.league_name.fillna("?").map(lg).values,
        n=H.PA.values.astype(float), y=np.stack([H.SO, H.BB + H.HBP, H.HR], 1).astype(float),
        age=A, last_t=last_t, rank=rank, lvl=S.lvl.fillna(0).astype(int).values,
        age_rel=S.age_rel.fillna(0).values, org=S.org_id.fillna(-1).map(org).values,
        prior=np.stack([np.log(S.pick.fillna(600)) - 5, S.drafted.astype(float), (S.age.fillna(21) - 21) / 3], 1),
        debut=S.debut_k4.values, logpa=np.log1p(S.ctrl_pa.fillna(0).values),
        cens=S.value_censored.fillna(True).values.astype(bool),
        dims=(len(S), T, len(LVL) * len(seasons), len(lg), len(org)))
    return d, S, H


def ordered_logit_lp(lin, cut, y):
    """Stable log P(y = k) for an ordered logit (numpyro's OrderedLogistic underflows to -inf in float32)."""
    hi = jnp.concatenate([cut, jnp.array([40.0])])[y] - lin           # upper threshold
    lo = jnp.concatenate([jnp.array([-40.0]), cut])[y] - lin          # lower threshold
    lsh, lsl = jax.nn.log_sigmoid(hi), jax.nn.log_sigmoid(lo)
    return lsh + jnp.log1p(-jnp.exp(jnp.minimum(lsl - lsh, -1e-6)))


def model(d):
    P, T, NLS, NLG, NORG = d["dims"]
    S = 3
    mu = numpyro.sample("mu", dist.Normal(jnp.array([-1.5, -2.5, -3.7]), 0.5))
    b = numpyro.sample("b", dist.Normal(0, 0.3).expand([3, S]))
    sd0 = numpyro.sample("sd0", dist.HalfNormal(0.5).expand([S]))
    sde = numpyro.sample("sd_eta", dist.HalfNormal(0.2).expand([S]))
    drift = numpyro.sample("drift", dist.Normal(0, 0.1).expand([2, S]))            # intercept + slope on (age - 22)
    sdo = numpyro.sample("sd_org", dist.HalfNormal(0.05).expand([S]))
    u_org = numpyro.sample("u_org", dist.Normal(0, 1).expand([NORG, S])) * sdo
    z0 = numpyro.sample("z0", dist.Normal(0, 1).expand([P, S]))
    ze = numpyro.sample("z_eta", dist.Normal(0, 1).expand([P, T, S]))
    th0 = mu + jnp.asarray(d["prior"]) @ b + sd0 * z0                              # P x S
    step = (drift[0] + drift[1] * (jnp.asarray(d["age"])[..., None] - 22)) + u_org[jnp.asarray(d["org"])][:, None, :] \
        + sde * ze
    step = step.at[:, 0, :].set(0.0)
    theta = th0[:, None, :] + jnp.cumsum(step, axis=1)                             # P x T x S
    sdl = numpyro.sample("sd_lam", dist.HalfNormal(0.3).expand([S]))
    lam = numpyro.sample("lam", dist.Normal(0, 1).expand([NLS, S])) * sdl
    sdg = numpyro.sample("sd_lg", dist.HalfNormal(0.1).expand([S]))
    nu = numpyro.sample("nu", dist.Normal(0, 1).expand([NLG, S])) * sdg
    p, t = jnp.asarray(d["p"]), jnp.asarray(d["t"])
    eta = theta[p, t] + lam[jnp.asarray(d["ls"])] + nu[jnp.asarray(d["lg"])]
    numpyro.sample("obs", dist.Binomial(jnp.asarray(d["n"])[:, None], logits=eta), obs=jnp.asarray(d["y"]))
    th_last = theta[jnp.arange(P), jnp.asarray(d["last_t"])]                      # P x S
    # scouting measurement
    w = numpyro.sample("w_rank", dist.Normal(0, 1).expand([S]))
    w_age = numpyro.sample("w_age", dist.Normal(0, 1))
    sd_rank = numpyro.sample("sd_rank", dist.LogNormal(0, 0.5).expand([len(LVL)]))  # noise scale, bounded away from 0
    cut = numpyro.sample("cut", dist.TransformedDistribution(
        dist.Normal(0, 3).expand([4]), dist.transforms.OrderedTransform()))
    lin = (th_last @ w + w_age * jnp.asarray(d["age_rel"])) / sd_rank[jnp.asarray(d["lvl"])]
    numpyro.factor("rank", jnp.sum(ordered_logit_lp(lin, cut, jnp.asarray(d["rank"]))))
    # outcome hurdle
    a = numpyro.sample("a", dist.Normal(-1, 2))
    c = numpyro.sample("c", dist.Normal(0, 1).expand([S]))
    dl = numpyro.sample("d_lvl", dist.Normal(0, 1).expand([len(LVL)]))
    da = numpyro.sample("d_age", dist.Normal(0, 1))
    lo = a + th_last @ c + dl[jnp.asarray(d["lvl"])] + da * jnp.asarray(d["age_rel"])
    numpyro.sample("debut", dist.Bernoulli(logits=lo), obs=jnp.asarray(d["debut"]))
    # value | debut, right-censored rows as P(Y > y_obs)
    v0 = numpyro.sample("v0", dist.Normal(6, 2))
    vc = numpyro.sample("vc", dist.Normal(0, 1).expand([S]))
    vs = numpyro.sample("v_sd", dist.HalfNormal(2))
    mv = v0 + th_last @ vc
    deb = jnp.asarray(d["debut"]) == 1
    cens = jnp.asarray(d["cens"])
    lp = jnp.where(cens, jax.scipy.special.log_ndtr((mv - jnp.asarray(d["logpa"])) / vs),
                   dist.Normal(mv, vs).log_prob(jnp.asarray(d["logpa"])))
    numpyro.factor("value", jnp.sum(jnp.where(deb, lp, 0.0)))


def smoke(steps=2000):
    import time
    d, S, H = prep()
    print("players", d["dims"][0], "lines", len(d["p"]), "T", d["dims"][1], "level x season cells", d["dims"][2])
    guide = autoguide.AutoNormal(model)
    svi = SVI(model, guide, numpyro.optim.Adam(0.02), Trace_ELBO())
    t0 = time.time()
    res = svi.run(jax.random.PRNGKey(99), steps, d, progress_bar=False)
    loss = np.asarray(res.losses)
    post = guide.median(res.params)
    print(f"SVI {steps} steps in {time.time() - t0:.0f}s; loss first/last-100 {loss[:100].mean():.0f} -> "
          f"{loss[-100:].mean():.0f}; finite {np.isfinite(loss[-1])}")
    for k in ("mu", "drift", "w_rank", "c", "vc", "sd_rank", "sd_org"):
        print(k, np.round(np.asarray(post[k]), 3).tolist())
    # sanity: latent K skill vs the raw career K rate
    th0 = post["mu"] + d["prior"] @ post["b"] + post["sd0"] * post["z0"]
    raw = (H.groupby("p").SO.sum() / H.groupby("p").PA.sum()).reindex(range(d["dims"][0])).values
    print("corr(theta0_K, raw K%)", round(float(np.corrcoef(th0[:, 0], raw)[0, 1]), 3))
    return loss


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--smoke", action="store_true")
    if ap.parse_args().smoke:
        smoke()
