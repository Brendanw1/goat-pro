"use client";

/**
 * Player hand-off (owner 2026-10-04): clicking a player in a list dims the page in the team's colour, with the name,
 * team and position large, expanding from the click; it fades out a beat after the profile has mounted. Nothing loads
 * for it (the props are what the list row already had), so it costs one fixed div.
 *
 * Why a PlayerReady marker instead of usePathname: (dashboard)/loading.tsx makes the router commit the URL as soon as the
 * skeleton shows, before the profile's data arrives; the profile itself mounting is the real "ready".
 */
import Link from "next/link";
import { useEffect, useState, type ComponentProps, type MouseEvent } from "react";
/** Team colour map + readable-text rule, restored locally: the defense pages that owned them are deleted. */
const TEAM_COLORS: Record<string, string> = {};
const teamText = (color: string | null | undefined): string | null | undefined =>
  color ? "#f3f5f6" : undefined;

export interface PlayerTransitionInfo { name: string; team?: string | null; teamName?: string | null; color?: string | null; pos?: string | null }
type State = (PlayerTransitionInfo & { x: number; y: number; at: number }) | null;

let listener: ((s: State | "ready") => void) | null = null;
const emit = (s: State | "ready") => listener?.(s);

/** A Link to /player/[id] that plays the hand-off. Modified clicks (new tab etc.) behave like a plain link. */
export function PlayerLink({ info, onClick, ...props }: ComponentProps<typeof Link> & { info: PlayerTransitionInfo }) {
  return (
    <Link prefetch={false} {...props} onClick={(e: MouseEvent<HTMLAnchorElement>) => {
      onClick?.(e);
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      emit({ ...info, x: e.clientX, y: e.clientY, at: performance.now() });
    }} />
  );
}

/** Rendered by the profile page: the hand-off ends once this mounts. */
export function PlayerReady() {
  useEffect(() => emit("ready"), []);
  return null;
}

/** "Rodriguez, Blaze" -> "Blaze Rodriguez": lists sort by last name, a title card reads first name first. */
export const displayName = (n: string) => { const m = /^([^,]+),\s*(.+)$/.exec(n); return m ? `${m[2]} ${m[1]}` : n; };

// Scaled to the load (owner 2026-10-04: "quicker if the page loads quicker"): a load under FAST_MS gets no hold and a short
// fade, so a prefetched profile reads as a quick flash of the name; a slow one holds a beat so the swap looks intentional.
const FAST_MS = 300;
const HOLD_MS = 160;
const FADE_MS = 200;
const FAST_FADE_MS = 110;
const GIVE_UP_MS = 8000;  // a failed navigation never leaves the screen dimmed

export function PlayerTransitionOverlay() {
  const [s, setS] = useState<State>(null);
  const [leaving, setLeaving] = useState(false);
  const [fade, setFade] = useState(FADE_MS);
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const close = (delay: number, ms: number) => {
      timers.push(setTimeout(() => { setFade(ms); setLeaving(true); }, delay), setTimeout(() => { setS(null); setLeaving(false); }, delay + ms));
    };
    listener = (next) => {
      if (next === "ready") {
        setS((cur) => {
          if (cur) { timers.splice(0).forEach(clearTimeout); const fast = performance.now() - cur.at < FAST_MS; close(fast ? 0 : HOLD_MS, fast ? FAST_FADE_MS : FADE_MS); }
          return cur;
        });
        return;
      }
      timers.splice(0).forEach(clearTimeout);
      setLeaving(false); setS(next); close(GIVE_UP_MS, FADE_MS);
    };
    return () => { listener = null; timers.forEach(clearTimeout); };
  }, []);
  if (!s) return null;
  const color = s.color ?? (s.team ? TEAM_COLORS[s.team] : null) ?? "#2b3a33";
  const text = teamText(color) ?? "var(--color-text-secondary)";
  return (
    <div aria-live="polite" role="status" data-testid="player-transition"
      className={`fixed inset-0 z-[200] grid place-items-center transition-opacity ease-out ${leaving ? "opacity-0" : "opacity-100 animate-[page-fade-in_120ms_ease-out]"}`}
      style={{ transitionDuration: `${fade}ms`, backgroundColor: "rgba(5,8,7,0.62)",
        backgroundImage: `radial-gradient(ellipse at ${s.x}px ${s.y}px, ${color}66, ${color}26 45%, transparent 80%)`, backdropFilter: "blur(6px) saturate(1.2)" }}>
      <div className="text-center animate-[player-pop_200ms_cubic-bezier(0.2,0,0,1)]" style={{ transformOrigin: `${s.x}px ${s.y}px` }}>
        {s.pos ? <div className="mb-3 inline-block rounded-full border border-white/20 bg-white/10 px-3 py-0.5 font-data text-xs uppercase tracking-widest text-text-primary">{s.pos}</div> : null}
        <div className="font-display text-5xl leading-tight text-white [text-shadow:0_2px_24px_rgba(0,0,0,0.5)] sm:text-6xl">{displayName(s.name)}</div>
        {s.teamName ? (
          <div className="mt-3 inline-flex items-center gap-2 text-lg font-medium" style={{ color: text }}>
            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: color, boxShadow: `0 0 12px ${color}` }} />{s.teamName}
          </div>
        ) : null}
      </div>
    </div>
  );
}
