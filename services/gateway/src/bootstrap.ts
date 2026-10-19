import type pg from "pg";
import { hashPassword } from "./passwords.js";

export interface BootstrapOptions {
  adminEmail: string;
  adminPassword: string;
  wooUrl: string;
}

// First start only (no users yet): create the admin and register woo-mcp.
// Later starts do nothing, so an admin who removed woo does not get it back.
export async function bootstrap(pool: pg.Pool, options: BootstrapOptions): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("LOCK TABLE users IN EXCLUSIVE MODE");
    const { rows } = await client.query("SELECT 1 FROM users LIMIT 1");
    if (rows.length === 0) {
      await client.query("INSERT INTO users (email, role, password_hash) VALUES ($1, 'admin', $2)", [options.adminEmail.trim().toLowerCase(), await hashPassword(options.adminPassword)]);
      const woo = await client.query<{ id: string }>("INSERT INTO upstream_servers (slug, url) VALUES ('woo', $1) RETURNING id", [options.wooUrl]);
      // Members get woo's read tools only (ADR 022).
      await client.query("INSERT INTO tool_rules (server_id, tool, admin_only) VALUES ($1, 'create_product', true), ($1, 'update_order_status', true)", [woo.rows[0]!.id]);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
