import { describe, expect, it } from "vitest";
import { assertAllowedHost, isBlockedHost } from "../src/url-guard.js";

describe("isBlockedHost", () => {
  it.each(["127.0.0.1", "127.0.0.2", "[::1]", "::1", "[::ffff:127.0.0.1]", "169.254.169.254", "[fe80::1]", "0.0.0.0", "[::]", "localhost", "LOCALHOST", "foo.localhost", "localhost."])("blocks %s", (host) => {
    expect(isBlockedHost(host)).toBe(true);
  });

  // Private ranges stay allowed: in-cluster upstreams live there.
  it.each(["10.0.0.1", "172.16.5.4", "192.168.1.9", "8.8.8.8", "woo-mcp", "woo-mcp.urumi.svc.cluster.local", "[2001:db8::1]"])("allows %s", (host) => {
    expect(isBlockedHost(host)).toBe(false);
  });

  it("blocks the odd IPv4 spellings once the URL parser has normalised them", () => {
    expect(isBlockedHost(new URL("http://2130706433/").hostname)).toBe(true); // decimal 127.0.0.1
    expect(isBlockedHost(new URL("http://0x7f.1/").hostname)).toBe(true);
  });
});

describe("assertAllowedHost", () => {
  const resolvesTo = (...addresses: string[]) => async () => addresses.map((address) => ({ address }));

  it("rejects a name that resolves to a blocked address, even if only one of several does", async () => {
    await expect(assertAllowedHost("evil.example", resolvesTo("127.0.0.1"))).rejects.toThrow(/not allowed/);
    await expect(assertAllowedHost("evil.example", resolvesTo("10.0.0.5", "169.254.169.254"))).rejects.toThrow(/not allowed/);
  });

  it("rejects a blocked literal without a lookup", async () => {
    const neverCalled = async () => {
      throw new Error("lookup should not run");
    };
    await expect(assertAllowedHost("127.0.0.1", neverCalled)).rejects.toThrow(/not allowed/);
  });

  it("accepts names that resolve to public or private addresses", async () => {
    await expect(assertAllowedHost("woo-mcp", resolvesTo("10.43.1.2"))).resolves.toBeUndefined();
    await expect(assertAllowedHost("example.com", resolvesTo("93.184.216.34"))).resolves.toBeUndefined();
  });
});
