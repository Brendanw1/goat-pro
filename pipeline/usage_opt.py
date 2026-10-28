"""Decay-aware usage optimizer and the edge tests (pipeline/PREREG-usage-opt.md).

    python pipeline/usage_opt.py --window selection        pairs 2023->24, 24->25, 25->26
    python pipeline/usage_opt.py --window confirmation     pairs 2021->22, 22->23 (once, after selection is written)

Unit = pitcher x season x platoon side. Values are count-adjusted run value per pitch, shrunk to type x platoon.
The decay curve is §59's (strict MLB bins), scaled by class. Read-only on the mart.
"""
import argparse
import sys

import numpy as np
import pandas as pd
from scipy.optimize import linprog, minimize

from paths import VT_ROOT  # noqa: E402
sys.path.insert(0, str(VT_ROOT))
from savant_mart import mart  # noqa: E402

FAM = """CASE WHEN pitch_type IN ('FF') THEN 'FF' WHEN pitch_type = 'SI' THEN 'SI' WHEN pitch_type = 'FC' THEN 'FC'
              WHEN pitch_type IN ('SL','ST','SV') THEN 'SL' WHEN pitch_type IN ('CU','KC','CS') THEN 'CU'
              WHEN pitch_type IN ('CH','FS','FO','SC') THEN 'CH' END"""
CLS = {"FF": "FB", "SI": "FB", "FC": "FB", "SL": "BB", "CU": "BB", "CH": "OS"}
SCALE = {"FB": .00161 / .00141, "BB": .00152 / .00141, "OS": .00412 / .00141}
F_S, F_V = [0, 1, 2, 3.5], [0, -.0024, -.0045, -.0053]
WIN = {"selection": [(2023, 2024), (2024, 2025), (2025, 2026)], "confirmation": [(2021, 2022), (2022, 2023)]}
SEL_YEARS = (2023, 2024, 2025, 2026)
MIN_UNIT, MIN_USE, BOUND, COMMON = 300, .03, .10, .85
WHIFF = "('swinging_strike','swinging_strike_blocked','foul_tip')"
SWING = "('swinging_strike','swinging_strike_blocked','foul_tip','foul','foul_bunt','hit_into_play','missed_bunt','bunt_foul_tip')"


def load():
    con = mart.connect()
    con.sql(f"""CREATE OR REPLACE TEMP TABLE q AS
      WITH p AS (SELECT game_year y, pitcher, (stand <> p_throws)::INT opp, {FAM} AS type, -delta_run_exp AS rv, balls, strikes,
                        description, events, zone, release_speed, pfx_x, pfx_z, release_spin_rate, game_pk, game_date, n_thruorder_pitcher tto
                 FROM pitches_all WHERE game_type = 'R' AND game_year BETWEEN 2021 AND 2026 AND delta_run_exp IS NOT NULL)
      SELECT *, rv - AVG(rv) OVER (PARTITION BY y, balls, strikes, opp) rva,
             (description IN {WHIFF})::INT wh, (description IN {SWING})::INT sw,
             (description IN {WHIFF} OR description = 'called_strike')::INT csw, (zone BETWEEN 1 AND 9)::INT iz
      FROM p WHERE type IS NOT NULL""")
    cells = con.sql("""SELECT y, pitcher, opp, type, COUNT(*) n, AVG(rva) v, VAR_SAMP(rva) var, SUM(wh) wh, SUM(sw) sw,
                         SUM(csw) csw, SUM(iz) iz, AVG(release_speed) velo, AVG(pfx_x) * 12 px, AVG(pfx_z) * 12 pz,
                         AVG(release_spin_rate) spin FROM q GROUP BY ALL""").df()
    units = con.sql("""SELECT y, pitcher, opp, COUNT(*) n, AVG(rva) v, SUM(wh) wh, SUM(sw) sw, SUM(csw) csw,
                         SUM((events IN ('strikeout','strikeout_double_play'))::INT) k, SUM((events IS NOT NULL)::INT) pa
                       FROM q GROUP BY ALL""").df()
    split = con.sql("""SELECT y, pitcher, opp, type, (month(game_date::DATE) < 5)::INT AS early, COUNT(*) n, AVG(rva) v,
                         AVG(release_speed) velo, AVG(pfx_x) * 12 px, AVG(pfx_z) * 12 pz, AVG(release_spin_rate) spin
                       FROM q GROUP BY ALL""").df()
    role = con.sql("""SELECT y, pitcher, CASE WHEN COUNT(*) / COUNT(DISTINCT game_pk) >= 50 THEN 'SP' ELSE 'RP' END AS role
                      FROM q GROUP BY ALL""").df()
    pa = con.sql("""SELECT r.role, LEAST(q.tto, 4) AS k, COUNT(*) AS pas FROM q JOIN (SELECT y, pitcher,
                      CASE WHEN COUNT(*) / COUNT(DISTINCT game_pk) >= 50 THEN 'SP' ELSE 'RP' END AS role FROM q GROUP BY ALL) r
                    USING (y, pitcher) WHERE q.events IS NOT NULL GROUP BY ALL""").df()
    ppa = con.sql("""SELECT r.role, COUNT(*)::DOUBLE / SUM((q.events IS NOT NULL)::INT) AS ppa FROM q JOIN (SELECT y, pitcher,
                      CASE WHEN COUNT(*) / COUNT(DISTINCT game_pk) >= 50 THEN 'SP' ELSE 'RP' END AS role FROM q GROUP BY ALL) r
                     USING (y, pitcher) GROUP BY ALL""").df()
    return cells, units, role, pa, ppa, split


