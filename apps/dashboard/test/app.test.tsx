import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/api";
import { admin, member, renderAt, somePassword, stubApi, type Reply } from "./helpers";

afterEach(() => vi.unstubAllGlobals());

// A fake gateway: /me answers with `session`, /auth/login with `loginAs` (null = wrong password).
function gateway(session: typeof admin | null, loginAs?: typeof admin | null) {
  return (path: string): Reply => {
    if (path === "/me") return session ? { status: 200, body: session } : { status: 401, body: { error: "not logged in" } };
    if (path === "/auth/login") return loginAs ? { status: 200, body: loginAs } : { status: 401, body: { error: "invalid email or password" } };
    if (path === "/auth/logout") return { status: 204 };
    return { status: 200, body: [] };
  };
}

async function logIn(email: string) {
  await userEvent.type(await screen.findByLabelText("Email"), email);
  await userEvent.type(screen.getByLabelText("Password"), somePassword());
  await userEvent.click(screen.getByRole("button", { name: "Log in" }));
}

describe("session check", () => {
  it("shows Loading and does not redirect while /me is pending", async () => {
    let resolveMe: (r: Reply) => void = () => {};
    stubApi((path) => (path === "/me" ? new Promise<Reply>((r) => (resolveMe = r)) : { status: 200 }));
    renderAt("/audit");
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
    resolveMe({ status: 200, body: admin });
    expect(await screen.findByRole("heading", { name: "Audit log" })).toBeInTheDocument();
  });

  it("shows the login form when /me is 401", async () => {
    stubApi(gateway(null));
    renderAt("/servers");
    expect(await screen.findByLabelText("Email")).toBeInTheDocument();
  });

  it("returns to the login form when a later call gets 401", async () => {
    stubApi((path) => (path === "/me" ? { status: 200, body: admin } : { status: 401, body: { error: "not logged in" } }));
    renderAt("/audit");
    await screen.findByRole("heading", { name: "Audit log" });
    await api("/audit").catch(() => {});
    expect(await screen.findByLabelText("Email")).toBeInTheDocument();
  });
});

describe("login", () => {
  it("shows the API error on a wrong password and stays on the form", async () => {
    stubApi(gateway(null, null));
    renderAt("/login");
    await logIn("admin@urumi.local");
    expect(await screen.findByText("invalid email or password")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("sends an admin to /servers", async () => {
    stubApi(gateway(null, admin));
    renderAt("/login");
    await logIn(admin.email);
    expect(await screen.findByRole("heading", { name: "Servers" })).toBeInTheDocument();
  });

  it("sends a member to /keys", async () => {
    stubApi(gateway(null, member));
    renderAt("/login");
    await logIn(member.email);
    expect(await screen.findByRole("heading", { name: "My Keys" })).toBeInTheDocument();
  });

  it("returns to the page they were trying to open", async () => {
    stubApi(gateway(null, admin));
    renderAt("/audit");
    await logIn(admin.email);
    expect(await screen.findByRole("heading", { name: "Audit log" })).toBeInTheDocument();
  });
});

describe("role-aware nav", () => {
  it("shows Servers and Members to an admin", async () => {
    stubApi(gateway(admin));
    renderAt("/keys");
    await screen.findByRole("heading", { name: "My Keys" });
    expect(screen.getByRole("link", { name: "Servers" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Members" })).toBeInTheDocument();
  });

  it("hides them from a member and redirects /servers to My Keys", async () => {
    stubApi(gateway(member));
    renderAt("/servers");
    expect(await screen.findByRole("heading", { name: "My Keys" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Servers" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Members" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Audit" })).toBeInTheDocument();
  });

  it("logs out with a POST and returns to the form", async () => {
    const { calls } = stubApi(gateway(admin));
    renderAt("/servers");
    await userEvent.click(await screen.findByRole("button", { name: "Log out" }));
    expect(await screen.findByLabelText("Email")).toBeInTheDocument();
    expect(calls).toContain("POST /auth/logout");
  });
});

describe("api()", () => {
  it("sends a JSON content type on POST (the gateway answers 415 otherwise)", async () => {
    const { inits } = stubApi(() => ({ status: 200, body: {} }));
    await api("/keys", { method: "POST", body: { name: "laptop" } });
    const headers = new Headers(inits[0]?.headers);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(inits[0]?.body).toBe('{"name":"laptop"}');
    await waitFor(() => expect(inits[0]?.credentials).toBe("same-origin"));
  });
});

describe("api() on non-JSON bodies", () => {
  it("turns an HTML 502 into a readable error", async () => {
    stubApi(() => ({ status: 502, raw: "<html>Bad Gateway</html>" }));
    await expect(api("/keys")).rejects.toMatchObject({ status: 502, message: "request failed (502)" });
  });

  it("still returns to the login form on an HTML 401", async () => {
    stubApi((path) => (path === "/me" ? { status: 200, body: admin } : { status: 401, raw: "<html>nope</html>" }));
    renderAt("/audit");
    await screen.findByRole("heading", { name: "Audit log" });
    await api("/audit").catch(() => {});
    expect(await screen.findByLabelText("Email")).toBeInTheDocument();
  });
});

describe("logout failures", () => {
  it("stays logged in and says so when the gateway answers 500", async () => {
    stubApi((path) => (path === "/auth/logout" ? { status: 500, body: { error: "boom" } } : gateway(admin)(path)));
    renderAt("/servers");
    await userEvent.click(await screen.findByRole("button", { name: "Log out" }));
    expect(await screen.findByText("Logout failed, try again")).toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  });

  it("stays logged in on a network error", async () => {
    stubApi(gateway(admin));
    renderAt("/servers");
    await screen.findByRole("button", { name: "Log out" });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    await userEvent.click(screen.getByRole("button", { name: "Log out" }));
    expect(await screen.findByText("Logout failed, try again")).toBeInTheDocument();
  });

  it("treats 401 as already logged out", async () => {
    stubApi((path) => (path === "/auth/logout" ? { status: 401, body: { error: "not logged in" } } : gateway(admin)(path)));
    renderAt("/servers");
    await userEvent.click(await screen.findByRole("button", { name: "Log out" }));
    expect(await screen.findByLabelText("Email")).toBeInTheDocument();
  });
});
