import Link from "next/link";
import { getPitchers } from "@/lib/data";
import { logoUrl } from "@/lib/team-pixel";

export const metadata = { title: "Teams" };
// The club list comes from R2 at request time; prerendering it would need the
// export bucket at build.
export const dynamic = "force-dynamic";

/** Club index: every team the boards carry, linking its two-sided team page. */
export default async function TeamsPage() {
  const pitchers = await getPitchers();
  const teams = [...new Set((pitchers ?? []).map((r: any) => r.team).filter(Boolean))].sort() as string[];
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-text-primary">Teams</h1>
      <p className="text-xs text-text-dim">Each club&apos;s pitchers and hitters, the advanced boards cut to one team.</p>
      <div className="flex flex-wrap gap-2">
        {teams.map((t) => {
          const crest = logoUrl(t);
          return (
            <Link key={t} href={`/teams/${t.toLowerCase()}`}
              className="flex items-center gap-2 rounded-lg border border-border-subtle px-3 py-2 text-xs text-text-primary hover:bg-white/[0.04]">
              {crest ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={crest} alt="" width={20} height={20} className="rounded" />
              ) : null}
              {t}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
