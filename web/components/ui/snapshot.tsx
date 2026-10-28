"use client";

/**
 * Snapshot: pick any panels on any page (profile, fall profile, game / practice / postgame report) and export them as
 * one branded PNG for coaches. Docs: docs/snapshot.md.
 *
 * Every leaf `.glass-panel` in <main> is pickable (a panel holding other panels is a wrapper, not a unit), so no page
 * opts in. Picked panels are CLONED into a board (a still image of what was on screen, not live components), laid out
 * in the order picked, reorderable, at a slide or portrait width, and saved with html-to-image at 2x.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { pngFileName } from "@/components/ui/export-png-button";

const PICKABLE = "main .glass-panel";
const LAYOUTS = { slide: { w: 1920, label: "Slide (16:9 width)" }, portrait: { w: 1080, label: "Portrait / phone" } } as const;
type Layout = keyof typeof LAYOUTS;

/** Leaf panels: a .glass-panel containing another one is a wrapper. Exported for the test. */
export function leafPanels(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(PICKABLE)].filter((el) => !el.querySelector(".glass-panel"));
}
/** Move item i by d (-1 up, +1 down) within bounds; a new array. */
export function move<T>(xs: T[], i: number, d: -1 | 1): T[] {
  const j = i + d;
  if (j < 0 || j >= xs.length) return xs;
  const out = [...xs];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}
const titleOf = (el: HTMLElement) => (el.querySelector("h2, h3, figcaption")?.textContent ?? "").trim().slice(0, 80) || "Panel";

/** A still copy of a panel: canvases become images and every SVG gets a viewBox so it scales. Ids stay: charts clip
 *  and fill through url(#id), and the page's originals come first in the document, so duplicates still resolve. */
function still(el: HTMLElement): HTMLElement {
  const c = el.cloneNode(true) as HTMLElement;
  const src = el.querySelectorAll("canvas"), dst = c.querySelectorAll("canvas");
  src.forEach((cv, i) => {
    try {
      const img = document.createElement("img");
      img.src = cv.toDataURL("image/png");
      img.style.width = `${cv.clientWidth}px`; img.style.height = `${cv.clientHeight}px`;
      dst[i].replaceWith(img);
    } catch { /* a tainted canvas stays blank */ }
  });
  // nivo measures through a 0 x 0 wrapper; open it so the chart below can take the cell's width.
  c.querySelectorAll<HTMLElement>("div[style]").forEach((d) => {
    if (d.style.width === "0px" && d.style.height === "0px") { d.style.width = "100%"; d.style.height = "auto"; }
  });
  c.querySelectorAll("svg").forEach((s) => {
    const w = parseFloat(s.getAttribute("width") ?? ""), h = parseFloat(s.getAttribute("height") ?? "");
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 60 || String(s.getAttribute("width")).includes("%")) return;   // icons stay as they are
    if (!s.getAttribute("viewBox")) s.setAttribute("viewBox", `0 0 ${w} ${h}`);
    // Fit the cell, never larger than it was drawn, proportions kept.
    s.style.width = "100%"; s.style.maxWidth = `${w}px`; s.style.height = "auto";
  });
  c.removeAttribute("data-snap-candidate"); c.removeAttribute("data-snap-picked");
  c.querySelectorAll("[data-export-exclude]").forEach((n) => n.remove());
  return c;
}

/** `copy` is taken at the click, while the panel is on screen: lazy charts draw only once visible and may not later. */
type Pick = { key: number; el: HTMLElement; copy: HTMLElement; title: string; w: number };

