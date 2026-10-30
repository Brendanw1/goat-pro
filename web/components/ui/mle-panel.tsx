import { getTranslation, getTranslationFactors } from "@/lib/data";
import { SortableTable, SortTh } from "@/components/ui/sortable-table";

/**
 * MLB-equivalent lines (RESULTS-MLB §88, milb_translation.py) for every AAA/AA season a player has.
 * Each stat carries its verdict: "tested" beat both the raw line and the MLB mean at forecasting the
 * next MLB season; the rest are descriptive, not a forecast.
 */
const COLS = {
  hitters: [
    { key: "kPct", label: "K%", nd: 1 }, { key: "bbPct", label: "BB%", nd: 1 }, { key: "iso", label: "ISO", nd: 3 },
    { key: "babip", label: "BABIP", nd: 3 }, { key: "woba", label: "wOBA", nd: 3 },
  ],
  pitchers: [
    { key: "kPct", label: "K%", nd: 1 }, { key: "bbPct", label: "BB%", nd: 1 }, { key: "hr9", label: "HR/9", nd: 2 },
    { key: "fip", label: "FIP", nd: 2 },
  ],
} as const;

const fmt = (v: unknown, nd: number) =>
  typeof v === "number" && Number.isFinite(v) ? v.toFixed(nd).replace(/^(-?)0\./, "$1.") : "—";

export async function MlePanel({ id }: { id: string }) {
  const factors = await getTranslationFactors();
  const seasons: number[] = factors?.seasons ?? [];
  if (!seasons.length) return null;
  const out: { kind: "hitters" | "pitchers"; rows: any[] }[] = [];
  for (const kind of ["hitters", "pitchers"] as const) {
    const files = await Promise.all(seasons.map((s) => getTranslation(kind, s)));
    const rows = files.flatMap((f) => (f?.rows ?? []).filter((r: any) => r.id === id).map((r: any) => ({ ...r, season: f.season })));
    if (rows.length) out.push({ kind, rows: rows.sort((a, b) => b.season - a.season || a.level.localeCompare(b.level)) });
  }
  if (!out.length) return null;
  return (
    <div className="space-y-3">
      {out.map(({ kind, rows }) => (
        <div key={kind} className="glass-panel overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border-subtle text-[10px] font-semibold uppercase tracking-wider text-text-dim">
            MLB equivalent · {kind === "hitters" ? "batting" : "pitching"}
          </div>
          <div className="overflow-x-auto">
            <SortableTable className="w-full min-w-max text-xs font-data">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-text-dim">
                  <SortTh className="px-4 py-2 text-left font-semibold">Season</SortTh>
                  <SortTh className="px-2 py-2 text-left font-semibold">From</SortTh>
                  {COLS[kind].map((c) => <SortTh key={c.key} className="px-2 py-2 text-right font-semibold">{c.label}</SortTh>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.season}-${r.level}`} className="border-t border-white/[0.04]">
                    <td className="px-4 py-1.5 text-text-secondary">{r.season}</td>
                    <td className="px-2 py-1.5 font-sans text-text-secondary">{r.level}</td>
                    {COLS[kind].map((c) => {
                      const v = factors?.levels?.[r.level]?.[kind]?.verdict?.[c.key];
                      return (
                        <td key={c.key} title={v === "tested" ? "tested translation (§88)" : v === "provisional" ? "provisional (passed a re-test on already-read rows; confirm on 2026 → 2027)" : "descriptive, not a forecast"}
                          className={`px-2 py-1.5 text-right ${v === "tested" ? "text-text-primary" : v === "provisional" ? "text-text-secondary" : "text-text-dim italic"}`}>
                          {fmt(r[c.key], c.nd)}{v === "provisional" ? "†" : ""}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </SortableTable>
          </div>
          <p className="px-4 py-2 border-t border-white/[0.04] text-[10px] text-text-dim leading-[1.5]">
            His minor-league line translated to the MLB scale: park- and league-adjusted (AAA parks), multiplied by
            the level&apos;s factor, regressed to the level average. Upright numbers are <span className="text-text-secondary">tested</span>:
            they beat both his raw line and the MLB mean at forecasting his next MLB season, if he gets playing time. Numbers marked † are provisional: they passed only a re-test on rows already read once, to be confirmed on 2026 → 2027.{" "}
            <span className="italic">Italic</span> numbers are
            descriptive, not a forecast. AAA and AA 2026 are scored for display only.
          </p>
        </div>
      ))}
    </div>
  );
}
