/**
 * Interface audit, second pass: the things you can only see in painted pixels.
 *
 * `interface-audit.mjs` answers structural questions — is this a table, can a
 * keyboard reach it, does the document reflow. This one answers the questions
 * that need the rasterised page: what contrast did the text actually get, is
 * anything clipped where it cannot be scrolled to, are the targets big enough,
 * does focus follow the document.
 *
 * Usage — dev server first, then:
 *
 *     node scripts/interface-paint.mjs /hitters /pitchers
 *     node scripts/interface-paint.mjs "/player/824443#Overview"
 *
 * A `#Tab` suffix clicks that tab before measuring. Slower than the structural
 * audit (it screenshots each contrast candidate), so it is a separate command
 * rather than part of `audit:ui`.
 *
 * ── Every probe here is the second or third version of itself ───────────────
 * The first versions produced 59 findings across five routes and *all* of them
 * were false. Each fix is documented at its probe, because the failure modes
 * are not obvious and the next person to write one of these will hit them too:
 *
 *  1. Contrast read `getComputedStyle().color` with a regex. Chrome serialises
 *     a colour derived from an oklch() token as `lab(94.2 -0.82 -1.65)`, so the
 *     regex took the L channel as red and called near-white text near-black.
 *     Colours now resolve through a 1×1 canvas — the browser's own conversion.
 *  2. Contrast then composited backgrounds from `backgroundColor` up the tree.
 *     That cannot see `.glass-panel::before` (a radial-gradient glow) or
 *     `backdrop-filter`, and reported the same token at 3.21:1 on one panel and
 *     5.97:1 on another. Backgrounds are now screenshotted with the element's
 *     own text made transparent, so the number comes from real pixels.
 *  3. Clipping walked up to the first `overflow: hidden` ancestor — which on a
 *     table is the truncating `<th>`, long before the table's scroll box. Every
 *     row below the fold got reported as clipped by the panel. It now stops at
 *     the first genuinely-scrolling ancestor, because content you can scroll to
 *     is not lost.
 *  4. Truncation compared `scrollWidth` to `clientWidth`. `clientWidth` excludes
 *     borders, so every 1px-bordered panel looked 2px overflowed. It now needs
 *     the overflow to exceed the borders, and ignores `sr-only`, whose whole job
 *     is to clip to 1px.
 *  5. Focus order compared `rect.top + scrollY`. Tabbing into a table scrolls
 *     the table's *own* overflow box, which never moves `window.scrollY`, so
 *     each row appeared to jump back up the page. It now compares document
 *     order with `compareDocumentPosition`.
 *
 * Exit code is 1 if anything fails, so this can gate a branch too.
 */

async function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_PATH,
    "playwright",
    "/Users/brendanwaterval/.npm/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs",
  ].filter(Boolean);
  for (const c of candidates) {
    try { return await import(c); } catch { /* next */ }
  }
  console.error("playwright not found; set PLAYWRIGHT_PATH to an existing copy's index.mjs.");
  process.exit(2);
}
const { chromium } = await loadPlaywright();

const BASE = process.env.AUDIT_BASE ?? "http://localhost:3000";
const paths = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (paths.length === 0) {
  console.error('usage: node scripts/interface-paint.mjs <path>["#Tab"] […]');
  process.exit(2);
}

let failures = 0;
const fail = (m) => { failures++; console.log(`   ❌ ${m}`); };
const pass = (m) => console.log(`   ✅ ${m}`);

