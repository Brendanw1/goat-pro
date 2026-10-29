"""team_stints: the latest club is current, sides follow inning_topbot 'Top'/'Bot' (python pipeline/test_team_stints.py)."""
import duckdb

from web_export import team_stints

con = duckdb.connect()
con.execute("""CREATE TABLE pitches_all AS SELECT * FROM (VALUES
  -- pitcher 1 with DET, then LAD after a trade; one home and one road game each
  (1, 9, 2024, 'R', 101, DATE '2024-04-01', 'Top', 'DET', 'NYY'),
  (1, 9, 2024, 'R', 102, DATE '2024-04-05', 'Bot', 'NYY', 'DET'),
  (1, 9, 2024, 'R', 201, DATE '2024-08-03', 'Top', 'LAD', 'SF'),
  (1, 9, 2024, 'R', 202, DATE '2024-08-09', 'Bot', 'SF', 'LAD')
) t(pitcher, batter, season, game_type, game_pk, game_date, inning_topbot, home_team, away_team)""")
cur, st = team_stints(con, "pitcher", "2024")
assert cur[(1, 2024)] == "LAD", cur
assert [s["team"] for s in st[(1, 2024)]] == ["DET", "LAD"], st
assert st[(1, 2024)][1]["from"] == "2024-08-03" and st[(1, 2024)][0]["g"] == 2
cur, st = team_stints(con, "batter", "2024")
# batter 9 is the hitter facing him: NYY (away in the top, home in the bottom), then SF
assert cur[(9, 2024)] == "SF" and [s["team"] for s in st[(9, 2024)]] == ["NYY", "SF"], st
print("team_stints ok")
