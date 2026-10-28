"""§81: Savant average fielder start positions -> cache/fielder_positions.parquet.

    python fielder_positions.py          # fetch 2020-26, positions 3-9 (~400 polite requests, ~10 min)
    python fielder_positions.py --demo   # self-check of the shifted-mean back-out

Source: baseballsavant.mlb.com/visuals/position_data (public). Feet; x < 0 toward third, y = depth from home.
shift=1 is all plays, shift=0 excludes shifted plays; firstBase=1 is the runner-on-first subset.
One row per fielder x season x pos x stand x r1 x shifted (0 standard, 1 shifted): n, x, y.
"""
import json
import sys
import time
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

OUT = Path(__file__).resolve().parent.parent / "cache" / "fielder_positions.parquet"
URL = ("https://baseballsavant.mlb.com/visuals/position_data?type=player&teamId=&firstBase={fb}&shift={sh}"
       "&batSide={bs}&season={s}&position={p}&attempts=1")


def get(**k) -> pd.DataFrame:
    req = urllib.request.Request(URL.format(**k), headers={"User-Agent": "Mozilla/5.0"})
    for i in range(4):
        try:
            rows = json.load(urllib.request.urlopen(req, timeout=60))["positionData"]
            break
        except Exception:
            time.sleep(5 * (i + 1))
    else:
        raise RuntimeError(f"failed: {k}")
    d = pd.DataFrame(rows)
    if d.empty:
        return pd.DataFrame(columns=["mlbam", "n", "x", "y"])
    d = d.assign(mlbam=d["fielder_id"].astype(int), n=d["n"].astype(float), x=d["avg_norm_start_pos_x"].astype(float),
                 y=d["avg_norm_start_pos_y"].astype(float))
    # traded players: one row per team -> n-weighted mean
    d = d.assign(wx=d["x"] * d["n"], wy=d["y"] * d["n"]).groupby("mlbam")[["n", "wx", "wy"]].sum()
    return pd.DataFrame({"mlbam": d.index, "n": d["n"].values, "x": (d["wx"] / d["n"]).values,
                         "y": (d["wy"] / d["n"]).values})


def shifted(all_, std):
    """Back out the shifted-play mean from all plays and the standard-only subset."""
    m = all_.merge(std, on="mlbam", how="left", suffixes=("", "_s")).fillna({"n_s": 0, "x_s": 0, "y_s": 0})
    k = m["n"] - m["n_s"]
    out = pd.DataFrame({"mlbam": m["mlbam"], "n": k, "x": (m["n"] * m["x"] - m["n_s"] * m["x_s"]) / k.where(k > 0),
                        "y": (m["n"] * m["y"] - m["n_s"] * m["y_s"]) / k.where(k > 0)})
    return out[k > 0]


def demo():
    a = pd.DataFrame({"mlbam": [1, 2], "n": [30.0, 10.0], "x": [20.0, 5.0], "y": [150.0, 150.0]})
    s = pd.DataFrame({"mlbam": [1, 2], "n": [10.0, 10.0], "x": [-10.0, 5.0], "y": [150.0, 150.0]})
    r = shifted(a, s)
    assert list(r["mlbam"]) == [1] and np.isclose(r["x"].iloc[0], 35.0) and r["n"].iloc[0] == 20, r
    print("demo ok")


def main():
    out = []
    for s in range(2020, 2027):
        for p in range(3, 10):
            for bs in "LR":
                for fb in (0, 1):
                    al, st = get(fb=fb, sh=1, bs=bs, s=s, p=p), get(fb=fb, sh=0, bs=bs, s=s, p=p)
                    time.sleep(1.0)
                    for sh, d in ((0, st), (1, shifted(al, st))):
                        out.append(d.assign(season=s, pos=p, stand=bs, r1=fb, shifted=sh))
        print(s, sum(len(d) for d in out), flush=True)
    pd.concat(out, ignore_index=True).to_parquet(OUT)
    print("wrote", OUT)


if __name__ == "__main__":
    demo() if "--demo" in sys.argv else main()
