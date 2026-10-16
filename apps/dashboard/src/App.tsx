import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, homeFor, useAuth } from "./auth";
import { Layout, RequireAdmin, RequireUser } from "./Layout";
import { AcceptInvite } from "./pages/AcceptInvite";
import { Audit } from "./pages/Audit";
import { Chat } from "./pages/Chat";
import { Keys } from "./pages/Keys";
import { Login } from "./pages/Login";
import { Members } from "./pages/Members";
import { Servers } from "./pages/Servers";

function Home() {
  const { user } = useAuth();
  return <Navigate to={user ? homeFor(user) : "/login"} replace />;
}

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/invite/:token" element={<AcceptInvite />} />
        <Route element={<RequireUser />}>
          <Route element={<Layout />}>
            <Route path="/" element={<Home />} />
            <Route element={<RequireAdmin />}>
              <Route path="/servers" element={<Servers />} />
              <Route path="/members" element={<Members />} />
            </Route>
            <Route path="/keys" element={<Keys />} />
            <Route path="/audit" element={<Audit />} />
            <Route path="/chat" element={<Chat />} />
          </Route>
        </Route>
        <Route path="*" element={<Home />} />
      </Routes>
    </AuthProvider>
  );
}