def shrink(cells: pd.DataFrame) -> pd.DataFrame:
    """v_hat toward the type x platoon x season league mean; k = sigma^2 / tau^2 per type x platoon (selection years)."""
    lg = cells.groupby(["y", "type", "opp"]).apply(lambda g: np.average(g.v, weights=g.n), include_groups=False)
    cells["m"] = [lg[(y, t, o)] for y, t, o in zip(cells.y, cells.type, cells.opp)]
    ks = {}
    sel = cells[cells.y.isin(SEL_YEARS) & (cells.n >= 100)]
    for (t, o), g in sel.groupby(["type", "opp"]):
        s2 = np.average(g["var"], weights=g.n)
        tau2 = np.average((g.v - g.m) ** 2, weights=g.n) - np.average(g["var"] / g.n, weights=g.n)
        ks[(t, o)] = s2 / max(tau2, 1e-9)
    cells["k"] = [ks[(t, o)] for t, o in zip(cells.type, cells.opp)]
    cells["vh"] = (cells.n * cells.v + cells.k * cells.m) / (cells.n + cells.k)
    print("shrinkage k (pitches) by type x opp:", {f"{t}{'-opp' if o else '-same'}": int(k) for (t, o), k in ks.items()})
    return cells


def make_pen(pa: pd.DataFrame, ppa: pd.DataFrame):
    w = {r: (g.set_index("k").pas / g.pas.sum()).reindex([1, 2, 3, 4], fill_value=0).to_numpy() for r, g in pa.groupby("role")}
    P = dict(zip(ppa.role, ppa.ppa))
    print("role params:", {r: {"P": round(P[r], 2), "w": np.round(w[r], 3).tolist()} for r in w})

    def pen(u, cls, role):
        u = np.asarray(u, float)
        return SCALE[cls] * sum(w[role][k] * np.interp(u * P[role] * k, F_S, F_V) for k in range(4))
    return pen


def optimize(vh, u0, cls, role, pen, decay=True):
    """Max sum u * v(u) under |du| <= BOUND, u >= MIN_USE, sum fixed. Returns (u_opt, paper gain per pitch)."""
    lo = np.maximum(MIN_USE, u0 - BOUND); hi = np.minimum(1, u0 + BOUND); tot = u0.sum()
    if decay:
        v0 = vh - np.array([pen(u, c, role) for u, c in zip(u0, cls)])
        val = lambda u: float(np.sum(u * (v0 + np.array([pen(x, c, role) for x, c in zip(u, cls)]))))  # noqa: E731
        r = minimize(lambda u: -val(u), u0, method="SLSQP", bounds=list(zip(lo, hi)),
                     constraints=[{"type": "eq", "fun": lambda u: u.sum() - tot}], options={"ftol": 1e-12, "maxiter": 200})
        u = r.x if r.success else u0
        return u, val(u) - val(u0)
    r = linprog(-vh, A_eq=[np.ones(len(u0))], b_eq=[tot], bounds=list(zip(lo, hi)))
    return r.x, float((r.x - u0) @ vh)


def wls(y, X, w):
    X = np.column_stack([np.ones(len(y)), X]); W = np.sqrt(w)
    return np.linalg.lstsq(X * W[:, None], y * W, rcond=None)[0]


