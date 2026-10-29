/**
 * Server-side data fetching from R2 (or the local export directory in dev).
 * These functions run in Server Components or Route Handlers only.
 *
 * MVP surface per docs/parity-matrix.md: the pitcher grades leaderboard, the
 * pitcher profile, arsenal cards/pages + the slot board, and the attributed
 * Savant reference boards. Everything here reads baked JSON only (AGENTS.md
 * clean-room rule 5): no mart, no database, no local store at runtime.
 */
import { cache } from "react";
import { fetchFromR2, fetchGzippedJson } from "./r2";
import { overlayStuffPercentiles, type StuffPercentiles } from "./percentiles";

type PitcherRowAny = Record<string, any>;

/** "aaa" reads the same bake run over AAA Statcast (web_export.py --level aaa) under aaa/. */
export type Level = "mlb" | "aaa";
const lv = (level: Level, path: string) => (level === "aaa" ? `aaa/${path}` : path);

/** (id, season) -> value from a {seasons: {season: rows[]}} index file, for joining onto board rows. */
async function seasonIndex(path: string, pick: (rows: any[]) => Record<string, any>, sub?: string): Promise<Map<string, any>> {
  const doc = await fetchFromR2<any>(path, { shared: true }).catch(() => null);
  const out = new Map<string, any>();
  for (const [s, v] of Object.entries<any>(doc?.seasons ?? {})) {
    const rows: any[] = sub ? v?.[sub] : v;
    const byId = new Map<string, any[]>();
    for (const r of rows ?? []) byId.set(String(r.id), [...(byId.get(String(r.id)) ?? []), r]);
    for (const [id, rs] of byId) out.set(`${id}|${s}`, pick(rs));
  }
  return out;
}

export async function getPitchers(level: Level = "mlb"): Promise<PitcherRowAny[]> {
  try {
    const data = (await fetchFromR2<PitcherRowAny[]>(lv(level, "pitchers.json"))) || [];
    if (level !== "mlb") return data;
    // Deception+ (bat-tracking seasons) lives in its own family; joined here so every board and page sees it
    const [dec, war] = await Promise.all([
      seasonIndex("deception_index.json", (rs) => ({ deceptionPlus: rs[0].plus ?? null })),
      seasonIndex("war_index.json", (rs) => ({ war: rs[0].war ?? null }), "pitchers"),
    ]);
    const k = (r: any) => `${r.id}|${r.season}`;
    return data.map((r) => ({ ...r, deceptionPlus: null, war: null, ...dec.get(k(r)), ...war.get(k(r)) }));
  } catch {
    return [];
  }
}

export async function getArsenalPitchType(pitchType: string): Promise<any[]> {
  try {
    const data = await fetchFromR2<any[]>(`arsenal/${pitchType.toLowerCase()}.json`);
    return data || [];
  } catch {
    return [];
  }
}

/** Top-5-per-type cards under /arsenal (baked by pipeline/web_export.py). */
export async function getArsenalCards(): Promise<ArsenalCardAny[]> {
  try {
    const data = await fetchFromR2<ArsenalCardAny[]>("arsenal_cards.json");
    return data || [];
  } catch {
    return [];
  }
}
type ArsenalCardAny = Record<string, any>;

/** MLB VAA-by-zone breakpoints per pitch type x cell (PP8/A9), for the profile's VAA ranks. */
export async function getVaaZonePct(level: Level = "mlb"): Promise<VaaZoneFileAny | null> {
  return fetchFromR2<VaaZoneFileAny>(lv(level, "vaa_zone_pct.json"), { shared: true }).catch(() => null);
}
type VaaZoneFileAny = Record<string, any>;

/** Arm slot, release and per-type slot rows (PP13), for the profile's arm-slot file. */
export async function getArmSlot(id: string, season?: string | number, level: Level = "mlb"): Promise<any | null> {
  return perSeasonFile("slot", id, season, level);
}

/**
 * A per-pitcher family baked as {id}-{season}.json plus a bare {id}.json
 * (latest season). The bare file is the fallback for older bakes; its own
 * `season` field says which season it holds, and panels label it.
 */
async function perSeasonFile(dir: string, id: string, season: string | number | undefined, level: Level): Promise<any | null> {
  // Both candidates at once: the fallback costs one cheap 404 hop, not a serial wait.
  const [bySeason, bare] = await Promise.all([
    season !== undefined && season !== ""
      ? fetchFromR2<any>(lv(level, `${dir}/${id}-${season}.json`)).catch(() => null)
      : null,
    fetchFromR2<any>(lv(level, `${dir}/${id}.json`)).catch(() => null),
  ]);
  return bySeason ?? bare;
}

