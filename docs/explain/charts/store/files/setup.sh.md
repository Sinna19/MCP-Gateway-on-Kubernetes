# Explain: `charts/store/files/setup.sh` (the store setup Job)

Companion files: `charts/store/templates/setup-job.yaml`, `setup-role.yaml`, `setup-serviceaccount.yaml`,
`setup-configmap.yaml`, `scripts/secrets.sh`, ADR 004.

## 1. What it is, in two sentences
A bash script, run once per `helm upgrade` by a Kubernetes Job, that turns an empty WordPress into a working shop: install WP and
WooCommerce, pretty permalinks, COD, shipping, 3 products, an integration user, and the user's Application Password written into
Secret `woo-api`. Every step checks first and skips if already done, so a rerun changes nothing.

## 2. Flow, hop by hop
Deploy side:
1. `make deploy` → `helm upgrade --install` → kube-apiserver creates Job `setup-<revision>` (`setup-job.yaml:6`).
2. The Job controller makes a pod. The kubelet mounts: ConfigMap `store-setup` at `/setup` (`setup-job.yaml:86-87`, holds
   this script and `products.txt`), the PVC `store-wordpress-content` at `wp-content` (`:84-85`), an empty `core` volume at `/var/www/html`.
3. Init container `copy-core` (`:31-36`) copies WordPress core from the **same** image the live site runs, so versions match, then the
   main container starts `bash /setup/setup.sh` (`:50`).

Inside the script:
4. Wait for the DB (`setup.sh:16`): `wp` → MySQL protocol → Service `store-mariadb:3306` → MariaDB pod. Loops until `SELECT 1` works.
5. Install WP, plugin, permalinks, options, products (`:18-83`). These are **not** HTTP calls to the site: `wp` loads WordPress
   PHP in-process and talks to MariaDB. Even `wp wc ...` runs the REST handlers in-process, which is why it needs `--user` (`:46`).
   Plugin download is the one outbound HTTPS call (`downloads.wordpress.org`, `:29`).
6. Create user `woo-mcp` with role `shop_manager` and a random throwaway password (`:85-91`).
7. Secret hand-off (`:93-115`): `curl` over HTTPS to `kubernetes.default.svc` (ClusterIP → kube-apiserver), authenticated with the
   pod's ServiceAccount token. `GET` the Secret (`:99`); if `password` is set → skip. Else create an app password
   (`:110`) and `PATCH` it in (`:112-113`). apiserver checks RBAC: only `get`/`patch` on `woo-api` pass.

Later (Phase 2, not built yet): woo-mcp reads `woo-api` via env, calls `http://store-wordpress/wp-json/wc/v3/...` with Basic auth.

## 3. Kubernetes objects and the fields that matter
- **Job** `setup-job.yaml`: `name: setup-{{ .Release.Revision }}` (`:6`) because Job specs are immutable: a fixed name would fail the
  2nd upgrade. `ttlSecondsAfterFinished: 600` (`:11`) auto-cleans. `backoffLimit: 3` (`:12`) retries. `activeDeadlineSeconds: 900`
  (`:13`) kills a hung run (e.g. DB never comes up). `restartPolicy: OnFailure` (`:20`) retries in the same pod.
- **Security context** (`:22-26,34-35,48-49`): uid 33 (www-data) so files on the PVC keep the owner WordPress uses; non-root;
  no privilege escalation. The cli image's default uid is 82, hence the override.
- **No probes** on the Job: it is run-to-completion, so probes make no sense; the deadline + backoff replace them (ADR 004).
- **Resources** (`:37-38,79-80`) from `setup.resources` (requests 100m/256Mi, limits 1 CPU/512Mi). The script raises PHP
  `memory_limit` to 512M (`setup.sh:12`) because the cli image has no php.ini (default 128M).
- **Secrets**: `store-db` (DB password), `store-wp-salts`, `store-wp-admin` (admin login → `WC_USER`/`WC_PASS`, `:67-76`), and
  `woo-api` (output). All created by `scripts/secrets.sh`, none in Helm values.
- **RBAC** `setup-role.yaml`: Role `store-setup` = `get`,`patch` on `secrets` with `resourceNames: [woo-api]`. ServiceAccount
  `store-setup` is used only by this Job.
- **PVC**: `wp-content` (plugins, uploads). RWO, shared with the WordPress pod; works because both land on the same node (local-path).
- **NetworkPolicy**: none applies to the store yet. Honest gap; woo-mcp's policy comes in Phase 2, and a MariaDB policy is a Phase 7 item.

