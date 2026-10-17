import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { homeFor, useAuth } from "../auth";

type From = { pathname: string; search?: string };

export function Login() {
  const { status, user, login } = useAuth();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: From } | null)?.from;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  // Already logged in (page reload on /login): skip the form.
  const back = from ? `${from.pathname}${from.search ?? ""}` : null;
  if (status === "ready" && user) return <Navigate to={back ?? homeFor(user)} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const u = await login(email, password);
      navigate(back ?? homeFor(u), { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "login failed");
    }
  }

  return (
    <form className="login" onSubmit={(e) => void submit(e)}>
      <h1>Urumi MCP Gateway</h1>
      <label>
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
      </label>
      <label>
        Password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="submit">Log in</button>
    </form>
  );
}
