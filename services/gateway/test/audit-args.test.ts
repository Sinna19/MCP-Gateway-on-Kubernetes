import { describe, expect, it } from "vitest";
import { auditArgs, MAX_ARGS_BYTES, redact } from "../src/audit-args.js";

describe("redact", () => {
  it("replaces values whose key matches, at any depth and in arrays, ignoring case", () => {
    const out = redact({
      name: "Widget",
      token: "t1",
      Authorization: "a1",
      nested: { api_key: "k1", PASSWORD: "p1", keep: 1 },
      list: [{ cookie: "c1", ok: true }, "plain"],
      client_secret: { deep: "s1" },
    });
    expect(out).toEqual({
      name: "Widget",
      token: "[redacted]",
      Authorization: "[redacted]",
      nested: { api_key: "[redacted]", PASSWORD: "[redacted]", keep: 1 },
      list: [{ cookie: "[redacted]", ok: true }, "plain"],
      client_secret: "[redacted]",
    });
  });

  it("over-redacts on purpose: author and keyword match too", () => {
    expect(redact({ author: "x", keyword: "y", order_key: "z" })).toEqual({ author: "[redacted]", keyword: "[redacted]", order_key: "[redacted]" });
  });

  it("returns a copy and does not change the input", () => {
    const input = { token: "t", nested: { password: "p" } };
    redact(input);
    expect(input).toEqual({ token: "t", nested: { password: "p" } });
  });

  it("leaves values alone when only the value looks secret", () => {
    expect(redact({ note: "my token is abc" })).toEqual({ note: "my token is abc" });
  });
});

describe("auditArgs", () => {
  it("is null when there are no args", () => {
    expect(auditArgs(undefined)).toBeNull();
  });

  it("keeps small args as redacted JSON", () => {
    expect(auditArgs({ name: "W", token: "t" })).toEqual({ name: "W", token: "[redacted]" });
  });

  it("keeps args exactly at the limit", () => {
    const filler = "x".repeat(MAX_ARGS_BYTES - JSON.stringify({ a: "" }).length);
    const args = { a: filler };
    expect(Buffer.byteLength(JSON.stringify(args))).toBe(MAX_ARGS_BYTES);
    expect(auditArgs(args)).toEqual(args);
  });

  it("stores a truncated marker, not cut JSON, when over 2 KB", () => {
    const args = { description: "y".repeat(MAX_ARGS_BYTES) };
    const out = auditArgs(args);
    expect(out).toEqual({ _truncated: true, bytes: Buffer.byteLength(JSON.stringify(args)) });
    expect(JSON.stringify(out)).not.toContain("yyy");
  });

  it("measures bytes, not characters", () => {
    const args = { note: "é".repeat(MAX_ARGS_BYTES / 2) }; // 2 bytes each, so over the limit once quoted
    expect(auditArgs(args)).toMatchObject({ _truncated: true });
  });

  it("applies the cap after redaction", () => {
    const args = { token: "z".repeat(MAX_ARGS_BYTES * 2), name: "W" };
    expect(auditArgs(args)).toEqual({ token: "[redacted]", name: "W" });
  });
});
