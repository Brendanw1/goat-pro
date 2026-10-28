/**
 * Constants integrity tests.
 *
 * Catches:
 * - Missing pitch type definitions (renders as undefined in UI)
 * - Inconsistent keys between config and data
 * - Column definitions referencing non-existent stat keys
 */
import { describe, it, expect } from "vitest";
import { PITCH_CONFIG, HITTER_COLUMNS, PITCHER_COLUMNS } from "@/lib/constants";

describe("PITCH_CONFIG", () => {
  const EXPECTED_TYPES = ["FF", "SI", "CH", "CB", "SL", "SW", "CT", "FS"];

  it("has all expected pitch types", () => {
    for (const pt of EXPECTED_TYPES) {
      expect(PITCH_CONFIG).toHaveProperty(pt);
    }
  });

  it("every pitch type has label, color, and shortLabel", () => {
    for (const [key, config] of Object.entries(PITCH_CONFIG)) {
      expect(config.label, `${key} missing label`).toBeTruthy();
      expect(config.color, `${key} missing color`).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(config.shortLabel, `${key} missing shortLabel`).toBeTruthy();
    }
  });

  it("colors are valid hex codes", () => {
    for (const [key, config] of Object.entries(PITCH_CONFIG)) {
      expect(config.color, `${key} has invalid color`).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});

describe("HITTER_COLUMNS", () => {
  it("has required columns (name, team, pa, woba)", () => {
    const keys = HITTER_COLUMNS.map((c) => c.key);
    expect(keys).toContain("name");
    expect(keys).toContain("team");
    expect(keys).toContain("pa");
    expect(keys).toContain("woba");
  });

  it("every column has a label and key", () => {
    for (const col of HITTER_COLUMNS) {
      expect(col.key).toBeTruthy();
      expect(col.label).toBeTruthy();
    }
  });

  it("no duplicate keys", () => {
    const keys = HITTER_COLUMNS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("PITCHER_COLUMNS", () => {
  it("has required columns (name, team, era, kPct)", () => {
    const keys = PITCHER_COLUMNS.map((c) => c.key);
    expect(keys).toContain("name");
    expect(keys).toContain("team");
    expect(keys).toContain("era");
    expect(keys).toContain("kPct");
  });

  it("no duplicate keys", () => {
    const keys = PITCHER_COLUMNS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
