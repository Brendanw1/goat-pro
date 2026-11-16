"""Model scorecard: one standard battery for every pitcher grade, so research models have baselines to compare to.

    python scorecard.py                       # every results/*_grades.csv + the naive / Marcel baselines
    python scorecard.py results/kplus_grades.csv [more.csv ...]
    python scorecard.py --pitches cache/pred_s4_bb.parquet --pred pred --label whiff --mask swing --name whiff_plus

Writes results/scorecards/<name>.json per model and rebuilds docs/model-scorecards.md (the leaderboard).

SELECTION SET. Every number here reads MLB 2020-2026, which is spent for pitcher models (docs/ml-hardening-plan.md
§2). A scorecard is a like-for-like comparison against the baselines, never a confirmation. It never opens the
sealed 2015-2019 cache or any 2027 data.

Season tier (input: mlbam, season, grade; higher = better for the pitcher). Population as judge.py (it reproduces judge.py's dr exactly): >= 50 taken
pitches in S+1, S as the grade file has it, pairs S -> S+1 for S in 2023..2025 (every file has them; files with 2020-22 also get
season_full over 2020..2025), pitchers resampled once across pairs (cluster_w).
  spread        SD and p10 / p90 of the grade
  reliability   year-to-year r of the grade (S vs S+1)
  descriptive   r(grade in S, outcome in S)
  predictive    r(grade in S, outcome in S+1); Spearman IC; worst pair; the 2025->26 (ABS zone) pair alone
  vs naive      r(grade, next) - r(same stat in S, next)
  vs Marcel     r(grade, next) - r(Marcel of that stat, next)
  incremental   partial r(grade, next | Marcel) with its CI (the test), and delta R^2 = partial r^2 x (1 - r(Marcel, next)^2)
                (shown, never tested: a squared statistic's bootstrap CI cannot cross 0)
  deciles       mean next outcome, top decile minus bottom decile, and monotonicity (Spearman over the 10 means)
Outcomes: K/PA, BB/PA (sign flipped: fewer is better), (K-BB)/PA, RV/100, xRV/100. Composite = mean over
K, K-BB, RV/100, xRV/100, the judge.py composite.
Marcel: 5/4/3 on S, S-1, S-2 weighted by PA + 1,200 PA of league average (kproj.py). RV/100 and xRV/100 are
PA-weighted too (pitch counts are not in the outcomes cache).

Pitch tier (a per-pitch probability against a 0/1 label): base rate, Brier and log loss with skill vs the base rate,
AUC, ECE (10 quantile bins), calibration intercept/slope (logistic of label on logit(pred)), the same per season
(drift), PSI of the prediction vs the train seasons, and split-half reliability of the pitcher-season mean
prediction vs the observed rate, with the stabilization n (pitches at which reliability = .5).
"""
import json
import sys
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")
PIPE = Path(__file__).resolve().parent
sys.path.insert(0, str(PIPE))
from judge import _r, cluster_w  # noqa: E402

RES, OUT = PIPE / "results", PIPE / "results" / "scorecards"
DOC = PIPE.parent / "docs" / "model-scorecards.md"
REG = json.loads((PIPE / "scorecard_registry.json").read_text())
OUTCOMES = {"k": 1, "bb": -1, "kbb": 1, "rv100": 1, "xrv100": 1}   # orientation: + = good for the pitcher
COMPOSITE = ("k", "kbb", "rv100", "xrv100")
COMMON = [(s, s + 1) for s in range(2023, 2026)]   # every grade file covers these: the like-for-like window
FULL = [(s, s + 1) for s in range(2020, 2026)]
DRAWS, SEED, R_MARCEL, W = 2000, 13, 1200, (5, 4, 3)
TRAIN = (2023, 2024)


def outcomes():
    oc = pd.read_parquet(PIPE.parent / "cache" / "outcomes_2020.parquet")
    oc["bb"] = oc["bb"] / oc["pa"]
    for o, sgn in OUTCOMES.items():
        oc[o] = sgn * oc[o]
    return oc


