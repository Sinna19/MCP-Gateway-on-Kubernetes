import type pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { login, makeUser, startServer, type TestServer } from "./api-helpers.js";
import { createTestDb, resetData } from "./helpers.js";

// The hourly purge of expired dashboard sessions (and old chat_usage rows), run from app.sweep().
describe("periodic purge", () => {
  let pool: pg.Pool;
  let drop: () => Promise<void>;
  let server: TestServer;
  let clock = 0;
  let userId: number;
  let log: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    ({ pool, drop } = await createTestDb());
  });
  afterAll(async () => {
    await drop();
  });
  beforeEach(async () => {
    await resetData(pool);
    clock = Date.parse("2026-03-10T12:00:00Z");
    userId = await makeUser(pool, "a@x.io");
    server = await startServer(pool, undefined, { now: () => clock });
    log = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(async () => {
    log.mockRestore();
    await server.stop();
  });

  const addSession = (hash: string, expiresSql: string) => pool.query(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, ${expiresSql})`, [hash, userId]);
  const sessionHashes = async () => (await pool.query("SELECT token_hash FROM sessions ORDER BY token_hash")).rows.map((r) => r.token_hash as string);

  it("deletes expired sessions, keeps live ones, and logs only the count", async () => {
    await addSession("old", "now() - interval '1 minute'");
    await addSession("live", "now() + interval '1 hour'");
    await server.app.sweep();
    expect(await sessionHashes()).toEqual(["live"]);
    expect(log).toHaveBeenCalledWith("swept 1 expired sessions");
    expect(log.mock.calls.flat().join(" ")).not.toContain("old");
  });

  it("runs at most once per hour", async () => {
    await server.app.sweep(); // first sweep runs the purge (nothing to delete)
    await addSession("old", "now() - interval '1 minute'");
    clock += 59 * 60_000;
    await server.app.sweep();
    expect(await sessionHashes()).toEqual(["old"]); // too soon
    clock += 2 * 60_000; // 61 minutes after the first run
    await server.app.sweep();
    expect(await sessionHashes()).toEqual([]);
  });

  it("login no longer deletes expired sessions itself", async () => {
    await addSession("old", "now() - interval '1 minute'");
    await login(server.base, "a@x.io");
    expect(await sessionHashes()).toContain("old");
  });

  it("also drops chat_usage rows older than 7 days", async () => {
    await pool.query("INSERT INTO chat_usage (user_id, day, count) VALUES ($1, '2026-03-01', 5), ($1, '2026-03-09', 5)", [userId]);
    await server.app.sweep();
    expect((await pool.query("SELECT day::text AS day FROM chat_usage")).rows).toEqual([{ day: "2026-03-09" }]);
  });
});
