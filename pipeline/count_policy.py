"""Count-state usage policies scored by off-policy evaluation (pipeline/PREREG-count-policy.md), restart step 3.

    python pipeline/count_policy.py FRAME.parquet --window selection|confirmation

Behavior mu = the pitcher's own cross-fit node mix in t+1; target pi = small tilts of mu built from season-t values.
Doubly robust gain in runs/100 pitches, pitcher-cluster bootstrap.
"""
import argparse

import numpy as np
import pandas as pd

FAM = {"FF": "FF", "SI": "SI", "FC": "FC", "SL": "SL", "ST": "SL", "SV": "SL", "CU": "CU", "KC": "CU", "CS": "CU",
       "CH": "CH", "FS": "CH", "FO": "CH", "SC": "CH"}
TYPES = ["FF", "SI", "FC", "SL", "CU", "CH"]
WIN = {"selection": [(2023, 2024), (2024, 2025), (2025, 2026)], "confirmation": [(2021, 2022), (2022, 2023)]}
WIN_D1 = {"selection": [(2024, 2025), (2025, 2026)], "confirmation": [(2022, 2023), (2023, 2024)]}  # vt_baseball research/usage-efficiency-d1
NODE = ["pitcher", "balls", "strikes", "opp"]
K_MU, K_Q, CLIP, MIN_MU, REPS = 20.0, 300.0, 3.0, .02, 1000


def prep(path, ycol="y"):
    df = pd.read_parquet(path, columns=["season", "game_pk", "at_bat_number", "pitcher", "batter", "stand", "p_throws",
                                        "balls", "strikes", "pitch_type", "b", *dict.fromkeys(["y", ycol])])
    df["y"] = df[ycol]
    df = df[df.balls.between(0, 3) & df.strikes.between(0, 2) & df.y.notna() & df.b.notna()].copy()
    df["type"] = df.pitch_type.map(FAM); df = df[df.type.notna()].reset_index(drop=True)
    df["opp"] = (df.stand != df.p_throws).astype(int)
    df["a"] = df.y - df.groupby(["season", "balls", "strikes", "opp"]).y.transform("mean")
    df["half"] = (df.game_pk % 2).astype(int)
    pa = df.groupby(["game_pk", "pitcher", "batter"]).at_bat_number.rank(method="dense").astype(int)
    df["pak"] = pa.clip(upper=3)
    return df


def mix_table(d, keys, k, prior=None):
    """Shrunk type shares per key cell from the OTHER half: rows (keys..., half, type) -> share (cross-fit)."""
    c = d.groupby(keys + ["half", "type"]).size().unstack("type", fill_value=0).reindex(columns=TYPES, fill_value=0)
    c = c.reset_index(); c["half"] = 1 - c["half"]                 # half h reads 1-h
    c = c.set_index(keys + ["half"])
    n = c.sum(1)
    if prior is None:
        return c.div(n.where(n > 0), axis=0)
    pr = prior.reindex(c.index.droplevel([l for l in c.index.names if l not in prior.index.names])).to_numpy()
    return pd.DataFrame((c.to_numpy() + k * pr) / (n.to_numpy()[:, None] + k), index=c.index, columns=TYPES)


def behavior(d):
    side = mix_table(d, ["pitcher", "opp"], 0)                                    # pitcher-season-side mix (t+1)
    node = mix_table(d, NODE, K_MU, side)
    pak = mix_table(d, NODE + ["pak"], K_MU, node)
    return node, pak


def values(t):
    """Season-t node x type means: b and a shrunk to b (k=300)."""
    g = t.groupby(NODE + ["type"]).agg(n=("a", "size"), a=("a", "mean"), b=("b", "mean"))
    g["as_"] = (g.n * g.a + K_Q * g.b) / (g.n + K_Q)
    return g.b.unstack("type").reindex(columns=TYPES), g.as_.unstack("type").reindex(columns=TYPES)