/** Injected once per page: colour resolution and luminance, browser-side. */
const HELPERS = `
  window.__cv = document.createElement("canvas");
  window.__ctx = window.__cv.getContext("2d", { willReadFrequently: true });
  window.__res = (css) => {
    if (!css || css === "transparent" || css === "none") return null;
    const c = window.__cv, x = window.__ctx;
    c.width = c.height = 1;
    x.clearRect(0, 0, 1, 1); x.fillStyle = "#000"; x.fillStyle = css; x.fillRect(0, 0, 1, 1);
    const d = x.getImageData(0, 0, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
  };
  window.__lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  window.__ratio = (a, b) => {
    const [hi, lo] = [window.__lum(a), window.__lum(b)].sort((m, n) => n - m);
    return (hi + 0.05) / (lo + 0.05);
  };
  /** Mean colour of a PNG, decoded by the browser rather than by hand in node. */
  window.__mean = (b64) => new Promise((done) => {
    const img = new Image();
    img.onload = () => {
      const c = window.__cv, x = window.__ctx;
      c.width = img.width; c.height = img.height;
      x.clearRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
      done({ r: r / n, g: g / n, b: b / n, a: 1 });
    };
    img.src = "data:image/png;base64," + b64;
  });
  window.__srOnly = (el) => {
    if (el.closest(".sr-only")) return true;
    const s = getComputedStyle(el);
    return s.position === "absolute" && (parseFloat(s.width) <= 1 || parseFloat(s.height) <= 1);
  };
`;

/**
 * Candidates for the contrast check, chosen with a cheap CSS composite.
 *
 * Deliberately over-inclusive (anything under 6:1) because the composite is the
 * unreliable part — it exists only to keep the number of screenshots down, and
 * every candidate is then re-measured against real pixels.
 */
const candidates = () => {
  const composite = (el) => {
    const layers = [];
    for (let n = el; n; n = n.parentElement) {
      const c = window.__res(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a === 1) break; }
    }
    let acc = { r: 0, g: 0, b: 0, a: 1 };
    for (const l of layers.reverse())
      acc = { r: l.r * l.a + acc.r * (1 - l.a), g: l.g * l.a + acc.g * (1 - l.a),
              b: l.b * l.a + acc.b * (1 - l.a), a: 1 };
    return acc;
  };
  const groups = new Map();
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const text = n.nodeValue.trim();
    if (!text) continue;
    const el = n.parentElement;
    if (!el || el.closest("nextjs-portal,script,style") || window.__srOnly(el)) continue;
    const s = getComputedStyle(el);
    if (s.visibility === "hidden" || s.display === "none" || +s.opacity === 0) continue;
    const r = el.getBoundingClientRect();
    // Too small to screenshot meaningfully, or so wide the mean background
    // would average over unrelated content.
    if (r.width < 6 || r.height < 5 || r.width > 600) continue;
    const fg = window.__res(s.color);
    if (!fg) continue;
    let a = fg.a;
    for (let q = el; q; q = q.parentElement) a *= +getComputedStyle(q).opacity;
    const bg = composite(el);
    const rough = window.__ratio(
      { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 }, bg);
    if (rough > 6) continue;
    const px = parseFloat(s.fontSize);
    const key = String(el.className) + "|" + px;
    if (groups.has(key)) continue;
    el.dataset.paintKey = key;
    groups.set(key, {
      key, px, weight: s.fontWeight, sample: text.slice(0, 24),
      cls: String(el.className).slice(0, 58), fg: { ...fg, a },
      // WCAG 1.4.3: 3:1 for large text (>=24px, or >=18.66px bold), else 4.5:1.
      need: (px >= 24 || (px >= 18.66 && +s.fontWeight >= 700)) ? 3 : 4.5,
      // 1.4.3 exempts inactive controls, so a disabled button is reported
      // separately rather than as a failure.
      inactive: !!el.closest("[disabled],[aria-disabled=true]"),
    });
  }
  return [...groups.values()];
};

