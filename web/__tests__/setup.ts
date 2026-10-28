import "@testing-library/jest-dom/vitest";

/**
 * `window.matchMedia`, which jsdom does not implement.
 *
 * Needed because `border-beam` calls it during render, so any test that mounts
 * a component wrapped in `<BorderBeam>` — the three league tables — throws
 * before a single assertion runs. Nothing under test reads the result; the
 * stub only has to exist and report "does not match", which is also the honest
 * answer for a headless environment with no display.
 *
 * `matches: false` in particular means `prefers-reduced-motion` reads as "no
 * preference" in tests, which is the state the components are written against.
 */
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

/**
 * `HTMLDialogElement.showModal()` / `.close()`, which jsdom 30 does not implement.
 *
 * `expandable-card.tsx` is built on the native `<dialog>` precisely so the browser
 * supplies the focus trap, Escape handling, backdrop and top layer. jsdom supplies
 * none of that, and without a shim the element's methods are `undefined`, so a
 * test could only ever assert that nothing happened.
 *
 * The shim is deliberately thin: it toggles the `open` attribute, which is what
 * jsdom uses to decide visibility, so `getByRole("dialog")` and `toBeVisible()`
 * behave. It does NOT emulate the focus trap or the top layer — those are browser
 * behaviour, and a test asserting them here would be testing this stub.
 */
if (typeof window !== "undefined" && window.HTMLDialogElement) {
  const proto = window.HTMLDialogElement.prototype;
  if (!proto.showModal) {
    proto.showModal = function (this: HTMLDialogElement) {
      this.open = true;
    };
  }
  if (!proto.close) {
    proto.close = function (this: HTMLDialogElement, returnValue?: string) {
      this.open = false;
      if (returnValue !== undefined) this.returnValue = returnValue;
      this.dispatchEvent(new Event("close"));
    };
  }
}

/**
 * `Element.animate`, which jsdom 30 does not implement either.
 *
 * `expandable-card.tsx` drives its FLIP with the Web Animations API, on purpose:
 * the transform depends on where the trigger sits on screen, so it cannot live in
 * a stylesheet, and WAAPI is the one way to script it that still composites off
 * the main thread.
 *
 * Without a shim `el.animate` is undefined, the component takes its no-animation
 * branch, and the ORDER that matters — exit finishes, only then does the dialog
 * close — becomes untestable. So the stub resolves `finished` on a macrotask:
 * long enough that a synchronous assertion can observe the in-between state,
 * short enough not to slow the suite.
 *
 * It does NOT interpolate anything. Keyframes and easing are the browser's job,
 * and a test that asserted them here would be asserting this file.
 */
if (typeof window !== "undefined" && !window.Element.prototype.animate) {
  window.Element.prototype.animate = function (
    this: Element,
    _keyframes: unknown,
    options?: number | { duration?: number },
  ) {
    let cancelled = false;
    let settle: () => void = () => {};
    const finished = new Promise<void>((resolve, reject) => {
      settle = resolve;
      const ms =
        typeof options === "number" ? options : (options?.duration ?? 0);
      setTimeout(() => {
        if (cancelled) reject(new DOMException("cancelled", "AbortError"));
        else resolve();
      }, Math.min(ms, 20));
    });
    // an unhandled rejection here would fail the suite from a cancel that the
    // component deliberately swallows
    finished.catch(() => {});
    return {
      finished,
      cancel() {
        cancelled = true;
      },
      play: settle,
    } as unknown as Animation;
  } as typeof Element.prototype.animate;
}