def boot(df, fn, reps=1000, seed=0):
    """Pitcher cluster bootstrap: each pitcher drawn once across all pairs (judge.cluster_w rule)."""
    rng = np.random.default_rng(seed); ids = df.pitcher.unique(); grp = {p: g for p, g in df.groupby("pitcher")}
    est = fn(df); bs = []
    for _ in range(reps):
        bs.append(fn(pd.concat([grp[p] for p in rng.choice(ids, len(ids))], ignore_index=True)))
    bs = np.array(bs)
    return est, np.percentile(bs, 2.5, axis=0), np.percentile(bs, 97.5, axis=0)


def fmt(e, lo, hi, nd=3):
    e, lo, hi = np.atleast_1d(e), np.atleast_1d(lo), np.atleast_1d(hi)
    return "; ".join(f"{a:+.{nd}f} [{b:+.{nd}f}, {c:+.{nd}f}]" for a, b, c in zip(e, lo, hi))


def itt(cells, split, pairs, pen):
    """Amendment: t+1 usage from March/April only; t+1 value (T2 dv, T3 R) from May 1 on only."""
    X2, XC = ["du", "v0", "dvelo", "dpx", "dpz", "dspin"], ["velo", "px", "pz", "spin"]
    e1 = split[split.early == 1]; l1 = split[split.early == 0]
    rows3, rows2, rows_al = [], [], []
    for t0, t1 in pairs:
        g0 = cells[cells.y == t0]
        E = e1[e1.y == t1].set_index(["pitcher", "opp", "type"]); L = l1[l1.y == t1].set_index(["pitcher", "opp", "type"])
        En = E.groupby(level=[0, 1]).n.sum(); Ln = L.groupby(level=[0, 1]).n.sum()
        Lv = L.assign(s=L.n * L.v).groupby(level=[0, 1]).s.sum() / Ln
        for (pid, opp), a0 in g0.groupby(["pitcher", "opp"]):
            if (pid, opp) not in En.index or (pid, opp) not in Ln.index or En[(pid, opp)] < 80 or Ln[(pid, opp)] < 200:
                continue
            a0 = a0.set_index("type")
            ue = E.loc[(pid, opp)].n / En[(pid, opp)]
            com = [t for t in a0.index if a0.u[t] >= MIN_USE and t in ue.index and ue[t] >= MIN_USE and (pid, opp, t) in L.index]
            if len(com) < 2 or a0.u[com].sum() < COMMON or ue[com].sum() < COMMON:
                continue
            u0 = (a0.u[com] / a0.u[com].sum()).to_numpy(); u1 = (ue[com] / ue[com].sum()).to_numpy()
            vh0 = a0.vh[com].to_numpy(); cl = [CLS[t] for t in com]; rl = a0.role.iloc[0]
            pv = lambda u: np.array([pen(x, c, rl) for x, c in zip(u, cl)])  # noqa: E731
            v0 = vh0 - pv(a0.u[com].to_numpy())
            Lc = L.loc[[(pid, opp, t) for t in com]]
            dph = {f: float(u1 @ (Lc[f].to_numpy() - a0[f][com].to_numpy())) for f in ("velo", "px", "pz", "spin")}
            dph["px"] = abs(dph["px"])
            n0, n1 = a0.N.iloc[0], Ln[(pid, opp)]
            # R: May-on value at the pitcher's May-on mix, vs season t
            v0u = np.average(a0.v, weights=a0.n)
            rows3.append(dict(pitcher=pid, role=rl, G_s=100 * (u1 - u0) @ vh0,
                              G_d=100 * (u1 @ (v0 + pv(u1)) - u0 @ (v0 + pv(u0))), R=100 * (Lv[(pid, opp)] - v0u),
                              w=n0 * n1 / (n0 + n1), **dph))
            ud = a0.u_d[com].to_numpy() if a0.u_d[com].notna().all() else None
            if ud is not None:
                rows_al.append(dict(pitcher=pid, opt=(ud / ud.sum() - u0), act=(u1 - u0)))
            for t, du in zip(com, u1 - u0):
                c0, c1 = a0.loc[t], L.loc[(pid, opp, t)]
                rows2.append(dict(pitcher=pid, cls=CLS[t], dv=100 * (c1.v - c0.v), du=du, v0=100 * c0.v,
                                  dvelo=c1.velo - c0.velo, dpx=c1.px - c0.px, dpz=c1.pz - c0.pz, dspin=(c1.spin - c0.spin) / 100,
                                  w=c0.n * c1.n / (c0.n + c1.n)))
    t3, t2 = pd.DataFrame(rows3), pd.DataFrame(rows2)
    al = pd.DataFrame(rows_al)
    def align(d):
        o, a_ = np.concatenate(d.opt.to_list()), np.concatenate(d.act.to_list())
        return np.array([np.corrcoef(o, a_)[0, 1], (o @ a_) / (o @ o)])
    print("descriptive: do pitchers move toward the optimum on their own? corr(opt shift, Apr shift), projection:",
          fmt(*boot(al, align, reps=300)))
    print(f"\n== ITT (amendment): {len(t3)} unit-pairs, {t3.pitcher.nunique()} pitchers; usage Mar/Apr t+1, value May+ t+1 ==")
    print("ITT T2 d(v/100)/d(usage):", fmt(*boot(t2, lambda d: wls(d.dv.to_numpy(), d[X2].to_numpy(), d.w.to_numpy())[1])),
          "| decay-implied about -0.5")
    f = lambda d, g: wls(d.R.to_numpy(), d[[g] + XC].to_numpy(), d.w.to_numpy())[1]  # noqa: E731
    for g in ("G_s", "G_d"):
        print(f"ITT T3 slope R on {g}:", fmt(*boot(t3, lambda d: f(d, g))), f"| sd({g}) {t3[g].std():.3f}")
    print("ITT T3 |slope_s-1| - |slope_d-1|:", fmt(*boot(t3, lambda d: abs(f(d, "G_s") - 1) - abs(f(d, "G_d") - 1))))
    for r_ in ("SP", "RP"):
        s = t3[t3.role == r_]
        print(f"    {r_} (n={len(s)}): slope G_d", fmt(*boot(s, lambda d: f(d, "G_d"), reps=300)))