def tilt(mu, d, lam):
    dd = d.fillna(np.nan)
    m = mu.where(mu >= MIN_MU, 0.0)
    cen = (m * dd.fillna(0)).sum(1) / m.sum(1)
    dev = dd.sub(cen, axis=0).fillna(0.0)
    pi = m * np.exp(lam * dev)
    return pi.div(pi.sum(1), axis=0)


def shift_fb_bb(mu, amt=.05):
    m = mu.where(mu >= MIN_MU, 0.0); m = m.div(m.sum(1), axis=0)
    fb, bb = m[["FF", "SI"]].sum(1), m[["SL", "CU"]].sum(1)
    ok = (fb > amt) & (bb > 0)
    pi = m.copy()
    for t in ("FF", "SI"):
        pi.loc[ok, t] = m.loc[ok, t] * (1 - amt / fb[ok])
    for t in ("SL", "CU"):
        pi.loc[ok, t] = m.loc[ok, t] * (1 + amt / bb[ok])
    return pi


def save_os(mu_pak):
    m = mu_pak.where(mu_pak >= MIN_MU, 0.0); m = m.div(m.sum(1), axis=0)
    k = m.index.get_level_values("pak").to_numpy()
    f = np.where(k == 1, 0.7, np.where(k >= 3, 1.3, 1.0))
    ch = m["CH"].to_numpy(); new_ch = np.minimum(ch * f, 0.95); rest = 1 - ch
    scale = np.where(rest > 0, (1 - new_ch) / np.where(rest > 0, rest, 1), 1)
    pi = m.mul(scale, axis=0); pi["CH"] = new_ch
    return pi


def dr_rows(e, mu, pi, q):
    """Per-pitch DR value and IPS weight. e: eval pitches; mu/pi/q: frames indexed like mu (keys incl. half)."""
    keys = list(mu.index.names)
    idx = pd.MultiIndex.from_frame(e[keys])
    M, P, Q = (x.reindex(idx).to_numpy() for x in (mu, pi, q))
    col = e.type.map({t: i for i, t in enumerate(TYPES)}).to_numpy()
    r = np.arange(len(e))
    mu_t, pi_t, q_t = M[r, col], P[r, col], Q[r, col]
    ok = np.isfinite(mu_t) & (mu_t >= MIN_MU) & np.isfinite(P).all(1)
    w = np.clip(np.where(ok, pi_t / np.where(mu_t > 0, mu_t, 1), np.nan), 0, CLIP)
    # contrast with the identity policy (amendment): sum_x (pi - mu) q + (w - 1)(a - q_type)
    Mn = np.where(np.nan_to_num(M) >= MIN_MU, np.nan_to_num(M), 0.0); Mn = Mn / Mn.sum(1, keepdims=True)
    dm = np.nansum((np.nan_to_num(P) - Mn) * np.nan_to_num(Q), 1)
    g = dm + (w - 1) * (e.a.to_numpy() - np.nan_to_num(q_t))
    du = np.nan_to_num(P) - Mn
    cost = (du * (Mn + du)).sum(1)          # x s (runs/100 per unit share) -> usage-response cost per pitch
    return np.where(ok, g, np.nan), w, cost


