import { Suspense } from "react";
import { getPercentiles, getPitchers, getTicker } from "@/lib/data";
import { TickerStrip } from "@/components/ui/ticker-strip";
import { pitchersProps } from "@/lib/boards/pitchers";
import { PitchersTable } from "./table";
import { DescriptiveChip, DESCRIPTIVE_LINE, MODEL_NAME } from "@/lib/grades";

export const metadata = { title: "Pitchers" };

function TableSkeleton() {
  return (
    <div className="space-y-4 animate-fade-up">
      <div className="flex gap-2">
        <div className="h-8 w-48 rounded-full bg-white/[0.04] animate-pulse" />
        <div className="h-8 w-24 rounded-full bg-white/[0.04] animate-pulse" />
      </div>
      <div className="h-4 w-32 bg-white/[0.03] rounded animate-pulse" />
      <div className="glass-panel overflow-hidden">
        <div className="h-10 border-b border-border-subtle bg-white/[0.02]" />
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="h-9 border-b border-white/[0.02] flex items-center px-3 gap-4">
            <div className="h-3 w-8 bg-white/[0.03] rounded animate-pulse" />
            <div className="h-3 w-32 bg-white/[0.04] rounded animate-pulse" />
            <div className="h-3 w-12 bg-white/[0.03] rounded animate-pulse" />
            <div className="h-3 flex-1 bg-white/[0.02] rounded animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}

async function PitchersContent() {
  const [pitchers, percentiles, ticker] = await Promise.all([getPitchers(), getPercentiles(), getTicker()]);
  // Meta and the first page only; the full array never leaves the server (lib/boards/shared.ts).
  return (
    <>
      <TickerStrip ticker={ticker} />
      <PitchersTable {...pitchersProps(pitchers)} percentiles={percentiles?.pitchers}
                     pctBySeason={percentiles?.by_season ?? null} />
    </>
  );
}

export default function PitchersPage() {
  return (
    <div className="space-y-4">
      {/*
        * Visually hidden on purpose. This view deliberately carries no printed
        * title — the nav marks position with aria-current and the space goes to
        * rows — but with no heading at all there was nothing for a screen
        * reader's heading navigation to land on. sr-only keeps the density and
        * gives the document a root.
        */}
      <h1 className="sr-only">Pitchers</h1>
      <div className="flex flex-wrap items-center gap-2 animate-fade-up">
        <DescriptiveChip />
        <span className="text-[11px] text-text-dim">{MODEL_NAME}</span>
        <span className="text-[11px] text-text-dim hidden md:inline">· {DESCRIPTIVE_LINE}</span>
      </div>
      <Suspense fallback={<TableSkeleton />}>
        <PitchersContent />
      </Suspense>
    </div>
  );
}
