-- Emails are compared in lower case everywhere (login, invites), so the database enforces it too.
CREATE UNIQUE INDEX users_email_lower ON users (lower(email));
