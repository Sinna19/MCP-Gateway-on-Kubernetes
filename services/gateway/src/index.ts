import { createApp } from "./app.js";
import { bootstrap } from "./bootstrap.js";
import { loadConfig } from "./config.js";
import { createPool, migrate } from "./db.js";
import { UpstreamManager } from "./upstreams.js";

const config = loadConfig();
const pool = createPool(config.databaseUrl);
await migrate(pool);
await bootstrap(pool, { adminEmail: config.adminEmail, adminPassword: config.adminPassword, wooUrl: config.seedWooUrl });

const upstreams = new UpstreamManager({ pool, credentialsKey: config.credentialsKey, callTimeoutMs: config.callTimeoutMs, intervalMs: config.healthIntervalMs });
await upstreams.reload();
upstreams.start();

const app = createApp({ pool, upstreams, cookieSecure: config.cookieSecure });
const server = app.express.listen(config.port, () => console.log(`gateway listening on :${config.port}`));
// Node's defaults allow a client to hold a socket open for 5 minutes (slowloris).
server.requestTimeout = 15_000;
server.headersTimeout = 10_000;

const sweeper = setInterval(app.sweep, 60_000);
sweeper.unref();

process.on("SIGTERM", () => {
  clearInterval(sweeper);
  app.closeSessions();
  void upstreams.stop();
  server.close(() => void pool.end().then(() => process.exit(0)));
  server.closeAllConnections();
});
