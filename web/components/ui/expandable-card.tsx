"use client";

/**
 * A panel that grows out of itself into a focused overlay, and shrinks back.
 *
 * Built on the native `<dialog>` with `showModal()`, not a div, so the browser
 * supplies the focus trap, focus restored on close, Escape, `::backdrop`, page
 * inertness and the top layer — all of it correct, for no code of ours.
 *
 * ── Why this is FLIP and not a fade ────────────────────────────────────────
 * The first version faded a centred box in and out. It was smooth, and it was
 * still wrong: nothing connected the card you clicked to the panel you got, so
 * the overlay read as a new thing appearing rather than as this card opening.
 *
 * So: measure the card (First), open the dialog and measure it (Last), invert
 * the dialog onto the card's box, then play to identity. The element travels
 * from where you clicked.
 *
 * The scale is UNIFORM, taken from the width ratio, and it is a deliberate
 * compromise. A card and an overlay do not share an aspect ratio, so a scale
 * that matched both axes would visibly stretch the text on the way. Matching one
 * axis and crossfading the contents is the standard resolution and it is what
 * makes the growth read as growth rather than as a rubber sheet.
 *
 * Driven by the Web Animations API rather than CSS. Emil Kowalski's rule: WAAPI
 * gives JavaScript control at CSS performance — composited, off the main thread,
 * and interruptible, which matters because the exit can start while the entrance
 * is still running.
 *
 * ── Duration and curve ─────────────────────────────────────────────────────
 * 460ms in, 330ms out, on ease-in-out. Longer than the 300ms ceiling for
 * ordinary UI, and deliberately: that ceiling is for elements that change in
 * place. This one crosses the screen.
 *
 * The curve is why the duration is usable. Under the strong ease-out this used
 * to run, 59% of the motion landed in the first 42ms and the rest crawled — so
 * extra milliseconds went entirely into a tail nobody watches, costing latency
 * and buying no smoothness. ease-in-out spreads the motion across the whole
 * travel, which is the "gradual speed up" this was asked for.
 *
 * Exits stay faster than entrances: the decision is already made, so the
 * animation is only cleanup. See EASE below for why this is not the banned
 * ease-in.
 *
 * ── Reduced motion ─────────────────────────────────────────────────────────
 * No travel, no scale — just a short opacity fade. Fewer and gentler, not none:
 * opacity is what communicates the state change, and it is not a vestibular
 * trigger. Checked live rather than at mount, so changing the OS setting takes
 * effect without a reload.
 */
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The two icons, inline.
 *
 * `lucide-react` sits in devDependencies and nothing imports it, so pulling it in
 * here would break a production install. Two paths cost less than moving a
 * dependency and shipping a library for them.
 *
 * `currentColor` and no fill, so the icon takes its state from the button's own
 * colour — one SVG recoloured, never a second asset for hover. `strokeWidth`
 * 1.5 matches the 400-weight text beside it; a hairline next to this size reads
 * as a different family.
 */
function IconExpand({ size = 11 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
    </svg>
  );
}

function IconMinimise({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />
    </svg>
  );
}

const ENTER_MS = 460;
const EXIT_MS = 330;
/**
 * ease-IN-OUT, and deliberately not the strong ease-out used everywhere else.
 *
 * This element TRAVELS. A strong ease-out spends 59% of its motion in the first
 * 42ms and then crawls — measured, it reads as a snap followed by nothing, which
 * is what "too fast" meant even at 420ms. ease-in-out is the documented curve
 * for on-screen movement and it builds gradually.
 *
 * NOT the banned ease-in. That accelerates the whole way and lands hard. This
 * accelerates and then decelerates into the stop, the way a real object crosses
 * a distance.
 *
 * 0.45 rather than the textbook 0.77, and the difference is measured. Share of
 * the scale travelled by 84ms — roughly the threshold under which the brain
 * reads an event as simultaneous with the click that caused it:
 *
 *     0.77, 0, 0.175, 1     2%     a click with no visible answer
 *     0.65, 0, 0.35,  1     3%
 *     0.45, 0, 0.35,  1     7%     moving inside the threshold
 *
 * Kept in sync with --ease-travel in globals.css, which drives the backdrop; the
 * two have to agree or the card and its shadow part company.
 */
const EASE = "cubic-bezier(0.45, 0, 0.35, 1)";

const reduced = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export interface ExpandableCardProps {
  /** Shown on the trigger and as the overlay's heading. */
  title: string;
  /** Optional richer heading, rendered instead of `title` inside the overlay. */
  heading?: React.ReactNode;
  /** The compact view, always on the page. */
  children?: React.ReactNode;
  /** The expanded view. A function so its work is skipped while collapsed. */
  expanded: () => React.ReactNode;
  /** Overrides the trigger label. */
  expandLabel?: string;
  /** Replace the default "Expand" button and card body: the dialog grows out of whatever this renders. */
  trigger?: (open: () => void) => React.ReactNode;
  /** A small box (ticker items) instead of the wide overlay. */
  compact?: boolean;
  /** Near full screen (pitch rank: a wide table beside a detail panel). */
  wide?: boolean;
  /** Class for the box that wraps `trigger` (the dialog grows out of it). A whole card wants "block". */
  triggerClassName?: string;
}

