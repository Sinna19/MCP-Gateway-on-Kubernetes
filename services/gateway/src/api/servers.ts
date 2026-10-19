import { Router } from "express";
import type pg from "pg";
import { z } from "zod";
import { encrypt } from "../crypto.js";
import { prefixed } from "../tool-names.js";
import type { ServerStatus, UpstreamControl, UpstreamStatus } from "../upstreams.js";
import { isBlockedHost } from "../url-guard.js";
import { currentUser, requireAdmin, requireUser } from "./middleware.js";

interface ServerRow {
  slug: string;
  url: string;
  enabled: boolean;
  header_name: string | null;
  credential_enc: string | null;
}

export interface ToolRule {
  tool: string; // the upstream's own name, no "<slug>__" prefix
  adminOnly: boolean;
}

// The only place a server becomes JSON. It lists fields one by one, so a new column
// (or the ciphertext) can never leak by accident. Members get no url or header details,
// no admin-only tools and no sign that rules exist.
export function serverView(row: ServerRow, live: Pick<ServerStatus, "status" | "tools"> | undefined, isAdmin: boolean, rules: ToolRule[] = []) {
  const status: UpstreamStatus = live?.status ?? (row.enabled ? "unreachable" : "disabled");
  const restricted = new Set(rules.filter((r) => r.adminOnly).map((r) => prefixed(row.slug, r.tool)));
  const tools = live?.tools ?? [];
  if (!isAdmin) return { slug: row.slug, enabled: row.enabled, status, tools: tools.filter((t) => !restricted.has(t.name)) };
  return {
    slug: row.slug,
    enabled: row.enabled,
    status,
    tools: tools.map((t) => ({ ...t, adminOnly: restricted.has(t.name) })),
    toolRules: rules.map((r) => ({ tool: r.tool, adminOnly: r.adminOnly })),
    url: row.url,
    headerName: row.header_name,
    hasCredential: row.credential_enc !== null,
  };
}

// Headers that would break the HTTP request or that have their own auth type.
const FORBIDDEN_HEADERS = new Set([
  "host", "content-length", "cookie", "connection", "transfer-encoding", "authorization",
  "content-type", "accept", "mcp-session-id", "mcp-protocol-version", "proxy-authorization", "upgrade", "te",
]);
const HEADER_TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const VISIBLE_ASCII = /^[\x20-\x7e]+$/; // no CR/LF, so a value can't inject another header

const secretText = z.string().max(4096).regex(VISIBLE_ASCII, "must be printable ASCII");

const authBody = z.discriminatedUnion("type", [
  z.object({ type: z.literal("bearer"), token: secretText }),
  z.object({
    type: z.literal("header"),
    name: z
      .string()
      .max(100)
      .regex(HEADER_TOKEN, "not a valid header name")
      .refine((n) => !FORBIDDEN_HEADERS.has(n.toLowerCase()), "this header is not allowed (use type bearer for Authorization)"),
    value: secretText,
  }),
]);

// Registration check only; the manager checks the resolved address again at connect time (url-guard.ts).
function urlBodyFor(allowLoopback: boolean) {
  return z
    .string()
    .max(2000)
    .refine((value) => {
      try {
        const u = new URL(value);
        return (u.protocol === "http:" || u.protocol === "https:") && !u.username && !u.password && (allowLoopback || !isBlockedHost(u.hostname));
      } catch {
        return false;
      }
    }, "must be an http(s) URL without a username or password, and not point at localhost, a loopback or link-local address");
}

function bodiesFor(allowLoopback: boolean) {
  const urlBody = urlBodyFor(allowLoopback);
  const createBody = z.strictObject({
    slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(20),
    url: urlBody,
    enabled: z.boolean().optional(),
    auth: authBody.nullable().optional(),
  });
  // The slug is not here on purpose: it is the tool prefix and the encryption AAD.
  const patchBody = z
    .strictObject({ url: urlBody.optional(), enabled: z.boolean().optional(), auth: authBody.nullable().optional() })
    .refine((b) => b.url !== undefined || b.enabled !== undefined || b.auth !== undefined, { message: "give url, enabled or auth" })
    // The stored credential would otherwise be sent to the new host. auth: null (remove it) is fine.
    .refine((b) => b.url === undefined || b.auth !== undefined, { message: "changing url requires re-entering the credential" });
  return { createBody, patchBody };
}

type AuthInput = z.infer<typeof authBody>;

// bearer is stored as the header "Authorization: Bearer <token>".
function credentialFor(key: Buffer, slug: string, auth: AuthInput): { headerName: string; credentialEnc: string } {
  if (auth.type === "bearer") return { headerName: "Authorization", credentialEnc: encrypt(key, `Bearer ${auth.token}`, slug) };
  return { headerName: auth.name, credentialEnc: encrypt(key, auth.value, slug) };
}

const COLUMNS = "slug, url, enabled, header_name, credential_enc";

const toolRuleBody = z.strictObject({ adminOnly: z.boolean() });
const TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

