# Thunder run: Pitching+ v6 net sweep and large Optuna (NOT STARTED, spend not approved)

Box: one RTX A6000 (48 GB, 6 vCPU), about $0.35/hr billed per minute. Public MLB Statcast only (dev 70% of
pitchers); the lockbox and the sealed 2015-19 bank never leave the laptop. Keys in `.env` only.

## What runs there

1. **Shared-trunk multi-head net sweep** (`nn_multihead.py`, rung b). The default net (256 x 3, 8 epochs) already
   ran on the laptop CPU (about 18 s per epoch, 15 min for 5 folds) and LOST to the GBM softmax by J -.030
   [-.045, -.016]. It is untuned, and some folds were still improving at the epoch cap, so the open question is
   capacity and training length. Grid, nested: width {256, 512, 1024} x depth {3, 5} x dropout {.1, .3} x lr
   {1e-3, 3e-3} = 24 configs, chosen per outer fold on an inner 20% pitcher split ("ppv6-inner"), up to 30 epochs
   with patience 3, then a refit on the outer-training pitchers. That is 24 x 5 inner fits plus 5 refits.
2. **Large Optuna for the GBM** (rung e, `tune.py`): 200 trials per outer fold instead of the laptop's 25, so the
   wide space is actually explored (the college run sat at the grid edge in all 45 fits). Run on the GPU with
   XGBoost `device="cuda"` hist (G4: same family as LightGBM, expected difference about 0), or on the 6 vCPU with
   LightGBM if the bench says the GPU does not help.

## 0. Files to copy (same relative paths)

```
research/pitching-plus-v6/{lib.py, ladder.py, tune.py, nn_multihead.py}
research/pitching-plus-v6/cache/nn_input.parquet   (105 MB: dev pitches, public Statcast features + cls + fold)
research/pitching-plus-v6/cache/frame_dev.parquet  (export first: lib.load() dev rows only, about 350 MB zstd)
```
Never copy `cache/frame.parquet` (it holds the lockbox rows), `data/fg_pitch_models.csv`, or anything under
`~/Projects/goat-pro/cache/sealed`. Export `frame_dev.parquet` with
`python -c "import lib; lib.load().to_parquet('cache/frame_dev.parquet', compression='zstd')"` and point
`lib.load` at it on the box (`frame.parquet` absent there is the guard).

## 1. Environment (CUDA 12 box)

```
python3 -m venv ~/venv && . ~/venv/bin/activate
pip install torch pandas pyarrow lightgbm "xgboost>=2.1" optuna scikit-learn scipy
python -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0))"   # must be True
```

## 2. Bench FIRST: go / no-go (about 5 minutes, nothing scored)

```
python nn_multihead.py --bench          # one epoch, fold 0, prints seconds per epoch
```
- Laptop reference: 18 s per epoch (256 x 3, 2.1M rows, 3 CPU threads).
- **Go** if a 1024 x 5 epoch takes <= 10 s (then the sweep is about 4 GPU-hours).
- **No-go** if the 256 x 3 epoch is not at least 3x faster than the laptop (<= 6 s): stop the box and run the sweep
  on the laptop overnight; it costs only wall time.
- XGBoost bench: one 500-round fit on fold 0; go if <= 60 s.

## 3. Estimate and cap

| job | fits | per fit | GPU-hours |
|---|---|---|---|
| net sweep (24 configs x 5 inner + 5 refits) | 125 | about 2 min (30 epochs x 4 s) | 4.2 |
| Optuna (200 trials x 5 folds, inner frac .5) | 1,005 | about 30 s | 8.4 |
| bench, setup, copy, slack | | | 1.5 |
| **total** | | | **about 14 h, about $5** |

**Cap: $8 (about 23 hours).** Both scripts must be resumable per fold (the net already is: one parquet per fold);
stop the box as soon as the last fold file is written.

## 4. Bring back and read (laptop)

Copy back `cache/nn_fold*.parquet` (rename to the sweep's design name), `cache/oof_*+tuned@full.parquet` and
`results/tune_*.json`, then stop the box. Judge with `ladder.py <name> --vs <current best>` under the PREREG J rule.
The lockbox is not read on the box.
