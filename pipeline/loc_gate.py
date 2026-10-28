"""Location+ v2 gate (docs/v3-stuff-proposal.md): does Stuff+ v3 + Location+ v2 recover what v2 Stuff+
covered on next-season CSW%? Ridge on same-season CSW%, pitcher folds, scored out of fold.

    python loc_gate.py
PASSES if the joint r is >= v2's r - .01 in every pair (point estimates) and Location+ v2 YoY >= .5.
"""
import zlib

import numpy as np
import pandas as pd

from arsenal import RES, ridge_oof
from paired_bootstrap import compare, outcomes

oc = outcomes()
g = {k: pd.read_csv(RES / f"crossfit_v2_{f}_grades.csv").rename(columns={"grade": k})
     for k, f in (("v3", "wps_dml"), ("loc", "loc_v2"))}
d = g["v3"].merge(g["loc"]).merge(oc, on=["mlbam", "season"])
folds = d["mlbam"].map(lambda p: zlib.crc32(str(p).encode()) % 4).to_numpy()
d["grade"] = ridge_oof(d[["v3", "loc"]].to_numpy(float), d["csw"].to_numpy(float), folds)
d[["mlbam", "season", "grade"]].to_csv(RES / "loc_gate_joint_grades.csv", index=False)
print("=== joint (v3 + Location+ v2) vs v2 base, read csw rows; Location+ alone vs v2 below")
compare(RES / "crossfit_v2_base_grades.csv", RES / "loc_gate_joint_grades.csv", oc)
print("=== Location+ v2 alone vs v2 base")
compare(RES / "crossfit_v2_base_grades.csv", RES / "crossfit_v2_loc_v2_grades.csv", oc)
w = d.pivot_table(index="mlbam", columns="season", values="loc")
print("Location+ v2 YoY", [round(w[s].corr(w[s + 1]), 3) for s in (2023, 2024, 2025)])
print("r(v3, loc) by season", d.groupby("season")[["v3", "loc"]].corr().xs("v3", level=1)["loc"].round(3).to_dict())
