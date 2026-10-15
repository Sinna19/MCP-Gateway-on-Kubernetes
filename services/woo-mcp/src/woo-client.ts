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

export interface WooClient {
  request(method: "GET" | "POST" | "PUT", path: string, opts?: { query?: Query; body?: unknown }): Promise<unknown>;
}

export function createWooClient(opts: WooClientOptions): WooClient {
  const doFetch = opts.fetch ?? fetch;
  const base = opts.baseUrl.replace(/\/+$/, "");
  const auth = "Basic " + Buffer.from(`${opts.user}:${opts.password}`).toString("base64");

  return {
    async request(method, path, { query, body } = {}) {
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
      try {
        data = text ? JSON.parse(text) : undefined;
      } catch {
        data = undefined;
      }

      if (!res.ok) {
        const message = (data as { message?: unknown } | undefined)?.message;
        throw new WooError(`WooCommerce returned ${res.status}${typeof message === "string" ? `: ${message}` : ""}`);
      }
      return data;
    },
  };
}
