import { describe, expect, it } from "vitest";
import { decodeQueryKey, encodeQueryKey, QUERY_ROUTES } from "@/lib/query-key";

const keysFor = (path: string) => QUERY_ROUTES.find(([re]) => re.test(path))![1];

describe("query-key", () => {
  it("round-trips the whitelisted query, order-free, dropping junk", () => {
    const keys = keysFor("/prospects");
    const a = encodeQueryKey(new URLSearchParams("view=team&year=2025&team=dodgers&utm_source=x&_rsc=abc"), keys);
    const b = encodeQueryKey(new URLSearchParams("team=dodgers&year=2025&view=team"), keys);
    expect(a).toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeQueryKey(a)).toEqual({ team: "dodgers", view: "team", year: "2025" });
  });
  it("maps no usable param to the default view", () => {
    expect(encodeQueryKey(new URLSearchParams("year=<script>&x=1"), keysFor("/prospects"))).toBe("_");
    expect(decodeQueryKey("_")).toEqual({});
    expect(decodeQueryKey("!!!")).toBeNull();
  });
  it("matches only the converted paths", () => {
    expect(QUERY_ROUTES.some(([re]) => re.test("/teams/hou"))).toBe(true);
    expect(QUERY_ROUTES.some(([re]) => re.test("/teams/hou/q/_"))).toBe(false);
    expect(QUERY_ROUTES.some(([re]) => re.test("/player/123"))).toBe(false);
  });
});
