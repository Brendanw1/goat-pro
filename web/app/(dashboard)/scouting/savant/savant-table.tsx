"use client";

/**
 * One Savant reference board: sortable columns, player-name links where the row
 * carries an MLBAM id, client-side paging. The data is attributed Savant output
 * (see the page header); this component adds no judgement of its own.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import type { SavantBoard } from "@/lib/data";
import { PixelTeamLogo } from "@/components/ui/pixel-team-logo";

const PAGE_SIZE = 25;

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(1).replace(/\.0$/, "");
  return String(v);
}

export function SavantTable({ board }: { board: SavantBoard }) {
  const [sortBy, setSortBy] = useState<string>(board.columns.find((c) => c.key !== "name" && c.key !== "player" && c.key !== "team")?.key ?? board.columns[0]?.key);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    let out = board.rows;
    if (q) {
      const needle = q.toLowerCase();
      out = out.filter((r) =>
        board.columns.filter((c) => c.align === "left").some((c) => String(r[c.key] ?? "").toLowerCase().includes(needle)));
    }
    const dir = sortDir === "asc" ? 1 : -1;
    return [...out].sort((a, b) => {
      const av = a[sortBy], bv = b[sortBy];
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av ?? "").localeCompare(String(bv ?? "")) * dir;
    });
  }, [board.rows, board.columns, q, sortBy, sortDir]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const nameKey = board.columns.find((c) => c.key === "player" || c.key === "name")?.key;

  function handleSort(key: string) {
    if (sortBy === key) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortBy(key); setSortDir("desc"); }
    setPage(1);
  }

  return (
    <div className="glass-panel overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border-subtle">
        <input
          type="text"
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1); }}
          placeholder="Filter by name or team..."
          aria-label={`Filter ${board.title}`}
          className="w-[220px] px-3 py-1 rounded-full text-xs bg-white/[0.04] border border-border-subtle text-text-primary placeholder:text-text-dim focus:border-border-emphasis transition-all"
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-left">
          <caption className="sr-only">{board.title}, sorted by {sortBy} {sortDir}. Page {page} of {totalPages}.</caption>
          <thead>
            <tr>
              {board.columns.map((c) => (
                <th key={c.key} scope="col" aria-sort={sortBy === c.key ? (sortDir === "desc" ? "descending" : "ascending") : "none"}
                  className="sticky top-0 z-10 bg-surface-1 border-b border-border-subtle p-0">
                  <button type="button" onClick={() => handleSort(c.key)}
                    className={`w-full px-1.5 py-2 text-[10px] font-semibold uppercase tracking-wider cursor-pointer select-none transition-colors ${
                      c.align === "right" ? "text-right" : "text-left"
                    } ${sortBy === c.key ? "text-usf-gold" : "text-text-dim hover:text-text-secondary"}`}>
                    {c.label}
                    {sortBy === c.key && <span className="ml-0.5" aria-hidden>{sortDir === "desc" ? "▼" : "▲"}</span>}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r, i) => (
              <tr key={i} className={`border-b border-white/[0.025] hover:bg-white/[0.03] ${i % 2 === 1 ? "bg-white/[0.012]" : ""}`} style={{ height: "32px" }}>
                {board.columns.map((c) => {
                  const raw = r[c.key];
                  const isName = c.key === nameKey;
                  return (
                    <td key={c.key}
                      className={`px-1.5 text-xs truncate ${c.align === "right" ? "text-right font-data" : "text-left"} ${isName ? "text-text-primary font-medium" : "text-text-secondary"}`}>
                      {isName && r.id && board.link_players ? (
                        <Link href={`/player/${r.id}?season=${r.season}`} className="hover:underline">{fmt(raw)}</Link>
                      ) : isName && typeof r.team === "string" && /^[A-Z]{2,4}$/.test(r.team) ? (
                        <span className="inline-flex items-center gap-1.5">
                          <PixelTeamLogo team={r.team} size={14} />
                          {fmt(raw)}
                        </span>
                      ) : (
                        fmt(raw)
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between px-4 py-2.5 border-t border-border-subtle">
        <p className="text-[11px] text-text-dim">Page {page} of {totalPages} · {rows.length} rows</p>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="px-2.5 py-1 text-[11px] rounded bg-white/[0.04] text-text-secondary hover:bg-white/[0.08] disabled:opacity-30 transition-all press-scale">← Prev</button>
          <span className="px-2.5 py-1 text-[11px] rounded bg-usf-green/20 text-usf-gold border border-usf-green/30 font-data">{page}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-2.5 py-1 text-[11px] rounded bg-white/[0.04] text-text-secondary hover:bg-white/[0.08] disabled:opacity-30 transition-all press-scale">Next →</button>
        </div>
      </div>
    </div>
  );
}
