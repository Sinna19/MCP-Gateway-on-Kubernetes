import { useState } from "react";
import { Navigate, NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./auth";

// Not logged in: go to /login and remember where they were headed.
// The role checks here only hide pages. The gateway's requireAdmin is the real boundary.
export function RequireUser() {
  const { status, user } = useAuth();
  const location = useLocation();
  if (status === "loading") return <p>Loading…</p>;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return <Outlet />;
}

export function RequireAdmin() {
  const { status, user } = useAuth();
  if (status === "loading") return <p>Loading…</p>;
  if (user?.role !== "admin") return <Navigate to="/keys" replace />;
  return <Outlet />;
}

export function Layout() {
  const { user, logout } = useAuth();
  const [logoutError, setLogoutError] = useState("");
  const onLogout = () => {
    setLogoutError("");
    logout().catch((err: unknown) => setLogoutError(err instanceof Error ? err.message : "Logout failed, try again"));
  };
  return (
    <>
      <header className="topbar">
        <nav>
          {user?.role === "admin" && <NavLink to="/servers">Servers</NavLink>}
          {user?.role === "admin" && <NavLink to="/members">Members</NavLink>}
          <NavLink to="/keys">My Keys</NavLink>
          <NavLink to="/audit">Audit</NavLink>
          <NavLink to="/chat">Chat</NavLink>
        </nav>
        <span className="who">
          {user?.email} ({user?.role})
        </span>
        <button onClick={onLogout}>Log out</button>
      </header>
      {logoutError && <p role="alert">{logoutError}</p>}
      <main>
        <Outlet />
      </main>
    </>
  );
}