def marcel(oc):
    """Marcel of every outcome, per pitcher-season (kproj.py's recipe, applied to each rate)."""
    lg = {o: oc.groupby("season").apply(lambda d, o=o: np.average(d[o], weights=d["pa"])) for o in OUTCOMES}
    h = oc.set_index(["mlbam", "season"])
    out = {}
    for (m, s) in h.index:
        num = {o: R_MARCEL * lg[o][s] for o in OUTCOMES}
        den = float(R_MARCEL)
        for lag, w in enumerate(W):
            if (m, s - lag) in h.index:
                r = h.loc[(m, s - lag)]
                den += w * r["pa"]
                for o in OUTCOMES:
                    num[o] += w * r["pa"] * r[o]
        out[(m, s)] = {o: num[o] / den for o in OUTCOMES}
    return pd.DataFrame.from_dict(out, orient="index").rename_axis(["mlbam", "season"]).reset_index()


def pair_frames(g, oc, mc, pairs):
    q = oc[oc["n_taken"] >= 50]   # judge.py's population: the floor on the target season; S as the grade file has it
    cur = oc.merge(mc.add_prefix("m_").rename(columns={"m_mlbam": "mlbam", "m_season": "season"}), on=["mlbam", "season"])
    nxt = q[["mlbam", "season", *OUTCOMES]].rename(columns={o: f"n_{o}" for o in OUTCOMES})
    gn = g.rename(columns={"grade": "grade_next"})
    ds = []
    for s0, s1 in pairs:
        d = g[g["season"] == s0].merge(cur[cur["season"] == s0], on=["mlbam", "season"])
        d = d.merge(nxt[nxt["season"] == s1].drop(columns="season"), on="mlbam")
        d = d.merge(gn[gn["season"] == s1].drop(columns="season"), on="mlbam", how="left")
        ds.append(d.dropna(subset=["grade", *OUTCOMES, *[f"n_{o}" for o in OUTCOMES]]).reset_index(drop=True))
    return ds


def _b(x, w):
    return np.broadcast_to(np.asarray(x, float), w.shape)


def summ(v):
    """v: pooled (1 + draws) vector -> point, se, 95% CI."""
    return {"est": round(float(v[0]), 4), "se": round(float(v[1:].std()), 4),
            "ci": [round(float(x), 4) for x in np.percentile(v[1:], [2.5, 97.5])]}


