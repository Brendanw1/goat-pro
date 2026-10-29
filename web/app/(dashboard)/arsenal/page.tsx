import { Suspense } from "react";
import Link from "next/link";
import { getArsenalCards, getSlotBoard, getMixBoard } from "@/lib/data";
import { ArsenalGrid } from "./grid";
import { DescriptiveChip, DESCRIPTIVE_LINE } from "@/lib/grades";
import { SlotBoard } from "./slot-board";
import { MixBoard } from "./mix-board";
import { joinSlot, querySlot, slotMeta, SLOT_DEFAULTS } from "@/lib/boards/slot";
import { getArsenalBoardRows } from "@/lib/data";

export const metadata = { title: "Arsenal" };

const VIEWS = [
  { key: "types", label: "Pitch types", href: "/arsenal" },
  { key: "slot", label: "Arm slot", href: "/arsenal?view=slot" },
  { key: "mix", label: "Mix", href: "/arsenal?view=mix" },
] as const;

export default async function ArsenalPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const v = (await searchParams).view;
  const view = v === "slot" ? "slot" : v === "mix" ? "mix" : "types";

  return (
    <div className="space-y-4">
      {/*
        * Visually hidden on purpose — the nav marks position with aria-current
        * and the space goes to rows; sr-only gives the document a root heading.
        */}
      <h1 className="sr-only">Arsenal</h1>
      <div className="flex flex-wrap items-center gap-2 animate-fade-up">
        <DescriptiveChip />
        <span className="text-[11px] text-text-dim hidden md:inline">{DESCRIPTIVE_LINE}</span>
      </div>
      <nav aria-label="Arsenal view" className="flex gap-1.5">
        {VIEWS.map((v) => (
          <Link key={v.key} href={v.href} aria-current={view === v.key ? "page" : undefined}
            className={`press-scale rounded-full border px-3 py-1.5 text-xs transition-colors ${
              view === v.key ? "filter-chip-active" : "border-border-subtle text-text-secondary hover:bg-white/[0.03]"
            }`}>
            {v.label}
          </Link>
        ))}
      </nav>
      {view === "slot" ? <SlotView /> : view === "mix" ? <MixView /> : <TypesView />}
    </div>
  );
}

async function TypesView() {
  const cards = await getArsenalCards();
  return (
    <>
      <p className="text-xs text-text-dim">
        Top 10 pitchers per pitch type by Whiff+ · click to view the full leaderboard. Every grade is descriptive.
      </p>
      <ArsenalGrid cards={cards as any} />
    </>
  );
}

async function MixView() {
  const board = await getMixBoard();
  if (!board?.pitchers) return <p className="text-xs text-text-dim">The mix board has not been baked yet (pipeline/web_export.py).</p>;
  // A row without a name is a producer defect, not a renderable row.
  const rows = Object.entries(board.pitchers as Record<string, any>)
    .map(([id, p]) => ({ id, ...p }))
    .filter((r) => typeof r.name === "string" && r.name);
  return <MixBoard rows={rows} season={board.season} league={board.league ?? {}} />;
}

async function SlotView() {
  const pt = String(SLOT_DEFAULTS.filters.pt);
  const [arsenal, board] = await Promise.all([getArsenalBoardRows(pt), getSlotBoard()]);
  if (!board) return <p className="text-xs text-text-dim">The arm-slot board has not been baked yet (pipeline/web_export.py).</p>;
  // Meta and the default first page only; the route pages every other view.
  const joined = joinSlot(arsenal, board as any, pt);
  return <SlotBoard meta={slotMeta(board as any, joined)} initial={querySlot(joined, SLOT_DEFAULTS)} />;
}
