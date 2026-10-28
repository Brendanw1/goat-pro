"use client";
import { useEffect, useRef, useState } from "react";

/** viewBox units per CSS pixel for a width-fluid SVG: font size = px * k keeps axis text constant on screen. */
export function useSvgScale(viewW: number) {
  const ref = useRef<SVGSVGElement>(null);
  const [k, setK] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => { if (el.clientWidth) setK(viewW / el.clientWidth); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [viewW]);
  return [ref, k] as const;
}