/** The slot board file (A3/A4): release + grades per pitcher, joined with arsenal rows at query time. */
export async function getSlotBoard(): Promise<SlotBoardFileAny | null> {
  return fetchFromR2<SlotBoardFileAny>("slot_board.json", { shared: true }).catch(() => null);
}
type SlotBoardFileAny = Record<string, any>;

/** Measured per-pitch run-value card (PP9, measured half): RV/100 per type with an 80% range. */
export async function getPitchRv(id: string, level: Level = "mlb"): Promise<any | null> {
  return fetchFromR2<any>(lv(level, `pitch_rv/${id}.json`)).catch(() => null);
}

/** One season's location-mix file (PP20): league prices + every pitcher's mix decomposition. */
export async function getZoneMix(season: number | string, level: Level = "mlb"): Promise<any | null> {
  return fetchFromR2<any>(lv(level, `zone_mix/${season}.json`), { shared: true }).catch(() => null);
}

/** The arsenal mix board (A2/PP11): usage entropy, separation, scatter, velo range. */
export async function getMixBoard(): Promise<any | null> {
  return fetchFromR2<any>("arsenal.json", { shared: true }).catch(() => null);
}

/** The hitters leaderboard (H1/H3/H4): slash + derived wOBA + batted-ball + discipline. */
export async function getHitters(level: Level = "mlb"): Promise<HitterRowAny[]> {
  try {
    const data = (await fetchFromR2<HitterRowAny[]>(lv(level, "hitters.json"))) || [];
    if (level !== "mlb") return data;
    // the site's own fielding models, from their own families: range runs (all positions summed, the
    // position with the most chances) and Framing+ for catchers
    const [range, framing, war] = await Promise.all([
      seasonIndex("defense_index.json", (rs) => ({
        rangeRuns: Math.round(rs.reduce((a, r) => a + (r.runs ?? 0), 0) * 10) / 10,
        rangePos: [...rs].sort((a, b) => (b.chances ?? 0) - (a.chances ?? 0))[0]?.pos ?? null,
      })),
      seasonIndex("framing_plus.json", (rs) => ({ framingPlus: rs[0].plus ?? null })),
      seasonIndex("war_index.json", (rs) => ({ war: rs[0].war ?? null }), "hitters"),
    ]);
    const k = (r: any) => `${r.id}|${r.season}`;
    return data.map((r) => ({ ...r, ...range.get(k(r)), ...framing.get(k(r)), ...war.get(k(r)) }));
  } catch {
    return [];
  }
}
type HitterRowAny = Record<string, any>;

/** Hitter season doc (hitters/{id}.json or hitters/{id}-{season}.json). */
export async function getHitterProfile(id: string, season?: string, level: Level = "mlb"): Promise<any | null> {
  const [s, bare] = await Promise.all([
    season ? fetchFromR2<any>(lv(level, `hitters/${id}-${season}.json`)).catch(() => null) : null,
    fetchFromR2<any>(lv(level, `hitters/${id}.json`)).catch(() => null),
  ]);
  return s ?? bare;
}

/** Per-player game log (wave 2c, gzipped): per-game lines for either side. */
export async function getGameLog(id: string, season: string | number, level: Level = "mlb"): Promise<any | null> {
  return fetchGzippedJson<any>(lv(level, `gamelog/${id}-${season}.json.gz`)).catch(() => null);
}

/** D-12/D-13 site defense file (pipeline/defense_export.py): position cards with chance lists, catcher framing. MLB only. */
export async function getDefense(id: string, season: string | number): Promise<any | null> {
  return fetchGzippedJson<any>(`defense/${id}-${season}.json.gz`).catch(() => null);
}

/** Whiff+ explained (pipeline/whiff_shap.py): TreeSHAP of the cross-fit boosters in Whiff+ points, overall + per type. MLB only. */
export async function getWhiffShap(id: string, season: string | number): Promise<any | null> {
  return fetchGzippedJson<any>(`whiff_shap/${id}-${season}.json.gz`).catch(() => null);
}

