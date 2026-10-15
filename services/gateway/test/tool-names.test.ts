import { describe, expect, it } from "vitest";
import { isValidSlug, isValidToolName, prefixed, splitName } from "../src/tool-names.js";

describe("splitName", () => {
  it("splits on the first __", () => {
    expect(splitName("woo__list_products")).toEqual({ slug: "woo", tool: "list_products" });
  });
  it("keeps later __ inside the tool name", () => {
    expect(splitName("notes__add__note")).toEqual({ slug: "notes", tool: "add__note" });
  });
  it("returns null when there is no prefix or one side is empty", () => {
    expect(splitName("list_products")).toBeNull();
    expect(splitName("__tool")).toBeNull();
    expect(splitName("woo__")).toBeNull();
  });
  it("round-trips with prefixed", () => {
    expect(splitName(prefixed("fx-rates", "convert"))).toEqual({ slug: "fx-rates", tool: "convert" });
  });
});

describe("isValidSlug", () => {
  it("accepts lowercase words joined by single hyphens", () => {
    expect(isValidSlug("woo")).toBe(true);
    expect(isValidSlug("fx-rates")).toBe(true);
    expect(isValidSlug("a".repeat(20))).toBe(true);
  });
  it("rejects anything that could contain __ or break the format", () => {
    for (const s of ["a__b", "_a", "a_b", "a-", "-a", "a--b", "A", "a b", "", "a".repeat(21)]) {
      expect(isValidSlug(s), s).toBe(false);
    }
  });
});

describe("isValidToolName", () => {
  it("accepts what MCP clients accept", () => {
    expect(isValidToolName("woo__list_products")).toBe(true);
    expect(isValidToolName("a".repeat(64))).toBe(true);
  });
  it("rejects too long names, spaces and dots", () => {
    expect(isValidToolName("a".repeat(65))).toBe(false);
    expect(isValidToolName("woo__list products")).toBe(false);
    expect(isValidToolName("woo__list.products")).toBe(false);
    expect(isValidToolName("")).toBe(false);
  });
});
