import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { homeFor, useAuth } from "../auth";

const INVALID = "invite invalid or already used";

export function AcceptInvite() {
  const { token = "" } = useParams();
  const { status, user, logout, acceptInvite } = useAuth();
  const navigate = useNavigate();
  const [invite, setInvite] = useState<{ email: string; role: string } | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  // Only this read runs in the effect. The accept POST is the submit handler below,
  // because StrictMode runs effects twice in dev.
  useEffect(() => {
    if (status !== "ready" || user) return;
    api<{ email: string; role: string }>(`/invites/${encodeURIComponent(token)}`)
      .then(setInvite)
      .catch(() => setInvalid(true));
  }, [status, user, token]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const u = await acceptInvite(token, password);
      navigate(homeFor(u), { replace: true });
    } catch {
      // Unknown, expired, used or email-taken all look the same to the visitor.
      setError(INVALID);
    } finally {
      setPassword("");
    }
  }

  if (status === "loading") return <p>Loading…</p>;
  if (user) {
    return (
      <>
        <h1>Accept invite</h1>
        <p>You are logged in as {user.email}. Log out first to accept this invite.</p>
        <button onClick={() => void logout()}>Log out</button>
      </>
    );
  }
  if (invalid) return <p role="alert">{INVALID}</p>;
  if (!invite) return <p>Loading…</p>;
  return (
    <form className="panel" onSubmit={(e) => void submit(e)}>
      <h1>Accept invite</h1>
      <p>
        <strong>{invite.email}</strong> ({invite.role})
      </p>
      <label>
        Password
        <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={10} maxLength={200} required />
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="submit">Set password</button>
    </form>
  );
}
