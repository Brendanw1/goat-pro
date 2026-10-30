import { Nav } from "@/components/nav";
import { RouteTracker } from "@/components/ui/back-link";
import { LaunchIntro } from "@/components/ui/launch-intro";
import { PlayerTransitionOverlay } from "@/components/ui/player-transition";
import { SnapshotTool } from "@/components/ui/snapshot";
import { GradePctProvider, GradeScopeProvider, GradeScopeToggle } from "@/components/ui/grade-pct";
import { fetchFromR2 } from "@/lib/r2";
import type { StuffPercentiles } from "@/lib/percentiles";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  /*
   * goat-pro is a public site (README: "deployed for anyone to read"), so the
   * dashboard has no session gate: the forked BaseballGOAT auth check was
   * removed, not commented out — there is no mutation surface to guard and
   * every byte the site serves is public baked JSON (clean-room rule 5). The
   * login/register routes and the NextAuth/Turso stack are deleted with it.
   */
  // 17 KB, once per layout render: the population every season Stuff+ / ABStuff+ chip ranks in (components/ui/grade-pct).
  const stuffPcts = await fetchFromR2<StuffPercentiles>("stuff_percentiles.json").catch(() => null);

  return (
    <div className="min-h-screen flex flex-col">
      <LaunchIntro />
      <Nav />
      {/* filter-faithful back links: every pathname+search lands in a session stack */}
      <RouteTracker />
      {/*
        `min-w-0` is load-bearing, not tidiness. As a flex item this defaults to
        `min-width: auto`, which sizes it to max-content — so a table inside its
        own `overflow-x-auto` box still stretched the page, and the document
        scrolled sideways at 320px on four tabs even though every scroll
        container was clipping correctly. WCAG 1.4.10 wants reflow at 320, and
        this is the line that delivers it.
      */}
      {/* pb-24: room to scroll past the fixed Snapshot button (bottom-5 right-5), so it never covers a pager. */}
      <main className="flex-1 min-w-0 px-4 sm:px-6 pt-4 pb-24 print:pb-4 max-w-[1440px] mx-auto w-full page-content">
        <GradePctProvider data={stuffPcts}>
          <GradeScopeProvider>
            <div className="flex justify-end mb-1 -mt-1">
              <GradeScopeToggle />
            </div>
            {children}
          </GradeScopeProvider>
        </GradePctProvider>
      </main>
      <PlayerTransitionOverlay />
      <SnapshotTool />
    </div>
  );
}
