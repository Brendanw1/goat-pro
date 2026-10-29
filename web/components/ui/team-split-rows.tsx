"use client";
/**
 * Players who changed clubs mid-season: the season row's team cell reads "2TM" (FanGraphs style) and
 * opens one line per club beneath it. Club lines carry that club's stats and (pitchers) its
 * Whiff+; the projections (K+, Prevention+, ...) are season-long and stay on the combined row.
 */
import type { TeamStint } from "@/components/ui/shared-ui";

type Col = { key: string; w?: string; align?: string };

export const multiTeam = (row: any): TeamStint[] | null =>
  Array.isArray(row?.teams) && row.teams.length > 1 ? row.teams : null;

export function TeamCountButton({ row, open, onToggle }: { row: any; open: boolean; onToggle: () => void }) {
  const teams = multiTeam(row)!;
  return (
    <button type="button" onClick={onToggle} aria-expanded={open}
      title={`${teams.map((t) => t.team).join(" → ")} — ${open ? "hide" : "show"} each club's line`}
      className="font-data text-text-secondary hover:text-text-primary underline decoration-dotted underline-offset-2">
      {teams.length}TM {open ? "▾" : "▸"}
    </button>
  );
}

export function TeamSplitRows({ row, columns, fmt }: { row: any; columns: readonly Col[]; fmt: (v: any, key: string) => string }) {
  const lines: any[] = row.teamSplits ?? [];
  return (
    <>
      {lines.map((ln) => (
        <tr key={`${row.id}-${row.season}-${ln.team}`} className="border-b border-white/[0.025] bg-white/[0.02]" style={{ height: "30px" }}
          title={`${row.name} with ${ln.team}: that club's line; projections cover the whole season (the row above)`}>
          <td className="w-[32px]" />
          {columns.map((col) => (
            <td key={col.key} className={`${col.w ?? ""} px-1 text-[11px] text-text-dim truncate ${col.align === "right" ? "text-right font-data" : "text-left"}`}>
              {col.key === "name" ? <span className="pl-5">↳ {ln.team} · {ln.g} G</span>
                : col.key === "team" ? ln.team
                : ln[col.key] !== undefined && ln[col.key] !== null ? fmt(ln[col.key], col.key) : ""}
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
