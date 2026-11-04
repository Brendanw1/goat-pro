"""Step 2b (Thunder): one shared-trunk neural net, five heads, one summed loss -> per-pitch xRV.

    python nn_multihead.py --bench                  # 1 fold, 1 epoch timing on the device, nothing written
    python nn_multihead.py --folds 0 1 2 3 4        # OOF values -> cache/oof_NN_mh.parquet (resumable per fold)
    python nn_multihead.py --smoke                  # tiny CPU run on 2% of rows (laptop check)

How it is ONE model: a single trunk (MLP over the ladder features + a pitch-type embedding) feeds five heads,
  swing (sigmoid), take -> {ball, HBP, called strike} (softmax), swing -> {whiff, foul, in play} (softmax),
  in play -> four xwOBA bins (softmax), in play -> xwOBA (regression),
trained jointly on one loss: sum of each head's NLL on the pitches where that branch is observed (+ .5 x MSE on
xwOBA). The nine terminal probabilities are products of the heads. Value = sum p x fixed per-(season, count)
mean run value of that terminal class from training rows (lib.class_constants), count-normalized like the GBMs.
No head reads another head's output; nothing is stacked.

Input: cache/nn_input.parquet (written on the laptop by `python nn_multihead.py --export`: dev pitches only, public
Statcast features + cls + keys; no lockbox rows). Output per fold: cache/nn_fold{k}.parquet (index, v_raw).
"""
import argparse
import time
import zlib
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from torch import nn

HERE = Path(__file__).resolve().parent
CACHE = HERE / "cache"
NUM = ["velo", "ivb", "hb_arm", "spin", "ext", "rel_h", "rel_s_arm", "velo_diff", "ivb_diff", "hb_diff_arm",
       "hvaa", "spin_eff", "plate_x_arm", "plate_z", "balls", "strikes", "same_hand", "abs26"]


class Net(nn.Module):
    def __init__(self, n_in, width=256, depth=3, emb=8, drop=0.1):
        super().__init__()
        self.emb = nn.Embedding(13, emb)
        layers, d = [], n_in + emb
        for _ in range(depth):
            layers += [nn.Linear(d, width), nn.SiLU(), nn.Dropout(drop)]
            d = width
        self.trunk = nn.Sequential(*layers)
        self.swing, self.take, self.sw = nn.Linear(d, 1), nn.Linear(d, 3), nn.Linear(d, 3)
        self.bip, self.xw = nn.Linear(d, 4), nn.Linear(d, 1)

    def forward(self, x, t):
        h = self.trunk(torch.cat([x, self.emb(t)], 1))
        return self.swing(h).squeeze(1), self.take(h), self.sw(h), self.bip(h), self.xw(h).squeeze(1)

    def probs(self, x, t):
        s, tk, sw, b, _ = self(x, t)
        ps = torch.sigmoid(s)[:, None]
        pt, psw, pb = tk.softmax(1), sw.softmax(1), b.softmax(1)
        # terminal order = lib.CLASSES: ball, hbp, cs, whiff, foul, bip0..3
        return torch.cat([(1 - ps) * pt, ps * psw[:, :2], ps * psw[:, 2:3] * pb], 1)


def loss_fn(out, cls, xw):
    s, tk, sw, b, xh = out
    swung = cls >= 3
    l = nn.functional.binary_cross_entropy_with_logits(s, swung.float(), reduction="sum")
    take = ~swung
    l = l + nn.functional.cross_entropy(tk[take], cls[take], reduction="sum") if take.any() else l
    sub = torch.where(cls >= 5, 2, cls - 3)
    l = l + nn.functional.cross_entropy(sw[swung], sub[swung], reduction="sum") if swung.any() else l
    ip = cls >= 5
    if ip.any():
        l = l + nn.functional.cross_entropy(b[ip], cls[ip] - 5, reduction="sum")
        ok = ip & ~torch.isnan(xw)
        l = l + 0.5 * ((xh[ok] - xw[ok]) ** 2).sum()
    return l / len(cls)


def tensors(d, mu, sd, dev):
    x = torch.tensor(((d[NUM] - mu) / sd).fillna(0).to_numpy(np.float32), device=dev)
    t = torch.tensor(d["ptype"].to_numpy(np.int64), device=dev)
    return x, t