/** Per-PA pitch sequences (wave 6, gzipped): every pitch under every PA, joined from the gamelog rows' `g`. */
/** Every pitch of a player-season, compact columns (pitch explorer); side P = thrown, H = seen. */
export async function getPitchFile(side: "P" | "H", id: string, season: string | number, level: Level = "mlb"): Promise<any | null> {
  return fetchGzippedJson<any>(lv(level, `pitches/${side}${id}-${season}.json.gz`)).catch(() => null);
}

export async function getPaLog(id: string, season: string | number, level: Level = "mlb"): Promise<any | null> {
  return fetchGzippedJson<any>(lv(level, `pa_log/${id}-${season}.json.gz`)).catch(() => null);
}

/** One season's Pipeline prospect rankings (Top 100 + teams + positions). */
export async function getProspectsSeason(year: number | string): Promise<any | null> {
  return fetchFromR2<any>(`prospects/${year}.json`, { shared: true }).catch(() => null);
}

/** One player's Pipeline ranking history, for the profile badges. */
export async function getProspectRank(id: string): Promise<any | null> {
  return fetchFromR2<any>(`prospect_rank/${id}.json`).catch(() => null);
}

/** The latest day's games, for the home page's report links. */
export async function getRecentGames(): Promise<any | null> {
  return fetchFromR2<any>("recent_games.json", { shared: true }).catch(() => null);
}

/** One game's box score + PA table (wave 10). */
export async function getGameReport(gid: string, level: Level = "mlb"): Promise<any | null> {
  const g = await fetchGzippedJson<any>(lv(level, `games/${gid}.json.gz`)).catch(() => null);
  if (g || level !== "mlb") return g;
  // postseason games (pipeline/postseason.py): the same schema + lineups, series and wpa
  return fetchGzippedJson<any>(`postseason/games/${gid}.json.gz`).catch(() => null);
}

/** Per-player career file: this level's seasons (headline + pitcher mix per season). */
export async function getCareer(id: string, level: Level = "mlb"): Promise<any | null> {
  return fetchFromR2<any>(lv(level, `career/${id}.json`)).catch(() => null);
}

/** Per-player chart datasets (wave 7): velo KDE, spin clock, release cloud, location grids, count lattice. */
export async function getVisuals(id: string, season: string | number, level: Level = "mlb"): Promise<any | null> {
  return fetchGzippedJson<any>(lv(level, `visuals/${id}-${season}.json.gz`)).catch(() => null);
}

/** Hitter swing profile from Statcast bat tracking (depth item 1): distributions, splits, swords. */
export async function getSwingProfile(id: string, season: string | number, level: Level = "mlb"): Promise<any | null> {
  return fetchGzippedJson<any>(lv(level, `swing/${id}-${season}.json.gz`)).catch(() => null);
}

/** League aging curves (depth item 7): FF velo / bat speed / EV / wOBA by age. */
export async function getAgingCurves(): Promise<any | null> {
  return fetchFromR2<any>("aging/curves.json", { shared: true }).catch(() => null);
}

/** Decline read: latest-season FF velo vs previous, with IL moves. */
export async function getDeclineIndex(): Promise<any | null> {
  return fetchFromR2<any>("aging/decline_index.json", { shared: true }).catch(() => null);
}

/** Prospect bridges: draft-age clocks and tier debut ages/arcs. */
export async function getProspectAging(): Promise<any | null> {
  return fetchFromR2<any>("aging/prospect_aging.json", { shared: true }).catch(() => null);
}

/** One player's by-age track (3+ qualified seasons). */
export async function getAgingTrack(id: string): Promise<any | null> {
  return fetchGzippedJson<any>(`aging/${id}.json.gz`).catch(() => null);
}

/** Per-game win-probability file: timeline + top swings (depth item 6). */
export async function getGameWpa(gid: string, level: Level = "mlb"): Promise<any | null> {
  return fetchGzippedJson<any>(lv(level, `wpa/${gid}.json.gz`)).catch(() => null);
}

/** Movement-bucket board for one season + site pitch type (bake family `pitches`). */
export async function getBucketBoard(season: number | string, type: string, level: Level = "mlb"): Promise<any | null> {
  return fetchFromR2<any>(lv(level, `buckets/${season}-${type}.json`)).catch(() => null);
}

/** League range board: §81 runs + Savant OAA/FRV beside (D-14). */
export async function getDefenseIndex(): Promise<any | null> {
  return fetchFromR2<any>("defense_index.json", { shared: true }).catch(() => null);
}

/** Framing+ board per season with zone grids (gated vs Savant; PREREG). */
export async function getFramingPlus(): Promise<any | null> {
  return fetchFromR2<any>("framing_plus.json", { shared: true }).catch(() => null);
}

