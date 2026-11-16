"""scorecard.py: a grade that IS a baseline scores exactly zero against that baseline (alignment of grade, Marcel and
outcome rows across pairs). Needs cache/outcomes_2020.parquet; skipped without it."""
from pathlib import Path

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
