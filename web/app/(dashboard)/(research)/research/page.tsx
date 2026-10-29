import Link from "next/link";
import { RESEARCH_SECTIONS } from "@/lib/research-sections";

export const metadata = { title: "Research" };

const BLURB: Record<string, string> = {
  "/depth": "Where hitters meet the ball, how damage changes with it, and who is late on velocity.",
  "/plane": "Whether the bat's path matches the pitch's, and how a matched plane forgives timing.",
  "/archetypes": "Two broad swing shapes from six bat-tracking traits, each hitter's five closest swings, and how each shape ages.",
  "/aging": "League age curves for velocity, bat speed, exit velocity and wOBA, with each player's track.",
  "/tunneling": "How long pitch pairs look alike on the way in, and what it buys.",
  "/fatigue": "Times through the order, rest days and velocity fade within an outing.",
  "/buckets": "Pitch movement buckets: what each shape does against hitters, by velocity and break.",
  "/mechanism": "The physics study behind Whiff+: which pitch traits drive whiffs, and why.",
};

export default function ResearchIndex() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-text-primary">Research</h1>
      <p className="max-w-[80ch] text-xs text-text-dim">
        League studies and explainers, each with its own test in RESULTS-MLB. Descriptive unless a section says otherwise.
        Leaderboards live under the top menu.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {RESEARCH_SECTIONS.map((s) => (
          <Link key={s.href} href={s.href} className="glass-panel block p-4 transition-colors hover:bg-white/[0.04]">
            <div className="text-sm font-semibold text-text-primary">{s.label}</div>
            <p className="mt-1 text-xs text-text-dim">{BLURB[s.href]}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
