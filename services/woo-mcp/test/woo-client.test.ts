import { describe, expect, it, vi } from "vitest";
import { createWooClient, WooError } from "../src/woo-client.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function client(fetchImpl: typeof fetch, timeoutMs = 1000) {
  return createWooClient({
    baseUrl: "http://store-wordpress/",
    user: "woo-mcp",
    password: "app pass",
    timeoutMs,
    fetch: fetchImpl,
  });
}

describe("woo client", () => {
  it("builds the v3 url, query string and basic auth header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, [{ id: 1 }]));
    const out = await client(fetchMock).request("GET", "/products", { query: { per_page: 5, search: "mug" } });

    expect(out).toEqual([{ id: 1 }]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://store-wordpress/wp-json/wc/v3/products?per_page=5&search=mug");
    expect(init.method).toBe("GET");
    expect(init.headers.Authorization).toBe("Basic " + Buffer.from("woo-mcp:app pass").toString("base64"));
  });

  it("skips undefined query values", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, []));
    await client(fetchMock).request("GET", "/orders", { query: { status: undefined, per_page: 2 } });
    expect(fetchMock.mock.calls[0]![0]).toBe("http://store-wordpress/wp-json/wc/v3/orders?per_page=2");
  });

  it("sends a JSON body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { id: 9 }));
    await client(fetchMock).request("POST", "/products", { body: { name: "Cap" } });
    const init = fetchMock.mock.calls[0]![1];
    expect(init.body).toBe('{"name":"Cap"}');
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  it("turns a Woo error response into a WooError with the Woo message", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(404, { code: "woocommerce_rest_shop_order_invalid_id", message: "Invalid ID." }));
    const err = await client(fetchMock).request("GET", "/orders/999").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WooError);
    expect((err as WooError).message).toBe("WooCommerce returned 404: Invalid ID.");
  });

  it("handles a non-JSON error body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("<html>bad gateway</html>", { status: 502 }));
    await expect(client(fetchMock).request("GET", "/products")).rejects.toThrow("WooCommerce returned 502");
  });

  it("wraps a network failure", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    await expect(client(fetchMock).request("GET", "/products")).rejects.toThrow(
      "Could not reach WooCommerce: fetch failed",
    );
  });

  it("reports a timeout clearly", async () => {
    const slow = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal!.addEventListener("abort", () => reject(init.signal!.reason));
      })) as unknown as typeof fetch;
    await expect(client(slow, 20).request("GET", "/products")).rejects.toThrow("timed out after 20ms");
  });
});
