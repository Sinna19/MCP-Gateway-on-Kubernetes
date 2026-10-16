import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import { App } from "../src/App";

export type Reply = { status: number; body?: unknown };
export type Handler = (path: string, init: RequestInit) => Reply | Promise<Reply>;

// Stubs fetch. Every call is recorded as "METHOD /path" in `calls`.
export function stubApi(handler: Handler) {
  const calls: string[] = [];
  const inits: RequestInit[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = url.replace(/^\/api/, ""); // handlers and `calls` use the path after /api
      calls.push(`${init.method ?? "GET"} ${path}`);
      inits.push(init);
      const reply = await handler(path, init);
      return new Response(reply.status === 204 ? null : JSON.stringify(reply.body ?? {}), {
        status: reply.status,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  return { calls, inits };
}

export const admin = { id: "1", email: "admin@urumi.local", role: "admin" };
export const member = { id: "2", email: "bob@urumi.local", role: "member" };

// Test passwords are random so no literal secret sits in the source.
export const somePassword = () => crypto.randomUUID();

export function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}
