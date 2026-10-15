import { randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type pg from "pg";
import { createApp, type App } from "../src/app.js";
import { hashPassword } from "../src/passwords.js";

// Generated per run, so no password is written in the source.
export const PASSWORD = randomBytes(12).toString("hex");
export const NEW_PASSWORD = randomBytes(12).toString("hex");
export const WRONG_PASSWORD = randomBytes(12).toString("hex");
const PASSWORD_HASH = await hashPassword(PASSWORD); // scrypt is slow on purpose, so hash once per test file

export async function makeUser(pool: pg.Pool, email: string, role: "admin" | "member" = "member"): Promise<number> {
  const { rows } = await pool.query("INSERT INTO users (email, role, password_hash) VALUES ($1, $2, $3) RETURNING id", [email, role, PASSWORD_HASH]);
  return rows[0].id;
}

// An upstream manager that has no upstreams. Enough for the routes that never call a tool.
export function emptyUpstreams() {
  return Object.assign(new EventEmitter(), {
    tools: () => [],
    callTool: async () => ({ content: [] }),
  });
}

export interface TestServer {
  app: App;
  base: string;
  stop: () => Promise<void>;
}

export async function startServer(pool: pg.Pool, upstreams: ReturnType<typeof emptyUpstreams> = emptyUpstreams()): Promise<TestServer> {
  const app = createApp({ pool, upstreams });
  const http = await new Promise<Server>((resolve) => {
    const s = app.express.listen(0, "127.0.0.1", () => resolve(s));
  });
  return {
    app,
    base: `http://127.0.0.1:${(http.address() as AddressInfo).port}`,
    stop: async () => {
      app.closeSessions();
      http.closeAllConnections();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}

export interface ApiResponse {
  status: number;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  setCookie: string | undefined;
}

export interface Call {
  method?: string;
  body?: unknown;
  cookie?: string; // the session token, without the cookie name
  contentType?: string | null; // null sends none
}

export async function call(base: string, path: string, options: Call = {}): Promise<ApiResponse> {
  const headers: Record<string, string> = {};
  const contentType = options.contentType === undefined ? "application/json" : options.contentType;
  if (contentType) headers["Content-Type"] = contentType;
  if (options.cookie) headers.Cookie = `urumi_session=${options.cookie}`;
  const method = options.method ?? (options.body === undefined ? "GET" : "POST");
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : typeof options.body === "string" ? options.body : JSON.stringify(options.body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined, setCookie: res.headers.getSetCookie().find((c) => c.startsWith("urumi_session=")) };
}

export function tokenOf(setCookie: string | undefined): string {
  const token = setCookie?.split(";")[0]?.split("=")[1];
  if (!token) throw new Error("no session cookie in response");
  return token;
}

export async function login(base: string, email: string, password = PASSWORD): Promise<string> {
  const res = await call(base, "/auth/login", { body: { email, password } });
  if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
  return tokenOf(res.setCookie);
}
