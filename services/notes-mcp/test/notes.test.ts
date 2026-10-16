import { describe, expect, it } from "vitest";
import { MAX_NOTES, MAX_TEXT, NoteStore } from "../src/notes.js";

describe("NoteStore", () => {
  it("add returns the note with an increasing id", () => {
    const store = new NoteStore();
    const a = store.add("first");
    const b = store.add("second");
    expect(a).toMatchObject({ id: 1, text: "first" });
    expect(b.id).toBe(2);
  });

  it("list returns newest first", () => {
    const store = new NoteStore();
    store.add("old");
    store.add("new");
    expect(store.list({}).map((n) => n.text)).toEqual(["new", "old"]);
  });

  it("list filters by product ignoring case and spaces", () => {
    const store = new NoteStore();
    store.add("a", "Mug");
    store.add("b", "hoodie");
    store.add("c", "  mug ");
    expect(store.list({ product: "MUG" }).map((n) => n.text)).toEqual(["c", "a"]);
  });

  it("list returns at most 50, or the limit given", () => {
    const store = new NoteStore();
    for (let i = 0; i < 60; i++) store.add(`n${i}`);
    expect(store.list({})).toHaveLength(50);
    expect(store.list({ limit: 3 }).map((n) => n.text)).toEqual(["n59", "n58", "n57"]);
    expect(store.list({ limit: 500 })).toHaveLength(50);
  });

  it("keeps one canonical product form so Mug and mug are one product", () => {
    const store = new NoteStore();
    store.add("a", "Mug");
    store.add("b", "mug");
    store.add("c", "Hoodie");
    expect(store.products()).toEqual([
      { product: "Hoodie", notes: 1 },
      { product: "Mug", notes: 2 },
    ]);
    expect(store.list({}).every((n) => n.product !== "mug")).toBe(true);
  });

  it("trims the product and treats blank as no product", () => {
    const store = new NoteStore();
    expect(store.add("a", "  Mug  ").product).toBe("Mug");
    expect(store.add("b", "   ").product).toBeUndefined();
    expect(store.products()).toEqual([{ product: "Mug", notes: 1 }]);
  });

  it("rejects a product tag over 100 characters", () => {
    expect(() => new NoteStore().add("a", "x".repeat(101))).toThrow(/100/);
    expect(new NoteStore().add("a", "x".repeat(100)).product).toHaveLength(100);
  });

  it("rejects empty or oversized text", () => {
    const store = new NoteStore();
    expect(() => store.add("   ")).toThrow(/empty/);
    expect(() => store.add("x".repeat(MAX_TEXT + 1))).toThrow(String(MAX_TEXT));
  });

  it("rejects the note after the cap", () => {
    const store = new NoteStore();
    for (let i = 0; i < MAX_NOTES; i++) store.add("n");
    expect(() => store.add("one too many")).toThrow(String(MAX_NOTES));
  });
});