export function SnapshotTool() {
  const [mode, setMode] = useState<"off" | "pick" | "board">("off");
  const [picks, setPicks] = useState<Pick[]>([]);
  const seq = useRef(0);

  // Pick mode: mark candidates, and take clicks on them (capture phase, so a chart's own click does not fire).
  useEffect(() => {
    if (mode !== "pick") return;
    const cands = leafPanels(document);
    cands.forEach((el) => el.setAttribute("data-snap-candidate", ""));
    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>("[data-snap-candidate]");
      if (!el) return;
      e.preventDefault(); e.stopPropagation();
      setPicks((ps) => ps.some((p) => p.el === el) ? ps.filter((p) => p.el !== el)
        : [...ps, { key: ++seq.current, el, copy: still(el), title: titleOf(el), w: el.offsetWidth }]);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMode("off"); };
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey);
      cands.forEach((el) => { el.removeAttribute("data-snap-candidate"); el.removeAttribute("data-snap-picked"); });
    };
  }, [mode]);
  useEffect(() => {
    if (mode !== "pick") return;
    document.querySelectorAll("[data-snap-picked]").forEach((n) => n.removeAttribute("data-snap-picked"));
    picks.forEach((p, i) => p.el.setAttribute("data-snap-picked", String(i + 1)));
  }, [picks, mode]);

  const reset = useCallback(() => { setMode("off"); setPicks([]); }, []);

  return (
    <>
      {mode === "off" && (
        <button type="button" onClick={() => setMode("pick")} data-export-exclude title="Pick panels on this page and export them as one image"
          className="press-feedback fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full border border-usf-gold/30 bg-surface-1/90 px-4 py-2 text-xs text-text-primary shadow-[0_8px_30px_rgba(0,0,0,0.45)] backdrop-blur hover:border-usf-gold/60 print:hidden">
          <CameraIcon /> Snapshot
        </button>
      )}
      {mode === "pick" && (
        <div data-export-exclude role="toolbar" aria-label="Snapshot"
          className="fixed inset-x-0 bottom-5 z-40 mx-auto flex w-fit items-center gap-3 rounded-full border border-usf-gold/40 bg-surface-1/95 px-4 py-2 text-xs shadow-[0_10px_40px_rgba(0,0,0,0.55)] backdrop-blur print:hidden">
          <CameraIcon />
          <span className="text-text-secondary">{picks.length ? `${picks.length} picked, in this order` : "Click the panels to include, in the order you want them"}</span>
          {picks.length > 0 && <button type="button" onClick={() => setPicks([])} className="text-text-dim hover:text-text-primary">Clear</button>}
          <button type="button" onClick={reset} className="text-text-dim hover:text-text-primary">Cancel</button>
          <button type="button" disabled={!picks.length} onClick={() => setMode("board")}
            className="rounded-full bg-usf-gold px-3 py-1 font-semibold text-black disabled:opacity-40">Build snapshot</button>
        </div>
      )}
      {mode === "board" && <Board picks={picks} setPicks={setPicks} onBack={() => setMode("pick")} onDone={reset} />}
    </>
  );
}