export function serverRoutes(pool: pg.Pool, upstreams: UpstreamControl, credentialsKey: Buffer, allowLoopback = false, onToolRulesChanged: () => void = () => undefined): Router {
  const router = Router();
  const { createBody, patchBody } = bodiesFor(allowLoopback);

  // Every stored rule, grouped by server slug.
  async function rulesBySlug(): Promise<Map<string, ToolRule[]>> {
    const { rows } = await pool.query<{ slug: string; tool: string; admin_only: boolean }>(
      "SELECT s.slug, r.tool, r.admin_only FROM tool_rules r JOIN upstream_servers s ON s.id = r.server_id ORDER BY r.tool",
    );
    const bySlug = new Map<string, ToolRule[]>();
    for (const r of rows) bySlug.set(r.slug, [...(bySlug.get(r.slug) ?? []), { tool: r.tool, adminOnly: r.admin_only }]);
    return bySlug;
  }

  // One reload after every write: connects new or changed servers, drops removed ones.
  async function viewOf(slug: string, isAdmin: boolean) {
    const { rows } = await pool.query<ServerRow>(`SELECT ${COLUMNS} FROM upstream_servers WHERE slug = $1`, [slug]);
    return rows[0] && serverView(rows[0], upstreams.statuses().find((s) => s.slug === slug), isAdmin, (await rulesBySlug()).get(slug));
  }

  router.get("/servers", requireUser, async (_req, res) => {
    const isAdmin = currentUser(res).role === "admin";
    const { rows } = await pool.query<ServerRow>(`SELECT ${COLUMNS} FROM upstream_servers WHERE ($1 OR enabled) ORDER BY slug`, [isAdmin]);
    const live = new Map(upstreams.statuses().map((s) => [s.slug, s]));
    const rules = await rulesBySlug();
    res.json(rows.map((row) => serverView(row, live.get(row.slug), isAdmin, rules.get(row.slug))));
  });

  // Upsert the rule for one tool. The tool may not be listed right now (an admin can pre-mark it);
  // `listed` says whether it is. Open /mcp sessions are told to re-read their tool list.
  router.patch("/servers/:slug/tools/:tool", requireAdmin, async (req, res) => {
    const slug = String(req.params.slug);
    const tool = String(req.params.tool);
    if (!TOOL_NAME.test(tool)) {
      res.status(400).json({ error: "invalid tool name" });
      return;
    }
    const { adminOnly } = toolRuleBody.parse(req.body);
    const result = await pool.query(
      `INSERT INTO tool_rules (server_id, tool, admin_only) SELECT id, $2, $3 FROM upstream_servers WHERE slug = $1
       ON CONFLICT (server_id, tool) DO UPDATE SET admin_only = EXCLUDED.admin_only`,
      [slug, tool, adminOnly],
    );
    if (!result.rowCount) {
      res.status(404).json({ error: "server not found" });
      return;
    }
    onToolRulesChanged();
    const listed = upstreams.statuses().some((s) => s.slug === slug && s.tools.some((t) => t.name === prefixed(slug, tool)));
    res.json({ tool, adminOnly, listed });
  });

  router.post("/servers", requireAdmin, async (req, res) => {
    const body = createBody.parse(req.body);
    const cred = body.auth ? credentialFor(credentialsKey, body.slug, body.auth) : undefined;
    await pool.query("INSERT INTO upstream_servers (slug, url, enabled, header_name, credential_enc) VALUES ($1, $2, $3, $4, $5)", [
      body.slug,
      body.url,
      body.enabled ?? true,
      cred?.headerName ?? null,
      cred?.credentialEnc ?? null,
    ]);
    await upstreams.reload();
    res.status(201).json(await viewOf(body.slug, true));
  });

  // auth: absent = keep the stored credential, null = remove it, object = replace it.
  router.patch("/servers/:slug", requireAdmin, async (req, res) => {
    const slug = String(req.params.slug);
    const body = patchBody.parse(req.body);
    const cred = body.auth ? credentialFor(credentialsKey, slug, body.auth) : undefined;
    const result = await pool.query(
      `UPDATE upstream_servers SET
         url = COALESCE($2, url),
         enabled = COALESCE($3, enabled),
         header_name = CASE WHEN $4 THEN $5 ELSE header_name END,
         credential_enc = CASE WHEN $4 THEN $6 ELSE credential_enc END
       WHERE slug = $1`,
      [slug, body.url ?? null, body.enabled ?? null, body.auth !== undefined, cred?.headerName ?? null, cred?.credentialEnc ?? null],
    );
    if (!result.rowCount) {
      res.status(404).json({ error: "server not found" });
      return;
    }
    await upstreams.reload();
    res.json(await viewOf(slug, true));
  });

  // Audit rows keep the slug as plain text, so history survives the delete.
  router.delete("/servers/:slug", requireAdmin, async (req, res) => {
    const result = await pool.query("DELETE FROM upstream_servers WHERE slug = $1", [String(req.params.slug)]);
    if (!result.rowCount) {
      res.status(404).json({ error: "server not found" });
      return;
    }
    await upstreams.reload();
    res.status(204).end();
  });

  return router;
}