def season_card(g, pairs):
    oc, mc = CACHE["oc"], CACHE["mc"]
    ds = pair_frames(g, oc, mc, pairs)
    ws = cluster_w([d["mlbam"] for d in ds], np.random.default_rng(SEED), DRAWS)
    acc = {k: [] for k in ("rel", "pred", "ic", "naive", "marcel", "partial", "dr2", "desc")}
    per_pair = {}
    for (s0, s1), d, w in zip(pairs, ds, ws):
        G = _b(d["grade"], w)
        rank = lambda x: _b(pd.Series(x).rank().to_numpy(), w)  # noqa: E731
        p, ic, nv, mv, pt, r2, de = {}, {}, {}, {}, {}, {}, {}
        for o in OUTCOMES:
            Y, M = _b(d[f"n_{o}"], w), _b(d[f"m_{o}"], w)
            ryg, rym, rgm = _r(G, Y, w), _r(M, Y, w), _r(G, M, w)
            p[o] = ryg
            ic[o] = _r(rank(d["grade"]), rank(d[f"n_{o}"]), w)
            nv[o] = ryg - _r(_b(d[o], w), Y, w)
            mv[o] = ryg - rym
            pr = (ryg - rym * rgm) / np.sqrt(np.clip((1 - rym ** 2) * (1 - rgm ** 2), 1e-12, None))
            pt[o] = pr
            r2[o] = pr ** 2 * (1 - rym ** 2)
            de[o] = _r(G, _b(d[o], w), w)
        both = d["grade_next"].notna().to_numpy()
        wr = w[:, both]
        acc["rel"].append(_r(_b(d.loc[both, "grade"], wr), _b(d.loc[both, "grade_next"], wr), wr))
        for k, v in (("pred", p), ("ic", ic), ("naive", nv), ("marcel", mv), ("partial", pt), ("dr2", r2), ("desc", de)):
            acc[k].append(v)
        per_pair[f"{s0}->{s1}"] = {"n": len(d), **{o: round(float(p[o][0]), 4) for o in OUTCOMES},
                                   "composite": round(float(np.mean([p[o][0] for o in COMPOSITE])), 4)}

    def pooled(key, o=None):
        if o is None:
            return np.mean(acc[key], axis=0)
        if o == "composite":
            return np.mean([np.mean([a[x] for a in acc[key]], axis=0) for x in COMPOSITE], axis=0)
        return np.mean([a[o] for a in acc[key]], axis=0)

    every = pd.concat(ds)
    deciles = {}
    for o in OUTCOMES:
        top_bot, mono = [], []
        for d in ds:
            q = pd.qcut(d["grade"].rank(method="first"), 10, labels=False)
            m = d.groupby(q)[f"n_{o}"].mean()
            top_bot.append(m.iloc[-1] - m.iloc[0])
            mono.append(pd.Series(m.to_numpy()).corr(pd.Series(range(10)), method="spearman"))
        deciles[o] = {"top_minus_bottom": round(float(np.mean(top_bot)), 4), "monotonicity": round(float(np.mean(mono)), 3)}
    g_all = g.merge(oc[oc["n_taken"] >= 50][["mlbam", "season"]], on=["mlbam", "season"])["grade"]
    last = pairs[-1]
    return {
        "window": f"{pairs[0][0]}->{pairs[-1][1]}", "n_pairs": int(sum(len(d) for d in ds)), "n_pitchers": int(every["mlbam"].nunique()),
        "spread": {"sd": round(float(g_all.std()), 3), "p10": round(float(g_all.quantile(.1)), 2),
                   "p90": round(float(g_all.quantile(.9)), 2)},
        "reliability_yoy": summ(pooled("rel")),
        **{k: {o: summ(pooled(k, o)) for o in [*OUTCOMES, "composite"]}
           for k in ("desc", "pred", "ic", "naive", "marcel", "partial", "dr2")},
        "worst_pair": min(per_pair.items(), key=lambda kv: kv[1]["composite"])[0],
        "abs_zone_pair": {f"{last[0]}->{last[1]}": per_pair[f"{last[0]}->{last[1]}"]},
        "pairs": per_pair, "deciles": deciles,
    }


