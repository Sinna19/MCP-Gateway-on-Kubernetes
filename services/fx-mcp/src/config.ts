export interface Config {
  token: string;
  port: number;
}

const MIN_TOKEN_LENGTH = 32;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const token = env.FX_TOKEN ?? "";
  if (!token) throw new Error("Missing required env: FX_TOKEN");
  // A short or empty token (for example an empty Secret key) must stop the pod, not weaken the check.
  if (token.length < MIN_TOKEN_LENGTH) throw new Error(`FX_TOKEN must be at least ${MIN_TOKEN_LENGTH} characters`);
  const rawPort = env.PORT ?? "3000";
  const port = Number(rawPort);
  if (!/^\d+$/.test(rawPort) || port < 1 || port > 65535) throw new Error("PORT must be an integer from 1 to 65535");
  return { token, port };
}
