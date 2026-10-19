import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { purgeOldChatUsage, takeChatTurn } from "../src/chat/daily-cap.js";
import { createTestDb, resetData } from "./helpers.js";

const at = (iso: string) => () => Date.parse(iso);

describe("takeChatTurn", () => {
  let pool: pg.Pool;
  let drop: () => Promise<void>;
  let alice: number;
  let bob: number;

  beforeAll(async () => {
    ({ pool, drop } = await createTestDb());
  });
  afterAll(async () => {
    await drop();
  });
  beforeEach(async () => {
    await resetData(pool);
    const { rows } = await pool.query("INSERT INTO users (email, role, password_hash) VALUES ('a@x.io', 'member', 'x'), ('b@x.io', 'member', 'x') RETURNING id");
    const ids = rows.map((r) => Number(r.id)).sort((x, y) => x - y);
    alice = ids[0]!;
    bob = ids[1]!;
  });

  it("allows `cap` turns a day, then refuses with seconds to the next UTC midnight", async () => {
    const now = at("2026-03-10T12:00:00Z");
    expect(await takeChatTurn(pool, alice, 2, now)).toEqual({ ok: true });
    expect(await takeChatTurn(pool, alice, 2, now)).toEqual({ ok: true });
    expect(await takeChatTurn(pool, alice, 2, now)).toEqual({ ok: false, retryAfterSeconds: 12 * 3600 });
    const { rows } = await pool.query("SELECT count FROM chat_usage WHERE user_id = $1", [alice]);
    expect(rows).toEqual([{ count: 2 }]); // a refused turn is not counted
  });

  it("counts per user", async () => {
    const now = at("2026-03-10T12:00:00Z");
    await takeChatTurn(pool, alice, 1, now);
    expect((await takeChatTurn(pool, alice, 1, now)).ok).toBe(false);
    expect((await takeChatTurn(pool, bob, 1, now)).ok).toBe(true);
  });

  it("is atomic: 6 parallel takes at cap 2 let exactly 2 through", async () => {
    const now = at("2026-03-10T12:00:00Z");
    const results = await Promise.all(Array.from({ length: 6 }, () => takeChatTurn(pool, alice, 2, now)));
    expect(results.filter((r) => r.ok)).toHaveLength(2);
  });

  it("uses the injected clock for both the day bucket and Retry-After", async () => {
    expect(await takeChatTurn(pool, alice, 1, at("2026-03-10T23:59:30Z"))).toEqual({ ok: true });
    expect(await takeChatTurn(pool, alice, 1, at("2026-03-10T23:59:30Z"))).toEqual({ ok: false, retryAfterSeconds: 30 });
    // two seconds later it is a new UTC day: a fresh bucket
    expect(await takeChatTurn(pool, alice, 1, at("2026-03-11T00:00:01Z"))).toEqual({ ok: true });
    const { rows } = await pool.query("SELECT day::text AS day, count FROM chat_usage WHERE user_id = $1 ORDER BY day", [alice]);
    expect(rows).toEqual([{ day: "2026-03-10", count: 1 }, { day: "2026-03-11", count: 1 }]);
  });

  it("purgeOldChatUsage deletes days older than 7 and returns how many", async () => {
    for (const d of ["2026-03-01", "2026-03-02", "2026-03-09", "2026-03-10"]) await pool.query("INSERT INTO chat_usage (user_id, day, count) VALUES ($1, $2, 1)", [alice, d]);
    expect(await purgeOldChatUsage(pool, at("2026-03-10T12:00:00Z"))).toBe(2);
    const { rows } = await pool.query("SELECT day::text AS day FROM chat_usage ORDER BY day");
    expect(rows.map((r) => r.day)).toEqual(["2026-03-09", "2026-03-10"]);
  });
});
