"use client";

import { useState } from "react";

interface FilterDef {
  key: string;
  label: string;
  type: "select" | "range" | "toggle";
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
}

interface FilterPanelProps {
  filters: FilterDef[];
  values: Record<string, any>;
  onChange: (key: string, value: any) => void;
  onReset: () => void;
}

export function FilterPanel({ filters, values, onChange, onReset }: FilterPanelProps) {
  const [open, setOpen] = useState(false);

  // A value at its no-op default (empty, 0, or a max* slider at its ceiling) is not an active filter.
  const activeCount = Object.entries(values).filter(([k, v]) => {
    if (v === "" || v === null || v === undefined || v === 0) return false;
    const def = filters.find((f) => f.key === k);
    return !(def?.type === "range" && k.startsWith("max") && v === def.max);
  }).length;

  return (
    <div className="relative">
      {/* Trigger Button */}
      <button
        onClick={() => setOpen(!open)}
        className={`group relative px-4 py-1.5 rounded-full text-xs font-medium border transition-all duration-200 active:scale-[0.96] ${
          activeCount > 0
            ? "filter-chip-active shadow-[0_0_12px_rgba(232,119,34,0.2)]"
            : "border-border-subtle text-text-secondary hover:bg-white/[0.03] hover:border-white/[0.15] hover:shadow-[0_0_20px_rgba(232,119,34,0.12)]"
        }`}
      >
        {/* Glow effect on hover */}
        <span className="absolute inset-0 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
          style={{ boxShadow: "0 0 16px rgba(232, 119, 34, 0.15), inset 0 0 8px rgba(232, 119, 34, 0.05)" }}
        />
        <span className="relative">
          Filters{activeCount > 0 ? ` (${activeCount})` : ""}
          <span className="ml-1.5 text-[10px]">{open ? "▲" : "▼"}</span>
        </span>
      </button>

      {/* Panel */}
      {open && (
        <div className="absolute top-full mt-2 left-0 z-50 glass-panel p-4 w-[320px] shadow-[0_8px_40px_rgba(0,0,0,0.5),0_2px_8px_rgba(0,0,0,0.3)] animate-in">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-text-dim">
              Filters
            </span>
            <button
              onClick={() => { onReset(); }}
              className="text-[10px] text-text-dim hover:text-usf-gold transition-colors"
            >
              Reset all
            </button>
          </div>

          <div className="space-y-3">
            {filters.map((f) => (
              <div key={f.key}>
                <label htmlFor={`filter-${f.key}`} className="text-[10px] font-medium text-text-secondary mb-1 block">
                  {f.label}
                </label>

                {f.type === "select" && (
                  <select
                    id={`filter-${f.key}`}
                    value={values[f.key] || ""}
                    onChange={(e) => onChange(f.key, e.target.value)}
                    className="w-full px-2 py-1.5 rounded-md text-xs bg-white/[0.04] border border-border-subtle text-text-primary focus:border-border-emphasis appearance-none cursor-pointer"
                  >
                    <option value="">All</option>
                    {f.options?.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                )}

                {f.type === "range" && (
                  <div className="flex items-center gap-2">
                    <input
                      id={`filter-${f.key}`}
                      type="range"
                      min={f.min || 0}
                      max={f.max || 200}
                      step={f.step || 5}
                      value={values[f.key] || f.min || 0}
                      onChange={(e) => onChange(f.key, Number(e.target.value))}
                      className="flex-1 accent-usf-gold h-1"
                    />
                    <span className="text-[11px] font-data text-text-primary w-[36px] text-right">
                      {values[f.key] || f.min || 0}
                    </span>
                  </div>
                )}

                {f.type === "toggle" && (
                  <div className="flex gap-1.5 flex-wrap">
                    {f.options?.map((opt) => (
                      <button
                        key={opt}
                        onClick={() => onChange(f.key, values[f.key] === opt ? "" : opt)}
                        className={`px-2 py-0.5 rounded text-[10px] border transition-all press-scale ${
                          values[f.key] === opt
                            ? "bg-usf-green/20 border-usf-green/40 text-usf-gold"
                            : "border-border-subtle text-text-dim hover:bg-white/[0.03]"
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Close */}
          <button
            onClick={() => setOpen(false)}
            className="mt-3 w-full py-1.5 rounded-md text-xs bg-white/[0.04] text-text-secondary hover:bg-white/[0.06] transition-all"
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
}
