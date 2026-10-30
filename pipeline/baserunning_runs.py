"""§101 (D-40): XBT baserunning runs — extra bases taken vs the average runner.

    python baserunning_runs.py          # the §101 read (once) -> results/baserunning_SEALED.json
    python baserunning_runs.py --demo   # self-checks of the assignment rule and RE walk

The pitch mart carries on_1b/2b/3b + outs_when_up but no post-states, so a play's
after-state is the NEXT plate appearance's bases; the half's last play reads empty
bases, three outs. A runner's fate on a hit is enumerated, not guessed: every
assignment of each runner to (advanced-to, scored, retired) must reproduce the next
PA's bases, the runs that scored on the play and the outs added, with runners never
ending deeper-in... shallower than they started and never holding the base the
batter took; plays with zero or multiple consistent assignments are dropped and the
share reported. Runs use the site's RE24 attribution: play RV = runs on the play +
RE(after) - RE(before), credited against the league mean of the same
(from_base, event, outs) cell. Savant's runner_runs_XB is the validation
reference, not the source. No steal events exist in the mart — the SB/CS leg is
D-40a (needs a Stats API play-by-play ingest).
"""
import argparse
import itertools
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

PIPE = Path(__file__).resolve().parent
sys.path.insert(0, str(PIPE))
from paths import MART_DIR  # noqa: E402
sys.path.insert(0, str(MART_DIR))
import mart  # noqa: E402

SEASONS = list(range(2020, 2027))
# Opportunities: plays where the batter reaches and the advance decision belongs to
# the runner. Outs, force plays and fielder's choices are v2.
REACH_DEST = {"single": 1, "double": 2, "field_error": 1}

SQL_PAS = """
SELECT game_pk, inning, inning_topbot, season, at_bat_number,
       CAST(bat_score AS INT) AS bat_score, CAST(post_bat_score AS INT) AS post_bat_score,
       CAST(on_1b AS BIGINT) AS on_1b, CAST(on_2b AS BIGINT) AS on_2b, CAST(on_3b AS BIGINT) AS on_3b,
       CAST(outs_when_up AS INT) AS outs, batter, events
FROM pitches_all
WHERE game_type = 'R' AND season IN ({seasons}) AND inning IS NOT NULL
QUALIFY row_number() OVER (PARTITION BY game_pk, inning, inning_topbot, at_bat_number
                           ORDER BY pitch_number) = 1
ORDER BY game_pk, inning, inning_topbot, at_bat_number
"""


def re_table(con) -> dict:
    """RE for the 24 states: at every PA start, the runs still to score in the half
    are the half's last post_bat_score minus this PA's post_bat_score (post_bat_score
    tracks the batting team)."""
    q = f"""
    WITH pa AS (
        SELECT game_pk, inning, inning_topbot, at_bat_number,
               CAST(on_1b AS BIGINT) AS on_1b, CAST(on_2b AS BIGINT) AS on_2b,
               CAST(on_3b AS BIGINT) AS on_3b, CAST(outs_when_up AS INT) AS outs,
               CAST(post_bat_score AS INT) AS post_bat_score
        FROM pitches_all
        WHERE game_type = 'R' AND season IN ({",".join(map(str, SEASONS))}) AND inning IS NOT NULL
        QUALIFY row_number() OVER (PARTITION BY game_pk, inning, inning_topbot, at_bat_number
                                   ORDER BY pitch_number) = 1
    ),
    ends AS (
        SELECT game_pk, inning, inning_topbot, arg_max(post_bat_score, at_bat_number) AS last_post
        FROM pa GROUP BY 1, 2, 3
    )
    SELECT (CASE WHEN on_1b > 0 THEN 1 ELSE 0 END) AS b1,
           (CASE WHEN on_2b > 0 THEN 1 ELSE 0 END) AS b2,
           (CASE WHEN on_3b > 0 THEN 1 ELSE 0 END) AS b3,
           outs, last_post - post_bat_score AS runs_after
    FROM pa JOIN ends USING (game_pk, inning, inning_topbot)
    """
    df = con.sql(q).df()
    return {k: float(v) for k, v in df.groupby(["b1", "b2", "b3", "outs"])["runs_after"].mean().items()}


def assign_runners(froms: list[int], after: tuple[int, int, int], dest: int,
                   runs_play: int, retired: int) -> list[dict[int, int]] | None:
    """All fates consistent with the after-bases, the runs and the outs. Returns the
    unique assignment, or None when none / more than one matches. Fate: 1/2/3 = the
    base he ended at, 4 = scored, 0 = held, -1 = retired."""
    free = sorted(b for b in (1, 2, 3) if after[b - 1] and b != dest)
    keep = []
    for fates in itertools.product((0, 1, 2, 3, 4, -1), repeat=len(froms)):
        if sorted(f for f in fates if f in (1, 2, 3)) != free:
            continue
        if sum(f == 4 for f in fates) != runs_play or sum(f == -1 for f in fates) != retired:
            continue
        ok = True
        for f, b in zip(froms, fates):
            if b == 0 and f == dest:
                ok = False  # cannot "hold" the base the batter just took
                break
            if b in (1, 2, 3) and (b < f or (b == f and b == dest)):
                ok = False  # cannot end shallower, and cannot sit on the batter's base
                break
        if ok:
            keep.append(dict(zip(froms, fates)))
    return keep[0] if len(keep) == 1 else None


