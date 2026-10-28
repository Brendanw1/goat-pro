"""Buyback / decay test (pipeline/PREREG-buyback-decay.md): does within-game exposure to a pitch type cost it value,
and does exposure to the other types buy it back?

    python pipeline/buyback_decay.py --seasons 2023 2024 2025 2026        selection
    python pipeline/buyback_decay.py --seasons 2021 2022                  confirmation (once, after selection)
    ... --family                                                           same-family robustness

Exposure counts only earlier PAs of this pitcher to this batter in this game (S same type, O other types). The
placebo counts the later PAs (S_f, O_f). OLS with pitcher x type x season fixed effects absorbed by demeaning,
SEs clustered by pitcher. Read-only on the mart.
"""
import argparse
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, "/Users/brendanwaterval/Projects/vt_baseball")
from savant_mart import mart  # noqa: E402

FAMILY = """CASE WHEN pitch_type IN ('SL','ST','SV') THEN 'SL' WHEN pitch_type IN ('CU','KC','CS') THEN 'CU'
                 WHEN pitch_type IN ('CH','FS','FO','SC') THEN 'CH' ELSE pitch_type END"""
CLASS = {"FF": "FB", "SI": "FB", "FC": "FB", "SL": "BB", "ST": "BB", "SV": "BB", "CU": "BB", "KC": "BB", "CS": "BB",
         "CH": "OS", "FS": "OS", "FO": "OS", "SC": "OS"}
WHIFF = ("swinging_strike", "swinging_strike_blocked", "foul_tip")
SWING = WHIFF + ("foul", "foul_bunt", "hit_into_play", "missed_bunt", "bunt_foul_tip")


def mlb_base(seasons: list[int], family: bool) -> str:
    pt = FAMILY if family else "pitch_type"
    yrs = ",".join(map(str, seasons))
    return f"""
      SELECT game_year, game_pk, pitcher, batter, at_bat_number, pitch_number, pitch_type raw_type, {pt} pt,
             balls, strikes, zone, (stand <> p_throws)::INT platoon, n_thruorder_pitcher tto, -delta_run_exp y, description,
             ROW_NUMBER() OVER (PARTITION BY game_pk, pitcher ORDER BY at_bat_number, pitch_number) pcount
      FROM pitches_all
      WHERE game_type = 'R' AND game_year IN ({yrs}) AND delta_run_exp IS NOT NULL
        AND pitch_type IS NOT NULL AND pitch_type NOT IN ('PO','IN','EP','KN','UN','FA','AB')"""


def load(seasons: list[int], family: bool, con=None, base: str | None = None) -> pd.DataFrame:
    """Exposure counts over `base` (one row per pitch with the MLB column names); MLB mart by default."""
    q = f"""
    WITH p AS ({base or mlb_base(seasons, family)}),
    pt_pa AS (SELECT game_pk, pitcher, batter, at_bat_number, pt, COUNT(*) c FROM p GROUP BY ALL),
    tc AS (SELECT *, COALESCE(SUM(c) OVER (PARTITION BY game_pk, pitcher, batter, pt ORDER BY at_bat_number
                      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) s_before,
                  SUM(c) OVER (PARTITION BY game_pk, pitcher, batter, pt) s_game FROM pt_pa),
    gt AS (SELECT game_pk, pitcher, at_bat_number, pt, SUM(c) OVER (PARTITION BY game_pk, pitcher, pt ORDER BY at_bat_number
                      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) g_same FROM
             (SELECT game_pk, pitcher, at_bat_number, pt, SUM(c) c FROM pt_pa GROUP BY ALL)),
    pa AS (SELECT game_pk, pitcher, batter, at_bat_number, SUM(c) tot FROM pt_pa GROUP BY ALL),
    pc AS (SELECT *, COALESCE(SUM(tot) OVER (PARTITION BY game_pk, pitcher, batter ORDER BY at_bat_number
                      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) t_before,
                  SUM(tot) OVER (PARTITION BY game_pk, pitcher, batter) t_game,
                  ROW_NUMBER() OVER (PARTITION BY game_pk, pitcher, batter ORDER BY at_bat_number) pa_idx FROM pa)
    SELECT p.*, pc.pa_idx, COALESCE(gt.g_same, 0) - tc.s_before G, (p.pcount - p.pitch_number) - pc.t_before - (COALESCE(gt.g_same, 0) - tc.s_before) GO,
           tc.s_before S, pc.t_before - tc.s_before O,
           tc.s_game - tc.s_before - tc.c S_f, (pc.t_game - pc.t_before - pc.tot) - (tc.s_game - tc.s_before - tc.c) O_f
    FROM p JOIN tc USING (game_pk, pitcher, batter, at_bat_number, pt) JOIN pc USING (game_pk, pitcher, batter, at_bat_number)
    LEFT JOIN gt USING (game_pk, pitcher, at_bat_number, pt)
    WHERE pc.pa_idx >= 2"""
    return (con or mart.connect()).sql(q).df()