def main() -> None:
    ap = argparse.ArgumentParser(); ap.add_argument("frame"); ap.add_argument("--window", choices=list(WIN), required=True)
    ap.add_argument("--level", choices=["mlb", "d1"], default="mlb"); ap.add_argument("--ycol", default="y")
    a_ = ap.parse_args()
    if a_.level == "d1": WIN.update(WIN_D1)
    df = prep(a_.frame, a_.ycol)
    rng = np.random.default_rng(0)
    out = []
    for t0, t1 in WIN[a_.window]:
        tr, ev = df[df.season == t0], df[df.season == t1].copy()
        vb, va = values(tr)
        mu, mu_pak = behavior(ev)
        # q-hat: other-half t+1 node x type mean of a shrunk to b
        g = ev.groupby(NODE + ["half", "type"]).agg(n=("a", "size"), a=("a", "mean"), b=("b", "mean")).reset_index()
        g["half"] = 1 - g["half"]
        g["q"] = (g.n * g.a + K_Q * g.b) / (g.n + K_Q)
        q = g.set_index(NODE + ["half", "type"]).q.unstack("type").reindex(columns=TYPES).reindex(mu.index)
        q = q.fillna(0.0)
        # season-t deviations aligned to mu's index (drop half for lookup)
        nodes = mu.index.droplevel("half")
        dB = vb.reindex(nodes).set_axis(mu.index); dA = va.reindex(nodes).set_axis(mu.index)
        perm = dB.apply(lambda r: pd.Series(rng.permutation(r.to_numpy()), index=TYPES), axis=1)
        pols = {}
        for lam in (10, 25):
            pols[f"P1 quality lam{lam}"] = (mu, tilt(mu, dB, lam))
            pols[f"P2 perf lam{lam}"] = (mu, tilt(mu, dA, lam))
            pols[f"P0 placebo lam{lam}"] = (mu, tilt(mu, perm, lam))
        pols["P3 FB->BB 5pt"] = (mu, shift_fb_bb(mu))
        pols["ID identity (must be 0)"] = (mu, mu.where(mu >= MIN_MU, 0.0).pipe(lambda m: m.div(m.sum(1), axis=0)))
        qp = q.reindex(mu_pak.index.droplevel("pak")).set_axis(mu_pak.index)
        for name, (m, p) in pols.items():
            dr, w, cost = dr_rows(ev, m, p, q)
            out.append(pd.DataFrame({"pair": t0, "policy": name, "pitcher": ev.pitcher.to_numpy(), "g": dr,
                                     "w": w, "a": ev.a.to_numpy(), "cost": cost}))
        ev_p = ev
        dr, w, cost = dr_rows(ev_p, mu_pak, save_os(mu_pak), qp)
        out.append(pd.DataFrame({"pair": t0, "policy": "P4 save-OS", "pitcher": ev_p.pitcher.to_numpy(),
                                 "g": dr, "w": w, "a": ev_p.a.to_numpy(), "cost": cost}))
        print(f"pair {t0}->{t1}: eval pitches {len(ev):,}", flush=True)
    res = pd.concat(out, ignore_index=True)
    res = res[np.isfinite(res.g)]
    print(f"\n== {a_.window}: DR gain, runs/100 pitches [95% CI]; IPS (self-normalized) gain; ESS share ==")
    for name, d in res.groupby("policy"):
        codes, uniq = pd.factorize(d.pitcher)
        gp = np.bincount(codes, d.g.to_numpy()); npp = np.bincount(codes)
        wa, ww = np.bincount(codes, d.w * d.a), np.bincount(codes, d.w); aa = np.bincount(codes, d.a)
        bs, bi = [], []
        for _ in range(REPS):
            c = rng.multinomial(len(uniq), np.full(len(uniq), 1 / len(uniq))).astype(float)
            bs.append(100 * (c @ gp) / (c @ npp)); bi.append(100 * ((c @ wa) / (c @ ww) - (c @ aa) / (c @ npp)))
        est = 100 * gp.sum() / npp.sum(); ips = 100 * (wa.sum() / ww.sum() - aa.sum() / npp.sum())
        ess = d.w.sum() ** 2 / (d.w ** 2).sum() / len(d)
        print(f"  {name:22s} DR {est:+.4f} [{np.percentile(bs, 2.5):+.4f}, {np.percentile(bs, 97.5):+.4f}]"
              f" | IPS {ips:+.4f} [{np.percentile(bi, 2.5):+.4f}, {np.percentile(bi, 97.5):+.4f}]"
              f" | ESS {ess:.2f} | per SP-season {est * 30:+.2f} runs"
              f" | usage-response cost s=.5: {-0.5 * d.cost.mean():+.4f}, s=1: {-1.0 * d.cost.mean():+.4f}"
              f"", flush=True)


if __name__ == "__main__":
    main()
