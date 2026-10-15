CREATE TABLE users (
  id            bigserial PRIMARY KEY,
  email         text NOT NULL UNIQUE,
  role          text NOT NULL CHECK (role IN ('admin', 'member')),
  password_hash text NOT NULL,
  disabled_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Only the SHA-256 hash of a key is stored. prefix is the first characters, for display.
CREATE TABLE api_keys (
  id           bigserial PRIMARY KEY,
  user_id      bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         text NOT NULL,
  prefix       text NOT NULL,
  hash         text NOT NULL UNIQUE,
  revoked_at   timestamptz,
  last_used_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- The slug check keeps "__" out of slugs, so the router can split tool names on the first "__".
CREATE TABLE upstream_servers (
  id             bigserial PRIMARY KEY,
  slug           text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 20),
  url            text NOT NULL,
  enabled        boolean NOT NULL DEFAULT true,
  header_name    text,
  credential_enc text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- No arguments and no results are stored here, on purpose.
CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  user_id     bigint REFERENCES users(id) ON DELETE SET NULL,
  server_slug text,
  tool        text NOT NULL,
  started_at  timestamptz NOT NULL,
  duration_ms integer NOT NULL,
  outcome     text NOT NULL CHECK (outcome IN ('ok', 'error')),
  error       text CHECK (length(error) <= 500),
  source      text NOT NULL CHECK (source IN ('mcp', 'chat'))
);
CREATE INDEX audit_log_started_at ON audit_log (started_at DESC);
