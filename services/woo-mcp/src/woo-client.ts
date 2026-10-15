// Thin client for the WooCommerce REST API v3. Basic auth with a WordPress Application Password.

export class WooError extends Error {}

export interface WooClientOptions {
  baseUrl: string;
  user: string;
  password: string;
  timeoutMs: number;
  fetch?: typeof fetch;
}

type Query = Record<string, string | number | boolean | undefined>;

export interface WooPage {
  items: unknown[];
  total: number;
  total_pages: number;
}

export interface WooClient {
  request(method: "GET" | "POST" | "PUT", path: string, opts?: { query?: Query; body?: unknown }): Promise<unknown>;
  // GET a collection and report how many items exist in total, from Woo's X-WP-Total headers.
  list(path: string, query?: Query): Promise<WooPage>;
}

export function createWooClient(opts: WooClientOptions): WooClient {
  const doFetch = opts.fetch ?? fetch;
  const base = opts.baseUrl.replace(/\/+$/, "");
  const auth = "Basic " + Buffer.from(`${opts.user}:${opts.password}`).toString("base64");

  // One HTTP round trip. Every failure becomes a WooError with a message that is safe to show.
  async function send(method: string, path: string, query?: Query, body?: unknown) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) params.set(key, String(value));
    }
    const qs = params.toString();
    const url = `${base}/wp-json/wc/v3${path}${qs ? `?${qs}` : ""}`;

    const headers: Record<string, string> = { Authorization: auth, Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";

    let res: Response;
    try {
      res = await doFetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(opts.timeoutMs),
      });
    } catch (err) {
      if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
        throw new WooError(`WooCommerce request timed out after ${opts.timeoutMs}ms`);
      }
      throw new WooError(`Could not reach WooCommerce: ${err instanceof Error ? err.message : String(err)}`);
    }

    const text = await res.text();
    let data: unknown;
    let isJson = true;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      isJson = false;
    }

    if (!res.ok) {
      const message = isJson ? (data as { message?: unknown } | undefined)?.message : undefined;
      throw new WooError(`WooCommerce returned ${res.status}${typeof message === "string" ? `: ${message}` : ""}`);
    }
    // A 200 with HTML usually means WordPress permalinks are broken and /wp-json/ is not routed.
    if (!isJson) throw new WooError("WooCommerce returned an unexpected non-JSON response");
    return { data, headers: res.headers };
  }

  return {
    async request(method, path, { query, body } = {}) {
      return (await send(method, path, query, body)).data;
    },

    async list(path, query) {
      const { data, headers } = await send("GET", path, query);
      if (!Array.isArray(data)) throw new WooError("WooCommerce returned an unexpected response (expected a list)");
      const total = Number(headers.get("X-WP-Total"));
      const totalPages = Number(headers.get("X-WP-TotalPages"));
      return {
        items: data,
        total: Number.isFinite(total) && headers.has("X-WP-Total") ? total : data.length,
        total_pages: Number.isFinite(totalPages) && headers.has("X-WP-TotalPages") ? totalPages : 1,
      };
    },
  };
}