def fit(df: pd.DataFrame, y: str, strict: bool = False, bins: bool = False, ctrl: tuple = ()) -> dict:
    """OLS with FE demeaning; returns coefs + pitcher-clustered covariance.
    strict: pitcher x type x game FE + batter x season FE (alternating projections), per the amendment (R1)."""
    df = df.dropna(subset=[y])
    fes = ([df.groupby(["pitcher", "pt", "game_pk"], sort=False).ngroup().to_numpy(),
            df.groupby(["batter", "game_year"], sort=False).ngroup().to_numpy()] if strict
           else [df.groupby(["pitcher", "pt", "game_year"], sort=False).ngroup().to_numpy()])
    expo = df[["O", "S_f", "O_f"] + [c for c in ("G", "GO") if c in ctrl]].astype(float)
    ctrl = tuple(c for c in ctrl if c not in ("G", "GO"))
    if bins:   # R2: S binned (0 is the reference)
        expo = pd.concat([expo, pd.get_dummies(pd.cut(df.S, [-1, 0, 1, 2, 4, 999], labels=["0", "1", "2", "3-4", "5+"]),
                                               prefix="S", drop_first=True, dtype=float)], axis=1)
    else:
        expo = pd.concat([df[["S"]].astype(float), expo], axis=1)
    X = pd.concat([
        expo, df[["platoon"]].astype(float),
        (df.pcount / 100.0).rename("pc"), (df.pcount / 100.0).pow(2).rename("pc2"),
        pd.get_dummies(df.balls.astype(str) + "-" + df.strikes.astype(str), prefix="c", drop_first=True, dtype=float),
        pd.get_dummies(df.tto.clip(upper=4), prefix="tto", drop_first=True, dtype=float),
        *[pd.get_dummies(df[c].astype(str), prefix=c, drop_first=True, dtype=float) for c in ctrl],
    ], axis=1)
    names = list(X.columns)
    M = np.column_stack([X.to_numpy(float), df[y].to_numpy(float)])
    cnts = [np.bincount(fe) for fe in fes]
    for _ in range(12 if strict else 1):      # absorb FE: subtract group means (alternating projections when two)
        for fe, cnt in zip(fes, cnts):
            M -= (np.stack([np.bincount(fe, M[:, j]) for j in range(M.shape[1])], 1) / cnt[:, None])[fe]
    Xd, yd = M[:, :-1], M[:, -1]
    keep = Xd.std(0) > 0
    Xd, names = Xd[:, keep], [n for n, k in zip(names, keep) if k]
    XtX_inv = np.linalg.inv(Xd.T @ Xd)
    b = XtX_inv @ Xd.T @ yd
    u = yd - Xd @ b
    g = pd.factorize(df.pitcher)[0]
    S = np.zeros((Xd.shape[1], Xd.shape[1]))
    sc = np.zeros((g.max() + 1, Xd.shape[1]))
    np.add.at(sc, g, Xd * u[:, None])
    S = sc.T @ sc
    V = XtX_inv @ S @ XtX_inv
    ix = {n: i for i, n in enumerate(names)}
    return {"b": b, "V": V, "ix": ix, "n": len(df), "pitchers": g.max() + 1}


