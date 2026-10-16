import { describe, expect, it } from "vitest";
import { AS_OF, convert, ratesFor } from "../src/rates.js";

describe("convert", () => {
  it("converts from USD using the table", () => {
    const r = convert(100, "USD", "EUR");
    expect(r.rate).toBeCloseTo(0.92, 5);
    expect(r.result).toBe(92);
    expect(r.as_of).toBe(AS_OF);
  });

  it("goes through USD for cross rates", () => {
    const r = convert(100, "EUR", "GBP");
    expect(r.rate).toBeCloseTo(0.79 / 0.92, 8);
  });

  it("same currency has rate 1", () => {
    expect(convert(12.34, "INR", "INR")).toMatchObject({ rate: 1, result: 12.34 });
  });

  it("rounds only the result, to the target currency minor units", () => {
    // JPY has 0 decimals, EUR has 2. The rate itself is never rounded.
    expect(Number.isInteger(convert(10, "USD", "JPY").result)).toBe(true);
    expect(convert(1, "USD", "EUR").rate).toBe(0.92);
    expect(convert(1.234, "USD", "EUR").result).toBe(1.14);
  });

  it("throws on an unknown currency and lists the supported ones", () => {
    expect(() => convert(1, "USD", "XXX")).toThrow(/XXX.*USD/);
    expect(() => convert(1, "ZZZ", "USD")).toThrow(/ZZZ/);
  });
});

describe("ratesFor", () => {
  it("base USD returns every other currency", () => {
    const r = ratesFor("USD");
    expect(r.base).toBe("USD");
    expect(r.rates.EUR).toBe(0.92);
    expect(r.rates.USD).toBeUndefined();
  });

  it("rebases through USD", () => {
    expect(ratesFor("EUR").rates.USD).toBeCloseTo(1 / 0.92, 8);
  });

  it("throws on an unknown base", () => {
    expect(() => ratesFor("XXX")).toThrow(/XXX/);
  });
});
