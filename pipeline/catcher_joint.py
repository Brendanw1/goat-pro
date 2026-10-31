"""§108c (1) joint credit model: logit P(CS) = offset (v2 xCS logit) + u_catcher + v_pitcher + w_runner, crossed.

Runs ONLY in ~/.venvs/goat-bayes (NumPyro; never pip into /opt/anaconda3). Called by catcher_108c.py:

    ~/.venvs/goat-bayes/bin/python pipeline/catcher_joint.py IN.parquet OUT.parquet    # IN: y, off, catcher, pitcher_id, runner_id, fit
    ~/.venvs/goat-bayes/bin/python pipeline/catcher_joint.py --demo

One NUTS fit per distinct value of IN's `fit` column (2 chains, 1,000 warmup + 1,000 draws, seed 7, sigma ~ HalfNormal(.5),
non-centred). OUT: one row per (fit, kind, id) with the posterior-mean effect (logit scale), plus per-fit max R-hat
(sigmas and all effects) in OUT's sidecar .json.
"""
import json
import os
import sys

os.environ.setdefault("XLA_FLAGS", "--xla_force_host_platform_device_count=2")
import jax  # noqa: E402
import jax.numpy as jnp  # noqa: E402
import numpy as np  # noqa: E402
import numpyro  # noqa: E402
import numpyro.distributions as dist  # noqa: E402
import pandas as pd  # noqa: E402
from numpyro.diagnostics import split_gelman_rubin  # noqa: E402
from numpyro.infer import MCMC, NUTS  # noqa: E402

KINDS = ("catcher", "pitcher_id", "runner_id")


def model(off, idx, sizes, y=None):
    eta = off
    for k, (ix, n) in enumerate(zip(idx, sizes)):
        s = numpyro.sample(f"s{k}", dist.HalfNormal(.5))
        z = numpyro.sample(f"z{k}", dist.Normal(0, 1).expand([n]))
        eta = eta + s * z[ix]
    numpyro.sample("y", dist.Bernoulli(logits=eta), obs=y)


def fit(df: pd.DataFrame, seed=7):
    codes = [pd.factorize(df[k]) for k in KINDS]
    mc = MCMC(NUTS(model), num_warmup=1000, num_samples=1000, num_chains=2, chain_method="parallel",
              progress_bar=False)
    mc.run(jax.random.PRNGKey(seed), jnp.asarray(df["off"].to_numpy()), [jnp.asarray(c[0]) for c in codes],
           [len(c[1]) for c in codes], y=jnp.asarray(df["y"].to_numpy()))
    smp = mc.get_samples(group_by_chain=True)
    rows, rh_s, rh_all = [], [], []
    for k, kind in enumerate(KINDS):
        eff = np.asarray(smp[f"s{k}"])[..., None] * np.asarray(smp[f"z{k}"])  # chain, draw, n
        rh_s.append(float(split_gelman_rubin(np.asarray(smp[f"s{k}"]))))
        rh_all.append(float(np.nanmax(split_gelman_rubin(eff))))
        rows.append(pd.DataFrame({"kind": kind, "id": codes[k][1], "eff": eff.mean(axis=(0, 1))}))
    diag = {"rhat_sigma_max": round(max(rh_s), 4), "rhat_effect_max": round(max(rh_all), 4),
            "sigma": {kind: round(float(np.asarray(smp[f"s{k}"]).mean()), 4) for k, kind in enumerate(KINDS)},
            "n": int(len(df))}
    return pd.concat(rows, ignore_index=True), diag


def main(inp, out):
    df = pd.read_parquet(inp)
    effs, diags = [], {}
    for f, g in df.groupby("fit", sort=True):
        e, d = fit(g.reset_index(drop=True))
        effs.append(e.assign(fit=f))
        diags[str(f)] = d
        print(f"joint fit {f}: n {d['n']}, max R-hat sigma {d['rhat_sigma_max']}, effects {d['rhat_effect_max']}",
              flush=True)
    pd.concat(effs, ignore_index=True).to_parquet(out)
    with open(out + ".json", "w") as fh:
        json.dump(diags, fh, indent=1)


def demo():
    """Recover a planted catcher effect: 40 catchers, sd .4, zero pitcher/runner effects."""
    rng = np.random.default_rng(1)
    n = 6000
    c, p, r = rng.integers(0, 40, n), rng.integers(0, 200, n), rng.integers(0, 300, n)
    u = rng.normal(0, .4, 40)
    off = np.full(n, -1.0)
    y = (rng.random(n) < 1 / (1 + np.exp(-(off + u[c])))).astype(int)
    e, d = fit(pd.DataFrame({"y": y, "off": off, "catcher": c, "pitcher_id": p, "runner_id": r}))
    ce = e[e["kind"] == "catcher"].set_index("id")["eff"].reindex(range(40)).to_numpy()
    r_ = np.corrcoef(ce, u)[0, 1]
    assert r_ > .6 and d["sigma"]["pitcher_id"] < d["sigma"]["catcher"], (r_, d)
    print("demo ok", round(r_, 3), d)


if __name__ == "__main__":
    demo() if "--demo" in sys.argv else main(sys.argv[1], sys.argv[2])
