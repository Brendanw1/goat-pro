"""D-44 v1: unofficial MLB service-time / team-control ESTIMATOR from the public MLB Stats API.

    python pipeline/service_time.py --fetch   # incremental pull (cache/service/), polite 1 s pause
    python pipeline/service_time.py           # rebuild data/service/service_est.parquet from the cache
    python pipeline/service_time.py --demo    # self-check of the state machine + status rules, no network

Not contract data. Method (docs/service-time-method.md):
  * seed each season's state from the club 40-man roster on opening day (status A = active,
    D7/D10/D15/D60 = injured list, RM/MIN = optioned) — this re-anchors every season, so a parse
    miss cannot carry over a winter;
  * walk that season's Stats API transactions (sportId=1) day by day: selected/recalled/activated
    = on the active roster, placed on IL = still service, optioned = off, outrighted/released = off,
    DFA = service until resolved; a Rookie of the Year gets the full-year PPI credit (2022 CBA);
  * service days = championship-season days on active roster or IL, capped at 172 a season;
    2020 is prorated to 172 (60-game season);
  * option year used = a season with >= 20 optioned days;
  * status after the last season: pre-arb / arb-1..3 / 6+, Super Two = top 22% by service of the
    2.000-2.999 class with >= 86 days the prior season (applied every winter, so a former Super Two
    gets a fourth arb year);
  * control through = last season before 6.000 if he accrues a full year from here.
Rows are flagged uncertain when the walk hit contradictions (e.g. recalled while already up) or the
estimate sits within 15 days of a boundary (2.000 class cut, 3.000, 6.000, Super Two cut).
"""
import argparse
import json
import math
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "cache" / "service"
OUT = ROOT / "data" / "service" / "service_est.parquet"
UA = "goat-pro service-time estimator (personal, non-commercial; github.com goat-pro)"
PAUSE_S = 1.0
FIRST = 2010   # debuts before this are reported as 6+ (veteran), not walked
YEAR = 172
MLB = {108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 133, 134, 135, 136, 137, 138,
       139, 140, 141, 142, 143, 144, 145, 146, 147, 158}
SERVICE = {"A": "on", "D7": "il", "D10": "il", "D15": "il", "D60": "il", "PL": "il", "BRV": "il"}


def http_json(url: str, tries: int = 4) -> dict | None:
    for t in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=60) as r:
                return json.loads(r.read())
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            code = getattr(e, "code", None)
            if t < tries - 1 and code in (None, 429, 500, 502, 503, 504):
                time.sleep(2 ** (t + 2))
                continue
            print(f"  {type(e).__name__} {code} for {url}")
            return None
    return None


def cached(path: Path, url: str, refresh: bool = False) -> dict | None:
    if path.exists() and not refresh:
        return json.loads(path.read_text())
    d = http_json(url)
    time.sleep(PAUSE_S)
    if d is not None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(d))
    return d


def season_dates(y: int) -> tuple[date, date]:
    d = cached(CACHE / f"season_{y}.json", f"https://statsapi.mlb.com/api/v1/seasons/{y}?sportId=1")
    s = d["seasons"][0]
    return date.fromisoformat(s["regularSeasonStartDate"]), date.fromisoformat(s["regularSeasonEndDate"])


