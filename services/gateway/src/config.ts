export interface Config {
  databaseUrl: string;
  credentialsKey: Buffer;
  adminEmail: string;
  adminPassword: string;
  seedWooUrl: string;
  port: number;
  callTimeoutMs: number;
  healthIntervalMs: number;
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
  };
}
