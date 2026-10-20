// What the audit log stores about a call's arguments. Every audit write goes through auditArgs, so this
// is the only place that decides what is kept (ADR 015).

export const MAX_ARGS_BYTES = 2048;

// Matches on the key, not the value. It also hits "author", "keyword" and "order_key": over-redacting is the safe direction.
const SECRET_KEY = /pass|secret|token|key|auth|cookie/i;
const REDACTED = "[redacted]";

const MAX_DEPTH = 10;
const TOO_DEEP = "[depth limit]";

// Returns a copy; the args that go to the upstream are never touched.
// Objects are built from entries into a null-prototype object, so a "__proto__" key stays a plain own key.
export function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return TOO_DEEP;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value !== null && typeof value === "object") {
    const out = Object.create(null) as Record<string, unknown>;
    for (const [key, v] of Object.entries(value)) {
      Object.defineProperty(out, key, { value: SECRET_KEY.test(key) ? REDACTED : redact(v, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    return out;
  }
  return value;
}

// null when the caller sent nothing. Over the cap we store a marker, because cutting JSON mid-string would not parse.
export function auditArgs(args: Record<string, unknown> | undefined): unknown {
  if (args === undefined) return null;
  const redacted = redact(args);
  const bytes = Buffer.byteLength(JSON.stringify(redacted));
  return bytes > MAX_ARGS_BYTES ? { _truncated: true, bytes } : redacted;
}