const truncation = () => {
  const out = new Set();
  for (const el of document.querySelectorAll("*")) {
    if (window.__srOnly(el)) continue;
    const s = getComputedStyle(el);
    if (s.textOverflow !== "ellipsis" && s.overflow !== "hidden") continue;
    if (/auto|scroll/.test(s.overflowX + s.overflowY)) continue;
    // clientWidth excludes borders; scrollWidth does not. Without this a 1px
    // border on each side reads as 2px of clipped content on every panel.
    const borders = parseFloat(s.borderLeftWidth) + parseFloat(s.borderRightWidth);
    if (el.scrollWidth <= el.clientWidth + borders + 1) continue;
    const full = el.textContent.trim();
    if (!full) continue;
    if (el.title || el.closest("[title]") || el.getAttribute("aria-label") || el.querySelector(".sr-only")) continue;
    out.add(`${el.tagName.toLowerCase()} "${full.slice(0, 32)}" clipped by ${el.scrollWidth - el.clientWidth - borders}px`);
  }
  return [...out];
};

const clipping = () => {
  const out = new Set();
  for (const el of document.querySelectorAll("*")) {
    if (!el.textContent.trim() || el.children.length || window.__srOnly(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1) continue;
    for (let p = el.parentElement; p; p = p.parentElement) {
      const s = getComputedStyle(p);
      const scrolls = /auto|scroll/.test(s.overflowX + s.overflowY)
        && (p.scrollHeight > p.clientHeight + 2 || p.scrollWidth > p.clientWidth + 2);
      if (scrolls) break;                      // reachable by scrolling, so not lost
      if (s.overflow === "hidden" && s.textOverflow !== "ellipsis") {
        const pr = p.getBoundingClientRect();
        const lost = Math.max(0, r.right - pr.right) + Math.max(0, pr.left - r.left)
          + Math.max(0, r.bottom - pr.bottom) + Math.max(0, pr.top - r.top);
        if (lost > 2)
          out.add(`"${el.textContent.trim().slice(0, 24)}" loses ${Math.round(lost)}px in .${String(p.className).slice(0, 28)}`);
        break;
      }
    }
  }
  return [...out].slice(0, 8);
};

/**
 * WCAG 2.5.8. Under 24px is only a failure if the spacing exception also
 * fails — a dense leaderboard row is allowed to be 18px tall as long as a 24px
 * circle centred on each link does not reach another target.
 */
const targetSize = () => {
  const all = [...document.querySelectorAll('a[href],button,input:not([type=hidden]),select,[role="tab"]')]
    .map((e) => ({ e, r: e.getBoundingClientRect() }))
    .filter((t) => t.r.width >= 1 && t.r.height >= 1);
  const mid = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  const small = all.filter((t) => t.r.width < 24 || t.r.height < 24);
  const failing = small.filter((t) => {
    const c = mid(t.r);
    return all.some((o) => o.e !== t.e && Math.hypot(c.x - mid(o.r).x, c.y - mid(o.r).y) < 24);
  });
  return {
    small: small.length, failing: failing.length,
    examples: failing.slice(0, 4).map((t) =>
      `${t.e.tagName.toLowerCase()}"${(t.e.getAttribute("aria-label") || t.e.textContent || "").trim().slice(0, 16)}" ${Math.round(t.r.width)}×${Math.round(t.r.height)}`),
  };
};

async function focusOrder(page, limit = 80) {
  await page.evaluate(() => { document.activeElement?.blur(); window.__seq = []; });
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press("Tab");
    const more = await page.evaluate(() => {
      const e = document.activeElement;
      if (!e || e === document.body || e.tagName.toLowerCase() === "nextjs-portal") return false;
      if (window.__seq[window.__seq.length - 1] === e) return false;
      window.__seq.push(e);
      return true;
    });
    if (!more) break;
  }
  return page.evaluate(() => {
    const seq = window.__seq, breaks = [];
    const name = (e) => (e.getAttribute("aria-label") || e.textContent || e.tagName).trim().slice(0, 20);
    for (let i = 1; i < seq.length; i++) {
      const rel = seq[i - 1].compareDocumentPosition(seq[i]);
      // CONTAINS is fine — a wrapper focused before its own child.
      if (rel & Node.DOCUMENT_POSITION_PRECEDING && !(rel & Node.DOCUMENT_POSITION_CONTAINS))
        breaks.push(`"${name(seq[i - 1])}" → "${name(seq[i])}"`);
    }
    return { count: seq.length, breaks };
  });
}

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

