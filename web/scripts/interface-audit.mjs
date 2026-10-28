/**
 * Interface audit — the measurements behind docs/reviews/2026-08-20-interface-review.md.
 *
 * Every finding in that review came from one of the probes below rather than
 * from reading the source, because the things that go wrong here go wrong at
 * render time: a focus rule that loses in the cascade, a `role="row"` with no
 * table above it, a flex row that only overflows once the viewport is 320px.
 * Source review cannot see any of those.
 *
 * Usage — start the dev server first, then:
 *
 *     node scripts/interface-audit.mjs /player/824443 /pitchers /hitters
 *     node scripts/interface-audit.mjs --tabs /player/1000468924
 *
 * `--tabs` walks every `role="tab"` on the page and re-runs the probes per
 * panel, which is what the player profile needs and a flat page does not.
 *
 * Exit code is 1 if any HIGH-severity check fails, so this can gate a branch.
 */

/**
 * Playwright is deliberately not a dependency of this package — it pulls
 * browser binaries that CI here does not need and that every `npm ci` would
 * pay for. Resolve it from wherever it already exists: an explicit
 * `PLAYWRIGHT_PATH`, the project's own node_modules if someone installs it, or
 * the npx cache it usually lands in.
 */
async function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_PATH,
    "playwright",
    "/Users/brendanwaterval/.npm/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs",
  ].filter(Boolean);
  for (const c of candidates) {
    try { return await import(c); } catch { /* try the next one */ }
  }
  console.error(
    "playwright not found. Install it (`npm i -D playwright && npx playwright install chrome`)\n" +
    "or point PLAYWRIGHT_PATH at an existing copy's index.mjs.");
  process.exit(2);
}
const { chromium } = await loadPlaywright();

const BASE = process.env.AUDIT_BASE ?? "http://localhost:3000";
const args = process.argv.slice(2);
const perTab = args.includes("--tabs");
const paths = args.filter((a) => !a.startsWith("--"));
if (paths.length === 0) {
  console.error("usage: node scripts/interface-audit.mjs [--tabs] <path> [<path>…]");
  process.exit(2);
}

let failures = 0;
const fail = (msg) => { failures++; console.log(`   ❌ ${msg}`); };
const pass = (msg) => console.log(`   ✅ ${msg}`);

// ── probes ──────────────────────────────────────────────────────────────────

/**
 * Table semantics — both ways they go wrong.
 *
 * `orphanRows` catches a `role="row"` with no table above it. But the worse
 * case is quieter: a table built from divs carrying *no* roles at all passes
 * that check while being equally unreadable, and the league tables were exactly
 * that. `divTables` finds them structurally — a container whose children are
 * five or more siblings sharing a class, each holding four or more cells, is a
 * table whatever its tag says.
 */
const tableSemantics = () => {
  const divTables = [];
  for (const el of document.querySelectorAll("div")) {
    const kids = [...el.children].filter((c) => c.tagName === "DIV");
    if (kids.length < 5) continue;
    // Rows usually alternate their tint, so an exact className match is too
    // strict — a handful of distinct classes across many siblings is still a
    // table. What makes it one is the uniform cell count.
    const classes = new Set(kids.map((k) => String(k.className)));
    if (classes.size > 3) continue;
    const width = kids[0].children.length;
    if (width < 4 || !kids.every((k) => k.children.length === width)) continue;
    if (el.closest("table")) continue;
    divTables.push(`${kids.length}×${width} in .${String(kids[0].className).slice(0, 40)}`);
  }
  return {
    orphanRows: [...document.querySelectorAll('[role="row"]')]
      .filter((r) => !r.closest('table,[role="table"],[role="grid"],[role="rowgroup"]')).length,
    divTables,
    tables: document.querySelectorAll("table").length,
    colHeaders: document.querySelectorAll("th[scope=col]").length,
    sortableWithoutAriaSort: [...document.querySelectorAll("th")]
      .filter((h) => h.querySelector("button") && !h.hasAttribute("aria-sort")).length,
  };
};

/**
 * Focus indicators, measured by real Tab presses rather than `el.focus()`.
 *
 * This matters: Chrome paints the UA focus ring on `:focus-visible`, and a
 * programmatic `.focus()` does not always set it. Scripted focus therefore
 * reports "no outline" for controls that a keyboard user sees ringed — a false
 * finding that costs more than the check is worth. Tabbing is what a keyboard
 * user does, so tabbing is what gets measured.
 */
