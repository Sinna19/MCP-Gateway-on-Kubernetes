export interface Config {
  wooUrl: string;
  wooUser: string;
  wooPasswordFile: string;
  token: string;
  port: number;
  timeoutMs: number;
}

const MIN_TOKEN_LENGTH = 32;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const missing = ["WOO_URL", "WOO_USER", "WOO_APP_PASSWORD_FILE", "WOO_MCP_TOKEN"].filter((k) => !env[k]);
  if (missing.length > 0) throw new Error(`Missing required env: ${missing.join(", ")}`);
  // A short token (for example an odd Secret value) must stop the pod, not weaken the check.
  if (env.WOO_MCP_TOKEN!.length < MIN_TOKEN_LENGTH) {
    throw new Error(`WOO_MCP_TOKEN must be at least ${MIN_TOKEN_LENGTH} characters`);
  }
  return {
    wooUrl: env.WOO_URL!,
    wooUser: env.WOO_USER!,
    wooPasswordFile: env.WOO_APP_PASSWORD_FILE!,
    token: env.WOO_MCP_TOKEN!,
    port: Number(env.PORT ?? 3000),
    timeoutMs: Number(env.WOO_TIMEOUT_MS ?? 10000),
  };
}