def fit_fold(df, k, dev, epochs=8, bs=4096, lr=2e-3, bench=False):
    tr = df[(df["fold"] != k) & df["cls"].notna()]
    es = tr["pitcher"].map(lambda p: zlib.crc32(f"ppv6-es:{p}".encode()) % 10 == 0).to_numpy()
    fit, val = tr[~es], tr[es]
    mu, sd = fit[NUM].mean(), fit[NUM].std() + 1e-6
    X, T = tensors(fit, mu, sd, dev)
    C = torch.tensor(fit["cls"].to_numpy(np.int64), device=dev)
    XW = torch.tensor(fit["xwoba"].to_numpy(np.float32), device=dev)
    Xv, Tv = tensors(val, mu, sd, dev)
    Cv = torch.tensor(val["cls"].to_numpy(np.int64), device=dev)
    XWv = torch.tensor(val["xwoba"].to_numpy(np.float32), device=dev)
    torch.manual_seed(k)
    net = Net(len(NUM)).to(dev)
    opt = torch.optim.AdamW(net.parameters(), lr=lr, weight_decay=1e-4)
    best, best_state, bad = np.inf, None, 0
    for ep in range(epochs):
        t0 = time.time()
        net.train()
        perm = torch.randperm(len(X), device=dev)
        for i in range(0, len(X), bs):
            j = perm[i:i + bs]
            opt.zero_grad()
            loss_fn(net(X[j], T[j]), C[j], XW[j]).backward()
            opt.step()
        net.eval()
        with torch.no_grad():
            vl = float(sum(loss_fn(net(Xv[i:i + 65536], Tv[i:i + 65536]), Cv[i:i + 65536], XWv[i:i + 65536])
                           * len(Cv[i:i + 65536]) for i in range(0, len(Xv), 65536)) / len(Cv))
        print(f"fold {k} epoch {ep}: val loss {vl:.5f} ({time.time() - t0:.0f}s, {len(X):,} rows)", flush=True)
        if bench:
            return None
        if vl < best - 1e-5:
            best, best_state, bad = vl, {n: p.clone() for n, p in net.state_dict().items()}, 0
        else:
            bad += 1
            if bad >= 2:
                break
    net.load_state_dict(best_state)
    te = df[df["fold"] == k]
    Xt, Tt = tensors(te, mu, sd, dev)
    with torch.no_grad():
        P = torch.cat([net.probs(Xt[i:i + 65536], Tt[i:i + 65536]) for i in range(0, len(Xt), 65536)]).cpu().numpy()
    import lib
    const = lib.class_constants(tr)
    v = (P * lib.const_rows(te, const)).sum(1)
    return pd.DataFrame({"v_raw": v}, index=te.index)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--folds", type=int, nargs="*", default=[0, 1, 2, 3, 4])
    ap.add_argument("--bench", action="store_true")
    ap.add_argument("--smoke", action="store_true")
    ap.add_argument("--export", action="store_true", help="laptop: write cache/nn_input.parquet (dev only)")
    a = ap.parse_args()
    if a.export:
        import lib
        cols = ["pitcher", "season", "fold", "ptype", "cls", "xwoba", "rv"] + NUM
        d = lib.load(cols)
        d.to_parquet(CACHE / "nn_input.parquet", compression="zstd")
        print(f"nn_input: {len(d):,} rows, {d['pitcher'].nunique()} dev pitchers")
        return
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    df = pd.read_parquet(CACHE / "nn_input.parquet")
    if a.smoke:
        df = df.sample(frac=0.02, random_state=0)
    print(f"device {dev}, rows {len(df):,}", flush=True)
    if a.bench:
        fit_fold(df, 0, dev, bench=True)
        return
    for k in a.folds:
        path = CACHE / f"nn_fold{k}{'_smoke' if a.smoke else ''}.parquet"
        if path.exists():
            print(f"skip fold {k}")
            continue
        fit_fold(df, k, dev, epochs=2 if a.smoke else 8).to_parquet(path)


if __name__ == "__main__":
    main()
