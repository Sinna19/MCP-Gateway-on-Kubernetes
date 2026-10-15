# 008: Dashboard auth and REST API

Status: accepted (Phase 3b)

## Decision

- **Session**: random token in cookie `urumi_session` (HttpOnly, SameSite=Strict, `Secure` when `COOKIE_SECURE=true`, 12h). Only its SHA-256 hash is stored in Postgres `sessions`. The user is joined on every request, so disabling a user or logging out takes effect at once.
- **CSRF**: SameSite=Strict plus JSON-only POST/PATCH/PUT (415 otherwise). Cross-site forms cannot send `application/json`. No CORS headers are sent.
- **Login**: an unknown email is verified against a dummy hash, so timing does not reveal which emails exist; the 401 message is the same. Rate limiting is deferred to Phase 7.
- **Invites**: one-time link, only the hash is stored, 7-day expiry, 409 if the account already exists.
- **Members**: never hard-deleted (audit rows keep their user). Disabling deletes their sessions; their API keys stay but are rejected while disabled, and work again on re-enable. An admin cannot demote or disable themselves.
- **API keys**: anyone creates, lists and revokes their own. `GET /keys?all=true` and revoking someone else's key are admin only; a member using another user's key id gets 404, same as a missing id, so ids can't be probed. The plaintext key appears only in the create response.
- **Audit**: `GET /audit` filters by user, server, outcome, pages with `before=<id>`, `limit` max 200. A member is forced to their own rows whatever `?user=` says.
- **Errors**: one central handler. zod gives 400, Postgres 23505 gives 409, anything else a generic 500. No internal detail in bodies.

## Why

Cookie sessions fit a browser dashboard and can be revoked server-side, unlike a JWT. Storing only hashes means a database leak gives no usable tokens. Checking the database on every request costs one query and gives instant revocation, which the assignment's disable/revoke behaviour needs.

## Consequences

- No CSRF token: the defence depends on SameSite support and the JSON-only rule. Any new route must not accept form content types.
- Gateway is 1 replica, so no shared session cache is needed.
