import { loadConfig } from "./config.js";
import { createHttpServer } from "./server.js";

const config = loadConfig();
const server = createHttpServer({ token: config.token });
server.listen(config.port, () => console.log(`fx-mcp listening on :${config.port}`));

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
  // Let in-flight requests finish for 10s, then cut what is left (terminationGracePeriodSeconds is 15).
  setTimeout(() => {
    server.closeAllConnections();
    process.exit(0);
  }, 10_000).unref();
});
