"""D-36: projection bands from measured out-of-sample misses, no model SD.

    GOAT_LO=2020 python proj_bands.py          # writes results/proj_bands.json
    GOAT_LO=2020 python proj_bands.py --demo   # self-check on the written file

Every MLB pair S -> S+1 (stack.frame, the pairs the shipped K+ / Prevention+ ridges are fit on) gets an
out-of-fold projection from 5-fold pitcher-grouped CV: each pitcher is projected by models that never
saw him. The residuals (actual S+1 minus projection) are binned by batters faced in S, the only sample
size known when the projection is made, and each bin's 10th and 90th residual percentiles become the
80% band: "80% of past pitchers projected from this many batters faced landed in this range".
K bands are in K/PA. Prevention bands are in next-season RV/100: the projection itself is
prev_mean + (Prevention+ - 100) x prev_sd / 10, inverting p7_export's scale (MLB pitcher-seasons with
>= 100 PA), and the band is that plus the bin's residual quantiles.
"""
import json
import sys
from pathlib import Path

import numpy as np
from sklearn.model_selection import GroupKFold

import kproj
import stack

PIPE = Path(__file__).resolve().parent
OUT = PIPE / "results" / "proj_bands.json"
BINS = [50, 150, 300, 500, 700, 10_000]


def oof(d):
    d = d.copy()
    d["kp_oof"] = np.nan
    d["pv_oof"] = np.nan
    for tr, te in GroupKFold(5).split(d, groups=d["mlbam"]):
        kp = kproj.model().fit(d.iloc[tr][kproj.X_COLS], d.iloc[tr]["k_next"])
        trk = d.iloc[tr].copy()
        trk["kplus"] = kp.predict(trk[kproj.X_COLS])  # in-sample within the fold, as frozen_models does
        tek = d.iloc[te].copy()
        tek["kplus"] = kp.predict(tek[kproj.X_COLS])
        pv = kproj.model().fit(trk[stack.S_COLS], trk["rv_next"])
        d.iloc[te, d.columns.get_loc("kp_oof")] = tek["kplus"].to_numpy()
        d.iloc[te, d.columns.get_loc("pv_oof")] = pv.predict(tek[stack.S_COLS])
    return d


def bands():
    d = oof(stack.frame())
    # Prevention+ scale, exactly as aaa_p7.scored / p7_export: fit on all pairs, SD over >= 100 PA
    tr = stack.frame()
    kp = kproj.model().fit(tr[kproj.X_COLS], tr["k_next"])
    tr["kplus"] = kp.predict(tr[kproj.X_COLS])
    pv = kproj.model().fit(tr[stack.S_COLS], tr["rv_next"])
    pv100 = pv.predict(tr.loc[tr["pa"] >= 100, stack.S_COLS])
    sd, mean = float(pv100.std()), float(pv100.mean())
    out = {"method": __doc__.split("\n\n")[1].replace("\n", " "), "n_pairs": int(len(d)),
           "seasons": sorted(int(s) for s in d["season"].unique()), "prev_sd": round(sd, 5), "prev_mean": round(mean, 5), "k": [], "prev": []}
    for lo, hi in zip(BINS[:-1], BINS[1:]):
        b = d[(d["pa"] >= lo) & (d["pa"] < hi)]
        if len(b) < 30:
            continue
        rk = b["k_next"] - b["kp_oof"]
        rp = b["rv_next"] - b["pv_oof"]
        out["k"].append({"lo": lo, "hi": hi, "n": int(len(b)), "q10": round(float(rk.quantile(.1)), 4),
                         "q90": round(float(rk.quantile(.9)), 4), "rmse": round(float(np.sqrt((rk ** 2).mean())), 4),
                         "cover80": round(float(((rk >= rk.quantile(.1)) & (rk <= rk.quantile(.9))).mean()), 3)})
        out["prev"].append({"lo": lo, "hi": hi, "n": int(len(b)), "q10": round(float(rp.quantile(.1)), 3),
                            "q90": round(float(rp.quantile(.9)), 3),
                            "q10_plus": round(10 * float(rp.quantile(.1)) / sd, 1),
                            "q90_plus": round(10 * float(rp.quantile(.9)) / sd, 1)})
    return out


def band_for(bands_doc: dict, kind: str, pa: float):
    """The (q10, q90) row for a pitcher-season with `pa` batters faced, or None below the first bin."""
    for b in bands_doc[kind]:
        if b["lo"] <= pa < b["hi"]:
            return b
    return bands_doc[kind][-1] if bands_doc[kind] and pa >= bands_doc[kind][-1]["lo"] else None


def demo():
    b = json.loads(OUT.read_text())
    ks = [r["q90"] - r["q10"] for r in b["k"]]
    assert all(r["q10"] < 0 < r["q90"] for r in b["k"]), "a K band does not straddle zero"
    assert ks[0] > ks[-1], "bands should narrow as the sample grows"
    assert band_for(b, "k", 40) is None and band_for(b, "k", 800)["lo"] == b["k"][-1]["lo"]
    print("demo ok", [(r["lo"], r["n"], r["q10"], r["q90"]) for r in b["k"]])


if __name__ == "__main__":
    if "--demo" in sys.argv:
        demo()
        sys.exit()
    res = bands()
    OUT.write_text(json.dumps(res, indent=1))
    print(json.dumps(res, indent=1))
