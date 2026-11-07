"""Pitch Quality (PREREG-pitch-quality.md): the gate math self-check and the export's tier handling."""
import pandas as pd

import pitch_quality as pq
import web_export as we


def test_gate_math():
    pq.demo()


def test_export_tiers(tmp_path, monkeypatch):
    (tmp_path / "pipeline" / "results").mkdir(parents=True)
    pd.DataFrame([
        {"level": "mlb", "pitcher": 1, "season": 2026, "site": "SL", "grade": 65, "tier": "full", "claim": "describes",
         "need": 120, "grade_mlb": None, "grade_LHH": 60, "tier_LHH": "full", "grade_RHH": None, "tier_RHH": None},
        {"level": "mlb", "pitcher": 2, "season": 2026, "site": "SL", "grade": 40, "tier": "low", "claim": "describes",
         "need": 120, "grade_mlb": None, "grade_LHH": None, "tier_LHH": None, "grade_RHH": None, "tier_RHH": None},
        {"level": "aaa", "pitcher": 3, "season": 2026, "site": "FF", "grade": 55, "tier": "provisional",
         "claim": "limited data", "need": 260, "grade_mlb": 45, "grade_LHH": None, "tier_LHH": None,
         "grade_RHH": None, "tier_RHH": None},
    ]).to_csv(tmp_path / "pipeline" / "results" / "pitch_quality_units.csv", index=False)
    monkeypatch.setattr(we, "ROOT", tmp_path)
    m, a = we.pitch_quality("mlb"), we.pitch_quality("aaa")
    assert m[(1, 2026, "SL")]["pitchQuality"] == 65 and m[(1, 2026, "SL")]["pitchQualityVsLHH"] == 60
    assert m[(1, 2026, "SL")]["pitchQualityVsRHH"] is None and m[(1, 2026, "SL")]["board"]
    assert not m[(2, 2026, "SL")]["board"]  # muted low tier: profiles only
    assert (3, 2026, "FF") not in m and a[(3, 2026, "FF")]["pitchQualityMlb"] == 45