async function focusIndicators(page, limit = 60) {
  await page.evaluate(() => (document.activeElement)?.blur());
  const bad = [];
  let seen = 0;
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press("Tab");
    const r = await page.evaluate(() => {
      const e = document.activeElement;
      if (!e || e === document.body) return null;
      const s = getComputedStyle(e);
      const ring = s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0;
      // `boxShadow` is rarely the literal string "none" once Tailwind's ring
      // variables are in play — the login page resolved `focus:ring-usf-green/20`
      // to five fully transparent layers, which is not a focus indicator but is
      // also not "none". Require at least one layer with a non-zero alpha.
      const shadow = s.boxShadow !== "none" && /rgba?\([^)]*?(?:,\s*(?!0\s*\))[\d.]+\s*)?\)/.test(s.boxShadow)
        && !s.boxShadow.split(/,(?![^(]*\))/).every((l) => /\/\s*0\s*\)|,\s*0\s*\)/.test(l) || !/\d/.test(l));
      return {
        ring, shadow,
        visible: e.matches(":focus-visible"),
        tag: e.tagName.toLowerCase(),
        label: (e.getAttribute("aria-label") || e.textContent || e.placeholder || "").trim().slice(0, 20),
      };
    });
    if (!r) break;
    // The Next.js dev-tools overlay is injected by the dev server, not by us.
    if (r.tag === "nextjs-portal") continue;
    seen++;
    if (!r.ring && !r.shadow) bad.push(`${r.tag}"${r.label}"`);
  }
  return { total: seen, noIndicator: [...new Set(bad)] };
}

/** Controls a screen reader would announce as unnamed. */
const accessibleNames = () => {
  const name = (e) => (e.getAttribute("aria-label")
    || (e.getAttribute("aria-labelledby") && document.getElementById(e.getAttribute("aria-labelledby"))?.textContent)
    || e.textContent.trim() || e.getAttribute("title") || e.getAttribute("alt") || "").trim();
  return [...document.querySelectorAll('a[href],button,input,select,textarea,[role="button"]')]
    // `labels` covers both `<label for>` and a label *wrapping* the control,
    // which is how the calculator's number inputs are named — counting those as
    // unnamed was a false finding, not a bug in the page.
    .filter((e) => !name(e) && !(e.labels && e.labels.length))
    .map((e) => `${e.tagName.toLowerCase()}.${String(e.className).split(/\s+/)[0]}`);
};

/**
 * Click handlers on elements a keyboard can never reach.
 *
 * React puts no marker in the DOM for `onClick`, so this infers it the way a
 * user would: `cursor: pointer` on something that is not a link, a button or
 * focusable. The league tables navigated to a player profile from a row div
 * exactly like that — a whole page reachable by mouse and by nothing else.
 */