/** Swing-disruption profile per pitcher-season (item 10). */
export async function getDeception(id: string, season: string | number): Promise<any | null> {
  return fetchGzippedJson<any>(`deception/${id}-${season}.json.gz`).catch(() => null);
}

/** The physics study's published tables (item 9): mechanism/tables.json. */
export async function getMechanismTables(): Promise<any | null> {
  return fetchFromR2<any>("mechanism/tables.json", { shared: true }).catch(() => null);
}

/** Farm-system output table + tier time-to-MLB curves + risers (item 8). */
export async function getFarmOutput(): Promise<any | null> {
  return fetchFromR2<any>("prospects/farm.json", { shared: true }).catch(() => null);
}

/** Site WAR (pipeline/war.py, RESULTS-MLB §85): {seasons: {season: {rpw, hitters[], pitchers[]}}}, MLB only. */
export async function getWarIndex(): Promise<any | null> {
  return fetchFromR2<any>("war_index.json", { shared: true }).catch(() => null);
}

/** Trade tracker season (pipeline/trades.py): deals, what each club got back, team net run value. */
export async function getTrades(season: number | string): Promise<any | null> {
  return fetchFromR2<any>(`trades/${season}.json`, { shared: true }).catch(() => null);
}

/** Postseason brackets, leaders and each club's latest postseason lineup (pipeline/postseason.py). */
export async function getPostseason(): Promise<any | null> {
  return fetchFromR2<any>("postseason/index.json", { shared: true }).catch(() => null);
}

/** Would-it-dong board (pipeline/dong.py, RESULTS-MLB §86): per season + career rows, league per-park counts. */
export async function getDongBoard(): Promise<any | null> {
  return fetchFromR2<any>("dong/board.json", { shared: true }).catch(() => null);
}

/** One batter's would-it-dong file: season summaries + every ball that clears at least one park. */
export async function getDong(id: string): Promise<any | null> {
  return fetchGzippedJson<any>(`dong/players/${id}.json.gz`).catch(() => null);
}

/** Role conversion boards (pipeline/role_conversion.py, RESULTS-MLB §87): RP->SP and SP->RP candidates. */
export async function getRoles(): Promise<any | null> {
  return fetchFromR2<any>("roles/roles.json", { shared: true }).catch(() => null);
}

/** League WPA boards per season + the year's biggest swings. */
export async function getWpaIndex(level: Level = "mlb"): Promise<any | null> {
  return fetchFromR2<any>(lv(level, "wpa_index.json"), { shared: true }).catch(() => null);
}

/** Draft + rank hit-rate tables (depth item 5): public-source descriptive joins. */
export async function getDraftHitRates(): Promise<any | null> {
  return fetchFromR2<any>("draft/hit_rates.json", { shared: true }).catch(() => null);
}

/** Per-player roster-move timeline from the statsapi transactions feed. */
export async function getTransactions(id: string): Promise<any | null> {
  return fetchGzippedJson<any>(`transactions/${id}.json.gz`).catch(() => null);
}

/** Fatigue profile per pitcher-season: TTO / rest / velo-fade (depth item 3). */
export async function getLoadProfile(id: string, season: string | number, level: Level = "mlb"): Promise<any | null> {
  return fetchGzippedJson<any>(lv(level, `load/${id}-${season}.json.gz`)).catch(() => null);
}

/** League fatigue board rows per season + league TTO baselines. */
export async function getLoadIndex(): Promise<any | null> {
  return fetchFromR2<any>("load_index.json", { shared: true }).catch(() => null);
}

/** League swing-board rows per season (100+ tracked swings). */
export async function getSwingIndex(): Promise<any | null> {
  return fetchFromR2<any>("swing_index.json", { shared: true }).catch(() => null);
}

/** Per-season 20-80 skill grades for every hitter (the league skill board's rows). */
export async function getHitterSkillIndex(): Promise<any | null> {
  return fetchFromR2<any>("hitter_skill_index.json", { shared: true }).catch(() => null);
}

/** League per-split-cell lines + per-type rates (the Splits tab's benchmark rows). */
export async function getHitterSplitBenchmarks(level: Level = "mlb"): Promise<any | null> {
  return fetchFromR2<any>(lv(level, "benchmarks/hitter_splits.json"), { shared: true }).catch(() => null);
}

