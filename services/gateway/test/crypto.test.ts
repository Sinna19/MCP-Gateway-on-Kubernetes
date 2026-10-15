import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "../src/crypto.js";

const key = randomBytes(32);

describe("encrypt / decrypt", () => {
  it("round-trips", () => {
    expect(decrypt(key, encrypt(key, "s3cret", "woo"), "woo")).toBe("s3cret");
  });
  it("gives a different ciphertext each time", () => {
    expect(encrypt(key, "s3cret", "woo")).not.toBe(encrypt(key, "s3cret", "woo"));
  });
  it("does not contain the plaintext", () => {
    expect(Buffer.from(encrypt(key, "s3cret-value", "woo"), "base64").toString("utf8")).not.toContain("s3cret-value");
  });
  it("fails if the ciphertext was changed", () => {
    const raw = Buffer.from(encrypt(key, "s3cret", "woo"), "base64");
    raw.writeUInt8(raw.readUInt8(raw.length - 1) ^ 1, raw.length - 1);
    expect(() => decrypt(key, raw.toString("base64"), "woo")).toThrow();
  });
  it("fails with the wrong key", () => {
    expect(() => decrypt(randomBytes(32), encrypt(key, "s3cret", "woo"), "woo")).toThrow();
  });
  it("fails when copied to another server (slug is the AAD)", () => {
    expect(() => decrypt(key, encrypt(key, "s3cret", "woo"), "fx")).toThrow();
  });
});
