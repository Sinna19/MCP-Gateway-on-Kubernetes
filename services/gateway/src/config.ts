import { DEFAULT_LIMITS, type Limits } from "./rate-limit.js";

export interface Config {
  databaseUrl: string;
  credentialsKey: Buffer;
  adminEmail: string;
  adminPassword: string;
  seedWooUrl: string;
  port: number;
  callTimeoutMs: number;
  healthIntervalMs: number;
  cookieSecure: boolean;
  llm?: { baseUrl: string; model: string; apiKey: string }; // unset = chat answers 503
  chatReadOnlyTools: Set<string>;
  limits: Limits;
}

const REQUIRED = ["DATABASE_URL", "CREDENTIALS_KEY", "ADMIN_EMAIL", "ADMIN_PASSWORD", "SEED_WOO_URL"];

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const missing = REQUIRED.filter((k) => !env[k]);
  if (missing.length > 0) throw new Error(`Missing required env: ${missing.join(", ")}`);
  const credentialsKey = Buffer.from(env.CREDENTIALS_KEY!, "base64");
  if (credentialsKey.length !== 32) throw new Error("CREDENTIALS_KEY must be 32 bytes, base64 encoded");
  return {
    databaseUrl: env.DATABASE_URL!,
    credentialsKey,
    adminEmail: env.ADMIN_EMAIL!,
    adminPassword: env.ADMIN_PASSWORD!,
    seedWooUrl: env.SEED_WOO_URL!,
    port: Number(env.PORT ?? 8080),
    callTimeoutMs: Number(env.CALL_TIMEOUT_MS ?? 15_000),
    healthIntervalMs: Number(env.HEALTH_INTERVAL_MS ?? 5_000),
    cookieSecure: env.COOKIE_SECURE === "true",
    llm: loadLlm(env),
    chatReadOnlyTools: new Set((env.CHAT_READ_ONLY_TOOLS ?? "").split(",").map((t) => t.trim()).filter(Boolean)),
    limits: {
      loginPerEmail: positiveInt(env, "LOGIN_LIMIT_PER_EMAIL", DEFAULT_LIMITS.loginPerEmail),
      loginPerIp: positiveInt(env, "LOGIN_LIMIT_PER_IP", DEFAULT_LIMITS.loginPerIp),
      loginWindowMs: positiveInt(env, "LOGIN_LIMIT_WINDOW_SECONDS", DEFAULT_LIMITS.loginWindowMs / 1000) * 1000,
      mcpCallsPerMinute: positiveInt(env, "MCP_CALLS_PER_MINUTE", DEFAULT_LIMITS.mcpCallsPerMinute),
      mcpSessionsPerKey: positiveInt(env, "MCP_SESSIONS_PER_KEY", DEFAULT_LIMITS.mcpSessionsPerKey),
      chatDailyCap: positiveInt(env, "CHAT_DAILY_CAP", DEFAULT_LIMITS.chatDailyCap),
    },
  };
}

// The chart renders empty strings for unset values, so empty means default. A typo fails at start, not at the first request.
function positiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${name} must be a positive whole number`);
  return n;
}

// The chart renders empty strings when chat is not set up, so empty counts as unset.
// The bearer key goes to this URL, so it must be https (or LLM_ALLOW_HTTP=true). A bad URL
// disables chat with an error in the log; it must not stop the gateway from starting.
function loadLlm(env: NodeJS.ProcessEnv): Config["llm"] {
  if (!env.LLM_BASE_URL || !env.LLM_MODEL || !env.LLM_API_KEY) return undefined;
  let protocol = "";
  try {
    protocol = new URL(env.LLM_BASE_URL).protocol;
  } catch {
    console.error("chat disabled: LLM_BASE_URL is not a valid URL");
    return undefined;
  }
  if (protocol !== "https:" && !(protocol === "http:" && env.LLM_ALLOW_HTTP === "true")) {
    console.error("chat disabled: LLM_BASE_URL must be https (set LLM_ALLOW_HTTP=true to allow http)");
    return undefined;
  }
  return { baseUrl: env.LLM_BASE_URL, model: env.LLM_MODEL, apiKey: env.LLM_API_KEY };
}