/** Home-strip data: the latest day's best lines + season Whiff+ movers. */
export async function getTicker(): Promise<any | null> {
  return fetchFromR2<any>("ticker.json", { shared: true }).catch(() => null);
}

/** League zone-cell + count references per season x batter hand (scouting-card overlays). */
export async function getScoutingLeague(level: Level = "mlb"): Promise<any | null> {
  return fetchFromR2<any>(lv(level, "scouting_league.json"), { shared: true }).catch(() => null);
}

/** Hitter spray chart balls (wave 2c, gzipped, raw hc_x/hc_y feet). */
export async function getSpray(id: string, season: string | number, level: Level = "mlb"): Promise<any | null> {
  return fetchGzippedJson<any>(lv(level, `spray/${id}-${season}.json.gz`)).catch(() => null);
}

/** League spray-angle references per season x batter hand. */
export async function getSprayRefs(level: Level = "mlb"): Promise<any | null> {
  return fetchFromR2<any>(lv(level, "spray_refs.json"), { shared: true }).catch(() => null);
}

/** Run value in context (PP19, wave 4): leverage splits per pitcher-season. */
export async function getSituational(id: string, season?: string | number, level: Level = "mlb"): Promise<any | null> {
  return perSeasonFile("situational", id, season, level);
}

/** Hitter scouting card (wave 3, gzipped): zone cells, count rows, skill grades. */
export async function getHitterScouting(id: string, season: string | number, level: Level = "mlb"): Promise<any | null> {
  return fetchGzippedJson<any>(lv(level, `hitter_scouting/${id}-${season}.json.gz`)).catch(() => null);
}

/** Hitter percentile populations (percentiles.json hitters section) + dense wOBA. */
export async function getHitterPercentiles(season?: string | number, level: Level = "mlb"): Promise<any | null> {
  const file = await fetchFromR2<any>(lv(level, "percentiles.json"), { shared: true }).catch(() => null);
  if (!file?.hitters) return null;
  const bySeason = file.hitters.by_season ?? {};
  const dense = file.hitters_dense ?? {};
  return {
    by_season: bySeason,
    dense,
    shrunk_by_season: file.shrunk_by_season ?? null,
    season: season != null && bySeason[String(season)] ? String(season) : null,
  };
}

/**
 * percentiles.json (P14 population quantiles) with the dense grade breakpoints
 * from stuff_percentiles.json (G1) overlaid — for ONE season: a 2023 profile
 * ranks against 2023 arms. Falls back to the pooled section when the season
 * section is missing (older bakes).
 */
export async function getPercentiles(season?: string | number | null, level: Level = "mlb"): Promise<any> {
  try {
    const [data, stuff] = await Promise.all([
      fetchFromR2<any>(lv(level, "percentiles.json")),
      fetchFromR2<StuffPercentiles>(lv(level, "stuff_percentiles.json")).catch(() => null),
    ]);
    if (!data) return null;
    const section =
      season !== undefined && season !== null && data.by_season
        ? data.by_season[String(season)] ?? data.pooled ?? data
        : data.pooled ?? data;
    const dense = stuff
      ? (season !== undefined && season !== null && stuff.by_season
          ? stuff.by_season[String(season)] ?? stuff.pooled ?? stuff
          : stuff.pooled ?? stuff)
      : null;
    const overlaid = overlayStuffPercentiles(section, dense);
    // by_season rides along (boards tint cells against the ROW's own season;
    // shrunk_by_season is where the profile panels' sample-adjusted ranks live)
    return { ...overlaid, by_season: data.by_season ?? null, shrunk_by_season: data.shrunk_by_season ?? null };
  } catch {
    return null;
  }
}

/** Dense grade breakpoints alone (the GradePct chips in the dashboard layout). */
export async function getStuffPercentiles(): Promise<StuffPercentiles | null> {
  return fetchFromR2<StuffPercentiles>("stuff_percentiles.json").catch(() => null);
}

/**
 * id -> name, type, sample. `t` is "P" for every MVP entry (pitchers only).
 * Baked by pipeline/web_export.py; the nav search and profile loaders read it.
 */
export interface PlayerIndexEntry { n: string | null; t: string | null; tm?: string | null; bf?: number | null; season?: number | null }
export const getPlayerIndex = cache(async (): Promise<Record<string, PlayerIndexEntry> | null> =>
  fetchFromR2<Record<string, PlayerIndexEntry>>("player_index.json").catch(() => null));

