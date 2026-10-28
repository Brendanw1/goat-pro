"""Per-count minimax test (pipeline/PREREG-count-minimax.md), restart step 1.

    python pipeline/count_minimax.py FRAME.parquet --window selection|confirmation

FRAME is count_frame.py's output. Node = pitcher x season x count x batter side.
a = denoised realized value (y minus the league mean for season x count x side); b = Pitching+ model value.
"""
import argparse

import numpy as np
import pandas as pd

FAM = {"FF": "FF", "SI": "SI", "FC": "FC", "SL": "SL", "ST": "SL", "SV": "SL", "CU": "CU", "KC": "CU", "CS": "CU",
       "CH": "CH", "FS": "CH", "FO": "CH", "SC": "CH"}
WIN = {"selection": (2023, 2024, 2025, 2026), "confirmation": (2021, 2022)}
WIN_D1 = {"selection": (2024, 2025, 2026), "confirmation": (2022, 2023)}  # vt_baseball research/usage-efficiency-d1
GROUP = {(1, 0): "behind", (2, 0): "behind", (3, 0): "behind", (2, 1): "behind", (3, 1): "behind",
         (0, 0): "even", (1, 1): "even", (2, 2): "even", (3, 2): "even", (0, 1): "ahead", (0, 2): "ahead", (1, 2): "ahead"}
NODE = ["pitcher", "season", "balls", "strikes", "opp"]
REPS = 1000


def wcorr(x, y, w):
    mx, my = np.average(x, weights=w), np.average(y, weights=w)
    return np.sum(w * (x - mx) * (y - my)) / np.sqrt(np.sum(w * (x - mx) ** 2) * np.sum(w * (y - my) ** 2))


def wslope(y, x, w):
    mx, my = np.average(x, weights=w), np.average(y, weights=w)
    return np.sum(w * (x - mx) * (y - my)) / np.sum(w * (x - mx) ** 2)


def boot(df, fn):
    """Pitcher cluster bootstrap via multinomial weights (each pitcher drawn once across seasons)."""
    rng = np.random.default_rng(0)
    codes, uniq = pd.factorize(df.pitcher)
    est, bs = fn(df, np.ones(len(df))), []
    for _ in range(REPS):
        cnt = rng.multinomial(len(uniq), np.full(len(uniq), 1 / len(uniq)))
        m = cnt[codes].astype(float)
        if m.sum() == 0: continue
        bs.append(fn(df, m))
    bs = np.array(bs)
    return est, np.percentile(bs, 2.5, 0), np.percentile(bs, 97.5, 0), bs.std(0)


def fmt(r, nd=3):
    e, lo, hi, _ = (np.atleast_1d(x) for x in r)
    return "; ".join(f"{a:+.{nd}f} [{b:+.{nd}f}, {c:+.{nd}f}]" for a, b, c in zip(e, lo, hi))


