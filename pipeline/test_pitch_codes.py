"""The pitch-code standard (docs/formulas.md): every per-type key in the export is a site code.

    python pipeline/test_pitch_codes.py   (or pytest)
"""
import pandas as pd

import web_export as we


def test_fold_kc_cu_and_st():
    bt = pd.DataFrame({"id": [1, 1, 1, 2], "season": 2025, "pitch_type": ["CU", "KC", "FF", "ST"],
                       "n": [100, 300, 500, 400], "whiff": [10, 60, 50, 80], "velo": [80.0, 84.0, 95.0, 82.0],
                       "n_bip": [10, 30, 50, 40], "ev": [90.0, 86.0, 88.0, 85.0]})
    f = we.fold_to_site(bt, means=("velo", "ev"))
    assert not f.duplicated(["id", "season", "site"]).any()       # no duplicate labels
    cb = f[(f["id"] == 1) & (f["site"] == "CB")].iloc[0]
    assert cb["n"] == 400 and cb["whiff"] == 70 and cb["pitch_type"] == "KC"   # counts sum, largest-n code
    assert abs(cb["velo"] - 83.0) < 1e-9 and abs(cb["ev"] - 87.0) < 1e-9      # n- and n_bip-weighted
    assert f[f["id"] == 2]["site"].tolist() == ["SW"]


def test_xrv_and_prev_key_on_site(tmp_path, monkeypatch):
    res = tmp_path / "pipeline" / "results"
    res.mkdir(parents=True)
    pd.DataFrame({"mlbam": [1, 1, 2], "season": 2025, "pitch_type": ["CU", "KC", "ST"], "n": [20, 20, 40],
                  "xrv100": [1.0, 3.0, -1.0], "rv100": [0.0, 2.0, 0.0], "obs_xrv100": [0.0, 0.0, 0.0]}
                 ).to_csv(res / "xrv_v2_pitch_types.csv", index=False)
    pd.DataFrame({"pitcher": [1, 1, 2], "season": 2025, "pitch_type": ["CU", "KC", "ST"], "n": [150, 450, 200],
                  "prev_plus": [100.0, 120.0, 90.0], "prev_L": [None, 110.0, 95.0], "prev_R": [100.0, 120.0, 85.0]}
                 ).to_csv(res / "prevention_pitch_scores.csv", index=False)
    monkeypatch.setattr(we, "ROOT", tmp_path)
    x = we.xrv_by_site(floor=30)   # each code alone is under 30; the folded CB is 40
    assert x[(1, 2025, "CB")][0] == 2.0 and (2, 2025, "SW") in x and len(x) == 2
    p = we.prev_pitch_scores()
    assert p[(1, 2025, "CB")][0] == 115.0 and p[(1, 2025, "CB")][1] == 110.0 and (2, 2025, "SW") in p


if __name__ == "__main__":
    import pytest
    raise SystemExit(pytest.main([__file__, "-q"]))
