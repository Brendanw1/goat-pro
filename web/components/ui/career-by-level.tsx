import Link from "next/link";
import { getHitters, getMinorsIndex, getMinorsLines, getPitchers } from "@/lib/data";

/**
 * Every season x level a player has a line at: MLB rows from the site's boards (2023+), Rookie
 * through AAA from the MLB Stats API lines (minors_export.py, 2021+). Box-score columns only, so a
 * Rookie line and an MLB line read the same way. MLB rows open the MLB profile; AAA rows from 2023
 * open the AAA Statcast profile.
 */
const ORDER = ["MLB", "AAA", "AA", "A+", "A", "ROK"];
const LEVEL_LABEL: Record<string, string> = { ROK: "Rookie" };

type Row = Record<string, any> & { season: number; level: string };

const num = (v: unknown, nd: number, lead = true): string => {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  const s = v.toFixed(nd);
  return lead ? s : s.replace(/^0\./, ".");
};

async function minorsRows(id: string, kind: "pitchers" | "hitters"): Promise<Row[]> {
  const index = await getMinorsIndex();
  const files = await Promise.all((index?.[kind] ?? []).map((s) => getMinorsLines(kind, s)));
  return files.flatMap((f) => (f?.rows ?? []).filter((r: any) => r.id === id).map((r: any) => ({ ...r, season: f.season })));
}

function href(id: string, r: Row): string | null {
  if (r.level === "MLB") return `/player/${id}?season=${r.season}`;
  if (r.level === "AAA" && r.season >= 2023) return `/minors/player/${id}?season=${r.season}`;
  return null;
}

function Table({ id, title, rows, cols }: {
  id: string; title: string; rows: Row[];
  cols: { key: string; label: string; fmt: (r: Row) => string }[];
}) {
  return (
    <div className="glass-panel overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border-subtle text-[10px] font-semibold uppercase tracking-wider text-text-dim">
        {title}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-max text-xs font-data">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-text-dim">
              <th className="px-4 py-2 text-left font-semibold">Season</th>
              <th className="px-2 py-2 text-left font-semibold">Level</th>
              <th className="px-2 py-2 text-left font-semibold">Team</th>
              <th className="px-2 py-2 text-right font-semibold">Age</th>
              {cols.map((c) => <th key={c.key} className="px-2 py-2 text-right font-semibold">{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const to = href(id, r);
              return (
                <tr key={`${r.season}-${r.level}-${i}`} className="border-t border-white/[0.04]">
                  <td className="px-4 py-1.5 text-text-secondary">{r.season}</td>
                  <td className="px-2 py-1.5 font-sans">
                    {to ? <Link href={to} className="text-text-primary underline decoration-white/20 underline-offset-2 hover:decoration-white/60">{LEVEL_LABEL[r.level] ?? r.level}</Link>
                      : <span className="text-text-secondary">{LEVEL_LABEL[r.level] ?? r.level}</span>}
                  </td>
                  <td className="px-2 py-1.5 font-sans text-text-secondary">{r.team ?? "—"}</td>
                  <td className="px-2 py-1.5 text-right text-text-dim">{num(r.age, 1)}</td>
                  {cols.map((c) => <td key={c.key} className="px-2 py-1.5 text-right text-text-secondary">{c.fmt(r)}</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const sortRows = (rows: Row[]) =>
  rows.sort((a, b) => a.season - b.season || ORDER.indexOf(b.level) - ORDER.indexOf(a.level));

export async function CareerByLevel({ id }: { id: string }) {
  const [mp, mh, mlbP, mlbH] = await Promise.all([
    minorsRows(id, "pitchers"), minorsRows(id, "hitters"), getPitchers(), getHitters(),
  ]);
  const pRows = [...mp, ...mlbP.filter((r) => String(r.id) === id).map((r) => ({ ...r, season: Number(r.season), level: "MLB", bf: r.battersFaced }))];
  const hRows = [...mh, ...mlbH.filter((r) => String(r.id) === id).map((r) => ({ ...r, season: Number(r.season), level: "MLB" }))];
  // a pitcher's few minor league plate appearances are noise, not a hitting career
  const showHitting = hRows.length > 0 && (pRows.length === 0 || mh.reduce((a, r) => a + (r.pa ?? 0), 0) >= 100);
  if (!pRows.length && !showHitting) return null;
  return (
    <div className="space-y-4 mt-5">
      {pRows.length > 0 && (
        <Table id={id} title="Career by level · pitching" rows={sortRows(pRows)} cols={[
          { key: "ip", label: "IP", fmt: (r) => num(r.ip, 1) },
          { key: "bf", label: "BF", fmt: (r) => (typeof r.bf === "number" ? String(r.bf) : "—") },
          { key: "fip", label: "FIP", fmt: (r) => num(r.fip, 2) },
          { key: "whip", label: "WHIP", fmt: (r) => num(r.whip, 2) },
          { key: "kPct", label: "K%", fmt: (r) => num(r.kPct, 1) },
          { key: "bbPct", label: "BB%", fmt: (r) => num(r.bbPct, 1) },
          { key: "kBbPct", label: "K-BB%", fmt: (r) => num(r.kBbPct, 1) },
          { key: "gbPct", label: "GB%", fmt: (r) => num(r.gbPct, 1) },
        ]} />
      )}
      {showHitting && (
        <Table id={id} title="Career by level · hitting" rows={sortRows(hRows)} cols={[
          { key: "pa", label: "PA", fmt: (r) => (typeof r.pa === "number" ? String(r.pa) : "—") },
          { key: "avg", label: "AVG", fmt: (r) => num(r.avg, 3, false) },
          { key: "obp", label: "OBP", fmt: (r) => num(r.obp, 3, false) },
          { key: "slg", label: "SLG", fmt: (r) => num(r.slg, 3, false) },
          { key: "ops", label: "OPS", fmt: (r) => num(r.ops ?? (r.obp + r.slg), 3, false) },
          { key: "kPct", label: "K%", fmt: (r) => num(r.kPct, 1) },
          { key: "bbPct", label: "BB%", fmt: (r) => num(r.bbPct, 1) },
          { key: "hr", label: "HR", fmt: (r) => (typeof r.hr === "number" ? String(r.hr) : "—") },
          { key: "sb", label: "SB", fmt: (r) => (typeof r.sb === "number" ? String(r.sb) : "—") },
        ]} />
      )}
    </div>
  );
}
