export interface Config {
  wooUrl: string;
  wooUser: string;
  wooAppPassword: string;
  port: number;
  timeoutMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const missing = ["WOO_URL", "WOO_USER", "WOO_APP_PASSWORD"].filter((k) => !env[k]);
  if (missing.length > 0) throw new Error(`Missing required env: ${missing.join(", ")}`);
  return {
    wooUrl: env.WOO_URL!,
    wooUser: env.WOO_USER!,
    wooAppPassword: env.WOO_APP_PASSWORD!,
    port: Number(env.PORT ?? 3000),
    timeoutMs: Number(env.WOO_TIMEOUT_MS ?? 10000),
  };
}
