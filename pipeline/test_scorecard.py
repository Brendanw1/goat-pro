"""scorecard.py: a grade that IS a baseline scores exactly zero against that baseline (alignment of grade, Marcel and
outcome rows across pairs). Needs cache/outcomes_2020.parquet; skipped without it."""
from pathlib import Path

import numpy as np
import pytest

import scorecard as sc

pytestmark = pytest.mark.skipif(not (Path(sc.PIPE.parent) / "cache" / "outcomes_2020.parquet").exists(),
                                reason="no outcomes cache")


def test_baselines_score_zero_against_themselves():
    sc.CACHE["oc"] = oc = sc.outcomes()
    sc.CACHE["mc"] = mc = sc.marcel(oc)
    q = oc.merge(mc, on=["mlbam", "season"], suffixes=("", "_m"))
    naive = sc.season_card(q[["mlbam", "season"]].assign(grade=q["k"]), sc.COMMON)
    assert naive["naive"]["k"]["est"] == 0
    assert abs(naive["desc"]["k"]["est"] - 1) < 1e-9
    m = sc.season_card(q[["mlbam", "season"]].assign(grade=q["k_m"]), sc.COMMON)
    assert m["marcel"]["k"]["est"] == 0
    assert abs(m["partial"]["k"]["est"]) < 1e-3   # partial r of Marcel given itself: 0 up to float noise


def test_weighting_changes_only_the_weights(monkeypatch):
    """Weighted (the default) with every pitcher at the same PA must reproduce the unweighted card."""
    oc = sc.outcomes()
    sc.CACHE["oc"], sc.CACHE["mc"] = oc, sc.marcel(oc)
    g = oc[["mlbam", "season"]].assign(grade=oc["k"])
    monkeypatch.setattr(sc, "WEIGHTED", False)
    base = sc.season_card(g, sc.COMMON)["pred"]["rv100"]["est"]
    monkeypatch.setattr(sc, "WEIGHTED", True)
    assert sc.season_card(g, sc.COMMON)["pred"]["rv100"]["est"] != base
    sc.CACHE["oc"] = oc.assign(pa=100)
    sc.CACHE["mc"] = sc.marcel(sc.CACHE["oc"])
    flat = sc.season_card(g, sc.COMMON)["pred"]["rv100"]["est"]
    monkeypatch.setattr(sc, "WEIGHTED", False)
    assert abs(flat - sc.season_card(g, sc.COMMON)["pred"]["rv100"]["est"]) < 1e-9


def test_projection_error_and_power():
    """An oracle grade (next K minus Marcel K) gets a large MSE skill and a calibration slope near 1 even though beta
    is fit on the other pairs; MDE on a 20% seal is sqrt(5) wider."""
    oc = sc.outcomes()
    mc = sc.marcel(oc)
    sc.CACHE["oc"], sc.CACHE["mc"] = oc, mc
    nxt = oc[["mlbam", "season", "k"]].assign(season=oc["season"] - 1)
    q = mc[["mlbam", "season", "k"]].merge(nxt, on=["mlbam", "season"], suffixes=("_m", ""))
    card = sc.season_card(q[["mlbam", "season"]].assign(grade=q["k"] - q["k_m"]), sc.COMMON)
    assert card["mse_skill"]["k"]["est"] > .9
    assert abs(card["cal_slope"]["k"]["est"] - 1) < .1
    assert card["ll_skill"]["k"]["est"] > 0
    p = card["partial"]["composite"]
    assert abs(p["mde_seal20"] - p["mde"] * 5 ** .5) < 1e-3


def test_shuffled_grade_rarely_passes():
    """Fable 1.7: a grade shuffled across pitchers passes 'adds to Marcel' or MSE skill in few of 10 runs."""
    res = sc.null_check(10, draws=300)
    assert res["false_pass_partial"] <= .2 and res["false_pass_mse_skill"] <= .2


def test_survivorship_weights():
    """Fable 1.6: IPW weights average 1 per season, keep at least half the effective N, and up-weight the kind of
    pitcher who tends not to return (fewer PA in S)."""
    oc = sc.outcomes()
    w, info = sc.ipw(oc)
    assert (w.groupby("season")["ipw"].mean() - 1).abs().max() < 1e-9
    assert info["ess_share"] >= .5 and 0 < info["return_rate"] < 1
    m = w.merge(oc, on=["mlbam", "season"])
    assert np.corrcoef(np.log(m["pa"]), m["ipw"])[0, 1] < 0


def test_extras_cover_the_population():
    """Fable 1.5: GB and xwOBAcon exist for nearly every pitcher-season at the judge floor."""
    oc = sc.outcomes()
    q = oc[oc["n_taken"] >= 50]
    assert q["gb"].notna().mean() > .99 and q["xwobacon"].notna().mean() > .99
