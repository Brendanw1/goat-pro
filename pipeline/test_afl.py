"""The AFL feed parser and bake (afl_fetch.py, afl_export.py).

    python pipeline/test_afl.py   (or pytest)
"""
import afl_export
import afl_fetch


def _pitch(code, balls, strikes, n, **pd_):
    return {"isPitch": True, "pitchNumber": n, "details": {"code": code, "type": {"code": "FF"}},
            "count": {"balls": balls, "strikes": strikes}, "pitchData": pd_}


def _feed(plays):
    return {"gameData": {"teams": {"home": {"name": "Home"}, "away": {"name": "Away"}}},
            "liveData": {"plays": {"allPlays": plays}}}


def _play(i, events, ev_type, last_is_pitch=True):
    pe = list(events) + ([] if last_is_pitch else [{"isPitch": False}])
    return {"about": {"atBatIndex": i, "isTopInning": True, "inning": 1, "isComplete": True},
            "result": {"type": "atBat", "eventType": ev_type},
            "matchup": {"pitcher": {"id": 1}, "batter": {"id": 2}, "pitchHand": {"code": "R"}, "batSide": {"code": "L"}},
            "playEvents": pe}


def test_pitch_rows_count_call_and_movement():
    coords = {"x0": -1.23, "y0": 50.0, "z0": 6.12, "vX0": 3.12, "vY0": -124.36, "vZ0": -0.38,
              "aX": 1.29, "aY": 21.48, "aZ": -34.76, "pX": 0.1, "pZ": 3.1}
    rows = afl_fetch.pitch_rows(_feed([_play(0, [
        _pitch("B", 1, 0, 1, startSpeed=85.3, zone=12, coordinates=coords, extension=6.3,
               breaks={"breakHorizontal": -2.0, "breakVerticalInduced": -2.9, "spinRate": 2570}),
        _pitch("T", 1, 1, 2), _pitch("C", 1, 2, 3)], "strikeout")]), {"season": 2026})
    assert [r["description"] for r in rows] == ["ball", "foul_tip", "called_strike"]
    assert [(r["balls"], r["strikes"]) for r in rows] == [(0, 0), (1, 0), (1, 1)]  # count BEFORE the pitch
    assert [r["events"] for r in rows] == [None, None, "strikeout"]                # event on the last pitch only
    r = rows[0]
    assert abs(r["pfx_x"] - 2 / 12) < 1e-9 and abs(r["pfx_z"] + 2.9 / 12) < 1e-9   # Savant sign and feet
    assert r["pitcher_team"] == "Home" and r["batter_team"] == "Away"
    assert 54 < 60.5 - r["release_extension"] < 55 and 5.5 < r["release_pos_z"] < 6.5


def test_runner_out_truncates_the_pa():
    rows = afl_fetch.pitch_rows(_feed([_play(0, [_pitch("B", 1, 0, 1)], "caught_stealing_2b", False)]), {})
    assert rows[0]["events"] == "truncated_pa"


def test_export_demo():
    afl_export.demo()


if __name__ == "__main__":
    test_pitch_rows_count_call_and_movement()
    test_runner_out_truncates_the_pa()
    test_export_demo()
    print("test_afl ok")
