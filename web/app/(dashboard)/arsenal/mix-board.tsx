"use client";

import { useMemo, useState } from "react";
import { useUrlRecord } from "@/lib/use-url-record";
import { PlayerLink } from "@/components/ui/player-transition";
import { PixelTeamLogo } from "@/components/ui/pixel-team-logo";
import { PctChip } from "@/components/ui/shared-ui";
import { sortComparator } from "@/lib/table-sort";

/**
 * The mix board (A2): how many offerings a pitcher has, how evenly he uses
 * them, how far apart they are, how repeatable each is, how wide the velo
 * range. Percentiles (bake-side, vs same-season pitchers with 100+) print on
 * every cell — the chip is where he sits, not a verdict: these metrics carry
 * no good/bad direction except shape scatter (lower = more repeatable, so the
 * column's default sort ascends), and the header note says so.
 */

interface MixRow {
  id: string;
  name: string;
  team?: string | null;
  n: number;
  nTypes?: number;
  effTypes?: number;
  separation?: number | null;
  repeatSd?: number | null;
  veloSpread?: number;
  types?: string[];
  pct?: Record<string, number | null>;
}

const COLS: { key: string; label: string; align: string; sortable: boolean; title?: string }[] = [
  { key: "name", label: "Pitcher", align: "left", sortable: true },
  { key: "team", label: "Team", align: "left", sortable: true },
  { key: "n", label: "Pitches", align: "right", sortable: true, title: "Pitches thrown (types under 3% usage are excluded from the mix metrics)" },
  { key: "nTypes", label: "Pitches#", align: "right", sortable: true, title: "Pitch types thrown at least 3% of the time" },
  { key: "effTypes", label: "Eff. mix", align: "right", sortable: true, title: "How evenly he uses his pitches: three at a third each = 3.0; 80/15/5 ≈ 1.8" },
  { key: "separation", label: "Separation", align: "right", sortable: true, title: "Average distance between his pitch types in velocity (mph) and movement (in)" },
  { key: "repeatSd", label: "Shape scatter", align: "right", sortable: true, title: "How much each pitch's movement varies around its own average, usage-weighted. Lower = more repeatable" },
  { key: "veloSpread", label: "Velo range", align: "right", sortable: true, title: "Fastest minus slowest pitch type, by average velocity" },
];

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function MixBoard({ rows, season, league }: { rows: MixRow[]; season: number; league: Record<string, number | null> }) {
  // Sort rides the URL (?sort=separation&dir=asc), so Back from a profile
  // and a shared link restore the ordering.
  const [sort, setSort] = useUrlRecord({ sort: "effTypes", dir: "desc" });
  const sortKey = sort.sort;
  const sortDir = sort.dir as "asc" | "desc";
  const [shown, setShown] = useState(50);
  const [search, setSearch] = useState("");

  const view = useMemo(() => {
    let out = rows;
    if (search) {
      const q = search.toLowerCase();
      out = out.filter((r) => r.name.toLowerCase().includes(q) || (r.team || "").toLowerCase().includes(q));
    }
    return [...out].sort(sortComparator(sortKey, sortDir));
  }, [rows, search, sortKey, sortDir]);

  const fmtCell = (r: MixRow, key: string): string => {
    const v = num((r as any)[key]);
    if (v === null) return "—";
    if (key === "n" || key === "nTypes") return String(Math.round(v));
    return v.toFixed(1);
  };
  const pctOf = (r: MixRow, key: string): number | null => num(r.pct?.[key]);

  function handleSort(key: string) {
    if (!key) return;
    if (sortKey === key) {
      setSort({ ...sort, dir: sortDir === "desc" ? "asc" : "desc" });
    } else {
      // repeatSd: higher = more scatter = worse; default that sort ascending.
      setSort({ ...sort, sort: key, dir: key === "repeatSd" ? "asc" : "desc" });
    }
    setShown(50);
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-text-dim">
        A description of the arsenal, not a grade: none of these predicted next season beyond Pitching+ and the
        pitcher&apos;s own prior year. The chip on each cell is where he sits among {season} pitchers with 100+ pitches
        (shape scatter: a high chip is MORE scatter — the one metric with a good direction, and its default sort
        ascends). League medians: eff. mix {league.effTypes ?? "—"}, separation {league.separation ?? "—"}, scatter{" "}
        {league.repeatSd ?? "—"} in, velo range {league.veloSpread ?? "—"} mph.
      </p>
      <input
        type="text"
        placeholder="Search pitchers..."
        aria-label="Search the mix board by name"
        value={search}
        onChange={(e) => { setSearch(e.target.value); setShown(50); }}
        className="w-[200px] px-3 py-1.5 rounded-full text-sm bg-white/[0.04] border border-border-subtle text-text-primary placeholder:text-text-dim focus:border-border-emphasis transition-all"
      />
      <div className="glass-panel overflow-hidden">
        <div className="overflow-x-auto"><div className="min-w-max">
          <div className="flex items-center px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-text-dim border-b border-border-subtle">
            {COLS.map((c) => (
              <button key={c.key} type="button" onClick={() => handleSort(c.key)} title={c.title}
                className={`${c.key === "name" ? "w-[180px] text-left" : c.key === "team" ? "w-[56px] text-left" : "w-[86px] text-right"} ${
                  sortKey === c.key ? "text-usf-gold" : "hover:text-text-secondary"} transition-colors`}>
                {c.label}
                {sortKey === c.key && <span className="ml-0.5">{sortDir === "desc" ? "▼" : "▲"}</span>}
              </button>
            ))}
            <div className="w-[150px] text-left">Types</div>
          </div>
          {view.slice(0, shown).map((r, i) => (
            <div key={`${r.id}-${i}`}
              className={`flex items-center px-4 border-b border-white/[0.025] ${i % 2 === 1 ? "bg-white/[0.012]" : ""}`}
              style={{ height: "36px" }}>
              <div className="w-[180px]">
                <PlayerLink href={`/player/${r.id}?season=${season}`} info={{ name: r.name, team: r.team, teamName: r.team, pos: "Pitcher" }} className="hover:underline text-xs text-text-primary">
                  <PixelTeamLogo team={r.team} size={16} className="mr-1.5" />
                  {r.name}
                </PlayerLink>
              </div>
              <div className="w-[56px] text-left text-xs font-data text-text-secondary">{r.team || "—"}</div>
              {["n", "nTypes", "effTypes", "separation", "repeatSd", "veloSpread"].map((key) => {
                const pct = pctOf(r, key);
                return (
                  <div key={key} className="w-[86px] flex items-center justify-end gap-1 text-xs font-data text-text-secondary"
                    title={pct !== null
                      ? `${pct}th percentile of ${season} MLB pitchers (100+ pitches)${key === "repeatSd" ? " — higher = more movement scatter" : ""}`
                      : "Too thin to rank this season"}>
                    <span>{fmtCell(r, key)}</span>
                    {pct !== null && <PctChip p={pct} title={undefined} />}
                  </div>
                );
              })}
              <div className="w-[150px] text-left text-[11px] text-text-dim truncate" title={(r.types || []).join(" · ")}>
                {(r.types || []).join(" · ")}
              </div>
            </div>
          ))}
        </div></div>
      </div>
      {shown < view.length && (
        <button onClick={() => setShown((s) => s + 100)}
          className="px-3 py-1.5 rounded-full text-xs border border-border-subtle text-text-secondary hover:bg-white/[0.03] transition-all press-scale">
          Show more ({view.length - shown} left)
        </button>
      )}
    </div>
  );
}
