/**
 * Roster-move timeline (depth list item 5): the statsapi transactions feed
 * for one player — call-ups, options, DFAs, trades, outrighted, signed.
 * Descriptive public record; the description text is the source's own.
 */
export function TransactionsPanel({ tx, limit = 12 }: { tx: any | null; limit?: number }) {
  const rows: any[] = tx?.rows ?? [];
  if (!rows.length) return null;
  const shown = rows.slice(0, limit);
  return (
    <div className="glass-panel p-4">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">Roster moves</h2>
        <span className="text-[10px] text-text-dim">statsapi · since 2019</span>
      </div>
      <ul className="space-y-1">
        {shown.map((r, i) => (
          <li key={`${r.date}-${i}`} className="flex items-baseline gap-3 py-0.5 border-b border-white/[0.03] last:border-0">
            <span className="text-[10px] font-data text-text-dim shrink-0 w-[76px]">{r.date}</span>
            <span className="text-[11px] text-text-secondary leading-snug">{r.desc}</span>
          </li>
        ))}
      </ul>
      {rows.length > shown.length && (
        <p className="text-[10px] text-text-dim mt-2">+{rows.length - shown.length} earlier moves</p>
      )}
    </div>
  );
}
