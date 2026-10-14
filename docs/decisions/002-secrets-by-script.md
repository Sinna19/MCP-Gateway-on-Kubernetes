# 002: Secrets are created by a script, not by Helm

## Status
Accepted

## Context
MariaDB needs a root and a user password. The charts must not contain secret values (assignment rule),
and the same charts must work locally and on the VPS.

## Decision
`scripts/secrets.sh` creates Secret `store-db` with random passwords (`openssl rand`) if it does not
already exist. Charts only reference the Secret by name (`mariadb.existingSecret`). `make deploy` runs
the script first.

## Why not the alternatives
- **Helm-templated `randAlphaNum`**: regenerates on every `helm upgrade` unless you add `lookup` tricks,
  and the values end up in the Helm release history stored in the cluster.
- **Literals in values files**: ends up in git.

## Consequences
- Create-if-missing is deliberate: MariaDB reads the password env vars only on first init of the data
  directory. Rotating the Secret later would lock WordPress out. Rotation needs a manual procedure.
- The same script runs against the VPS by pointing kubectl at its kubeconfig.