def main() -> None:
    ap = argparse.ArgumentParser(); ap.add_argument("frame"); ap.add_argument("--window", choices=list(WIN), required=True)
    ap.add_argument("--level", choices=["mlb", "d1"], default="mlb"); ap.add_argument("--ycol", default="y")
    a_ = ap.parse_args()
    df = pd.read_parquet(a_.frame, columns=["season", "game_pk", "pitcher", "stand", "p_throws", "balls", "strikes",
                                            "pitch_type", "y", "b", "rv"])
    if a_.ycol != "y": df["y"] = df[a_.ycol]
    if a_.level == "d1": WIN.update(WIN_D1)
    df = df[df.season.isin(WIN[a_.window]) & df.y.notna() & df.b.notna() & df.balls.between(0, 3) & df.strikes.between(0, 2)]
    df["type"] = df.pitch_type.map(FAM); df = df[df.type.notna()]
    df["opp"] = (df.stand != df.p_throws).astype(int)
    df["a"] = df.y - df.groupby(["season", "balls", "strikes", "opp"]).y.transform("mean")
    df["half"] = (df.game_pk % 2).astype(int)
    print(f"{a_.window}: {len(df):,} pitches; corr(a, b) = {np.corrcoef(df.a, df.b)[0, 1]:.3f} (sanity: model value tracks outcomes)")

    # ---- cells: node x type x half and node x type
    ch = df.groupby(NODE + ["type", "half"]).agg(n=("a", "size"), a=("a", "mean"), b=("b", "mean")).reset_index()
    cf = df.groupby(NODE + ["type"]).agg(N=("a", "size")).reset_index()
    ch = ch.merge(cf, on=NODE + ["type"])
    ch = ch[ch.N >= 10]
    wide = ch.pivot_table(index=NODE + ["type"], columns="half", values=["n", "a", "b"]).dropna()
    wide = wide[(wide[("n", 0)] >= 3) & (wide[("n", 1)] >= 3)]
    w = wide.reset_index()
    w.columns = [c if isinstance(c, str) else (c[0] if c[1] == "" else f"{c[0]}{int(c[1])}") for c in w.columns]
    w = w[w.groupby(NODE).type.transform("size") >= 2].copy()
    for h in (0, 1):
        g = w.groupby(NODE)
        tot = g[f"n{h}"].transform("sum")
        w[f"u{h}"] = w[f"n{h}"] / tot
        w[f"da{h}"] = w[f"a{h}"] - (w[f"a{h}"] * w[f"n{h}"]).groupby([w[k] for k in NODE]).transform("sum") / tot
        w[f"dab{h}"] = (w[f"a{h}"] - w[f"b{h}"]) - ((w[f"a{h}"] - w[f"b{h}"]) * w[f"n{h}"]).groupby([w[k] for k in NODE]).transform("sum") / tot
        w[f"du{h}"] = w[f"u{h}"] - g[f"u{h}"].transform("mean")
    w["wt"] = w.n0 * w.n1 / (w.n0 + w.n1)
    print(f"nodes: {w.groupby(NODE).ngroups:,}; node-type rows {len(w):,}; pitchers {w.pitcher.nunique():,}")

    m1 = boot(w, lambda d, m: wcorr(d.da0, d.da1, d.wt * m))
    print("M1 persistence r of within-node deviations (a), half A vs half B:", fmt(m1))
    m2f = lambda d, m: 100 * (wslope(d.da1, d.du0, d.wt * m) + wslope(d.da0, d.du1, d.wt * m)) / 2  # noqa: E731
    m2 = boot(w, m2f)
    print(f"M2 slope: value dev (runs/100) on other-half usage-share dev: {fmt(m2, 2)} | MDE (2.8 SE) {2.8 * m2[3]:.2f}"
          " | equilibrium with §59 decay implies about +0.5")
    for grp in ("behind", "even", "ahead"):
        s = w[[GROUP[(b_, s_)] == grp for b_, s_ in zip(w.balls, w.strikes)]]
        print(f"    {grp}: M1 {fmt(boot(s, lambda d, m: wcorr(d.da0, d.da1, d.wt * m)))} | M2 {fmt(boot(s, m2f), 2)}")
    m4 = boot(w, lambda d, m: 100 * (wslope(d.dab1, d.du0, d.wt * m) + wslope(d.dab0, d.du1, d.wt * m)) / 2)
    print("M4 situational premium: (a-b) dev on other-half usage dev, runs/100:", fmt(m4, 2))

    # ---- M3: FB vs BB gap, season frame vs within node
    df["cls"] = df.type.map({"FF": "FB", "SI": "FB", "SL": "BB", "CU": "BB"})
    d3 = df[df.cls.notna()]

    def gap(keys):
        g = d3.groupby(keys + ["cls"]).agg(n=("a", "size"), a=("a", "mean"), b=("b", "mean")).unstack("cls").dropna()
        g = g[(g[("n", "FB")] >= 10) & (g[("n", "BB")] >= 10)]
        out = pd.DataFrame({"pitcher": g.index.get_level_values("pitcher"),
                            "ga": 100 * (g[("a", "FB")] - g[("a", "BB")]).to_numpy(),
                            "gb": 100 * (g[("b", "FB")] - g[("b", "BB")]).to_numpy(),
                            "w": (g[("n", "FB")] * g[("n", "BB")] / (g[("n", "FB")] + g[("n", "BB")])).to_numpy()})
        if "balls" in keys:
            out["grp"] = [GROUP[(b_, s_)] for b_, s_ in zip(g.index.get_level_values("balls"), g.index.get_level_values("strikes"))]
        return out
    gs, gn = gap(["pitcher", "season", "opp"]), gap(NODE)
    ga_s = boot(gs, lambda d, m: np.array([np.average(d.ga, weights=d.w * m), np.average(d.gb, weights=d.w * m)]))
    ga_n = boot(gn, lambda d, m: np.array([np.average(d.ga, weights=d.w * m), np.average(d.gb, weights=d.w * m)]))
    print("M3 FB-BB gap, runs/100 (realized a; model b), negative = BB better:")
    print("    (i) season frame:", fmt(ga_s, 2)); print("    (ii) within node:", fmt(ga_n, 2))
    # ratio with a joint bootstrap over pitchers present in both
    both = set(gs.pitcher) & set(gn.pitcher); gs2, gn2 = gs[gs.pitcher.isin(both)], gn[gn.pitcher.isin(both)]
    rng = np.random.default_rng(1); ids = np.array(sorted(both)); rat = []
    ci_s, ci_n = pd.factorize(gs2.pitcher)[0], None
    idx = {p: i for i, p in enumerate(ids)}; cs, cn = gs2.pitcher.map(idx).to_numpy(), gn2.pitcher.map(idx).to_numpy()
    for _ in range(REPS):
        cnt = rng.multinomial(len(ids), np.full(len(ids), 1 / len(ids))).astype(float)
        rat.append(np.average(gn2.ga, weights=gn2.w * cnt[cn]) / np.average(gs2.ga, weights=gs2.w * cnt[cs]))
    r0 = np.average(gn2.ga, weights=gn2.w) / np.average(gs2.ga, weights=gs2.w)
    print(f"    ratio (ii)/(i) on a: {r0:.2f} [{np.percentile(rat, 2.5):.2f}, {np.percentile(rat, 97.5):.2f}]  (burden explains it if < 0.5)")
    for grp in ("behind", "even", "ahead"):
        s = gn[gn.grp == grp]
        print(f"    (iii) {grp}:", fmt(boot(s, lambda d, m: np.array([np.average(d.ga, weights=d.w * m), np.average(d.gb, weights=d.w * m)])), 2),
              f"| FB share {d3[[GROUP[(b_, s_)] == grp for b_, s_ in zip(d3.balls, d3.strikes)]].cls.eq('FB').mean():.2f}")


if __name__ == "__main__":
    main()
