import { loadConfig } from "./config.js";
import { NoteStore } from "./notes.js";
import { createHttpServer } from "./server.js";

const config = loadConfig();
// One store for the whole process: each request builds a fresh MCP server but shares this.
const server = createHttpServer({ key: config.key, store: new NoteStore() });
server.listen(config.port, () => console.log(`notes-mcp listening on :${config.port}`));

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
  // Let in-flight requests finish for 10s, then cut what is left (terminationGracePeriodSeconds is 15).
  setTimeout(() => {
    server.closeAllConnections();
    process.exit(0);
  }, 10_000).unref();
});
