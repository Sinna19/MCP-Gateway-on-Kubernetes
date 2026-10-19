-- Chat turns per user per UTC day, for the daily cap (ADR 020). One row per user and day;
-- the gateway deletes rows older than 7 days from its hourly sweep.
CREATE TABLE chat_usage (
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day     date   NOT NULL,
  count   int    NOT NULL,
  PRIMARY KEY (user_id, day)
);
