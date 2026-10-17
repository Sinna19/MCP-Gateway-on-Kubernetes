export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// AuthProvider sets this. It runs on a 401 from any endpoint except /auth/* and /me.
let onUnauthorized: () => void = () => {};
export function setOnUnauthorized(fn: () => void): void {
  onUnauthorized = fn;
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? "GET",
    credentials: "same-origin",
    headers: opts.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  // A proxy error page (Traefik 502/504) is HTML, not JSON. Treat it as "no body" so the status still decides what happens.
  let data: { error?: string } | null = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = {};
  }
  if (!res.ok) {
    // /me is how AuthProvider asks "am I logged in?", and a wrong password is also a 401: neither is an expiry.
    if (res.status === 401 && !path.startsWith("/auth/") && path !== "/me") onUnauthorized();
    throw new ApiError(res.status, data?.error ?? `request failed (${res.status})`);
  }
  return data as T;
}
