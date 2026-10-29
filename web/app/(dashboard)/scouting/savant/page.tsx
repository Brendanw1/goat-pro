import Link from "next/link";
import { getSavantBoard, type SavantBoard } from "@/lib/data";
import { SavantTable } from "./savant-table";
import { DescriptiveChip } from "@/lib/grades";

export const metadata = { title: "Savant reference boards" };

/** The boards the MVP bakes, in page order. Keys are savant/<family>.json in the bucket. */
const BOARDS = [
  { key: "bat_tracking", label: "Bat tracking" },
  { key: "swing_take", label: "Swing & take" },
  { key: "expected_statistics_batter", label: "Expected stats — hitters" },
  { key: "expected_statistics_pitcher", label: "Expected stats — pitchers" },
  { key: "oaa", label: "Outs Above Average" },
  { key: "frv", label: "Fielding Run Value" },
  { key: "sprint_speed", label: "Sprint speed" },
  { key: "baserunning_rv", label: "Baserunning runs" },
  { key: "basestealing_rv", label: "Basestealing runs" },
  { key: "xb_taken", label: "Extra bases taken" },
  { key: "abs_challenges", label: "ABS challenges" },
  { key: "catcher_framing", label: "Catcher framing" },
  { key: "catcher_blocking", label: "Catcher blocking" },
  { key: "catcher_throwing", label: "Catcher throwing" },
] as const;

export default async function SavantPage({
  searchParams,
}: {
  searchParams: Promise<{ board?: string; season?: string }>;
}) {
  const sp = await searchParams;
  const family = BOARDS.some((b) => b.key === sp.board) ? sp.board! : BOARDS[0].key;
  const board = await getSavantBoard(family);
  const season = Number(sp.season) || board?.seasons?.[0];
  const rows = season && board ? board.rows.filter((r) => Number(r.season ?? r.year ?? season) === season) : board?.rows ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="sr-only">Savant reference boards</h1>
        <DescriptiveChip />
        <span className="text-[11px] text-text-dim">
          Attributed Baseball Savant data, re-published as reference boards. These are Savant&apos;s published tables —
          not our models, and not forecasts.
        </span>
      </div>

      <nav aria-label="Savant boards" className="flex flex-wrap gap-1.5">
        {BOARDS.map((b) => (
          <Link key={b.key} href={`/scouting/savant?board=${b.key}`} aria-current={b.key === family ? "page" : undefined}
            className={`press-scale rounded-full border px-3 py-1.5 text-xs transition-colors ${
              b.key === family ? "filter-chip-active" : "border-border-subtle text-text-secondary hover:bg-white/[0.03]"
            }`}>
            {b.label}
          </Link>
        ))}
      </nav>

      {!board ? (
        <p className="text-xs text-text-dim">This board has not been baked yet (pipeline/web_export.py).</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-text-dim">
            <span>Source: <a className="underline hover:text-text-secondary" href={board.source_url} target="_blank" rel="noreferrer">{board.source}</a></span>
            <span>·</span>
            <span className="flex items-center gap-1">
              Seasons:
              {board.seasons.map((s) => (
                <Link key={s} href={`/scouting/savant?board=${family}&season=${s}`} aria-current={s === season ? "page" : undefined}
                  className={`rounded px-1.5 py-0.5 font-data ${s === season ? "bg-white/[0.08] text-text-primary" : "hover:text-text-secondary"}`}>
                  {s}
                </Link>
              ))}
            </span>
            <span>· {rows.length} rows</span>
          </div>
          <SavantTable board={{ ...board, rows } as SavantBoard} />
        </>
      )}
    </div>
  );
}
