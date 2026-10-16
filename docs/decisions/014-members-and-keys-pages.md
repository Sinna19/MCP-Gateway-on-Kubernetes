# 014: Members, My Keys and the invite page

Status: accepted. Dashboard only; no gateway change.

## Decisions
- **Secrets shown once** (new API key, invite link) go in a `readOnly` input that selects its text on focus (`ShownOnce.tsx`).
  - `navigator.clipboard` exists only in a secure context, and `http://app.localtest.me` is not one. The Copy button is rendered only if the API exists; the input always works.
  - They live in component state only: never in the URL, router state, storage or `console.*`. Dismiss, the next Generate/invite, or leaving the page drops them. Tests check the DOM and the console.
- **No polling** on these pages (unlike Servers): nothing changes unless an admin acts. Each write reloads once. A failed write keeps its error message: the reload does not clear it.
- **Revoke per key** from `GET /keys?all=true` (admin only, 403 for a member, checked live). That endpoint gives the owner's **email**, not an id, so keys are matched to members by email. Safe because emails are unique on `lower(email)` (migration 003). Cutting a person off entirely is **Disable** (ends their sessions, rejects all their keys); the page says so next to the button.
- **Own row**: role select and Disable are disabled for the logged-in admin. Convenience only: the API's 400 and 409 are the guards, and their messages are shown.
- **Invite page** `/invite/:token` (public route):
  - Only the `GET /invites/:token` runs in an effect. The accept POST runs in the submit handler (StrictMode runs effects twice). Tested: no POST before submit, exactly one after.
  - Unknown, expired, used or email-taken all show one message, "invite invalid or already used".
  - A logged-in visitor is told to log out first; no silent session swap.
  - Accept sets the session cookie, so `acceptInvite` in `auth.tsx` sets the user (like `login`) and goes to the role's home. Password length is mirrored as `minLength/maxLength` only; the gateway stays the authority.
  - `<meta name="referrer" content="no-referrer">` in `index.html` so the token never leaves in a Referer header. The nginx task adds the matching `Referrer-Policy` header.
- `GET /invites` (pending list) never returns the token or path; verified by grep on the live response.

## Known gap (phase 7)
Revoking a key rejects its next request, even inside an open `/mcp` session (verified: 401 on `tools/list`). The session object and any open SSE stream are not closed until the 30-minute idle timeout, so a revoked key may still receive `list_changed` notifications until then.
