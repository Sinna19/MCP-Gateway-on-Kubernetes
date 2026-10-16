# 013: Servers page

Status: accepted. Dashboard only; no gateway change.

## Decisions
- **Poll every 5s** (same as the gateway's health ping) so the status badge follows reality.
  - The tick is skipped while `document.visibilityState` is hidden; one fetch on return to visible.
  - A request in flight blocks the next tick, so a slow gateway never stacks requests.
  - After a write we fetch once more (forced); only the newest answer is applied (`latest` counter).
  - The poll replaces the list only. Edit opens on a **snapshot** of the row, so typing is never reset.
  - The interval and the listener are removed on unmount.
- **Session expiry is fixed, not sliding**: `sessions.expires_at` is set once at login (12h, `sessions.ts`). Polling does not keep an admin logged in; after 12h the poll gets 401 and `onUnauthorized` shows the login form.
- **Credential is write-only.** The API never returns it, so no input is ever pre-filled.
  - Secret inputs are `type=password` with `autocomplete="new-password"`, so the browser does not offer the saved dashboard password.
  - Token and value are cleared from state after a submit, success or error.
  - Edit offers Keep / Replace / Remove. A URL change disables Keep (the API rejects a new url without `auth`), and both Replace and Remove are accepted by the API with a url change.
  - Keep with an unchanged URL sends no request and shows "nothing to save".
- **Slug is read-only when editing**: it is the tool-name prefix and the encryption AAD, and PATCH has no slug field.
- **Delete** asks `window.confirm`. `audit_log.server_slug` is plain text with no foreign key (`001_init.sql`), so history survives a delete.
- Descriptions of tools are untrusted text; only tool names are shown, as React text.
- The UI hides nothing for security: `requireAdmin` on the API is the boundary (ADR 012).