## 4. Failure modes
| Failure | What happens |
|---|---|
| MariaDB not ready | Loop at `:16` waits; `activeDeadlineSeconds` ends it after 15 min |
| Any command fails | `set -euo pipefail` (`:4`) stops the script; pod retried up to `backoffLimit`; rerun resumes since steps are idempotent |
| Died after creating app password, before patching Secret | Next run sees empty `password` and first deletes our old app password (`:103-109`), then makes a new one |
| `kube` PATCH fails | `--fail-with-body` (`:96`) makes curl exit non-zero and print the API's error message → pipeline fails → retry |
| WooCommerce download fails | Script exits, retry; plugin is checked with `is-installed` so a half install is the risk |
| Job fails all retries | `scripts/wait-setup.sh` (run by `make deploy`) sees the `failed` condition within seconds, prints the last 20 log lines, exits 1, so `make deploy` fails |
| `woo-api` does not exist | `GET` fails (`--fail-with-body`) → Job fails; fix: `make secrets` |

## 5. Security
- **Trusted:** the cluster, the chart values, the ConfigMap script. **Not trusted:** nothing external feeds this script; product names come from our values.
- **Credentials:** admin password in Secret → env `WC_PASS` → used at `:22`. Integration password: generated by WordPress, held in a shell
  variable, base64'd, sent on stdin to the API, stored in Secret `woo-api`. Never logged.
- **Least privilege:** the Job can read/patch exactly one Secret; it cannot read `store-db` or create Secrets (`kubectl auth can-i` verified).
  `woo-mcp` is `shop_manager`, not admin.
- **Weak spots here:** admin password is a command-line argument (`:22`) and the ServiceAccount bearer token is a `curl` argument
  (`:96`), so both are visible to `ps` inside this pod. Only the app password is kept off the command line. The pod is short-lived and not exposed.
- The Application Password works over HTTP only because `WP_ENVIRONMENT_TYPE=local`. In production mode it needs TLS.

## 6. Ten likely interview questions
1. **Why a Job and not a Helm hook?** Hooks sit outside the release, hide failures, and fight `--wait`. A normal Job is visible with `kubectl`, and ttl cleans it up.
2. **Why is the Job named with the revision?** Job specs are immutable, so a fixed name breaks the second `helm upgrade`. New name per revision = new Job.
3. **How is it idempotent?** Each step checks state first: `is-installed`, option equals value, SKU lookup, user exists, Secret `password` non-empty. Rerun logs "skipped" everywhere (verified: `setup-4`).
4. **Why pre-create `woo-api` in `secrets.sh` instead of letting the Job create it?** RBAC can't restrict `create` to one name, so the Job would need `create` on *all* Secrets. Pre-creating lets the Role be `get/patch` on one name.
5. **Why no `password` key in the pre-created Secret?** So woo-mcp's `secretKeyRef` on `password` keeps its pod waiting, not starting with a blank password.
6. **Why curl to the K8s API and not a kubectl image?** One image, one script. The kubectl image has no shell, so "skip if set" is awkward. The cli image already has curl and php.
7. **Why a second image (`wordpress:cli`) plus `copy-core`?** The cli image has `wp` but no WordPress core. Copying core from the exact site image guarantees the same version.
8. **Why `shop_manager` and not admin?** Covers WooCommerce products/orders over REST v3 but cannot manage plugins or users. A leaked credential does less damage.
9. **Why Application Passwords and not a WooCommerce API key (consumer key)?** Woo keys need generating via admin UI/DB; Application Passwords are creatable by WP-CLI and tied to a user/role. (Plan decision: ADR for Phase 2.)
10. **What if two upgrades run close together?** `make deploy` waits for its Job (`scripts/wait-setup.sh`), so sequential deploys never overlap. Two people running raw `helm upgrade` at once can still race (weakness 1).

## 7. What is weak, be ready to defend or fix
1. **Races (reasoned, not tested).** `make deploy` now serialises its own Jobs, but raw `helm upgrade` runs are not guarded. Two Jobs at once can both pass the "SKU missing" / "password empty" checks. Worst case: Job B deletes Job A's app password, A patches after B, and the Secret holds a deleted credential. Fix: one Job at a time (delete older Job first or a lock).
2. ~~Latent `set -e` bug in the app-password loop~~ **Fixed:** the loop used `[ ... ] && delete`, which exits 1 when the last row doesn't match, and `pipefail` would then kill the script. It is now an `if` (`:106-108`).
3. **Drift is not reconciled.** Products are matched by SKU only; changing a price in values does not update an existing product. Bumping `woocommerceVersion` does not upgrade an installed plugin (`:26`).
4. ~~Silent failure~~ **Fixed:** `make deploy` ends with `scripts/wait-setup.sh`, and curl uses `--fail-with-body`. Remaining gap: a raw `helm upgrade` still doesn't wait.
5. **Credentials in `ps`** (see section 5): admin password at `:22`, bearer token at `:96`.
6. **COD log line** (`:63-64`) always says "enabled" even when nothing changed; it is idempotent but not a true "skipped" log.
7. **No NetworkPolicy for the store yet** (planned in Phase 7: MariaDB accepts only WordPress and the setup Job), and the integration user's e-mail is a fake `.invalid` address.
