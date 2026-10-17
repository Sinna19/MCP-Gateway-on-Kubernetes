import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError, setOnUnauthorized } from "./api";

export type User = { id: string; email: string; role: "admin" | "member" };

type AuthState = {
  status: "loading" | "ready";
  user: User | null;
  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  acceptInvite: (token: string, password: string) => Promise<User>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<"loading" | "ready">("loading");
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    setOnUnauthorized(() => setUser(null));
    api<User>("/me")
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setStatus("ready"));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const u = await api<User>("/auth/login", { method: "POST", body: { email, password } });
    setUser(u);
    return u;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch (err) {
      // 401 means the session is already gone. Anything else (network, 5xx): the cookie may still be valid, so stay logged in.
      if (!(err instanceof ApiError && err.status === 401)) throw new Error("Logout failed, try again");
    }
    setUser(null);
  }, []);

  // The gateway sets the session cookie on accept, so the new user is logged in like after login().
  const acceptInvite = useCallback(async (token: string, password: string) => {
    const u = await api<User>(`/invites/${encodeURIComponent(token)}/accept`, { method: "POST", body: { password } });
    setUser(u);
    return u;
  }, []);

  const value = useMemo(() => ({ status, user, login, logout, acceptInvite }), [status, user, login, logout, acceptInvite]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}

export const homeFor = (user: User) => (user.role === "admin" ? "/servers" : "/keys");
