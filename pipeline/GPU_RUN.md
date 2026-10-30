# GPU run: §104 NPY (NumPyro NUTS) value folds

Target box: one RTX A6000 (48 GB, 6 vCPU, $0.35/hr billed per minute, Thunder Compute). The §104 pre-registration
(`RESULTS-MLB.md` §104) fixes NPY as compact NUTS: 4 chains vectorized on the single GPU (`chain_method="vectorized"`;
"parallel" needs one device per chain), 1,000 warm-up + 1,000 draws, thinning 5, target accept .9, max tree depth 10,
≤ 20k training entities per role. 4 folds × 2 roles = 8 fits. Public data only.

## 0. Files to copy (same relative paths; public MiLB parquet + three scripts, nothing else)

```
pipeline/prospect_bayes.py
pipeline/prospect_backtest.py
pipeline/prospect_bayes_bench.py
data/milb/prospect_snapshots.parquet   (19.2 MB)
data/milb/draft_full.parquet           (0.3 MB)
data/milb/hist_hitters.parquet         (1.4 MB)
data/milb/hitters.parquet              (0.9 MB)
data/milb/hist_pitchers.parquet        (1.4 MB)
data/milb/pitchers.parquet             (1.0 MB)
```
Then `mkdir -p pipeline/results`.

## 1. Environment (CUDA 12 box)

```
python3 -m venv ~/venv && . ~/venv/bin/activate
pip install -U "jax[cuda12]" numpyro pandas pyarrow
python -c "import jax; print(jax.devices())"      # must list CudaDevice
```

## 2. Bench FIRST: go / no-go (≈ 2–3 min, nothing scored)

```
python pipeline/prospect_bayes_bench.py --compact --chains 4 --task val --year 2018
```
- Local CPU reference (docs/prospect-model.md §9, compact hitters full fold): **2.9 ms per gradient**, ≈ 2.6 s per NUTS
  iteration.
- **Go** if ms/gradient ≤ 1.0 (at least ≈ 3× the CPU). A full fit then takes ≈ 10× the printed 200-step warm-up time.
  Multiply by 8 fits to set the budget.
- **No-go** if ms/gradient > 1.0. Stop the box (every minute is billed) and report the bench lines. At that speed the CPU
  run costs about the same.

## 3. The run (resumable, budgeted; the `--method nuts` defaults are the §104 settings)

```
nohup python pipeline/prospect_bayes.py --method nuts --folds val:2015 val:2016 val:2017 val:2018 \
      --max-minutes 600 --est-minutes 60 > npy104.log 2>&1 &
grep -E "fit wall|skip|budget stop|Traceback" npy104.log
```
- Each fit (one role in one fold) is saved as soon as it ends, to `pipeline/results/prospect_104_npy_val{Y}_{h,p}.parquet`.
  When both roles are done, they are merged into `prospect_104_npy_val{Y}.parquet`.
- **Resumable.** Re-running the same command skips every fit whose file exists, so a kill or preemption never redoes
  finished work.
- **Budget.** `--max-minutes` counts wall time from the start of the process. A fit starts only if the elapsed time plus
  the longest fit so far (or `--est-minutes` before the first fit) fits in the budget. Otherwise the run stops cleanly.
  The log prints `fit wall X min` for every fit.
- Diagnostics are appended to `pipeline/results/prospect_104_npy_diag.jsonl`, one line per fit: divergences, R̂ and ESS
  of the globals, mean leapfrog steps, wall seconds and device.
- Do not change any setting. A different setting is a new spec and needs a new pre-registration.

## 4. Bring back and read (on the laptop)

Copy back `pipeline/results/prospect_104_npy_val{2015,2016,2017,2018}.parquet`, `prospect_104_npy_diag.jsonl` and
`npy104.log`, then stop the box. After that:
1. Before reading, check the NUTS validity bar in the jsonl: every global R̂ ≤ 1.05 and divergences ≤ 1% of draws. A
   failure is recorded, and the read cannot pass.
2. Score NPY dev (2015) and post-hoc (2016–17) with `python pipeline/prospect_backtest.py --npy104`. These are not gates.
3. The read happens **once**: `python pipeline/prospect_backtest.py --read104`. It refits B1/v0u/LGB on tyear ≤ 2014,
   merges NPY and writes `results/prospect_104_read.json`. It refuses to run a second time.
