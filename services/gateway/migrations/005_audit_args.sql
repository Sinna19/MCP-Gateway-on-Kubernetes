-- Tool arguments (redacted and size-capped by src/audit-args.ts); old rows stay null.
ALTER TABLE audit_log ADD COLUMN args jsonb;

-- A chat confirm the user declined is a row too; nothing was sent upstream.
ALTER TABLE audit_log DROP CONSTRAINT audit_log_outcome_check;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_outcome_check CHECK (outcome IN ('ok', 'error', 'declined'));