def contrast(r: dict, w: dict) -> tuple[float, float]:
    c = np.zeros(len(r["b"]))
    for k, v in w.items():
        c[r["ix"][k]] = v
    return float(c @ r["b"]), float(np.sqrt(c @ r["V"] @ c))


def report(r: dict, label: str, scale: float = 1.0) -> None:
    out = []
    for name, w in (("bS", {"S": 1}), ("bO", {"O": 1}), ("D = bO-bS", {"O": 1, "S": -1}),
                    ("Df (placebo)", {"O_f": 1, "S_f": -1}), ("D-Df", {"O": 1, "S": -1, "O_f": -1, "S_f": 1})):
        est, se = contrast(r, w)
        out.append(f"{name} {est * scale:+.5f} [{(est - 1.96 * se) * scale:+.5f}, {(est + 1.96 * se) * scale:+.5f}]")
    print(f"{label} (n={r['n']:,}, pitchers={r['pitchers']}):\n    " + "\n    ".join(out), flush=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seasons", type=int, nargs="+", required=True)
    ap.add_argument("--family", action="store_true")
    ap.add_argument("--strict", action="store_true", help="R1: pitcher x type x game + batter x season FE")
    ap.add_argument("--bins", action="store_true", help="R2: binned S dose-response")
    ap.add_argument("--loc", action="store_true", help="mediator: add Statcast zone (1-14) dummies")
    ap.add_argument("--lineup", action="store_true", help="add exposure of OTHER batters (G same type, GO other)")
    a = ap.parse_args()
    df = load(a.seasons, a.family)
    df["cls"] = df.raw_type.map(CLASS)
    print(f"seasons {a.seasons} {'family' if a.family else 'pitch_type'}: {len(df):,} pitches from 2nd+ PA; "
          f"mean S {df.S.mean():.2f}, O {df.O.mean():.2f}", flush=True)
    if a.bins:
        r = fit(df, "y", a.strict, bins=True)
        for k in ("S_1", "S_2", "S_3-4", "S_5+"):
            est, se = contrast(r, {k: 1})
            print(f"  S bin {k} vs 0: {est:+.5f} [{est - 1.96 * se:+.5f}, {est + 1.96 * se:+.5f}]")
        est, se = contrast(r, {"O": 1}); print(f"  bO {est:+.5f} [{est - 1.96 * se:+.5f}, {est + 1.96 * se:+.5f}]")
        return
    if a.lineup:
        r = fit(df, "y", a.strict, ctrl=("G", "GO"))
        report(r, "LINEUP: run value with other batters' exposure")
        for name, w in (("bG", {"G": 1}), ("bGO", {"GO": 1}), ("DG = bGO-bG", {"GO": 1, "G": -1})):
            est, se = contrast(r, w); print(f"    {name} {est:+.5f} [{est - 1.96 * se:+.5f}, {est + 1.96 * se:+.5f}]")
        return
    if a.loc:
        report(fit(df.dropna(subset=["zone"]), "y", a.strict, ctrl=("zone",)), "MEDIATOR: run value | zone")
        return
    report(fit(df, "y", a.strict), "PRIMARY run value per pitch (runs)")
    sw = df[df.description.isin(SWING)].copy()
    sw["whiff"] = sw.description.isin(WHIFF).astype(float)
    report(fit(sw, "whiff", a.strict), "secondary whiff per swing")
    for c in ("FB", "BB", "OS"):
        report(fit(df[df.cls == c], "y", a.strict), f"descriptive: target {c}, run value")


if __name__ == "__main__":
    main()
