import { loadConfig } from "./config.js";
import { createHttpServer } from "./server.js";
import { createWooClient } from "./woo-client.js";

const config = loadConfig();
const woo = createWooClient({
  baseUrl: config.wooUrl,
  user: config.wooUser,
  password: config.wooAppPassword,
  timeoutMs: config.timeoutMs,
});

const server = createHttpServer({ woo });
server.listen(config.port, () => console.log(`woo-mcp listening on :${config.port}`));

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
