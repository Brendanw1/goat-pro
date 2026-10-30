/**
 * Server-side fetchers for the basketball surfaces (hoops/... keys on R2).
 * Descriptive Phase 1 only — every number is a raw mart value or a plain
 * average/per-36; see pipeline/hoops_export.py for the bake and the LUMA
 * validation gate recorded in hoops/meta.json.
 */
import { cache } from "react";
import { fetchFromR2, fetchGzippedJson } from "./r2";

export type HoopsGameRow = {
  id: string; date: string; season: number; type: string;
  away: string | null; home: string | null;
  away_score: number; home_score: number; ot: number | null;
};
export type HoopsGamesDoc = { season: number; label: string; games: HoopsGameRow[] };
export type HoopsValidation = {
  gate: string; games_2024_25: string; games_2026_27: string; boxes: number;
  credit: string; boxes_ast_note: string;
};
export type HoopsMeta = {
  seasons: Record<string, { games: number; first: string; last: string }>;
  validation: HoopsValidation; note: string;
};
export type HoopsTeamAgg = {
  abbr: string; name: string; g: number; w: number; l: number;
  pts: number; opp_pts: number; fgm: number; fga: number; tpm: number; tpa: number;
  ftm: number; fta: number; reb: number; ast: number; tov: number; stl: number;
  blk: number; paint: number | null; fastbreak: number | null;
};
export type HoopsTeamsDoc = { seasons: Record<string, HoopsTeamAgg[]> };
export type HoopsTeamGame = {
  id: string; date: string; type: string; opp: string | null; home: boolean;
  pts: number; opp_pts: number; res: string;
};
export type HoopsTeamDoc = { seasons: Record<string, HoopsTeamAgg & { games: HoopsTeamGame[] }> };
export type HoopsPlayerRow = {
  id: string; name: string; pos: string | null; team: string | null;
  gp: number; gs: number; min: number; pts: number; reb: number; ast: number;
  stl: number; blk: number; tov: number; pts36: number | null; reb36: number | null; ast36: number | null;
};
export type HoopsPlayersDoc = { seasons: Record<string, HoopsPlayerRow[]> };
export type HoopsPlayerGame = {
  id: string; date: string; opp: string | null; home: boolean; res: string;
  min: number | null; pts: number; reb: number; ast: number; stl: number; blk: number;
  tov: number; pf: number; pm: number | null; fg: string; tp: string; ft: string;
};
export type HoopsPlayerDoc = {
  id: string; name: string;
  seasons: Record<string, {
    team: string | null; gp: number; gs: number;
    totals: { min: number; pts: number; reb: number; ast: number; stl: number; blk: number; tov: number };
    per_game: { min: number; pts: number; reb: number; ast: number; stl: number; blk: number; tov: number };
    per36: { pts: number | null; reb: number | null; ast: number | null };
    games: HoopsPlayerGame[];
  }>;
};
export type HoopsBoxRow = {
  name: string; pos: string | null; starter: boolean; dnp: boolean;
  min: number | null; pts: number | null; reb: number | null; ast: number | null;
  stl: number | null; blk: number | null; tov: number | null; pf: number | null;
  pm: number | null; fg: string | null; tp: string | null; ft: string | null;
};
export type HoopsShot = {
  p: number; t: number | null; x: number | null; y: number | null;
  m: boolean; v: number; pa: number | null; a: string | null; s: string | null; ty: string | null;
};
export type HoopsPlay = {
  p: number; t: number | null; ty: string | null; tx: string | null;
  a: string | null; hs: number; as: number;
};
export type HoopsGameDoc = {
  game: HoopsGameRow;
  teams: { abbr: string | null; side: string; points: number;
           paint: number | null; fastbreak: number | null; reb: number | null;
           ast: number | null; tov: number | null }[];
  boxes: Record<string, HoopsBoxRow[]>;
  shots: HoopsShot[];
  plays: HoopsPlay[];
};

export const getHoopsMeta = cache(async (): Promise<HoopsMeta | null> =>
  (await fetchFromR2<HoopsMeta>("hoops/meta.json").catch(() => null)) ?? null);

export const getHoopsGames = cache(async (season: number): Promise<HoopsGamesDoc | null> =>
  (await fetchFromR2<HoopsGamesDoc>(`hoops/games_${season}.json`).catch(() => null)) ?? null);

export const getHoopsGame = cache(async (gid: string): Promise<HoopsGameDoc | null> =>
  (await fetchGzippedJson<HoopsGameDoc>(`hoops/game/${gid}.json.gz`)) ?? null);

export const getHoopsTeams = cache(async (): Promise<HoopsTeamsDoc | null> =>
  (await fetchFromR2<HoopsTeamsDoc>("hoops/teams.json").catch(() => null)) ?? null);

export const getHoopsTeam = cache(async (abbr: string): Promise<HoopsTeamDoc | null> =>
  (await fetchGzippedJson<HoopsTeamDoc>(`hoops/team/${abbr.toLowerCase()}.json.gz`)) ?? null);

export const getHoopsPlayers = cache(async (): Promise<HoopsPlayersDoc | null> =>
  (await fetchFromR2<HoopsPlayersDoc>("hoops/players.json").catch(() => null)) ?? null);

export const getHoopsPlayer = cache(async (id: string): Promise<HoopsPlayerDoc | null> =>
  (await fetchGzippedJson<HoopsPlayerDoc>(`hoops/player/${id}.json.gz`)) ?? null);

/** Seasons the bake covers, newest first (falls back to nothing before the first bake). */
export async function hoopsSeasons(): Promise<number[]> {
  const meta = await getHoopsMeta();
  return Object.keys(meta?.seasons ?? {}).map(Number).sort((a, b) => b - a);
}
