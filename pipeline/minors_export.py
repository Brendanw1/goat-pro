"""minors_export.py — the /minors stat-line boards (Rookie through AAA) from data/milb (milb_lines.py).

    python pipeline/minors_export.py   -> data/export/web/minors/{pitchers,hitters}-{season}.json

One row per player x season x level (teams at the same level combined). Box-score rates only:
no pitch tracking exists below AAA (AAA's Statcast pages come from web_export.py --level aaa).
FIP's constant is per level and season (lgERA minus the level's raw FIP), the site's MLB rule.
Season age is age on June 30 of that season.
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "data" / "milb"
OUT = ROOT / "data" / "export" / "web" / "minors"
LEVEL_ORDER = ["AAA", "AA", "A+", "A", "ROK"]


def season_age(birth: pd.Series, season: pd.Series) -> pd.Series:
    b = pd.to_datetime(birth, errors="coerce")
    ref = pd.to_datetime(season.astype(str) + "-06-30")
    return ((ref - b).dt.days / 365.25).round(1)


def combine(df: pd.DataFrame, counts: list[str]) -> pd.DataFrame:
    """Sum a player's teams within one season x level; team becomes 'N teams'."""
    key = ["mlbam_id", "season", "level"]
    agg = df.groupby(key, sort=False)[counts].sum()
    first = df.groupby(key, sort=False)[["player_name", "birth_date", "bats", "throws", "position"]].first()
    teams = df.groupby(key, sort=False)["team_name"].agg(lambda t: t.iloc[0] if t.nunique() == 1 else f"{t.nunique()} teams")
    return agg.join(first).join(teams).reset_index()


def r(x, nd=1):
    return None if x is None or not np.isfinite(x) else round(float(x), nd)


def pitchers(df: pd.DataFrame) -> pd.DataFrame:
    df = combine(df, ["OUTS", "BF", "H", "HR", "BB", "IBB", "HBP", "SO", "GO", "AO", "ER", "R", "G", "GS"])
    ip = df["OUTS"] / 3
    raw = (13 * df["HR"] + 3 * (df["BB"] + df["HBP"]) - 2 * df["SO"])
    lg = df.groupby(["season", "level"])[["ER", "OUTS", "HR", "BB", "HBP", "SO"]].sum()
    lg_ip = lg["OUTS"] / 3
    cfip = 9 * lg["ER"] / lg_ip - (13 * lg["HR"] + 3 * (lg["BB"] + lg["HBP"]) - 2 * lg["SO"]) / lg_ip
    df["cfip"] = [cfip[(s, l)] for s, l in zip(df["season"], df["level"])]
    with np.errstate(divide="ignore", invalid="ignore"):
        df["ip"] = (df["OUTS"] // 3) + (df["OUTS"] % 3) / 10  # baseball notation, 45.2
        df["era"] = 9 * df["ER"] / ip
        df["fip"] = raw / ip + df["cfip"]
        df["whip"] = (df["H"] + df["BB"]) / ip
        df["kPct"] = 100 * df["SO"] / df["BF"]
        df["bbPct"] = 100 * df["BB"] / df["BF"]
        df["hr9"] = 9 * df["HR"] / ip
        df["gbPct"] = 100 * df["GO"] / (df["GO"] + df["AO"])
    return df


def hitters(df: pd.DataFrame) -> pd.DataFrame:
    df = combine(df, ["PA", "AB", "H", "2B", "3B", "HR", "BB", "IBB", "HBP", "SF", "SH", "SO", "SB", "CS", "GIDP", "G"])
    tb = df["H"] + df["2B"] + 2 * df["3B"] + 3 * df["HR"]
    with np.errstate(divide="ignore", invalid="ignore"):
        df["avg"] = df["H"] / df["AB"]
        df["obp"] = (df["H"] + df["BB"] + df["HBP"]) / (df["AB"] + df["BB"] + df["HBP"] + df["SF"])
        df["slg"] = tb / df["AB"]
        df["iso"] = df["slg"] - df["avg"]
        df["kPct"] = 100 * df["SO"] / df["PA"]
        df["bbPct"] = 100 * df["BB"] / df["PA"]
    return df


def rows_p(df: pd.DataFrame) -> list[dict]:
    return [{"id": str(t.mlbam_id), "name": t.player_name, "level": t.level, "team": t.team_name, "age": r(t.age),
             "throws": t.throws, "g": int(t.G), "gs": int(t.GS), "ip": r(t.ip), "bf": int(t.BF),
             "era": r(t.era, 2), "fip": r(t.fip, 2), "whip": r(t.whip, 2), "kPct": r(t.kPct), "bbPct": r(t.bbPct),
             "kBbPct": r(t.kPct - t.bbPct), "hr9": r(t.hr9, 2), "gbPct": r(t.gbPct),
             "so": int(t.SO), "bb": int(t.BB), "hr": int(t.HR)} for t in df.itertuples()]


def rows_h(df: pd.DataFrame) -> list[dict]:
    return [{"id": str(t.mlbam_id), "name": t.player_name, "level": t.level, "team": t.team_name, "age": r(t.age),
             "bats": t.bats, "pos": t.position, "g": int(t.G), "pa": int(t.PA), "avg": r(t.avg, 3), "obp": r(t.obp, 3),
             "slg": r(t.slg, 3), "ops": r(t.obp + t.slg, 3), "iso": r(t.iso, 3), "kPct": r(t.kPct), "bbPct": r(t.bbPct),
             "hr": int(t.HR), "sb": int(t.SB), "cs": int(t.CS)} for t in df.itertuples()]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    index = {}
    for kind, build, rows, floor in (("pitchers", pitchers, rows_p, "BF"), ("hitters", hitters, rows_h, "PA")):
        df = build(pd.read_parquet(SRC / f"{kind}.parquet"))
        df = df[df[floor] > 0].copy()
        df["age"] = season_age(df["birth_date"], df["season"])
        df["lv"] = df["level"].map({l: i for i, l in enumerate(LEVEL_ORDER)})
        df = df.sort_values(["season", "lv", "mlbam_id"], kind="stable")
        for season, sub in df.groupby("season"):
            path = OUT / f"{kind}-{season}.json"
            path.write_text(json.dumps({"season": int(season), "levels": LEVEL_ORDER, "rows": rows(sub)},
                                       separators=(",", ":")))
            print(f"{kind} {season}: {len(sub)} rows -> {path.name}")
        index[kind] = sorted(int(s) for s in df["season"].unique())
    (OUT / "index.json").write_text(json.dumps({"levels": LEVEL_ORDER, **index}))


if __name__ == "__main__":
    main()