def pitch_card(path, pred, label, mask):
    from sklearn.linear_model import LogisticRegression
    from sklearn.metrics import roc_auc_score
    cols = ["pitcher", "season", pred, label] + ([mask] if mask else [])
    d = pd.read_parquet(path, columns=cols)
    d = d[d["season"] <= 2026]                      # 3000+ = AAA/other levels in some caches
    if mask:
        d = d[d[mask] == 1]
    d = d.dropna(subset=[pred, label])
    p, y = d[pred].clip(1e-6, 1 - 1e-6).to_numpy(), d[label].astype(int).to_numpy()

    def block(p, y):
        base = y.mean()
        brier, brier0 = np.mean((p - y) ** 2), base * (1 - base)
        ll = -np.mean(y * np.log(p) + (1 - y) * np.log(1 - p))
        ll0 = -(base * np.log(base) + (1 - base) * np.log(1 - base))
        bins = pd.qcut(p, 10, labels=False, duplicates="drop")
        gp = pd.DataFrame({"p": p, "y": y, "b": bins}).groupby("b")
        ece = float((gp.size() / len(p) * (gp["p"].mean() - gp["y"].mean()).abs()).sum())
        lg = LogisticRegression(C=1e6).fit(np.log(p / (1 - p))[:, None], y)
        return {"n": int(len(y)), "base_rate": round(float(base), 4), "brier": round(float(brier), 5),
                "brier_skill": round(float(1 - brier / brier0), 4), "log_loss": round(float(ll), 5),
                "log_loss_skill": round(float(1 - ll / ll0), 4), "auc": round(float(roc_auc_score(y, p)), 4),
                "ece": round(ece, 4), "cal_intercept": round(float(lg.intercept_[0]), 3),
                "cal_slope": round(float(lg.coef_[0][0]), 3),
                "deciles": [[round(float(a), 4), round(float(b), 4)] for a, b in zip(gp["p"].mean(), gp["y"].mean())]}

    card = {"all": block(p, y), "by_season": {}}
    seasons = d["season"].to_numpy()
    edges = np.quantile(p[np.isin(seasons, TRAIN)], np.linspace(0, 1, 11))
    edges[0], edges[-1] = -np.inf, np.inf
    ref = np.histogram(p[np.isin(seasons, TRAIN)], edges)[0] / np.isin(seasons, TRAIN).sum()
    for s in sorted(np.unique(seasons)):
        m = seasons == s
        cur = np.histogram(p[m], edges)[0] / m.sum()
        psi = float(np.sum((cur - ref) * np.log(np.clip(cur, 1e-6, None) / np.clip(ref, 1e-6, None))))
        b = block(p[m], y[m])
        card["by_season"][int(s)] = {k: b[k] for k in ("n", "base_rate", "brier_skill", "log_loss_skill", "auc",
                                                       "ece", "cal_slope")} | {"psi_vs_train": round(psi, 4)}
    # split-half: random halves within pitcher-season, cells with >= 100 rows
    rng = np.random.default_rng(SEED)
    d = d.assign(h=rng.integers(0, 2, len(d)))
    cells = d.groupby(["pitcher", "season", "h"]).agg(mp=(pred, "mean"), my=(label, "mean"), n=(pred, "size")).unstack("h")
    cells = cells[(cells["n"][0] + cells["n"][1]) >= 100].dropna()
    half_n = float(((cells["n"][0] + cells["n"][1]) / 2).median())
    for name, c in (("model", "mp"), ("observed", "my")):
        rh = float(np.corrcoef(cells[c][0], cells[c][1])[0, 1])
        rho = rh / (half_n - (half_n - 1) * rh) if rh < 1 else 1.0     # per-row ICC from the half-size reliability
        card[f"split_half_{name}"] = {"r_half": round(rh, 4), "half_n": round(half_n, 1),
                                      "stabilization_n": round((1 - rho) / rho, 1) if rho > 0 else None}
    card["n_cells"] = int(len(cells))
    return card


def meta(name):
    return REG.get(name, {"label": name, "status": "research", "where": ""})


def leaderboard():
    cards = {p.stem: json.loads(p.read_text()) for p in sorted(OUT.glob("*.json"))}
    f = lambda v: f"{v['est']:+.3f} [{v['ci'][0]:+.3f}, {v['ci'][1]:+.3f}]"  # noqa: E731
    rows = []
    for n, c in cards.items():
        s = c.get("season")
        if not s:
            continue
        cls = ("baseline" if c["meta"]["status"] == "baseline"
               else "beats Marcel" if s["marcel"]["composite"]["ci"][0] > 0
               else "adds to Marcel" if s["partial"]["composite"]["ci"][0] > 0
               else "no forecast edge")
        rows.append((s["pred"]["composite"]["est"], f"| {c['meta']['label']} | {c['meta']['status']} | {c['meta']['where']} "
                     f"| {s['n_pairs']:,} | {s['spread']['sd']:.1f} | {s['reliability_yoy']['est']:.2f} "
                     f"| {s['desc']['composite']['est']:.3f} | {f(s['pred']['composite'])} | {s['pred']['k']['est']:.3f} "
                     f"| {s['pred']['rv100']['est']:.3f} | {f(s['marcel']['composite'])} "
                     f"| {f(s['partial']['composite'])} | {s['dr2']['composite']['est']:.3f} | {cls} |"))
    lines = [
        "# Model scorecards (MLB pitcher grades)",
        "",
        "Generated by `pipeline/scorecard.py`; do not edit by hand. **Selection set**: every number reads MLB 2020-26,",
        "which is spent for pitcher models, so this is a like-for-like comparison, not a confirmation. Pairs S -> S+1,",
        "2023-25 (the window every file covers), judge.py's population (>= 50 taken pitches in S+1), pitchers resampled once across pairs (2,000 draws).",
        "",
        "Composite = mean r over next-season K/PA, (K-BB)/PA, RV/100, xRV/100 (the judge.py composite).",
        "Class: *beats Marcel* = composite r minus the Marcel of each outcome, CI above 0. *adds to Marcel* = partial r",
        "with the next-season outcome given that outcome's Marcel (mean over the composite outcomes), CI above 0: it",
        "carries information Marcel lacks, even if it",
        "loses head to head (E13). *no forecast edge* = neither; it may still be a reliable descriptive grade (YoY r).",
        "These classes are evidence on spent data, not site roles: a role still needs its own pre-registered read.",
        "",
        "| Model | Status | Where | Pairs | SD | YoY r | Same-season r | Next-season r (composite) | Next K | Next RV/100 "
        "| vs Marcel | Partial r given Marcel | dR2 | Class |",
        "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
        *[r for _, r in sorted(rows, key=lambda t: -t[0])],
    ]
    pc = [(n, c) for n, c in cards.items() if c.get("pitch")]
    if pc:
        lines += ["", "## Pitch tier", "",
                  "| Model | n | Base rate | AUC | Brier skill | Log-loss skill | ECE | Cal slope | Max PSI | "
                  "Stabilizes (model) | Stabilizes (observed) |", "|---|---|---|---|---|---|---|---|---|---|---|"]
        for n, c in pc:
            a, b = c["pitch"]["all"], c["pitch"]
            psi = max(v["psi_vs_train"] for v in b["by_season"].values())
            lines.append(f"| {c['meta']['label']} | {a['n']:,} | {a['base_rate']:.3f} | {a['auc']:.3f} | "
                         f"{a['brier_skill']:.3f} | {a['log_loss_skill']:.3f} | {a['ece']:.4f} | {a['cal_slope']:.2f} | "
                         f"{psi:.3f} | {b['split_half_model']['stabilization_n']} | {b['split_half_observed']['stabilization_n']} |")
    lines += ["", "Per-model JSON (per pair, per outcome, deciles, per-season drift): `pipeline/results/scorecards/`.", ""]
    DOC.write_text("\n".join(lines))


