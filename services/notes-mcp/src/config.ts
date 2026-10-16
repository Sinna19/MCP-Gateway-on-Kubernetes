export interface Config {
  key: string;
  port: number;
}

const MIN_KEY_LENGTH = 32;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const key = env.NOTES_KEY ?? "";
  if (!key) throw new Error("Missing required env: NOTES_KEY");
  // A short or empty key (for example an empty Secret key) must stop the pod, not weaken the check.
  if (key.length < MIN_KEY_LENGTH) throw new Error(`NOTES_KEY must be at least ${MIN_KEY_LENGTH} characters`);
  const rawPort = env.PORT ?? "3000";
  const port = Number(rawPort);
  if (!/^\d+$/.test(rawPort) || port < 1 || port > 65535) throw new Error("PORT must be an integer from 1 to 65535");
  return { key, port };
}
