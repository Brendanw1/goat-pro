"""Per-pitch topological pitch-class keys for MLB Statcast (public data only).

Reuses ~/Projects/pitch-classes-statcast (Maloof et al. 2026 reimplementation):
  l1  Level 1 class FB/BB/CH (or "unassigned") from a (hb, ivb, ds) persistence landscape
  l2  A2 Level-2 pitch name (FF SI FC SL ST CU CH FS), None where the pitch has no Level 2 group
Landscape and the A2 naming model are fit on 2023-24 pitchers outside the repo's fixed 25% pitcher
holdout; every pitch 2021-2026 is then assigned. Output: pipeline/cache/topo_keys.parquet.

Run: nice -n 10 python pipeline/topo_keys.py
"""
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path.home() / "Projects/pitch-classes-statcast/src"))
sys.path.insert(0, str(Path.home() / "Projects/vt_baseball/savant_mart"))
from pitchtopo import data, landscape, level2, tagger  # noqa: E402

OUT = Path(__file__).parent / "cache" / "topo_keys.parquet"
WORKERS = 4
SQL = """
SELECT game_pk, at_bat_number, pitch_number, CAST(pitcher AS BIGINT) AS pitcher, season, pitch_type,
       p_throws AS throws, release_speed AS speed, pfx_x * 12 AS pfx_x_in, pfx_z * 12 AS ivb,
       release_spin_rate AS spin, spin_axis AS axis, release_extension AS ext,
       release_pos_x AS rel_x, release_pos_z AS rel_z
FROM pitches_all
WHERE game_type = 'R' AND season BETWEEN 2021 AND 2026
  AND pitch_type IN ('FF','SI','FC','SL','CU','KC','SW','SV','ST','CH','FS','FO','EP')
  AND release_speed BETWEEN 55 AND 105 AND release_extension > 3
  AND pfx_z IS NOT NULL AND pfx_x IS NOT NULL AND release_spin_rate IS NOT NULL
  AND p_throws IN ('L','R') AND stand IN ('L','R') AND pitcher IS NOT NULL
"""


def load():
    import mart
    D = mart.connect().sql(SQL).df()
    D["pitch_type"] = D.pitch_type.replace({"SW": "ST"})  # Savant's sweeper code -> repo's ST
    for c in ("speed", "pfx_x_in", "ivb", "spin", "axis", "ext", "rel_x", "rel_z"):
        D[c] = pd.to_numeric(D[c], errors="coerce").astype(np.float64)
    D["game"] = D.game_pk.astype(np.int64)
    D = D.dropna(subset=["pitcher"])
    for y in (2023, 2024):  # same sign check the repo applies
        assert data.arm_side_sign(D[D.season == y]) == {"R": -1.0, "L": 1.0}, y
    R = (D.throws == "R").to_numpy()
    D["hb"] = np.where(R, -D.pfx_x_in, D.pfx_x_in)
    D["axis"] = np.where(R, D.axis, 360 - D.axis)
    D["rel_side"] = np.where(R, -D.rel_x, D.rel_x)
    D["rel_h"] = D.rel_z
    D["cls_sc"] = D.pitch_type.map(data.CLASS_OF)
    D["type_sc"] = D.pitch_type.map(data.TYPE_OF)
    D["test"] = D.pitcher.map(data.is_test_pitcher).astype(bool)
    D = data.add_relative_features(D)
    return D.drop(columns=["pfx_x_in", "rel_x", "rel_z", "throws"])


def build(D):
    X = D[["hb", "ivb", "ds"]].to_numpy(np.float64)
    tr = ((~D.test) & D.season.isin([2023, 2024])).to_numpy()
    L = landscape.build(X[tr])
    codes = L.classify(X)
    assert not (codes > 3).any(), f"extra Level 1 peak: {L.peaks}"
    l1 = np.array(landscape.CLASSES, object)[codes]
    fpop = {c: level2.league_density(D.loc[tr & (l1 == c), ["hb", "ivb"]].to_numpy()) for c in ("FB", "BB", "CH")}
    gid = level2.run(D, l1, fpop, workers=WORKERS)
    G = tagger.group_table(D, l1, gid, D.type_sc.to_numpy(dtype=object))
    tagger.LGB_GROUP["n_jobs"] = WORKERS
    Gtr = G[~G.pitcher.map(data.is_test_pitcher).to_numpy() & G.season.isin([2023, 2024]).to_numpy()]
    G["A2"], _ = tagger.name_a2(tagger.fit_a2(Gtr.reset_index(drop=True)), G)
    D["l1"], D["l2"] = l1, tagger.to_pitches(D, l1, gid, G, "A2")
    return D, L


def agreement(D, seasons):
    m = D.season.isin(seasons) & D.cls_sc.isin(["FB", "BB", "CH"])
    return 100 * (D.l1[m] == D.cls_sc[m]).mean()


def validate(D):
    v = {"l1_2023_25": agreement(D, [2023, 2024, 2025]), "l1_2021_22": agreement(D, [2021, 2022])}
    fc = D[(D.pitch_type == "FC") & D.season.between(2023, 2025)].l1.value_counts(normalize=True) * 100
    v["fc_pct_2023_25"] = fc.round(2).to_dict()
    t = D[D.test & (D.season == 2025) & D.l2.notna() & D.type_sc.isin(data.TYPES)]
    v["l2_vs_statcast_test_pitchers_2025"] = 100 * (t.l2 == t.type_sc).mean()
    v["l2_vs_statcast_all_2023_25"] = (lambda t: 100 * (t.l2 == t.type_sc).mean())(
        D[D.season.between(2023, 2025) & D.l2.notna() & D.type_sc.isin(data.TYPES)])
    return v


if __name__ == "__main__":
    t0 = time.time()
    D, L = build(load())
    print("peaks", L.peaks, "islands", L.islands)
    v = validate(D)
    print(v)
    OUT.parent.mkdir(exist_ok=True)
    D[["game_pk", "at_bat_number", "pitch_number", "pitcher", "season", "pitch_type", "l1", "l2"]].to_parquet(
        OUT, compression="zstd", index=False)
    print(f"{len(D)} rows -> {OUT} ({OUT.stat().st_size / 1e6:.1f} MB), {time.time() - t0:.0f}s")
    assert v["l1_2023_25"] >= 95 and v["l1_2021_22"] >= 95, "Level 1 agreement below 95%"
