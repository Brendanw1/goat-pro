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

/** Column kind drives formatting: fractions get 3 decimals, percents/counts 1, integers none. */
type Kind = "frac" | "num" | "text";

function fmt(v: unknown, kind: Kind = "num"): string {
  if (v === null || v === undefined) return "—";
  if (typeof v !== "number") return String(v);
  const r = Number(v.toFixed(kind === "frac" ? 3 : 1));
  if (r === 0) return (0).toFixed(kind === "frac" ? 3 : 1); // -0 must not survive the rounding
  return kind === "frac" ? r.toFixed(3).replace(/^0/, "") : String(r);
}

export function SavantTable({ board }: { board: SavantBoard }) {
  // default sort: the first real stat column — season/id columns are labels, not rankings
  const [sortBy, setSortBy] = useState<string>(board.columns.find((c) => !/^(player|name|team|team_name|season|year|(_)?id)$/i.test(c.key))?.key ?? board.columns[0]?.key);
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

  // per-column kind (fraction vs number) and the sorted numeric values for percentile lookups —
  // the owner ask: "percentile chips per column, within board + season". A cell earns a tint by
  // distance from the column median and a title stating the percentile; below 30 rows it stays quiet.
  const { kinds, ranks } = useMemo(() => {
    const kinds: Record<string, Kind> = {};
    const ranks: Record<string, number[]> = {};
    for (const c of board.columns) {
      const vals = board.rows.map((r) => r[c.key]).filter((v): v is number => typeof v === "number");
      if (!vals.length) { kinds[c.key] = "text"; continue; }
      kinds[c.key] = vals.every((v) => Math.abs(v) < 1) ? "frac" : "num";
      // ids and seasons are not stats — percentiles on them are noise
      const isKey = /(^|_)(id|season|year)$/i.test(c.key);
      if (!isKey && vals.length >= 30) ranks[c.key] = [...vals].sort((a, b) => a - b);
    }
    return { kinds, ranks };
  }, [board]);

  const pctile = (key: string, v: number): { pct: number; n: number } | null => {
    const a = ranks[key];
    if (!a) return null;
    let lo = 0, hi = a.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < v) lo = m + 1; else hi = m; }
    return { pct: Math.round((100 * lo) / a.length), n: a.length };
  };

  function exportCsv() {
    const cols = board.columns;
    const esc = (v: unknown) => {
      const s2 = v == null ? "" : String(v);
      return /[",\n]/.test(s2) ? `"${s2.replace(/"/g, '""')}"` : s2;
    };
    const csv = [cols.map((c) => esc(c.label)).join(","), ...rows.map((r) => cols.map((c) => esc(r[c.key])).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `savant-${board.source?.split("/").pop()?.replace(/\.[a-z]+$/, "") || "board"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

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
                  const kind = kinds[c.key] ?? "num";
                  const p = typeof raw === "number" && kind !== "text" ? pctile(c.key, raw) : null;
                  // Tint by distance from the median: violet = high, cyan = low. Direction-free on purpose (a board mixes
                  // columns where high is good and where low is good), so it never borrows the site's good/bad red-blue.
                  const tint = p && Math.abs(p.pct - 50) >= 10
                    ? { backgroundColor: `rgba(${p.pct > 50 ? "167,139,250" : "34,211,238"},${(0.06 + (Math.abs(p.pct - 50) - 10) / 40 * 0.3).toFixed(3)})` }
                    : undefined;
                  const tip = p ? `${p.pct}th percentile of ${p.n} (board + season)` : undefined;
                  return (
                    <td key={c.key} title={tip} style={tint}
                      className={`px-1.5 text-xs truncate ${c.align === "right" ? "text-right font-data" : "text-left"} ${isName ? "text-text-primary font-medium" : "text-text-secondary"}`}>
                      {isName && r.id && board.link_players ? (
                        <Link prefetch={false} href={`/player/${r.id}?season=${r.season}`} className="hover:underline">
                          {isName && typeof r.team === "string" && /^[A-Z]{2,4}$/.test(r.team) ? (
                            <span className="inline-flex items-center gap-1.5">
                              <PixelTeamLogo team={r.team} size={14} />
                              {fmt(raw, "text")}
                            </span>
                          ) : fmt(raw, "text")}
                        </Link>
                      ) : isName && typeof r.team === "string" && /^[A-Z]{2,4}$/.test(r.team) ? (
                        <span className="inline-flex items-center gap-1.5">
                          <PixelTeamLogo team={r.team} size={14} />
                          {fmt(raw, "text")}
                        </span>
                      ) : (
                        fmt(raw, kind)
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
        <div className="flex items-center gap-3">
          <span className="mr-auto flex items-center gap-1.5 text-[10px] text-text-dim">
            <span className="h-2.5 w-2.5 rounded-sm bg-[rgba(34,211,238,0.36)]" /> low
            <span className="h-2.5 w-2.5 rounded-sm bg-[rgba(167,139,250,0.36)]" /> high
            <span>within board and season, not good/bad</span>
          </span>
          <button onClick={exportCsv} className="px-2.5 py-1 text-[11px] rounded bg-white/[0.04] text-text-secondary hover:bg-white/[0.08] transition-all press-scale">
            Export CSV
          </button>
          <p className="text-[11px] text-text-dim">Page {page} of {totalPages} · {rows.length} rows</p>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="px-2.5 py-1 text-[11px] rounded bg-white/[0.04] text-text-secondary hover:bg-white/[0.08] disabled:opacity-30 transition-all press-scale">← Prev</button>
          <span className="px-2.5 py-1 text-[11px] rounded bg-usf-green/20 text-usf-gold border border-usf-green/30 font-data">{page}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-2.5 py-1 text-[11px] rounded bg-white/[0.04] text-text-secondary hover:bg-white/[0.08] disabled:opacity-30 transition-all press-scale">Next →</button>
        </div>
      </div>
    </div>
  );
}
