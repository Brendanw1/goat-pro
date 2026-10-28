"use client";

import { useState } from "react";

/** `833405-2026-03-10-vs-umbc_ret.png`: lowercase, filesystem-safe, empty parts dropped. */
export function pngFileName(parts: string[]): string {
  const slug = parts.filter(Boolean).join("-").toLowerCase().replace(/[^a-z0-9_]+/g, "-").replace(/^-+|-+$/g, "");
  return `${slug || "report"}.png`;
}

/**
 * Saves `target()` as a PNG for sharing: rendered at 2x, on the page's own background so dark mode does not come out
 * transparent, without any node marked `data-export-exclude` (the buttons themselves).
 */
export function ExportPngButton({ target, fileName }: { target: () => HTMLElement | null; fileName: string }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function save() {
    const node = target();
    if (!node) return;
    setBusy(true);
    setFailed(false);
    try {
      const { toPng } = await import("html-to-image");
      const url = await toPng(node, {
        pixelRatio: 2,
        cacheBust: true,
        backgroundColor: getComputedStyle(document.body).backgroundColor || "#0b0f14",
        filter: (n: Node) => !(n instanceof HTMLElement && n.dataset.exportExclude !== undefined),
      });
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" onClick={save} disabled={busy} data-export-exclude
      title={failed ? "Could not render the report; try again" : "Save this report as a PNG image"}
      className="rounded-md border border-border-subtle px-2.5 py-1 text-[11px] text-text-secondary hover:text-text-primary disabled:opacity-50">
      {busy ? "Exporting…" : failed ? "Export failed, retry" : "Export PNG"}
    </button>
  );
}