export function ExpandableCard({
  title,
  heading,
  children,
  expanded,
  expandLabel = "Expand",
  trigger,
  compact = false,
  wide = false,
  triggerClassName = "inline-block",
}: ExpandableCardProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const anim = useRef<Animation | null>(null);
  const [mounted, setMounted] = useState(false);

  /** The transform that puts the dialog exactly on top of the card. */
  const invert = useCallback(() => {
    const card = cardRef.current?.getBoundingClientRect();
    const dlg = dialogRef.current?.getBoundingClientRect();
    if (!card || !dlg || !dlg.width || !dlg.height) return null;
    const scale = Math.max(card.width / dlg.width, 0.05);
    const dx = card.left + card.width / 2 - (dlg.left + dlg.width / 2);
    const dy = card.top + card.height / 2 - (dlg.top + dlg.height / 2);
    return `translate(${dx}px, ${dy}px) scale(${scale})`;
  }, []);

  const play = useCallback(
    (dir: "in" | "out", done?: () => void) => {
      const el = dialogRef.current;
      if (!el?.animate) {
        done?.();
        return;
      }
      anim.current?.cancel();
      const from = reduced() ? "none" : invert() ?? "none";
      const frames =
        dir === "in"
          ? [
              { opacity: 0, transform: from },
              { opacity: 1, transform: "none" },
            ]
          : [
              { opacity: 1, transform: "none" },
              { opacity: 0, transform: from },
            ];
      const a = el.animate(frames, {
        duration: reduced() ? 140 : dir === "in" ? ENTER_MS : EXIT_MS,
        easing: EASE,
        fill: "both",
      });
      anim.current = a;
      a.finished
        .then(() => {
          if (anim.current === a) {
            a.cancel(); // drop `fill: both` so the element is not left pinned
            anim.current = null;
          }
          done?.();
        })
        .catch(() => {
          /* cancelled by a newer animation; that one owns the outcome */
        });
    },
    [invert],
  );

  useEffect(() => {
    if (!mounted) return;
    const el = dialogRef.current;
    el?.showModal?.();
    play("in");
  }, [mounted, play]);

  useEffect(() => () => anim.current?.cancel(), []);

  /** Play the exit, then close. Closing first would leave nothing to animate. */
  const requestClose = useCallback(() => {
    const el = dialogRef.current;
    if (!el?.close) {
      setMounted(false);
      return;
    }
    el.dataset.closing = "";
    play("out", () => {
      delete el.dataset.closing;
      el.close();
    });
  }, [play]);

  return (
    <>
      {trigger ? (
        <span ref={cardRef as React.RefObject<HTMLSpanElement>} className={triggerClassName}>{trigger(() => setMounted(true))}</span>
      ) : (
      <div ref={cardRef as React.RefObject<HTMLDivElement>} className="relative">
        <button
          type="button"
          onClick={() => setMounted(true)}
          className="press-feedback absolute right-0 top-0 z-10 flex items-center
                     gap-1 rounded-inner border border-border-subtle px-2 py-0.5
                     text-[11px] text-text-dim focus-visible:outline
                     focus-visible:outline-1 focus-visible:outline-offset-2
                     focus-visible:outline-border-emphasis"
          aria-haspopup="dialog"
        >
          <IconExpand />
          {expandLabel}
        </button>
        {children}
      </div>
      )}

      <dialog
        ref={dialogRef}
        aria-label={title}
        // Escape reaches `cancel` first and would close the dialog on the spot,
        // skipping the exit. Prevent it and route through requestClose so both
        // ways out look the same.
        onCancel={(e) => {
          e.preventDefault();
          requestClose();
        }}
        onClose={() => setMounted(false)}
        onClick={(e) => {
          if (e.target === dialogRef.current) requestClose();
        }}
        className={`overlay-card m-auto ${wide ? "max-h-[94vh]" : "max-h-[88vh]"} ${compact ? "w-[min(92vw,440px)]" : wide ? "w-[min(96vw,1480px)]" : "w-[min(92vw,1100px)]"}
                   overflow-hidden rounded-panel border border-border-subtle
                   bg-surface-1 p-0 text-text-primary`}
      >
        {mounted && (
          <div className={`flex flex-col ${wide ? "max-h-[94vh]" : "max-h-[88vh]"}`}>
            <div
              className="overlay-region flex items-center justify-between gap-4
                         border-b border-border-subtle px-5 py-3"
              style={{ "--i": 0 } as React.CSSProperties}
            >
              {heading ?? <h2 className="text-sm font-medium">{title}</h2>}
              <button
                type="button"
                onClick={requestClose}
                className="press-feedback flex shrink-0 items-center gap-1.5
                           rounded-inner border border-border-subtle px-2.5 py-1
                           text-xs text-text-dim focus-visible:outline
                           focus-visible:outline-1 focus-visible:outline-offset-2
                           focus-visible:outline-border-emphasis"
              >
                <IconMinimise />
                Minimise
              </button>
            </div>
            <div
              className="overlay-region overflow-y-auto px-5 py-4"
              style={{ "--i": 1 } as React.CSSProperties}
            >
              {expanded()}
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
