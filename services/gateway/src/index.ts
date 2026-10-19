import { createApp } from "./app.js";
import { bootstrap } from "./bootstrap.js";
import { loadConfig } from "./config.js";
import { createLlm } from "./chat/llm.js";
import { createPool, migrate } from "./db.js";
import { UpstreamManager } from "./upstreams.js";

const config = loadConfig();
const pool = createPool(config.databaseUrl);
await migrate(pool);
await bootstrap(pool, { adminEmail: config.adminEmail, adminPassword: config.adminPassword, wooUrl: config.seedWooUrl });

const upstreams = new UpstreamManager({ pool, credentialsKey: config.credentialsKey, callTimeoutMs: config.callTimeoutMs, intervalMs: config.healthIntervalMs });
await upstreams.reload();
upstreams.start();

const app = createApp({ pool, upstreams, credentialsKey: config.credentialsKey, cookieSecure: config.cookieSecure,
  llm: config.llm ? createLlm(config.llm) : undefined,
  chatReadOnlyTools: config.chatReadOnlyTools,
  limits: config.limits,
});
console.log(config.llm ? `chat enabled (model ${config.llm.model})` : "chat not configured (no LLM_* env)");
const server = app.express.listen(config.port, () => console.log(`gateway listening on :${config.port}`));
// Node's defaults allow a client to hold a socket open for 5 minutes (slowloris), so requestTimeout stays short.
// keepAliveTimeout must be longer than Traefik's 90s idle timeout, or Node closes a socket Traefik is about to reuse (502).
server.requestTimeout = 15_000;
server.keepAliveTimeout = 95_000;
server.headersTimeout = 96_000;

const sweeper = setInterval(app.sweep, 60_000);
sweeper.unref();

process.on("SIGTERM", () => {
  clearInterval(sweeper);
  app.closeSessions();
  void upstreams.stop();
  server.close(() => void pool.end().then(() => process.exit(0)));
  // Let in-flight requests finish for 10s, then cut what is left (terminationGracePeriodSeconds is 15).
  setTimeout(() => server.closeAllConnections(), 10_000).unref();
});
