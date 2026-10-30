import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { SortableTable, SortTh, sortValue } from "@/components/ui/sortable-table";

describe("sortValue reads display text as the raw value", () => {
  it("parses formatted numbers", () => {
    expect(sortValue(".312")).toBe(0.312);
    expect(sortValue("12.5%")).toBe(12.5);
    expect(sortValue("+1.2")).toBe(1.2);
    expect(sortValue("−0.4")).toBe(-0.4);
    expect(sortValue("1,234")).toBe(1234);
  });
  it("treats dashes and empties as blanks, the rest as text", () => {
    expect(sortValue("—")).toBeNull();
    expect(sortValue(" ")).toBeNull();
    expect(sortValue("-")).toBeNull();
    expect(sortValue("Judge")).toBe("judge");
  });
});

describe("SortableTable", () => {
  const view = () => render(
    <SortableTable>
      <thead><tr><SortTh>Name</SortTh><SortTh>AVG</SortTh></tr></thead>
      <tbody>
        <tr><td>b</td><td>.250</td></tr>
        <tr><td>a</td><td>—</td></tr>
        <tr><td>c</td><td data-sort="0.3125">.313</td></tr>
        <tr><td>d</td><td>.250</td></tr>
      </tbody>
    </SortableTable>,
  );
  const names = (c: HTMLElement) => Array.from(c.querySelectorAll("tbody tr")).map((r) => r.firstElementChild!.textContent);

  it("numbers descend first, reverse on second click, blanks last both ways, ties stable", () => {
    const { container, getByText } = view();
    fireEvent.click(getByText("AVG"));
    expect(names(container)).toEqual(["c", "b", "d", "a"]);
    expect(getByText("AVG").closest("th")!.getAttribute("aria-sort")).toBe("descending");
    fireEvent.click(getByText("AVG"));
    expect(names(container)).toEqual(["b", "d", "c", "a"]);
    expect(getByText("AVG").closest("th")!.getAttribute("aria-sort")).toBe("ascending");
  });

  it("text ascends first", () => {
    const { container, getByText } = view();
    fireEvent.click(getByText("Name"));
    expect(names(container)).toEqual(["a", "b", "c", "d"]);
  });
});