def main() -> None:
    ap = argparse.ArgumentParser(); ap.add_argument("--window", choices=list(WIN), required=True); a = ap.parse_args()
    cells, units, role, pa, ppa, split = load()
    cells = shrink(cells); pen = make_pen(pa, ppa)
    cells = cells.merge(role, on=["y", "pitcher"])
    tot = cells.groupby(["y", "pitcher", "opp"]).n.transform("sum"); cells["u"] = cells.n / tot; cells["N"] = tot
    cells = cells[cells.N >= MIN_UNIT]
    pairs = WIN[a.window]; years = sorted({y for p in pairs for y in p})
    cells = cells[cells.y.isin(years)]

    # ---- T4 per unit-season: optimal vs actual (decay-aware and static)
    opt_rows, cell_opt = [], {}
    for (y, pid, opp), g in cells.groupby(["y", "pitcher", "opp"]):
        g = g[g.u >= MIN_USE]
        if len(g) < 2: continue
        u0, vh, cl, rl = g.u.to_numpy(), g.vh.to_numpy(), [CLS[t] for t in g.type], g.role.iloc[0]
        ud, gd = optimize(vh, u0, cl, rl, pen, True); us, gs = optimize(vh, u0, cl, rl, pen, False)
        mv = vh + u0 * np.array([(pen(u + 1e-4, c, rl) - pen(u, c, rl)) / 1e-4 for u, c in zip(u0, cl)])  # d(u v(u))/du at u0
        for t, a0, b, s, m, c in zip(g.type, u0, ud, us, mv, cl):
            cell_opt[(y, pid, opp, t)] = (b, s, m)
        csw_r = (g.csw / g.n).to_numpy(); wh_r = (g.wh / g.n).to_numpy(); iz_r = (g.iz / g.n).to_numpy()
        opt_rows.append(dict(y=y, pitcher=pid, opp=opp, role=rl, N=g.N.iloc[0], gain_d=100 * gd, gain_s=100 * gs,
                             d_csw=100 * (ud - u0) @ csw_r, d_whiff=100 * (ud - u0) @ wh_r, d_zone=100 * (ud - u0) @ iz_r))
    opt = pd.DataFrame(opt_rows)
    cells["u_d"] = [cell_opt.get(k, (np.nan,) * 3)[0] for k in zip(cells.y, cells.pitcher, cells.opp, cells.type)]
    cells["u_s"] = [cell_opt.get(k, (np.nan,) * 3)[1] for k in zip(cells.y, cells.pitcher, cells.opp, cells.type)]
    cells["mv"] = [cell_opt.get(k, (np.nan,) * 3)[2] for k in zip(cells.y, cells.pitcher, cells.opp, cells.type)]
    first = opt[opt.y < max(years)]
    print(f"\n== {a.window}: {len(first)} unit-seasons (t side of pairs) ==")
    print("T4 paper gain, runs/100 (median, p90): decay", first.gain_d.median().round(3), first.gain_d.quantile(.9).round(3),
          "| static", first.gain_s.median().round(3), first.gain_s.quantile(.9).round(3))
    ps = first.assign(rd=first.gain_d * first.N / 100).groupby(["y", "pitcher", "role"]).rd.sum().reset_index()
    print("T4 paper runs/season per pitcher (decay), median by role:", ps.groupby("role").rd.median().round(2).to_dict(),
          "p90:", ps.groupby("role").rd.quantile(.9).round(2).to_dict())
    print("T4 mix shift with optimum (pts): CSW", first.d_csw.mean().round(2), "whiff/pitch", first.d_whiff.mean().round(2),
          "zone", first.d_zone.mean().round(2))
    c1 = cells[cells.y < max(years)].dropna(subset=["u_d"])
    sh = c1.assign(cls=c1.type.map(CLS), du_d=c1.u_d - c1.u, du_s=c1.u_s - c1.u)
    print("T4 mean usage shift by type (pts) decay | static:\n", (100 * sh.groupby(["opp", "type"])[["du_d", "du_s"]].mean()).round(2).unstack(0).to_string())

    # ---- pairs
    rows_t3, rows_t2, rows_t1, rows_kl = [], [], [], []
    U = units.set_index(["y", "pitcher", "opp"]); C = cells.set_index(["y", "pitcher", "opp", "type"])
    for t0, t1 in pairs:
        g0 = cells[cells.y == t0]; keys = g0.groupby(["pitcher", "opp"]).size().index
        for pid, opp in keys:
            if (t1, pid, opp) not in U.index or (t0, pid, opp) not in U.index: continue
            a0 = g0[(g0.pitcher == pid) & (g0.opp == opp)].set_index("type")
            a1 = cells[(cells.y == t1) & (cells.pitcher == pid) & (cells.opp == opp)].set_index("type")
            if a1.empty or a0.N.iloc[0] < MIN_UNIT: continue
            com = [t for t in a0.index if a0.u[t] >= MIN_USE and t in a1.index and a1.u[t] >= MIN_USE]
            if len(com) < 2 or a0.u[com].sum() < COMMON or a1.u[com].sum() < COMMON: continue
            u0 = (a0.u[com] / a0.u[com].sum()).to_numpy(); u1 = (a1.u[com] / a1.u[com].sum()).to_numpy()
            vh0 = a0.vh[com].to_numpy(); cl = [CLS[t] for t in com]; rl = a0.role.iloc[0]
            v0 = vh0 - np.array([pen(u, c, rl) for u, c in zip(a0.u[com], cl)])
            vd = lambda u: np.array([pen(x, c, rl) for x, c in zip(u, cl)])  # noqa: E731
            g_s = 100 * (u1 - u0) @ vh0
            g_d = 100 * (u1 @ (v0 + vd(u1)) - u0 @ (v0 + vd(u0)))
            dphys = {f: float(u1 @ (a1[f][com].to_numpy() - a0[f][com].to_numpy())) for f in ("velo", "px", "pz", "spin")}
            dphys["px"] = abs(dphys["px"])
            n0, n1 = U.loc[(t0, pid, opp)].n, U.loc[(t1, pid, opp)].n
            r0, r1 = U.loc[(t0, pid, opp)], U.loc[(t1, pid, opp)]
            rows_t3.append(dict(pitcher=pid, pair=t0, opp=opp, role=rl, G_s=g_s, G_d=g_d, R=100 * (r1.v - r0.v),
                                dWh=100 * (r1.wh / r1.sw - r0.wh / r0.sw), dCSW=100 * (r1.csw / r1.n - r0.csw / r0.n),
                                dK=100 * (r1.k / r1.pa - r0.k / r0.pa), w=n0 * n1 / (n0 + n1), **dphys))
            m0 = a0.vh[com] - np.average(a0.vh[com], weights=a0.u[com]); m1 = a1.vh[com] - np.average(a1.vh[com], weights=a1.u[com])
            for t in com:
                c0, c1 = a0.loc[t], a1.loc[t]
                rows_t1.append(dict(pitcher=pid, d0=m0[t], d1=m1[t], w=c0.n * c1.n / (c0.n + c1.n)))
                rows_t2.append(dict(pitcher=pid, cls=CLS[t], dv=100 * (c1.v - c0.v), du=c1.u - c0.u, v0=100 * c0.v,
                                    dvelo=c1.velo - c0.velo, dpx=c1.px - c0.px, dpz=c1.pz - c0.pz,
                                    dspin=(c1.spin - c0.spin) / 100, u=c0.u, role=rl,
                                    slope_imp=100 * (pen(c0.u + .01, CLS[t], rl) - pen(c0.u, CLS[t], rl)) / .01,
                                    w=c0.n * c1.n / (c0.n + c1.n)))
            mv = a0.mv[com]
            if mv.notna().all() and mv.max() - mv.min() > 0:
                hi, lo = mv.idxmax(), mv.idxmin()
                rows_kl.append(dict(pitcher=pid, pred=100 * (a0.vh[hi] - a0.vh[lo]), real=100 * (a1.v[hi] - a1.v[lo]),
                                    hi=CLS[hi], lo=CLS[lo]))
    t3, t2, t1, kl = map(pd.DataFrame, (rows_t3, rows_t2, rows_t1, rows_kl))
    print(f"\npairs: {len(t3)} unit-pairs, {t3.pitcher.nunique()} pitchers; type rows {len(t2)}")
    e = boot(t1, lambda d: np.corrcoef(d.d0, d.d1)[0, 1] if len(d) > 2 else 0.0)
    print("T1 stability r (within-unit type deviations, shrunk, t vs t+1):", fmt(*e))
    X2 = ["du", "v0", "dvelo", "dpx", "dpz", "dspin"]
    e = boot(t2, lambda d: wls(d.dv.to_numpy(), d[X2].to_numpy(), d.w.to_numpy())[1])
    print("T2 adaptation: d(v per 100)/d(usage share) observed:", fmt(*e, nd=2),
          "| decay-implied mean:", round(float(np.average(t2.slope_imp, weights=t2.w)), 2))
    for c in ("FB", "BB", "OS"):
        s = t2[t2.cls == c]; e = boot(s, lambda d: wls(d.dv.to_numpy(), d[X2].to_numpy(), d.w.to_numpy())[1], reps=300)
        print(f"    {c}: observed {fmt(*e, nd=2)} | implied {np.average(s.slope_imp, weights=s.w):.2f}")
    XC = ["velo", "px", "pz", "spin"]
    def t3fit(d, g, y="R", ols=False):
        w = np.ones(len(d)) if ols else d.w.to_numpy()
        return wls(d[y].to_numpy(), d[[g] + XC].to_numpy(), w)[1]
    for g in ("G_s", "G_d"):
        print(f"T3 slope R on {g} (WLS):", fmt(*boot(t3, lambda d: t3fit(d, g))), "| OLS:", fmt(*boot(t3, lambda d: t3fit(d, g, ols=True), reps=300)),
              f"| sd({g}) {t3[g].std():.3f}, sd(R) {t3.R.std():.3f}")
    e = boot(t3, lambda d: abs(t3fit(d, "G_s") - 1) - abs(t3fit(d, "G_d") - 1))
    print("T3 |slope_s-1| - |slope_d-1| (>0 favours decay-aware):", fmt(*e))
    for role_ in ("SP", "RP"):
        s = t3[t3.role == role_]
        print(f"    {role_} (n={len(s)}): slope G_d", fmt(*boot(s, lambda d: t3fit(d, "G_d"), reps=300)))
    for y in ("dWh", "dCSW", "dK"):
        print(f"T5 {y} on G_d:", fmt(*boot(t3, lambda d: t3fit(d, "G_d", y), reps=300)))
    e = boot(kl, lambda d: np.array([d.pred.mean(), d.real.mean()]))
    print("T4 Kovash-Levitt: hi-vs-lo marginal-value class, value gap per 100 (predicted t, realized t+1):", fmt(*e))
    print("    hi/lo class pairs:", kl.groupby(["hi", "lo"]).size().sort_values(ascending=False).head(6).to_dict())
    print("    realized gap by hi/lo:", kl.groupby(["hi", "lo"]).real.mean().round(2).to_dict())
    itt(cells, split, pairs, pen)
    t3.to_parquet(f"/private/tmp/claude-501/-Users-brendanwaterval-Projects-vt-baseball/780ca8ef-242c-4bca-a0cc-c36c954467e1/scratchpad/usage_t3_{a.window}.parquet")
    opt.to_parquet(f"/private/tmp/claude-501/-Users-brendanwaterval-Projects-vt-baseball/780ca8ef-242c-4bca-a0cc-c36c954467e1/scratchpad/usage_opt_{a.window}.parquet")


if __name__ == "__main__":
    main()