const pointerOnlyControls = () =>
  [...document.querySelectorAll("div,span,li,tr")].filter((e) => {
    if (getComputedStyle(e).cursor !== "pointer") return false;
    if (e.matches('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])')) return false;
    if (e.closest('a[href],button,label')) return false;
    // A pointer cursor inherited from a focusable ancestor is that ancestor's.
    return !e.querySelector('a[href],button,[tabindex]:not([tabindex="-1"])');
  }).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 42)}`);

/** A scroll box with nothing focusable inside and no tabindex is mouse-only. */
const unreachableScrollers = () =>
  [...document.querySelectorAll("*")].filter((d) => {
    const s = getComputedStyle(d);
    const scrolls = /auto|scroll/.test(s.overflowX + s.overflowY)
      && (d.scrollWidth > d.clientWidth + 4 || d.scrollHeight > d.clientHeight + 4);
    return scrolls && !d.hasAttribute("tabindex")
      && d.querySelectorAll('a[href],button,input,[tabindex]:not([tabindex="-1"])').length === 0;
  }).map((d) => String(d.className).slice(0, 50));

/** A declared tab widget that does not resolve to a panel. */
const tabWiring = () => {
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  if (tabs.length === 0) return null;
  return {
    tabs: tabs.length,
    missingAriaControls: tabs.filter((t) => !t.hasAttribute("aria-controls")).length,
    danglingAriaControls: tabs.filter((t) => t.getAttribute("aria-controls")
      && !document.getElementById(t.getAttribute("aria-controls"))).length,
    panels: document.querySelectorAll('[role="tabpanel"]').length,
    noRovingTabindex: tabs.every((t) => t.getAttribute("tabindex") === null),
  };
};

const headings = () => [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")]
  .map((h) => h.tagName).reduce((m, t) => ({ ...m, [t]: (m[t] ?? 0) + 1 }), {});

/**
 * WCAG 1.4.10. The honest test is whether the *document* scrolls sideways, not
 * whether some element is wide — a table inside its own `overflow-x-auto` is
 * fine and shows up as wide either way.
 */
const reflow = async () => {
  window.scrollTo(9999, 0);
  await new Promise((r) => requestAnimationFrame(r));
  const x = window.scrollX;
  window.scrollTo(0, 0);
  return { scrolledX: x, docScrollWidth: document.documentElement.scrollWidth };
};

// ── runner ──────────────────────────────────────────────────────────────────

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

async function auditView(label) {
  console.log(`\n  ${label}`);

  const t = await page.evaluate(tableSemantics);
  if (t.orphanRows > 0) fail(`${t.orphanRows} role="row" with no table above them`);
  if (t.divTables.length > 0) fail(`grid of divs with no table semantics: ${t.divTables[0]}`);
  if (t.orphanRows === 0 && t.divTables.length === 0)
    pass(`table semantics (${t.tables} tables, ${t.colHeaders} column headers)`);
  if (t.sortableWithoutAriaSort > 0) fail(`${t.sortableWithoutAriaSort} sortable headers with no aria-sort`);

  const f = await focusIndicators(page);
  f.noIndicator.length > 0
    ? fail(`no focus indicator: ${f.noIndicator.slice(0, 4).join(", ")}`)
    : pass(`focus indicators on all ${f.total} controls`);

  const n = await page.evaluate(accessibleNames);
  n.length > 0 ? fail(`unnamed controls: ${n.slice(0, 4).join(", ")}`) : pass("all controls named");

  const c = await page.evaluate(pointerOnlyControls);
  c.length > 0
    ? fail(`${c.length} clickable but not keyboard-reachable, e.g. ${c[0]}`)
    : pass("no pointer-only controls");

  const s = await page.evaluate(unreachableScrollers);
  s.length > 0 ? fail(`keyboard-unreachable scroll box: ${s[0]}`) : pass("scroll regions reachable");

  const w = await page.evaluate(tabWiring);
  if (w) {
    (w.missingAriaControls || w.danglingAriaControls || w.panels === 0 || w.noRovingTabindex)
      ? fail(`tab widget incomplete: ${JSON.stringify(w)}`)
      : pass(`tab widget wired (${w.tabs} tabs → ${w.panels} panel)`);
  }

  // A view with several panels needs an outline to navigate by; a view that is
  // one table under one <h1> does not, and failing it would be noise.
  const h = await page.evaluate(headings);
  const panels = await page.evaluate(() => document.querySelectorAll(".glass-panel").length);
  const sub = Object.entries(h).filter(([k]) => k !== "H1").reduce((n, [, v]) => n + v, 0);
  panels > 1 && sub === 0
    ? fail(`${panels} panels and no heading below H1 — nothing to navigate by`)
    : pass(`headings ${JSON.stringify(h)} over ${panels} panel(s)`);

  for (const width of [320, 720]) {
    await page.setViewportSize({ width, height: 800 });
    await page.waitForTimeout(900);
    const r = await page.evaluate(reflow);
    r.scrolledX > 0
      ? fail(`@${width}px the document scrolls sideways by ${r.scrolledX}px (WCAG 1.4.10)`)
      : pass(`@${width}px reflows without horizontal scroll`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(500);
}

for (const path of paths) {
  console.log(`\n━━ ${path} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForTimeout(2500);

  const tabs = perTab ? await page.getByRole("tab").allTextContents() : [];
  if (tabs.length === 0) {
    await auditView("(page)");
  } else {
    for (const label of tabs) {
      await page.getByRole("tab", { name: label }).click();
      await page.waitForTimeout(2000);
      await auditView(`tab: ${label}`);
    }
  }
}

await browser.close();
console.log(`\n${failures === 0 ? "✅ no failures" : `❌ ${failures} check(s) failed`}\n`);
process.exit(failures === 0 ? 0 : 1);