function Board({ picks, setPicks, onBack, onDone }: { picks: Pick[]; setPicks: (f: (p: Pick[]) => Pick[]) => void; onBack: () => void; onDone: () => void }) {
  const dlg = useRef<HTMLDialogElement>(null);
  const board = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<Layout>("slide");
  const [cols, setCols] = useState(picks.length === 1 ? 1 : 2);
  const [title, setTitle] = useState(() => document.title.replace(/\s+[—-]\s+GOAT$/, ""));
  const [sub, setSub] = useState(() => new Date().toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" }));
  const [fit, setFit] = useState(1);
  const [boardH, setBoardH] = useState(0);
  const [busy, setBusy] = useState<"idle" | "busy" | "failed">("idle");
  const W = LAYOUTS[layout].w, PAD = 48, GAP = 24, cell = (W - 2 * PAD - (cols - 1) * GAP) / cols;

  useEffect(() => { dlg.current?.showModal(); }, []);
  // Preview scale: the board is built at its real export width and shown scaled to fit the dialog.
  useLayoutEffect(() => {
    const f = () => setFit(Math.min(1, ((frame.current?.clientWidth ?? W) - 8) / W));
    f(); window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, [W]);
  useEffect(() => {
    const el = board.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBoardH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const mount = useCallback((p: Pick, slot: HTMLDivElement | null) => {
    if (!slot) return;
    const c = p.copy;
    // Reflowed to the cell (the site's panels are fluid); SVGs scale through the viewBox still() gave them. A panel
    // much wider on the page than its cell is zoomed out a little instead, so a wide table is not crushed.
    const cw = slot.clientWidth || cell, squeeze = cw / p.w;
    c.style.margin = "0";
    if (squeeze < 0.6) { c.style.width = `${Math.round(cw / 0.8)}px`; c.style.zoom = "0.8"; } else { c.style.width = "100%"; c.style.zoom = ""; }
    if (c.parentElement !== slot) slot.replaceChildren(c);
  }, [cell]);

  async function save() {
    if (!board.current) return;
    setBusy("busy");
    try {
      const { toPng } = await import("html-to-image");
      const url = await toPng(board.current, { pixelRatio: 2, cacheBust: true, backgroundColor: getComputedStyle(document.body).backgroundColor || "#0b0f14" });
      const a = document.createElement("a");
      a.href = url; a.download = pngFileName([title, sub]); a.click();
      setBusy("idle");
    } catch { setBusy("failed"); }
  }

  return (
    <dialog ref={dlg} onCancel={(e) => { e.preventDefault(); onBack(); }} data-export-exclude
      className="m-auto h-[94vh] w-[min(96vw,1700px)] overflow-hidden rounded-panel border border-border-subtle bg-[#0d1216] p-0 text-text-primary backdrop:bg-black/70">
      <div className="flex h-full flex-col">
        <div className="flex flex-wrap items-center gap-3 border-b border-border-subtle px-5 py-3 text-xs">
          <span className="font-semibold">Snapshot</span>
          <label className="flex items-center gap-1.5 text-text-dim">Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-64 rounded-md border border-border-subtle bg-white/[0.04] px-2 py-1 text-text-primary" />
          </label>
          <label className="flex items-center gap-1.5 text-text-dim">Subtitle
            <input value={sub} onChange={(e) => setSub(e.target.value)} className="w-56 rounded-md border border-border-subtle bg-white/[0.04] px-2 py-1 text-text-primary" />
          </label>
          <div className="flex gap-1" role="group" aria-label="Size">
            {(Object.keys(LAYOUTS) as Layout[]).map((k) => (
              <button key={k} type="button" aria-pressed={layout === k} onClick={() => setLayout(k)}
                className={`rounded-md border px-2 py-1 ${layout === k ? "border-usf-green/30 bg-usf-green/20 text-usf-gold" : "border-border-subtle text-text-secondary"}`}>{LAYOUTS[k].label}</button>
            ))}
          </div>
          <div className="flex gap-1" role="group" aria-label="Columns">
            {[1, 2, 3].map((n) => (
              <button key={n} type="button" aria-pressed={cols === n} onClick={() => setCols(n)}
                className={`rounded-md border px-2 py-1 ${cols === n ? "border-usf-green/30 bg-usf-green/20 text-usf-gold" : "border-border-subtle text-text-secondary"}`}>{n} col</button>
            ))}
          </div>
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={onBack} className="rounded-md border border-border-subtle px-3 py-1 text-text-secondary">Back to picking</button>
            <button type="button" onClick={onDone} className="rounded-md border border-border-subtle px-3 py-1 text-text-secondary">Close</button>
            <button type="button" onClick={save} disabled={busy === "busy"} className="rounded-md bg-usf-gold px-3 py-1 font-semibold text-black disabled:opacity-50">
              {busy === "busy" ? "Rendering…" : busy === "failed" ? "Failed, retry" : "Export PNG"}
            </button>
          </div>
        </div>
        <div className="flex min-h-0 flex-1">
          <ol className="w-60 shrink-0 space-y-1 overflow-y-auto border-r border-border-subtle p-3 text-[11px]" aria-label="Order">
            {picks.map((p, i) => (
              <li key={p.key} className="flex items-center gap-1.5 rounded-md bg-white/[0.03] px-2 py-1.5">
                <span className="w-4 text-text-dim">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-text-secondary" title={p.title}>{p.title}</span>
                <button type="button" aria-label={`Move ${p.title} up`} onClick={() => setPicks((ps) => move(ps, i, -1))} className="px-1 text-text-dim hover:text-text-primary">↑</button>
                <button type="button" aria-label={`Move ${p.title} down`} onClick={() => setPicks((ps) => move(ps, i, 1))} className="px-1 text-text-dim hover:text-text-primary">↓</button>
                <button type="button" aria-label={`Remove ${p.title}`} onClick={() => setPicks((ps) => ps.filter((x) => x.key !== p.key))} className="px-1 text-text-dim hover:text-rose-300">×</button>
              </li>
            ))}
          </ol>
          <div ref={frame} className="min-w-0 flex-1 overflow-auto bg-black/30 p-4">
            <div style={{ width: W * fit, height: boardH * fit }}>
              <div style={{ transform: `scale(${fit})`, transformOrigin: "top left", width: W }}>
                <div ref={board} style={{ width: W, padding: PAD, background: "radial-gradient(1200px 500px at 0% 0%, rgba(0,84,60,0.35), transparent 60%), #0b0f14" }}>
                  <header className="mb-8 flex items-end justify-between border-b border-white/10 pb-5">
                    <div>
                      <div className="text-[44px] font-semibold leading-tight tracking-tight text-white">{title}</div>
                      <div className="mt-1 text-lg text-white/60">{sub}</div>
                    </div>
                    <div className="flex items-center gap-3 text-white/70">
                      {/* eslint-disable-next-line @next/next/no-img-element -- html-to-image inlines a plain img; next/image would not export */}
                      <img src="/icon.svg" alt="" width={44} height={44} className="rounded-xl" />
                      <div className="text-right text-sm leading-tight"><div className="font-semibold text-white">GOAT</div><div className="text-white/50">MLB &amp; AAA research</div></div>
                    </div>
                  </header>
                  <div className="grid items-start" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: GAP }}>
                    {picks.map((p) => <div key={`${p.key}-${cols}-${layout}`} ref={(s) => mount(p, s)} className="min-w-0" />)}
                  </div>
                  <footer className="mt-8 text-right text-xs text-white/40">Snapshot of the site as shown on screen · {new Date().toLocaleString()}</footer>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </dialog>
  );
}

function CameraIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx={12} cy={13} r={3.5} />
    </svg>
  );
}
