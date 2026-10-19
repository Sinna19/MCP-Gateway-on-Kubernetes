-- Per-tool access rule. No row means everyone may use the tool (ADR 022).
-- tool is the upstream's own name, without the "<slug>__" prefix.
CREATE TABLE tool_rules (
  server_id  bigint NOT NULL REFERENCES upstream_servers(id) ON DELETE CASCADE,
  tool       text NOT NULL,
  admin_only boolean NOT NULL DEFAULT false,
  PRIMARY KEY (server_id, tool)
);

-- woo's write tools: members get the read tools only. A fresh database has no woo row yet
-- (bootstrap seeds these two rules itself); register-upstreams.sh covers a woo that was deleted and re-added.
INSERT INTO tool_rules (server_id, tool, admin_only)
SELECT id, t.name, true
FROM upstream_servers, (VALUES ('create_product'), ('update_order_status')) AS t(name)
WHERE slug = 'woo'
ON CONFLICT DO NOTHING;
