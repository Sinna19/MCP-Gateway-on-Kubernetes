import { readFileSync } from "node:fs";
import { loadConfig } from "./config.js";
import { createHttpServer } from "./server.js";
import { createWooClient } from "./woo-client.js";

const config = loadConfig();
const woo = createWooClient({
  baseUrl: config.wooUrl,
  user: config.wooUser,
  // A mounted Secret file: kubelet updates it in place, so a regenerated password needs no restart.
  readPassword: () => readFileSync(config.wooPasswordFile, "utf8").trim(),
  timeoutMs: config.timeoutMs,
});

const server = createHttpServer({ woo, token: config.token });
server.listen(config.port, () => console.log(`woo-mcp listening on :${config.port}`));

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
