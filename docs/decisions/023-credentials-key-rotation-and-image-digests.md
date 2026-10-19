# 023: CREDENTIALS_KEY rotation and image digests

**Status:** accepted (rotation done; the digest part is written in the next session)
**Date:** 2026-10-19

## Context
`CREDENTIALS_KEY` (Secret `gateway-app`) encrypts `upstream_servers.credential_enc` with AES-256-GCM (ADR 005 area, `src/crypto.ts`; the server slug is the AAD). Replacing the key by hand makes every stored credential undecryptable, so the gateway shows every authenticated upstream as unreachable. We need a rotation that cannot leave half the rows on one key and half on the other.

## Decision: rotation
- **`reencryptCredentials(pool, oldKey, newKey)`** (`src/rotate-key.ts`) does everything in ONE transaction: lock the rows (`FOR UPDATE`), decrypt each with the old key, encrypt with the new one, re-read the table and check every row decrypts with the new key to the same plaintext, then `COMMIT`. Any failure rolls back and nothing changes. Errors name the slug, never a key or a value. Same key twice or a wrong-size key is refused.
- **It runs in the cluster as a one-off Job** (`src/rotate-main.ts`, same gateway image as the running Deployment). Postgres is only reachable from inside the cluster (NetworkPolicy), so the Job needs no port-forward and no credentials on the laptop. The keys are mounted from two Secrets (`gateway-key-old`, `gateway-key-new`) as files under `/keys/old` and `/keys/new`. Nothing is passed through argv, env or stdin. A NetworkPolicy gives the Job's pod only DNS and Postgres egress and no ingress; Postgres ingress allows it.
- **`scripts/rotate-credentials-key.sh` (`make rotate-key`)**, in order:
  1. Refuse another kubectl context; refuse if a leftover `gateway-key-*` Secret exists (an earlier run did not finish).
  2. Print each row's ciphertext prefix (the 12-byte random IV, not secret). Create the new key with `openssl rand`, never printed, and the two Secrets from temp files (`umask 077`, removed on exit).
  3. **Scale the gateway to 0.** A running old-key gateway could save a credential between the commit and the Secret swap, and that row would be unreadable afterwards.
  4. Run the Job and wait. Failure: nothing changed; the trap scales the gateway back up on the old key and deletes both temp Secrets.
  5. Copy the new key into `gateway-app` (`kubectl patch --patch-file`).
  6. Scale to 1, wait for rollout, log in as the admin and wait until every enabled server is `connected`.
  7. Only then delete `gateway-key-old`, `gateway-key-new` and the Job.
- **Failure after the commit.** The EXIT trap always scales the gateway back to 1 except in one case. If the Job committed but the swap of `gateway-app` failed, the trap retries the swap once. If that works, the gateway starts on the new key. If it fails again the database holds the new key and `gateway-app` the old one, so starting the gateway would be wrong; the gateway stays at 0 and the script prints: `DB uses the new key (Secret gateway-key-new). Run: scripts/rotate-credentials-key.sh finish, then scale gateway to 1`. `finish` only copies `gateway-key-new` into `gateway-app`. `gateway-key-new` is kept in every path until the success step; if the servers do not connect after the swap, the old key also stays in `gateway-key-old`.

## Downtime
The gateway is down from step 3 to step 6, about 30 s locally (Job plus pod start). Open `/mcp` sessions and chat turns are cut and clients reconnect. Rotation is rare, so we accept it instead of building a gateway that holds two keys.

## Not done on purpose
- **No dual-key mode** in the gateway (try new, fall back to old). It would make rotation zero-downtime but adds a code path in the one place that handles secrets.
- **Only upstream credentials are re-encrypted.** API keys and passwords are stored as hashes, so they do not depend on `CREDENTIALS_KEY`.

## Images by digest
Written in the next session (7f, second group).

## Consequences
- After a rotation the old key exists nowhere in the cluster (backup Secret deleted after the check). A restored old Postgres backup would need the old key: keep the key with the backup.
- Interview line: one transaction, verify before commit, gateway stopped so nothing writes with the old key, backup key deleted only after every server is connected.
