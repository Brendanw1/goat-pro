# Goat-Pro Hoops — the owner's spec (2026-10-30)

Everything below is the owner's requirements, structured. Each item maps to its
source, surface, and what gates it. Order at the bottom is the build order.

## 1. Statistics foundation

- **All regular player statistics, per game and per season** — box scores
  (ESPN + LUMA back to 1997-98). Per player AND per team.
- **Per-36 rates** for everything (derived; show alongside totals, small-sample
  flagged).
- **All advanced statistics available**: from our own derivations (true
  shooting, effective FG%, usage, ORtg/DRtg-style from play-by-play
  possessions) + balldontlie's v2 advanced feed (PIE, four factors, hustle —
  deflections, contested shots, loose balls — defensive matchups, usage)
  once `BDL_KEY` lands.
- Every stat ranked against the league (percentile, Savant-style) and shown
  per-36 where meaningful.

## 2. Player impact isolation (models, descriptive first)

- **Shot creation / 1v1**: from play-by-play event types (driving layups,
  pull-ups, step-backs — the ESPN play types carry this) + tracking drives
  and touches when `BDL_KEY` lands. Unassisted made shots as the floor.
- **Playmaking**: assists + potential-assist-style reads from PBP (who passed,
  who shot); pass-distance detail stays gated (nba.com only).
- **Rim penetration**: driving-dunk/layup event rates from PBP; tracking
  drives when available.
- **Defense**: steals/blocks from box; **point-of-attack vs help defender**
  from balldontlie's defensive-matchup data (matchup FG%, points allowed) —
  partially available now, richer when the key lands. Contested-shot data
  same source.
- Each model: descriptive first, then a predictive gate (does it forecast
  next-season impact?) before any grade label loses the descriptive chip.

## 3. Rebounding

- Offensive/defensive rebound rates per player and team.
- **Zone visuals**: rebound heatmaps by court zone. ESPN's shot plays carry
  x/y of misses, so "where rebounds come from" maps directly; player-zone
  rebound rates = rebounds collected per misses-in-zone while on floor.
- **vs average**: zone-level comparison vs league average at the position —
  where he gains rebounds and where he gives them up.
- Gated item: true rebound *chances* (nba.com tracking) — our zone rates are
  the descriptive approximation until a tracking source lands.

## 4. Team impact / role decomposition

- **5v5 + overall impact** quantified with our models: RAPM (stints from PBP),
  with/without (on/off from ESPN-derived lineups, validated against LUMA's
  views).
- **Role decomposition**: shot gravity (do teammates' 3P attempt rate/quality
  rise when he's on the floor — an on/off differential on teammates' shots),
  passing vs scoring load (usage/assist split), screening (limited: no public
  screen counts — tracked as a research note until a source exists).
- On-court visuals: heatmaps per player (shots, rebounds, where teammates
  shoot when he's on), zone tables.

## 5. On/off — everywhere

On/off stats per player (net rating, teammate shooting, rebounding) as both a
standalone surface and a per-stat drill-down. Validated against LUMA's
`onoff_season`/`wowy` views.

## 6. Projections (last — after the models exist)

- **Season projections** and **career projections** with graphs, mirroring the
  Marcel→VectorSSM pattern from baseball: descriptive baselines first
  (age-curved per-36), then gated models.
- **Savant-style percentile cards** for players (the design system already
  has the card from baseball).
- **Aging adjustment**: age curves per stat (mirroring /aging), patterns to
  diagnose trajectory.

## Build order

1. Statistics foundation (box/per-36/advanced-basic) — per player + team.
2. On/off + lineups (the PBP stint pipeline is the prerequisite for most of
   the rest).
3. Impact models: shot creation, playmaking, rim penetration, defense,
   rebounding zones (descriptive first, each).
4. Team impact decomposition + gravity + heatmaps.
5. Projections + career curves + percentile cards.

## Infrastructure

Local-first. The mart (`hoops_mart`) fills locally; surfaces ship inside the
existing goat-pro app (`/hoops/...`), riding the existing GitHub repo, R2
bucket (namespaced `hoops/...`), and Vercel project. No new infrastructure
until the owner wants a standalone domain.

## Open

- `BDL_KEY` registration (owner) — unlocks tracking, defensive matchups,
  hustle, contracts.
- Screening counts: no public source identified — research note until one.
- Rebound *chances*: tracking-gated; zone rates ship first.