for (const spec of paths) {
  const [route, tab] = spec.split("#");
  console.log(`\n━━ ${spec} ━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForTimeout(2500);
  if (tab) {
    await page.getByRole("tab", { name: tab }).click();
    await page.waitForTimeout(2000);
  }
  await page.evaluate(HELPERS);

  /*
   * Order matters, and both orderings I tried first were wrong.
   *
   * Geometry probes run on an untouched page: measured after the focus walk,
   * a 61×21 segment reported a neighbour inside the 24px exception that is
   * really 25.4px away, because tabbing through 53 stops had revealed another
   * control beside it. Then the focus walk, which needs focus to start from
   * the top. The contrast pass runs last because it scrolls every candidate
   * into view and temporarily rewrites its colour — run the walk after that
   * and it starts from the final scroll position and dies at one stop.
   */
  const t = await page.evaluate(truncation);
  t.length ? t.slice(0, 5).forEach((x) => fail(`truncated with no full value: ${x}`)) : pass("no unreachable truncation");

  const c = await page.evaluate(clipping);
  c.length ? c.slice(0, 5).forEach((x) => fail(`clipped: ${x}`)) : pass("nothing clipped outside a scrollable box");

  const ts = await page.evaluate(targetSize);
  ts.failing
    ? fail(`${ts.failing} of ${ts.small} undersized targets also fail the 24px spacing exception — ${ts.examples.join(", ")}`)
    : pass(`target size: ${ts.small} under 24px, all pass the spacing exception`);

  const fo = await focusOrder(page);
  fo.breaks.length
    ? fail(`focus leaves document order: ${fo.breaks.slice(0, 3).join("; ")}`)
    : pass(`focus order follows the document across ${fo.count} stops`);

  const bad = [], exempt = [];
  for (const c of await page.evaluate(candidates)) {
    // Hide just this element's glyphs, photograph what is behind them, restore.
    const rect = await page.evaluate((key) => {
      const el = [...document.querySelectorAll("[data-paint-key]")].find((e) => e.dataset.paintKey === key);
      if (!el) return null;
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      if (r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth) return null;
      el.dataset.paintSaved = el.style.color || "";
      el.style.setProperty("color", "transparent", "important");
      return { x: Math.round(r.left), y: Math.round(r.top),
        width: Math.max(2, Math.round(r.width)), height: Math.max(2, Math.round(r.height)) };
    }, c.key);
    if (!rect) continue;
    await page.waitForTimeout(50);
    const shot = (await page.screenshot({ clip: rect })).toString("base64");
    const ratio = await page.evaluate(async ([b64, key, fg]) => {
      const el = [...document.querySelectorAll("[data-paint-key]")].find((e) => e.dataset.paintKey === key);
      if (el) el.style.color = el.dataset.paintSaved;
      const bg = await window.__mean(b64);
      const eff = { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a),
                    b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 };
      return +window.__ratio(eff, bg).toFixed(2);
    }, [shot, c.key, c.fg]);
    if (ratio + 0.02 >= c.need) continue;
    (c.inactive ? exempt : bad).push({ ...c, ratio });
  }
  bad.sort((a, b) => a.ratio - b.ratio);
  bad.length
    ? bad.forEach((r) => fail(`contrast ${r.ratio}:1 (needs ${r.need}) — ${r.px}px "${r.sample}" .${r.cls}`))
    : pass("contrast: every text node meets its ratio on painted pixels");
  for (const r of exempt)
    console.log(`   ·  ${r.ratio}:1 on an inactive control ("${r.sample}") — exempt under WCAG 1.4.3`);


}

await browser.close();
console.log(`\n${failures === 0 ? "✅ no failures" : `❌ ${failures} check(s) failed`}\n`);
process.exit(failures === 0 ? 0 : 1);