def walk_advances(pas: pd.DataFrame) -> tuple[pd.DataFrame, float]:
    """One row per kept (play, runner) with the RE-attribution parts. Returns the
    frame and the share of runner-opportunities dropped (ambiguous or inconsistent)."""
    rows: list[dict] = []
    kept = dropped = 0
    prev = None
    for t in pas.itertuples():
        if prev is not None and prev.game_pk == t.game_pk and prev.half == t.half and prev.events in REACH_DEST:
            dest = REACH_DEST[prev.events]
            runners = [(f, int(getattr(prev, f"on_{f}b"))) for f in (1, 2, 3)
                       if not pd.isna(getattr(prev, f"on_{f}b")) and getattr(prev, f"on_{f}b") > 0]
            if runners:
                after = tuple(0 if pd.isna(getattr(t, f"on_{b}b")) else int(getattr(t, f"on_{b}b") > 0)
                              for b in (1, 2, 3))
                s_before = tuple(0 if pd.isna(getattr(prev, f"on_{b}b")) else int(getattr(prev, f"on_{b}b") > 0)
                                 for b in (1, 2, 3))
                runs_play = int(t.post_bat_score - prev.bat_score)
                retired = int(t.outs - prev.outs)
                fates = None
                if 0 <= retired <= len(runners) and 0 <= runs_play <= len(runners):
                    fates = assign_runners([f for f, _ in runners], after, dest, runs_play, retired)
                if fates is None:
                    dropped += len(runners)
                else:
                    kept += len(runners)
                    for f, rid in runners:
                        rows.append({"season": prev.season, "runner_id": rid, "from": f,
                                     "event": prev.events, "outs": int(prev.outs),
                                     "runs_play": runs_play,
                                     "s_before": s_before, "s_after": after, "outs_after": int(t.outs),
                                     "outcome": fates[f]})
        elif prev is not None and prev.game_pk == t.game_pk and prev.half != t.half and prev.events in REACH_DEST:
            # the half's last play: bases empty, three outs afterwards
            dest = REACH_DEST[prev.events]
            runners = [(f, int(getattr(prev, f"on_{f}b"))) for f in (1, 2, 3)
                       if not pd.isna(getattr(prev, f"on_{f}b")) and getattr(prev, f"on_{f}b") > 0]
            if runners:
                runs_play = int(t.post_bat_score - prev.bat_score)
                retired = 3 - int(prev.outs)
                fates = None
                if 0 <= runs_play <= len(runners) and 0 <= retired <= len(runners):
                    fates = assign_runners([f for f, _ in runners], (0, 0, 0), dest, runs_play, retired)
                if fates is None:
                    dropped += len(runners)
                else:
                    kept += len(runners)
                    s_before = tuple(0 if pd.isna(getattr(prev, f"on_{b}b")) else int(getattr(prev, f"on_{b}b") > 0)
                                     for b in (1, 2, 3))
                    for f, rid in runners:
                        rows.append({"season": prev.season, "runner_id": rid, "from": f,
                                     "event": prev.events, "outs": int(prev.outs),
                                     "runs_play": runs_play,
                                     "s_before": s_before, "s_after": (0, 0, 0), "outs_after": 3,
                                     "outcome": fates[f]})
        prev = t
    return pd.DataFrame(rows), dropped / max(1, kept + dropped)


