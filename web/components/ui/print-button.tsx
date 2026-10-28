"use client";

/** Print the sheet: the browser's dialog over the print-tuned layout. */
export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="px-2.5 py-1 text-[11px] rounded bg-white/[0.06] text-text-primary border border-border-subtle hover:bg-white/[0.1] transition-colors press-scale"
    >
      Print sheet
    </button>
  );
}
