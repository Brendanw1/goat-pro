"""Post-hoc audit of T1b (RESULTS-MLB §43): is the BB/CH gain stuff or location? GOAT_LO=2020 python t1b_audit.py"""
import sys, numpy as np, pandas as pd
sys.path.insert(0, "."); import train_mlb as tm
from type_grades import SITE, type_table, MIN_N
from type_compare import wcorr
R = "results/crossfit_v2_%s_pt.csv"
df = tm.load_features()
df = df[df.pitch_type.isin(SITE)].assign(site=lambda d: d.pitch_type.map(SITE))
df = df[df.site.isin(["SL", "SW", "CB", "CH", "FS"])]
zone = df.plate_x.abs().le(0.83) & df.plate_z.between(1.5, 3.5)
sw = df.swing.eq(1)
df = df.assign(iz=zone, oz=~zone, wps_iz=df.whiff.where(sw & zone), wps_oz=df.whiff.where(sw & ~zone),
               chase=sw.astype(float).where(~zone), low=df.plate_z.lt(1.5).astype(float))
o = df.groupby(["pitcher", "season", "site"]).agg(
    n_sw=("swing", "sum"), wps=("whiff", lambda x: np.nan), n_iz=("wps_iz", "count"), n_oz=("wps_oz", "count"),
    wps_iz=("wps_iz", "mean"), wps_oz=("wps_oz", "mean"), chase=("chase", "mean"), zone=("iz", "mean"),
    pz=("plate_z", "mean"), low=("low", "mean"), rv100=("rv", lambda x: 100 * x.mean()), n=("rv", "size")).reset_index()
o["wps"] = df[sw].groupby(["pitcher", "season", "site"]).whiff.mean().reindex(pd.MultiIndex.from_frame(o[["pitcher","season","site"]])).to_numpy()
tb, _ = type_table(R % "base2020"); tc, _ = type_table(R % "t1b")
k = ["pitcher", "season", "site"]
g = tb[k + ["type_pred"]].merge(tc[k + ["type_pred"]], on=k, suffixes=("_b", "_c")).merge(o, on=k)
nxt = o.assign(season=o.season - 1).drop(columns=["n_sw"]).add_suffix("_nx").rename(
    columns={"pitcher_nx": "pitcher", "season_nx": "season", "site_nx": "site"})
j = g.merge(nxt, on=k)
j = j[(j.n_sw >= MIN_N)]
rng = np.random.default_rng(13)

def boot(d, y, xb, xc, n=1000):
    d = d[[xb, xc, y, "pitcher"]].dropna(); c, u = pd.factorize(d.pitcher)
    a, b, t = d[xb].to_numpy(), d[xc].to_numpy(), d[y].to_numpy(); out = []
    for _ in range(n):
        w = rng.multinomial(len(u), np.full(len(u), 1 / len(u)))[c]
        out.append(wcorr(b, t, w) - wcorr(a, t, w))
    return len(d), np.corrcoef(a, t)[0, 1], np.corrcoef(b, t)[0, 1], *np.percentile(out, [2.5, 97.5])

def resid(d, y, ctrl):
    X = np.column_stack([np.ones(len(d))] + [d[c] for c in ctrl]); return d[y] - X @ np.linalg.lstsq(X, d[y], rcond=None)[0]

rows = []
for site, d in list(j.groupby("site")) + [("ALL BB/CH", j)]:
    d = d.copy()
    for y, lab in [("wps_nx", "next whiff/swing"), ("wps_iz_nx", "next whiff/swing IN zone"),
                   ("wps_oz_nx", "next whiff/swing OUT of zone"), ("chase_nx", "next chase rate"),
                   ("rv100_nx", "next RV/100 (this pitch)"), ("pz_nx", "next mean height (leak)")]:
        dd = d if "iz" not in y else d[d.n_iz_nx >= 25]
        dd = dd if "oz" not in y else d[d.n_oz_nx >= 25]
        n, rb, rc, lo, hi = boot(dd, y, "type_pred_b", "type_pred_c")
        rows.append([site, lab, n, rb, rc, rc - rb, lo, hi])
    # gain net of the pitcher's own same-season location habits (height, zone%, low%)
    dd = d.dropna(subset=["wps_nx", "pz", "zone", "low"])
    for col in ("type_pred_b", "type_pred_c", "wps_nx"):
        dd[col + "_r"] = resid(dd, col, ["pz", "zone", "low"])
    n, rb, rc, lo, hi = boot(dd, "wps_nx_r", "type_pred_b_r", "type_pred_c_r")
    rows.append([site, "next whiff/swing, location habits partialled", n, rb, rc, rc - rb, lo, hi])
    rows.append([site, "same-season r(grade, mean height)", len(d), d.type_pred_b.corr(d.pz), d.type_pred_c.corr(d.pz),
                 d.type_pred_c.corr(d.pz) - d.type_pred_b.corr(d.pz), np.nan, np.nan])
r = pd.DataFrame(rows, columns=["site", "test", "n", "r_base", "r_tuned", "dr", "lo", "hi"])
pd.set_option("display.width", 200); print(r.round(3).to_string(index=False))
