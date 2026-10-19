import { describe, expect, it } from "vitest";
import { FixedWindowLimiter } from "../src/rate-limit.js";

describe("FixedWindowLimiter", () => {
  function make(max = 3, windowMs = 60_000) {
    const clock = { t: 1_000_000 };
    return { clock, limiter: new FixedWindowLimiter(max, windowMs, () => clock.t) };
  }

  it("allows max takes, then denies with a Retry-After rounded up to whole seconds", () => {
    const { clock, limiter } = make();
    for (let i = 0; i < 3; i++) expect(limiter.take("k")).toEqual({ ok: true });
    clock.t += 1_500;
    expect(limiter.take("k")).toEqual({ ok: false, retryAfterSeconds: 59 }); // 58.5s left
  });

  it("counts each key on its own", () => {
    const { limiter } = make(1);
    expect(limiter.take("a").ok).toBe(true);
    expect(limiter.take("a").ok).toBe(false);
    expect(limiter.take("b").ok).toBe(true);
  });

  it("starts a new window once windowMs has passed", () => {
    const { clock, limiter } = make(1);
    limiter.take("k");
    expect(limiter.take("k").ok).toBe(false);
    clock.t += 60_000;
    expect(limiter.take("k").ok).toBe(true);
  });

  it("reset forgets a key", () => {
    const { limiter } = make(1);
    limiter.take("k");
    limiter.reset("k");
    expect(limiter.take("k").ok).toBe(true);
  });

  it("refund gives one take back and never goes below zero", () => {
    const { limiter } = make(2);
    limiter.take("k");
    limiter.take("k");
    limiter.refund("k");
    expect(limiter.take("k").ok).toBe(true);
    expect(limiter.take("k").ok).toBe(false);
    limiter.refund("never-seen");
    limiter.refund("never-seen");
    expect(limiter.take("never-seen").ok).toBe(true);
    expect(limiter.take("never-seen").ok).toBe(true);
    expect(limiter.take("never-seen").ok).toBe(false);
  });

  it("sweep drops expired windows only", () => {
    const { clock, limiter } = make();
    limiter.take("old");
    clock.t += 30_000;
    limiter.take("new");
    clock.t += 30_000; // old is at its end, new has 30s left
    limiter.sweep();
    expect(limiter.size()).toBe(1);
  });
});
