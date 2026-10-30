# Questions for the owner (2026-10-30) — the after-lanes pass

The three lanes are complete: every queued deliverable is shipped or carries a recorded
verdict (RESULTS-MLB §104–§107 this week alone: two negatives, three shipped surfaces).
These are the decisions only you can make, in priority order.

## 1. Contracts display (gates D-44's surface + all of D-46) — **UPDATED 2026-10-30, likely resolved**

**balldontlie.io** (found via the basketball gap map) carries an NBA API with
`contracts/players` + `contracts/teams` endpoints and — decisive — **terms §6 grants
explicit permission to copy, store, publish, display and distribute** lawfully retrieved
data. Free key (5 req/min) to register; contracts are a small dataset, so the free tier
likely suffices. If live probing confirms coverage and the tier, D-44/D-46 build on
balldontlie and the (a)/(b) choice below dissolves — Cot's/Spotrac stay as private
accuracy references regardless. Your action: register at balldontlie.io and put the key
in the KB `.env` as `BDL_KEY`.

<details>The original question, for the record:</details>

## 1. Contracts display (gates D-44's surface + all of D-46)

Cot's/Spotrac publish no republication license. Pick one:
- **(a) Display with attribution** — the site shows their money (player contract rows,
  team payrolls) like it shows Savant's boards. Richest surface; their terms never
  granted it explicitly.
- **(b) Reference-only (my recommendation)** — Cot's/Spotrac stay private accuracy checks
  against official anchors (MLB's published CBT rankings, AP payrolls); the site shows
  only official/public numbers (CBT rankings, transaction-derived tenure) until a
  licensed source appears. D-46's free-agent LIST would then come from our own data
  (service-class modelling) rather than their tables.

Sub-question if (a): team money only, or player contract rows too?

## 2. Framing-canonical reconciliation (old owner ruling still owed)

The site's framing runs (§76, r .95 vs Savant) and Savant's framing runs are two
canonicals; boards/profiles currently show ours. Confirm ours stays canonical, or do you
want Savant's shown beside it as the reference column on /framing?

## 3. Hitter attack-plan surface (the D-19 remainder)

A composed hitter-side "attack plan" (scouting zone cells + buckets-against + splits +
pitcher matchup in one read) is the only game-plan piece not living on a better surface.
Build it as its own view, or let the existing surfaces stand?

## 4. D-45 pool sourcing (informational)

The clean path for draft-pool values is MLB Communications' slot releases (official PDFs,
parse deterministically). Pipeline/Wikipedia render client-side or lack them. Any
objection to the PDF route, or a source you already trust more?

## 5. Basketball foundation — green light + scope

The goat-pro lanes are done enough to start. Confirm: (a) start now; (b) same discipline
(gap-map first: verify the NBA Stats API endpoints, hidden feeds and player-tracking
availability live, politely, before any schema), (c) a `hoops` mart mirroring
`savant_mart`, and (d) the site surfaces gated the same way (descriptive labels until a
forecast gate passes). Anything you want prioritized in the NBA box (box scores first?
tracking? which surfaces matter most to you)?
