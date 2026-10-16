import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, setOnUnauthorized } from "./api";

export type User = { id: string; email: string; role: "admin" | "member" };

type AuthState = {
  status: "loading" | "ready";
  user: User | null;
  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
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
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    setUser(null);
  }, []);

  const value = useMemo(() => ({ status, user, login, logout }), [status, user, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}

export const homeFor = (user: User) => (user.role === "admin" ? "/servers" : "/keys");