def demo() -> None:
    def pa(**kw):
        base = dict(game_pk=1, inning=5, inning_topbot="Top", season=2025, at_bat_number=0,
                    bat_score=0, post_bat_score=0, on_1b=0, on_2b=0, on_3b=0,
                    outs=1, batter=0, events="strikeout")
        base.update(kw)
        return base

    half = lambda rows: pd.DataFrame(rows).assign(half=lambda d: d.game_pk.astype(str) + d.inning.astype(str) + d.inning_topbot)

    # 1. single, runner on 1st, next PA shows 1st+2nd -> advanced (unique)
    adv, _ = walk_advances(half([pa(at_bat_number=1, on_1b=111, events="single", batter=10),
                                 pa(at_bat_number=2, on_1b=222, on_2b=111, batter=11)]))
    assert len(adv) == 1 and adv.iloc[0]["runner_id"] == 111 and adv.iloc[0]["outcome"] == 2, adv

    # 2. ambiguous: runners on 1st+2nd, single, next PA shows only the batter on 1st,
    #    one run in, one out added -> (1 scored, 2 out) and (2 scored, 1 out) both fit
    adv, drop = walk_advances(half([pa(at_bat_number=1, on_1b=111, on_2b=222, events="single", batter=10),
                                    pa(at_bat_number=2, on_1b=333, post_bat_score=1, outs=2, batter=11)]))
    assert adv.empty and drop == 1.0, (adv, drop)

    # 3. half-ending single: two outs, runners on 1st+2nd, no run -> the 3rd out is a
    #    runner; unique read: the 1st runner retired (he cannot hold his base), the
    #    2nd stranded at second
    adv, drop = walk_advances(half([pa(at_bat_number=1, on_1b=111, on_2b=222, outs=2,
                                       events="single", batter=10),
                                    pa(game_pk=1, inning=5, inning_topbot="Bot", at_bat_number=2,
                                       batter=11)]))
    assert len(adv) == 2 and drop == 0.0, (adv, drop)
    got = {int(r.runner_id): int(r.outcome) for r in adv.itertuples()}
    assert got == {111: -1, 222: 0}, got

    print("demo ok")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--demo", action="store_true")
    args = ap.parse_args()
    if args.demo:
        demo()
        return
    con = mart.connect()
    con.execute("SET threads TO 1")
    pas = con.sql(SQL_PAS.format(seasons=",".join(map(str, SEASONS)))).df()
    pas["half"] = pas.game_pk.astype(str) + pas.inning.astype(str) + pas.inning_topbot
    re = re_table(con)
    adv, drop_share = walk_advances(pas)
    print(f"kept {len(adv):,} runner-opportunities; dropped {drop_share:.1%} (ambiguous or inconsistent)")

    # play RV via the site's RE24 attribution, then credit vs the league cell
    adv["rv_play"] = [
        rp + re.get((a, b, c, oa), None) - re.get((sb[0], sb[1], sb[2], so), None)
        if re.get((a, b, c, oa)) is not None and re.get((sb[0], sb[1], sb[2], so)) is not None else None
        for rp, (a, b, c), oa, sb, so in zip(adv.runs_play, adv.s_after, adv.outs_after, adv.s_before, adv.outs)
    ]
    adv = adv[adv["rv_play"].notna()]
    adv["cell"] = adv["from"].astype(str) + "|" + adv["event"] + "|" + adv["outs"].astype(str)
    lg = adv.groupby("cell")["rv_play"].mean()
    adv["credit"] = adv["rv_play"] - adv["cell"].map(lg)
    per = adv.groupby(["runner_id", "season"])["credit"].sum().rename("xbt_runs").reset_index()
    n_opp = adv.groupby(["runner_id", "season"])["credit"].size().rename("n_opp").reset_index()
    per = per.merge(n_opp, on=["runner_id", "season"])
    per["runner_id"] = per["runner_id"].astype(int)
    per.to_csv(PIPE / "results" / "baserunning_xbt.csv", index=False)

    # ---- the §101 read: agreement with Savant's runner_runs_XB (2021-26)
    lb_dir = Path(MART_DIR) / "data" / "leaderboards"
    sav = []
    for y in range(2021, 2027):
        fp = lb_dir / f"baserunning-run-value_{y}.csv"
        if fp.exists():
            d = pd.read_csv(fp)
            sav.append(d[["player_id", "runner_runs_XB"]].assign(season=y))
    sav = pd.concat(sav).rename(columns={"player_id": "runner_id"})
    j = per.merge(sav, on=["runner_id", "season"])
    j10 = j[(j.n_opp >= 10)]
    rs = {}
    for y, g in j10.groupby("season"):
        if len(g) >= 100:
            rs[int(y)] = {"n": int(len(g)), "r": round(float(g.xbt_runs.corr(g.runner_runs_XB)), 3)}
    pooled_r = float(j10.xbt_runs.corr(j10.runner_runs_XB))
    # simple per-season bootstrap for the CI (hitter-clustered would need the raw rows;
    # the player-season is already the independent unit of the comparison)
    rng = np.random.default_rng(13)
    boots = []
    arr = j10[["xbt_runs", "runner_runs_XB"]].to_numpy()
    for _ in range(2000):
        idx = rng.integers(0, len(arr), len(arr))
        boots.append(np.corrcoef(arr[idx, 0], arr[idx, 1])[0, 1])
    ci = [round(float(np.quantile(boots, 0.025)), 3), round(float(np.quantile(boots, 0.975)), 3)]
    # YoY of our runs
    p = per[per.n_opp >= 10].pivot(index="runner_id", columns="season", values="xbt_runs")
    yoy = []
    for y in range(2021, 2027):
        if y - 1 in p.columns and y in p.columns:
            both = p[[y - 1, y]].dropna()
            if len(both) >= 100:
                yoy.append(round(float(both[y - 1].corr(both[y])), 3))
    res = {
        "section": "§101 (D-40 XBT leg)",
        "kept": int(len(adv)), "dropped_share": round(drop_share, 4),
        "runner_seasons": int(len(per)),
        "claim": {"pooled_r": round(pooled_r, 3), "ci": ci, "by_season": rs,
                  "verdict": "PENDING READ"},
        "yoy_r": yoy,
    }
    print(json.dumps(res, indent=1))
    (PIPE / "results" / "baserunning_SEALED.json").write_text(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