def fetch(last: int) -> None:
    """Incremental: closed months and past seeds are pulled once; the two latest months always refresh."""
    today = date.today()
    for y in range(FIRST, last + 1):
        od, _ = season_dates(y)
        for tid in sorted(MLB):
            cached(CACHE / "seed" / f"{y}_{tid}.json",
                   f"https://statsapi.mlb.com/api/v1/teams/{tid}/roster?rosterType=40Man&date={od}")
        for m in range(1, 13):
            first = date(y, m, 1)
            if first > today:
                break
            end = (first.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
            fresh = (today - first).days < 62
            cached(CACHE / "tx" / f"{y}-{m:02d}.json",
                   f"https://statsapi.mlb.com/api/v1/transactions?sportId=1&startDate={first}&endDate={end}",
                   refresh=fresh)
        print(f"  {y}: seeds + transactions cached", flush=True)


# ---- the walk -------------------------------------------------------------------------------

def classify(t: dict) -> str | None:
    """One transaction -> the roster state it puts the player in (None = no change). Only moves made
    by an MLB club count (affiliates also place players on their own injured lists)."""
    code, desc = t.get("typeCode"), (t.get("description") or "").lower()
    to_mlb = (t.get("toTeam") or {}).get("id") in MLB
    if code in ("SE", "CU") or code == "PUR" and t.get("fromTeam"):
        return "on" if to_mlb else None
    if code == "OPT":
        return "opt"
    if code in ("OUT", "REL", "DFA", "RET", "RTN", "SU"):
        return "off"
    if code == "DES":
        return "dfa"
    if code == "SC" and to_mlb:
        if "activated" in desc or "reinstated" in desc:
            return "on"
        if "restricted" in desc or "suspended" in desc or "voluntarily retired" in desc:
            return "off"
        if "minor league" in desc and ("reassigned" in desc or "assigned" in desc):
            return "opt"
        if re.search(r"(placed|transferred) .*(injured|disabled|paternity|bereavement|family medical)", desc):
            return "il"
        return None
    if code == "CLW":
        return "claim" if to_mlb else None   # lands on the active roster unless an option follows
    if code == "TR":
        return "keep"   # state rides with him
    return None


def walk(seed: dict, txs: list, od: date, end: date) -> tuple[dict, dict, dict, dict]:
    """Season walk. seed: pid -> state on opening day; txs: (date, pid, state) sorted.
    Returns (service days, optioned days, contradictions, final state) per pid."""
    state, since = dict(seed), {p: od for p in seed}
    svc, opt, bad, stints = {}, {}, {}, {}

    def close(p: str, upto: date):
        s, a = state.get(p), since.get(p, od)
        n = max(0, (min(upto, end + timedelta(days=1)) - max(a, od)).days)
        if s in ("on", "il", "dfa"):
            svc[p] = svc.get(p, 0) + n
        elif s == "opt":
            stints.setdefault(p, []).append(n)

    for d, p, new in txs:
        if d > end:
            break
        cur = state.get(p)
        if new == "keep" or new == "claim" and cur in ("on", "il", "opt"):
            continue
        new = "on" if new == "claim" else new
        if new == "on" and cur == "on" or new == "opt" and cur in ("opt", "off", None) and d >= od:
            bad[p] = bad.get(p, 0) + 1
        close(p, d)
        state[p], since[p] = new, max(d, od)
    for p in list(state):
        close(p, end + timedelta(days=1))
    for p, ns in stints.items():
        opt[p] = sum(ns)
        # ponytail: no credit for short options. A <20-day credit was tried first and overcounted two
        # shuttle arms in the spot-check (Fried, Valdez); see docs/service-time-method.md.
    return svc, opt, bad, state


def status_after(hist: dict, last: int) -> dict:
    """hist: pid -> {season: days}. Winter-by-winter arb clocks with the Super Two rule."""
    tot = {p: 0 for p in hist}
    arb = {p: 0 for p in hist}
    s2 = {p: False for p in hist}
    near = {p: False for p in hist}
    years = sorted({y for h in hist.values() for y in h})
    for y in years:
        for p, h in hist.items():
            tot[p] += h.get(y, 0)
        cls = sorted((tot[p], p) for p in hist if 2 * YEAR <= tot[p] < 3 * YEAR and hist[p].get(y, 0) >= 86)
        cut = cls[int(len(cls) * 0.78)][0] if cls else None
        for _, p in cls:
            if cut is not None and abs(tot[p] - cut) <= 15:
                near[p] = True
        for p in hist:
            if 3 * YEAR <= tot[p] < 6 * YEAR or (cut is not None and 2 * YEAR <= tot[p] < 3 * YEAR
                                                 and hist[p].get(y, 0) >= 86 and tot[p] >= cut):
                arb[p] += 1
                if tot[p] < 3 * YEAR:
                    s2[p] = True
        if y == last:
            s2cut = cut
    return {p: {"days": tot[p], "arb_n": arb[p], "super2": s2[p] and tot[p] < 6 * YEAR, "near_s2": near[p],
                "s2cut": s2cut} for p in hist}


def label(days: int, arb_n: int, debuted: bool) -> str:
    if days >= 6 * YEAR:
        return "6+"
    if arb_n == 0:
        return "pre-arb" if debuted or days else "pre-MLB"
    return f"arb-{arb_n}" if arb_n < 4 else "arb-4+"   # a slow accruer can sit in arb past three winters


def svc_str(days: int) -> str:
    return f"{days // YEAR}.{days % YEAR:03d}"


def build(last: int) -> "pd.DataFrame":
    import pandas as pd

    debut, hist, opts, bad, opt_seasons = {}, {}, {}, {}, {}
    # The logged `date` is used, not `effectiveDate`: the feed sometimes stamps a move's effective date
    # with the NEXT move's (Burnes' 2018 selection reads effective 2019-04-19).
    alltx = []
    for f in sorted((CACHE / "tx").glob("*.json")):
        for t in json.loads(f.read_text()).get("transactions", []):
            new = classify(t)
            if new and t.get("person") and t.get("date"):
                alltx.append((date.fromisoformat(t["date"][:10]), str(t["person"]["id"]), new))
    alltx.sort(key=lambda x: x[0])
    carry, prev_end = {}, None
    for y in range(FIRST, last + 1):
        od, end = season_dates(y)
        # carry-over: up at the end of last season and not let go since (the opening-day 40-man
        # occasionally omits a player — Valdez is missing from HOU's 2022 and 2023 seeds)
        gone = {p for d, p, n in alltx if prev_end and prev_end < d <= od and n in ("off", "opt", "dfa")}
        seed = {p: "on" for p, st in carry.items() if st in ("on", "il") and p not in gone}
        for f in sorted((CACHE / "seed").glob(f"{y}_*.json")):
            for r in json.loads(f.read_text()).get("roster", []):
                st = r.get("status", {}).get("code")
                seed[str(r["person"]["id"])] = SERVICE.get(st, "opt" if st in ("RM", "MIN", "MA") else "off")
        # spring moves are already in the opening-day seed
        txs = [x for x in alltx if od < x[0] <= end]
        svc, opt, b, carry = walk(seed, txs, od, end)
        prev_end = end
        scale = YEAR / ((end - od).days + 1) if y == 2020 else 1.0
        for p, n in svc.items():
            hist.setdefault(p, {})[y] = min(YEAR, round(n * scale))
        for p, n in opt.items():
            if n >= 20:
                opt_seasons.setdefault(p, set()).add(y)
        for p, n in b.items():
            bad[p] = bad.get(p, 0) + n
    # 2022 CBA prospect-promotion incentive: a Rookie of the Year (on the top-100 lists, assumed) is
    # credited a full year of service for his rookie season (Skenes 2024). Winners only; votes not used.
    for y in range(2022, last + 1):
        for aw in ("ALROY", "NLROY"):
            d = cached(CACHE / "awards" / f"{aw}_{y}.json",
                       f"https://statsapi.mlb.com/api/v1/awards/{aw}/recipients?season={y}")
            for r in (d or {}).get("awards", []):
                p = str(r["player"]["id"])
                if p in hist and hist[p].get(y, 0) < YEAR:
                    hist[p][y] = YEAR
    st = status_after(hist, last)
    rows = []
    for p, h in hist.items():
        s = st[p]
        days = s["days"]
        need = max(0, 6 * YEAR - days)
        ctl = last + math.ceil(need / YEAR) if days < 6 * YEAR else None
        near = s["near_s2"] and days < 6 * YEAR or min(abs(days - b) for b in (2 * YEAR, 3 * YEAR, 6 * YEAR)) <= 15 or (
            s["s2cut"] is not None and 2 * YEAR <= days < 3 * YEAR and abs(days - s["s2cut"]) <= 15)
        cum, crossed = 0, None
        for y in sorted(h):
            cum += h[y]
            if cum >= 6 * YEAR:
                crossed = y
                break
        rows.append({"id": int(p), "days": days, "fa_after": crossed or ctl, "by_season": json.dumps(h, sort_keys=True), "service": svc_str(days), "last_days": h.get(last, 0),
                     "opt_years": len(opt_seasons.get(p, ())), "arb_n": s["arb_n"], "super2": s["super2"],
                     "contradictions": bad.get(p, 0), "control_thru": ctl,
                     "uncertain": bool(near or bad.get(p, 0) >= 2)})
    df = pd.DataFrame(rows)
    return df


def debuts(ids: list[int]) -> dict:
    out = {}
    for i in range(0, len(ids), 150):
        chunk = ids[i:i + 150]
        d = cached(CACHE / "people" / f"{chunk[0]}_{chunk[-1]}_{len(chunk)}.json",
                   "https://statsapi.mlb.com/api/v1/people?personIds=" + ",".join(map(str, chunk)))
        for p in (d or {}).get("people", []):
            out[p["id"]] = p.get("mlbDebutDate")
    return out


def demo() -> None:
    od, end = date(2025, 3, 27), date(2025, 9, 28)
    txs = [(date(2025, 4, 10), "a", "opt"), (date(2025, 4, 20), "a", "on"),     # 10-day option: off 10 days
           (date(2025, 5, 1), "b", "opt"), (date(2025, 6, 30), "b", "on"),      # 60-day option: off
           (date(2025, 7, 1), "c", "il"), (date(2025, 8, 1), "c", "on")]        # IL counts
    svc, opt, bad, _ = walk({"a": "on", "b": "on", "c": "on"}, txs, od, end)
    full = (end - od).days + 1
    assert svc["a"] == full - 10, svc
    assert svc["b"] == full - 60 and opt["b"] == 60, (svc, opt)
    assert svc["c"] == full and not bad
    hist = {"x": {2023: 172, 2024: 100, 2025: 100}, "y": {2024: 172, 2025: 172}, "z": {2025: 172}}
    s = status_after(hist, 2025)
    assert s["x"]["arb_n"] == 1 and s["x"]["super2"] and s["y"]["arb_n"] == 0, s
    assert label(0, 0, False) == "pre-MLB" and label(1100, 3, True) == "6+" and svc_str(345) == "2.001"
    print("demo ok")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--fetch", action="store_true")
    ap.add_argument("--demo", action="store_true")
    ap.add_argument("--last", type=int, default=2026)
    a = ap.parse_args()
    if a.demo:
        return demo()
    if a.fetch:
        fetch(a.last)
    df = build(a.last)
    deb = debuts(sorted(df["id"].tolist()))
    df["debut"] = df["id"].map(deb)
    old = df["debut"].notna() & (df["debut"].fillna("9999") < f"{FIRST}")
    df.loc[old, ["control_thru"]] = None
    df["veteran_pre_window"] = old
    df["status"] = [("6+" if v else label(d, n, bool(db)))
                    for d, n, db, v in zip(df["days"], df["arb_n"], df["debut"], old)]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(OUT, index=False)
    print(f"{len(df)} players -> {OUT}\n{df['status'].value_counts().to_string()}")


if __name__ == "__main__":
    sys.exit(main())
