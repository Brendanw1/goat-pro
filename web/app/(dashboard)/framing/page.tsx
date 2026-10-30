import Link from "next/link";
import { getFramingPlus } from "@/lib/data";
import { DescriptiveChip, DESCRIPTIVE_LINE } from "@/lib/grades";
import { FramingZoneRow } from "@/components/ui/framing-zone";
import { SortableTable, SortTh } from "@/components/ui/sortable-table";

export const dynamic = "force-dynamic";

export const metadata = { title: "Framing+" };

type Q = { season?: string };

/**
 * Framing+ (D-13 leg 1): strikes a catcher steals above a called-strike model
 * that holds location, count, handedness and pitch fixed — and never saw his
 * own pitches (catcher-grouped folds, the site's memorization rule applied to
 * the credited player). Pre-registered, gated against Baseball Savant's
 * framing board (per-season r .89-.97 2021-26, year-to-year stickiness dead
 * even with theirs) — their number sits beside ours on every row. Click a row
 * for the visual: where he steals strikes, as a heat grid over the plate.
 */

export default async function FramingPage({ searchParams }: { searchParams?: Promise<Q> }) {
  const q = (await searchParams) ?? {};
  const doc = await getFramingPlus();
  const seasons = Object.keys(doc?.seasons ?? {}).map(Number).sort((a, b) => b - a);
  const season = seasons.includes(Number(q.season)) ? Number(q.season) : seasons[0];
  const rows: any[] = doc?.seasons?.[String(season)] ?? [];

  const chip = (on: boolean) =>
    `px-2.5 py-1 rounded-md text-[11px] border ${on ? "border-usf-gold/60 text-text-primary bg-white/[0.06]" : "border-border-subtle text-text-secondary hover:bg-white/[0.04]"}`;

  return (
    <div className="space-y-4">
      <h1 className="sr-only">Framing+</h1>
      <div className="flex flex-wrap items-center gap-2 animate-fade-up">
        <DescriptiveChip />
        <span className="text-[11px] text-text-dim hidden md:inline">{DESCRIPTIVE_LINE}</span>
      </div>
      <p className="text-xs text-text-dim max-w-[85ch]">
        Our catcher-framing model&apos;s read: <span className="text-text-secondary">Framing+</span> on the site&apos;s
        100/10 scale among that season&apos;s 2,500+ taken-pitch catchers, with the stolen-strike count and its run
        value (each strike priced at the season&apos;s empirical count gap, ~.15 runs). The model prices location,
        count, handedness, pitch and era — never the catcher — and no prediction came from a fold that saw him
        (pre-registered: PREREG-framing-plus.md; gates vs Savant&apos;s board passed: per-season r .89–.97, stickiness
        .60 vs their .60). Their runs sit in the last column, labelled. Click any row for where he steals them.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {seasons.map((s) => (
          <Link key={s} href={`/framing?season=${s}`} className={chip(s === season)}>{s}</Link>
        ))}
        <span className="w-px h-4 bg-border-subtle mx-1" />
        <Link href="/defense/catchers" className={chip(false)}>Catcher board: blocking + throwing</Link>
      </div>
      <div className="glass-panel overflow-hidden">
        <div className="overflow-x-auto">
          <SortableTable className="w-full min-w-max text-xs font-data">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-text-dim">
                <SortTh className="px-4 py-2 text-left font-semibold">Catcher</SortTh>
                <SortTh className="px-2 py-2 text-right font-semibold">Taken</SortTh>
                <SortTh className="px-2 py-2 text-right font-semibold">Framing+</SortTh>
                <SortTh className="px-2 py-2 text-right font-semibold">Runs</SortTh>
                <SortTh className="px-2 py-2 text-right font-semibold">Strikes +</SortTh>
                <SortTh className="px-2 py-2 text-right font-semibold">Savant</SortTh>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => <FramingZoneRow key={r.id} row={{ ...r, season }} />)}
            </tbody>
          </SortableTable>
        </div>
        <div className="px-4 py-2 text-[11px] text-text-dim border-t border-border-subtle">
          {rows.length} catchers with 2,500+ taken pitches · rows expand to the zone visual · both boards positive-good
        </div>
      </div>
    </div>
  );
}