CACHE = {}


def main(argv):
    OUT.mkdir(exist_ok=True)
    if "--pitches" in argv:
        a = lambda k: argv[argv.index(k) + 1] if k in argv else None  # noqa: E731
        name = a("--name")
        path = OUT / f"{name}.json"
        card = json.loads(path.read_text()) if path.exists() else {"meta": meta(name)}
        card["pitch"] = pitch_card(PIPE.parent / a("--pitches"), a("--pred"), a("--label"), a("--mask"))
        path.write_text(json.dumps(card, indent=1))
        leaderboard()
        return
    CACHE["oc"] = oc = outcomes()
    CACHE["mc"] = marcel(oc)
    files = [Path(x) for x in argv] or sorted(RES.glob("*_grades.csv"))
    todo = []
    for f in files:
        g = pd.read_csv(f)
        if {"mlbam", "season", "grade"} - set(g.columns):
            print(f"skip {f.name}: no mlbam/season/grade columns")
            continue
        todo.append((f.stem.removesuffix("_grades"), g[["mlbam", "season", "grade"]]))
    if not argv:   # the baselines, as if they were grades
        q = oc.merge(CACHE["mc"], on=["mlbam", "season"], suffixes=("", "_m"))
        for o in ("kbb", "k", "rv100"):
            todo.append((f"baseline_naive_{o}", q[["mlbam", "season"]].assign(grade=q[o])))
            todo.append((f"baseline_marcel_{o}", q[["mlbam", "season"]].assign(grade=q[f"{o}_m"])))
    for name, g in todo:
        g = g[g["season"] < 3000].dropna().drop_duplicates(["mlbam", "season"])   # 3000+ = other levels
        path = OUT / f"{name}.json"
        card = json.loads(path.read_text()) if path.exists() else {}
        card.update({"meta": meta(name), "season": season_card(g, COMMON)})
        if g["season"].min() <= 2020:   # also the full 2020-26 window, for the files that have it
            card["season_full"] = season_card(g, FULL)
        path.write_text(json.dumps(card, indent=1))
        print(f"{name:45} composite next r {card['season']['pred']['composite']['est']:+.3f}", flush=True)
    leaderboard()


if __name__ == "__main__":
    main(sys.argv[1:])
