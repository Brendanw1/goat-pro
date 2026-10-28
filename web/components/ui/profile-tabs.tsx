"use client";

/**
 * The tab bar on a player profile.
 *
 * A hitter and a pitcher stopped sharing a tab set when the scouting suite
 * landed — a hitter has a batted-ball profile and no arsenal, a pitcher the
 * reverse — so the list is keyed by role rather than being one hard-coded pair.
 *
 * Spec: docs/superpowers/specs/2026-08-19-scouting-suite-foundations.md §7
 */

export type ProfileTab =
  | "overview"
  | "gamelog"
  | "battedball"
  | "scouting"
  | "approach"
  | "arsenal"
  | "visuals"
  | "situational"
  | "pitchplan"
  | "stuff"
  | "lab"
  | "savant"
  | "defense";

export type ProfileRole = "pitcher" | "batter";

/**
 * The two tab sets.
 *
 * `overview` leads on both, so the left end of the bar means the same thing
 * whichever profile you are on and the tabs that differ sit in the middle where
 * they are being compared anyway.
 *
 * ── `lab` is gone from both, 2026-08-31 ────────────────────────────────────
 * The 3D Lab trailed both sets and is withdrawn from the front end. `"lab"`
 * stays in the `ProfileTab` union deliberately: `hasTab()` reads these lists, so
 * a bookmarked `?tab=lab` now returns false and falls back to Overview instead
 * of stranding the page on a tab that renders nothing. Removing the union member
 * would make that a type error rather than a graceful fallback.
 *
 * Nothing was deleted. components/3d/ is intact and the tab returns by putting
 * one line back in each list.
 */
export const TABS_FOR: Record<ProfileRole, readonly { key: ProfileTab; label: string }[]> = {
  // 2026-10-23 (profile design review M2): Overview · Approach · Game log. Batted ball folded into Overview (spray
  // chart and table together); Scouting became Approach. "battedball" and "scouting" stay in the union so a stale
  // value falls back to Overview through hasTab() instead of failing to type.
  batter: [
    // goat-pro wave 2b: Overview · Splits (vs handedness and pitch family).
    // Approach carries the splits; the game log is a game-report surface not
    // yet ported (the union keeps the key so a stale ?tab= falls back).
    { key: "overview", label: "Overview" },
    { key: "approach", label: "Splits" },
    { key: "scouting", label: "Scouting" },
    { key: "visuals", label: "Visuals" },
    { key: "defense", label: "Defense" },
    { key: "savant", label: "Savant" },
    { key: "gamelog", label: "Game log" },
  ],
  // 2026-10-23 (profile design review H2): Overview · Arsenal · Situational · Game log. Situational holds the
  // context detail that used to sit on Overview above the location maps; the game log, raw by nature, goes last.
  // 2026-10-24: Pitch Plan (best pitch by count, put-away setups, two strikes by hitter type) after Situational,
  // whose count detail it follows on from.
  pitcher: [
    // goat-pro MVP: Overview · Arsenal. Situational, Pitch Plan and the game log
    // are NEEDS-MODEL / game-report surfaces deleted with their panels (the union
    // keeps their keys so a stale ?tab= falls back to Overview, per hasTab()).
    { key: "overview", label: "Overview" },
    { key: "arsenal", label: "Arsenal" },
    { key: "visuals", label: "Visuals" },
    { key: "gamelog", label: "Game log" },
  ],
};

export const tabId = (role: ProfileRole, tab: ProfileTab) => `${role}-tab-${tab}`;
export const panelId = (role: ProfileRole) => `${role}-tabpanel`;

export function ProfileTabs({
  role,
  value,
  onChange,
  aside,
}: {
  role: ProfileRole;
  value: ProfileTab;
  onChange: (tab: ProfileTab) => void;
  /** Page-level controls that apply to every tab (the pitch-tag toggle), at the bar's right end. */
  aside?: React.ReactNode;
}) {
  const tabs = TABS_FOR[role];

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const delta =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    let next: number | null = null;
    if (delta !== 0) {
      const i = tabs.findIndex((t) => t.key === value);
      next = (i + delta + tabs.length) % tabs.length;
    } else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    if (next === null) return;
    event.preventDefault();
    onChange(tabs[next].key);
    // Follow focus, which is the expected behaviour for a tablist that
    // activates on selection.
    document.getElementById(tabId(role, tabs[next].key))?.focus();
  };

  // The bar scrolls rather than wraps: five tabs are 343px and the narrowest
  // supported viewport is 320. Wrapping would put the selected tab's underline
  // on a different line from the border it sits on. Scrolling is safe for the
  // keyboard here because the tabs themselves are the focusable content and the
  // arrow keys call `.focus()`, which scrolls the target into view.
  const bar = (
    <div
      className="flex items-center gap-1 overflow-x-auto border-b border-border-subtle [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      role="tablist"
    >
      {tabs.map((tab) => {
        const active = tab.key === value;
        return (
          <button
            key={tab.key}
            id={tabId(role, tab.key)}
            role="tab"
            type="button"
            aria-selected={active}
            aria-controls={panelId(role)}
            // Roving: only the selected tab is in the tab order, and the arrow
            // keys move between them once you are inside.
            tabIndex={active ? 0 : -1}
            onKeyDown={onKeyDown}
            onClick={() => onChange(tab.key)}
            className={`relative shrink-0 px-3 py-2 text-xs font-medium transition-colors duration-150 cursor-pointer ${
              active ? "text-text-primary" : "text-text-dim hover:text-text-secondary"
            }`}
          >
            {tab.label}
            {active && <span className="absolute inset-x-0 -bottom-px h-px bg-usf-gold" />}
          </button>
        );
      })}
    </div>
  );
  if (!aside) return bar;
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-border-subtle">
      <div className="-mb-px min-w-0 [&>[role=tablist]]:border-b-0">{bar}</div>
      <div className="pb-1.5">{aside}</div>
    </div>
  );
}

/**
 * The panel the selected tab controls.
 *
 * `tabIndex={0}` because the panel's content is often a chart or a table with
 * no focusable element of its own — without it, tabbing off the bar skips
 * straight past everything the bar just revealed.
 */
export function ProfileTabPanel({
  role,
  tab,
  children,
}: {
  role: ProfileRole;
  /** The *selected* tab — the panel is labelled by whichever one revealed it. */
  tab: ProfileTab;
  children: React.ReactNode;
}) {
  return (
    <div
      id={panelId(role)}
      role="tabpanel"
      aria-labelledby={tabId(role, tab)}
      tabIndex={0}
      className="outline-offset-4"
    >
      {children}
    </div>
  );
}
