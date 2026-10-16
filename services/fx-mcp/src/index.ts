import { loadConfig } from "./config.js";
import { createHttpServer } from "./server.js";

const config = loadConfig();
const server = createHttpServer({ token: config.token });
server.listen(config.port, () => console.log(`fx-mcp listening on :${config.port}`));

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
