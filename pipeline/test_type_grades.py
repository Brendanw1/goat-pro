"""Per-type shrink (RESULTS-MLB §38): a type with few pitches sits near the pitcher's class mean."""
import pandas as pd

import train_mlb as tm


def test_shrink_pulls_small_types_to_class():
    d = pd.DataFrame({"pitcher": 1, "season": 2025, "pclass": "BB",
                      "pitch_type": ["SL"] * 300 + ["CU"] * 10, "p": [1.0] * 300 + [2.0] * 10})
    t = tm.shrunk_type_preds(d, "p").set_index("site")
    cls = d["p"].mean()
    assert abs(t.loc["CB", "shrunk"] - (10 * 2 + tm.TYPE_SHRINK * cls) / (10 + tm.TYPE_SHRINK)) < 1e-9
    assert t.loc["SL", "shrunk"] < t.loc["CB", "shrunk"] < 1.2