/**
 * The pitcher profile file (PP1–PP3, PP6–PP8, PP13 subset). The producer puts
 * every displayed field on the file; the leaderboard-row merge below is a
 * fallback so a file baked before a new leaderboard column still shows the raw
 * rates — the boards only read columns the producer emits, so a missing field
 * never renders as a stub.
 */
export async function getPlayerProfile(id: string, season?: string | number, level: Level = "mlb", opts: { noBoardFallback?: boolean } = {}): Promise<any | null> {
  // A leaderboard row links with its season: players/{id}-{season}.json holds
  // that season's numbers. The bare {id}.json is the latest graded season, and
  // the fallback when a season file is missing (older bakes, bad param).
  const [bySeason, bare] = await Promise.all([
    season !== undefined ? fetchFromR2<any>(lv(level, `players/${id}-${season}.json`)).catch(() => null) : null,
    fetchFromR2<any>(lv(level, `players/${id}.json`)).catch(() => null),
  ]);
  const profile = bySeason ?? bare;
  if (profile) {
    try {
      const pitchers = await getPitchers(level);
      const match = pitchers.find((p) => String(p.id) === String(id));
      if (match) {
        for (const key of ["kPct", "bbPct", "kBbPct", "cswPct", "whiffPct", "gbPct", "velo", "ivb",
          "era", "fip", "whip", "ip", "battersFaced", "pitches", "hits", "walks",
          "stuffPlus", "pitchingPlus", "confidence"]) {
          if (profile[key] === undefined && match[key] !== undefined) profile[key] = match[key];
        }
      }
    } catch {}
    return profile;
  }
  // Compose a minimal profile from the leaderboard row (no invented fields).
  // noBoardFallback: the caller has a hitter doc to try first and skips the
  // 10 MB pitchers.json download a hitter id would otherwise trigger for nothing.
  if (opts.noBoardFallback) return null;
  try {
    const pitchers = await getPitchers(level);
    const match = pitchers.find((p) => String(p.id) === String(id));
    if (match) {
      return {
        ...match,
        position: "P",
        bats: null,
        height: null,
        weight: null,
        pitches: [],
        battedBall: [],
        movementProfile: [],
        vaaByZone: null,
        vaaByPitch: [],
        release: {},
        percentiles: null,
      };
    }
  } catch {}
  return null;
}

/** One attributed Savant reference board (D5), baked from the mart's lb_* tables. */
export interface SavantBoard {
  family: string;
  title: string;
  source: string;
  source_url: string;
  label: string;
  /** Rows may open a goat-pro profile (pitcher-side boards only). */
  link_players?: boolean;
  seasons: number[];
  columns: { key: string; label: string; align?: "left" | "right"; kind?: string }[];
  rows: Record<string, any>[];
}
export async function getSavantBoard(family: string): Promise<SavantBoard | null> {
  return fetchFromR2<SavantBoard>(`savant/${family}.json`).catch(() => null);
}

/** parks.json (pipeline/park_factors.py, RESULTS-MLB §70): EB venue factors for the confirmed components, by hand. */
export async function getParks(): Promise<any | null> {
  return fetchFromR2<any>("parks.json").catch(() => null);
}

/** meta.json: export version, model-card fingerprints, per-file manifests. */
export async function getMeta(): Promise<any | null> {
  return fetchFromR2<any>("meta.json").catch(() => null);
}

/** /minors stat-line boards (minors_export.py): one season of every level, pitchers or hitters. */
export async function getMinorsLines(kind: "pitchers" | "hitters", season: number | string): Promise<any | null> {
  return fetchFromR2<any>(`minors/${kind}-${season}.json`, { shared: true }).catch(() => null);
}
export async function getMinorsIndex(): Promise<{ levels: string[]; pitchers: number[]; hitters: number[] } | null> {
  return fetchFromR2<any>("minors/index.json", { shared: true }).catch(() => null);
}

/** /minors MLEs (milb_translation.py, RESULTS-MLB §88): AAA/AA MLB-equivalent lines for one season. */
export async function getTranslation(kind: "pitchers" | "hitters", season: number | string): Promise<any | null> {
  return fetchFromR2<any>(`translation/${kind}-${season}.json`, { shared: true }).catch(() => null);
}
/** translation/factors.json: factor, k and verdict ("tested" | "descriptive") per level x kind x stat. */
export async function getTranslationFactors(): Promise<any | null> {
  return fetchFromR2<any>("translation/factors.json", { shared: true }).catch(() => null);
}
