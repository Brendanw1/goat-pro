/**
 * FilterBuilder from precomputed meta (the paged boards, lib/boards/shared.ts)
 * must render exactly what it renders from rows: same addable columns, same
 * range placeholders, same pick-lists.
 */
import { describe, expect, it } from "vitest";
import { act, render } from "@testing-library/react";
import { FilterBuilder } from "@/components/ui/filter-builder";
import { filterMeta, type ActiveFilter, type FilterColumn } from "@/lib/column-filters";

const COLUMNS: FilterColumn[] = [
  { key: "velo", label: "Velo", group: "Shape" },
  { key: "year", label: "Class", group: "Context" },
  { key: "mixed", label: "Mixed", group: "Context" },   // numbers and strings: not filterable either way
];
const ROWS = [
  { velo: 91.25, year: "Jr", mixed: 1 }, { velo: 97, year: "Sr", mixed: "a" }, { velo: null, year: "Fr" },
];

async function html(props: { rows?: object[]; meta?: ReturnType<typeof filterMeta> }, active: ActiveFilter[], click: string) {
  const { container, getByText, unmount } = render(<FilterBuilder {...props} columns={COLUMNS} active={active} onChange={() => {}} />);
  await act(async () => { getByText(click).click(); });
  const out = container.innerHTML;
  unmount();
  return out;
}

describe("FilterBuilder with meta", () => {
  const meta = filterMeta(ROWS, COLUMNS);

  it("derives the kind, range and categories the rows imply", () => {
    expect(meta).toEqual({ velo: { kind: "number", range: { min: 91.25, max: 97 } }, year: { kind: "category", categories: ["Fr", "Jr", "Sr"] } });
  });

  it("renders the same add menu, range editor and pick-list as from rows", async () => {
    expect(await html({ meta }, [], "+ Add filter")).toBe(await html({ rows: ROWS }, [], "+ Add filter"));
    const velo = [{ key: "velo", min: 92 }];
    const a = await html({ meta }, velo, "Velo ≥ 92");
    expect(a).toContain('placeholder="min 91.3"');
    expect(a).toBe(await html({ rows: ROWS }, velo, "Velo ≥ 92"));
    const year = [{ key: "year", values: ["Jr"] }];
    const b = await html({ meta }, year, "Class: Jr");
    expect(b).toContain(">Fr<");
    expect(b).toBe(await html({ rows: ROWS }, year, "Class: Jr"));
  });
});
