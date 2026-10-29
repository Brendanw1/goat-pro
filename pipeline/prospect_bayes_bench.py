"""prospect_bayes_bench.py — time the §99 NumPyro model on full data (CPU or a cloud GPU). No outcome is scored.

    pip install "jax[cuda12]" numpyro pandas pyarrow          # on the GPU box
    python pipeline/prospect_bayes_bench.py [--pitcher] [--compact] [--chains 4]

Needs only these gitignored public-data inputs (copy them to the same paths):
    data/milb/prospect_snapshots.parquet  (19.2 MB)
    data/milb/hist_hitters.parquet         (1.4 MB)    data/milb/hitters.parquet   (0.9 MB)
    data/milb/hist_pitchers.parquet        (1.4 MB)    data/milb/pitchers.parquet  (1.0 MB)
plus pipeline/prospect_bayes.py and pipeline/prospect_backtest.py. Prints jax.devices(), ms per gradient (mean of 50)
the wall time of a 200-step NUTS warm-up and its leapfrog steps per iteration on the full arrival fold 2018 (dev).
"""
import argparse
import time

import jax
import numpy as np
from numpyro.infer import MCMC, NUTS
from numpyro.infer.util import initialize_model

import prospect_bayes as pb

ap = argparse.ArgumentParser()
ap.add_argument("--pitcher", action="store_true")
ap.add_argument("--compact", action="store_true", help="z_eta only where read (exact; §99 speed note)")
ap.add_argument("--chains", type=int, default=1)
a = ap.parse_args()
print("devices:", jax.devices(), flush=True)
d, E = pb.prep(pb.entities(pb.bt.load(), "arr", 2018, a.pitcher), pb.lines(a.pitcher))
d["compact"] = a.compact
info = initialize_model(jax.random.PRNGKey(0), pb.model, model_args=(d, "arr"))
print("entities", len(E), "lines", len(d["e"]), "latents", sum(np.size(v) for v in info.param_info.z.values()))
vg = jax.jit(jax.value_and_grad(info.potential_fn))
jax.block_until_ready(vg(info.param_info.z))
t0 = time.time()
for _ in range(50):
    out = vg(info.param_info.z)
jax.block_until_ready(out)
print(f"ms per gradient: {(time.time() - t0) / 50 * 1000:.2f}", flush=True)
mc = MCMC(NUTS(pb.model, target_accept_prob=0.9), num_warmup=200, num_samples=1, num_chains=a.chains,
          chain_method="vectorized", progress_bar=False)
t0 = time.time()
mc.warmup(jax.random.PRNGKey(7), d, "arr", collect_warmup=True, extra_fields=("num_steps",))
ns = jax.block_until_ready(mc.get_extra_fields()["num_steps"])
print(f"200-step warm-up, {a.chains} chain(s): {time.time() - t0:.0f} s, mean leapfrog steps {float(ns.mean()):.0f}, "
      f"last 50 {float(ns[-50:].mean()):.0f}", flush=True)
