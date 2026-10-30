"use client";

/**
 * Click-to-sort for any table, server-rendered or not, without moving its rows into client state.
 *
 * `<SortableTable>` replaces `<table>`; `<SortTh>` replaces each sortable `<th>` (a button inside, aria-sort on
 * the th). A click reorders the existing `<tr>`s of each `<tbody>` in place, so the payload and the server render
 * stay exactly as they were: no row data crosses to the client. Each tbody sorts on its own (grouped tables keep
 * their groups); tfoot rows and rows marked data-sort-pin (an "All" total) never move; a one-cell full-width
 * detail row travels with the row above it.
 *
 * A cell sorts on its `data-sort` attribute when it has one (the raw value), else on its text parsed by
 * `sortValue` (".312", "12.5%", "+1.2", "−0.4", "1,234" all read as numbers; "—" is a blank). The order itself is
 * `compareValues` from lib/table-sort: blanks last in both directions, ties keep their original order.
 * First click: `first` if given, else descending for numbers and ascending for text. Second click reverses.
 */
import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState, type ReactNode, type TableHTMLAttributes, type ThHTMLAttributes } from "react";
import { compareValues, type SortDir } from "@/lib/table-sort";

/** Display text (or a data-sort attribute) to a rankable value: number, string, or null for a blank. */
export function sortValue(raw: string | null | undefined): number | string | null {
  if (raw == null) return null;
  const t = raw.trim();
  if (!t || /^[—–\-?]+$|^n\/?a$/i.test(t)) return null;
  const n = t.replace(/[−–]/g, "-").replace(/[,%$\s]/g, "").replace(/^\+/, "");
  if (/^-?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(n)) return Number(n);
  return t.toLowerCase();
}

type Sort = { col: number; dir: SortDir } | null;
const Ctx = createContext<{ sort: Sort; toggle: (th: HTMLTableCellElement, first?: SortDir) => void } | null>(null);

/** Column position of a cell, counting colSpans before it. */
const colOf = (cell: HTMLTableCellElement) => {
  let pos = 0;
  for (let c = cell.previousElementSibling; c; c = c.previousElementSibling) pos += (c as HTMLTableCellElement).colSpan || 1;
  return pos;
};

const cellAt = (row: HTMLTableRowElement, col: number) => {
  let pos = 0;
  for (const c of Array.from(row.cells)) {
    if (pos === col) return c;
    pos += c.colSpan || 1;
    if (pos > col) return null;
  }
  return null;
};

const keyOf = (row: HTMLTableRowElement, col: number) => {
  const c = cellAt(row, col);
  return c ? sortValue(c.dataset.sort ?? c.textContent) : null;
};

export function SortableTable({ children, ...rest }: TableHTMLAttributes<HTMLTableElement> & { children: ReactNode }) {
  const ref = useRef<HTMLTableElement>(null);
  const order = useRef(new WeakMap<Element, number>());
  const seen = useRef(0);
  const [sort, setSort] = useState<Sort>(null);

  const apply = useCallback((s: Sort) => {
    const table = ref.current;
    if (!table || !s) return;
    for (const body of Array.from(table.tBodies)) {
      const rows = Array.from(body.rows);
      // A row that is one full-width cell (an expanded detail row) travels with the row above it.
      const groups: HTMLTableRowElement[][] = [];
      for (const r of rows) {
        if (!order.current.has(r)) order.current.set(r, seen.current++);
        if (groups.length && r.cells.length === 1 && r.cells[0].colSpan > 1) groups[groups.length - 1].push(r);
        else groups.push([r]);
      }
      // data-sort-pin rows (an "All" total) hold the top.
      const pinned = groups.filter((g) => g[0].dataset.sortPin != null);
      const keyed = groups.filter((g) => g[0].dataset.sortPin == null).map((g) => ({ g, k: keyOf(g[0], s.col), i: order.current.get(g[0])! }));
      keyed.sort((a, b) => compareValues(a.k, b.k, s.dir) || a.i - b.i);
      const next = [...pinned, ...keyed.map((x) => x.g)].flat();
      if (next.some((r, i) => r !== rows[i])) for (const r of next) body.appendChild(r);
    }
  }, []);

  // Re-apply after every render: a client table whose rows change keeps the chosen order.
  useLayoutEffect(() => apply(sort));

  const toggle = useCallback((th: HTMLTableCellElement, first?: SortDir) => {
    const col = colOf(th);
    setSort((s) => {
      if (s?.col === col) return { col, dir: s.dir === "desc" ? "asc" : "desc" };
      let dir = first;
      if (!dir) {
        const rows = ref.current ? Array.from(ref.current.tBodies).flatMap((b) => Array.from(b.rows)) : [];
        dir = rows.some((r) => typeof keyOf(r, col) === "number") ? "desc" : "asc";
      }
      return { col, dir };
    });
  }, []);

  return (
    <Ctx.Provider value={{ sort, toggle }}>
      <table ref={ref} {...rest}>{children}</table>
    </Ctx.Provider>
  );
}

/** A sortable header cell. `first` overrides the first-click direction (e.g. "asc" for ranks or lower-is-better). */
export function SortTh({ children, first, className, ...rest }: ThHTMLAttributes<HTMLTableCellElement> & { first?: SortDir }) {
  const ctx = useContext(Ctx);
  const ref = useRef<HTMLTableCellElement>(null);
  const [col, setCol] = useState(-1);
  useLayoutEffect(() => { if (ref.current) setCol(colOf(ref.current)); }, []);
  const on = ctx?.sort && ctx.sort.col === col ? ctx.sort.dir : null;
  return (
    <th ref={ref} aria-sort={on === "desc" ? "descending" : on === "asc" ? "ascending" : "none"} className={className} {...rest}>
      <button type="button" onClick={() => ref.current && ctx?.toggle(ref.current, first)}
        className={`cursor-pointer select-none [text-transform:inherit] [text-align:inherit] hover:text-text-primary ${on ? "text-text-primary" : ""}`}>
        {children}{on ? <span aria-hidden className="ml-0.5">{on === "desc" ? "▼" : "▲"}</span> : null}
      </button>
    </th>
  );
}
