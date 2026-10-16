import { StrictMode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { admin, somePassword, stubApi, type Reply } from "./helpers";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const GENERIC = "invite invalid or already used";
const invitee = { id: "9", email: "carol@urumi.local", role: "member" };

// Not logged in (GET /me is 401) unless `loggedIn`.
function gateway(opts: { loggedIn?: boolean; get?: Reply; accept?: Reply } = {}) {
  return (path: string, init: RequestInit): Reply => {
    const method = init.method ?? "GET";
    if (path === "/me") return opts.loggedIn ? { status: 200, body: admin } : { status: 401, body: { error: "not logged in" } };
    if (method === "GET" && path === "/invites/tok") return opts.get ?? { status: 200, body: { email: invitee.email, role: "member" } };
    if (method === "POST" && path === "/invites/tok/accept") return opts.accept ?? { status: 201, body: invitee };
    if (path === "/keys") return { status: 200, body: [] };
    return { status: 200, body: {} };
  };
}

function openInvite(strict = false) {
  const tree = (
    <MemoryRouter initialEntries={["/invite/tok"]}>
      <App />
    </MemoryRouter>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

describe("accept invite", () => {
  it("shows the email and role from the invite, and a password form", async () => {
    stubApi(gateway());
    openInvite();
    expect(await screen.findByText(invitee.email)).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it("posts the password once on submit, then lands on the member's home", async () => {
    const pw = somePassword();
    const { calls, inits } = stubApi(gateway());
    openInvite();
    await userEvent.type(await screen.findByLabelText("Password"), pw);
    await userEvent.click(screen.getByRole("button", { name: "Set password" }));
    await waitFor(() => expect(calls).toContain("POST /invites/tok/accept"));
    expect(JSON.parse(String(inits[calls.indexOf("POST /invites/tok/accept")]?.body))).toEqual({ password: pw });
    expect(await screen.findByRole("heading", { name: "My Keys" })).toBeInTheDocument();
  });

  it("StrictMode: no POST before submit, exactly one after", async () => {
    const { calls } = stubApi(gateway());
    openInvite(true);
    await userEvent.type(await screen.findByLabelText("Password"), somePassword());
    expect(calls.filter((c) => c.startsWith("POST"))).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: "Set password" }));
    await screen.findByRole("heading", { name: "My Keys" });
    expect(calls.filter((c) => c === "POST /invites/tok/accept")).toHaveLength(1);
  });

  it("an unknown, used or expired token (GET 404) shows one generic message and no form", async () => {
    stubApi(gateway({ get: { status: 404, body: { error: "invite not found or expired" } } }));
    openInvite();
    expect(await screen.findByText(GENERIC)).toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  });

  it.each([404, 409])("accept answering %i shows the same generic message", async (status) => {
    stubApi(gateway({ accept: { status, body: { error: "something specific" } } }));
    openInvite();
    await userEvent.type(await screen.findByLabelText("Password"), somePassword());
    await userEvent.click(screen.getByRole("button", { name: "Set password" }));
    expect(await screen.findByText(GENERIC)).toBeInTheDocument();
    expect(screen.queryByText("something specific")).not.toBeInTheDocument();
  });

  it("a logged-in user is told to log out first: no form, no accept call", async () => {
    const { calls } = stubApi(gateway({ loggedIn: true }));
    openInvite();
    expect(await screen.findByText(/log out first/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    expect(calls.filter((c) => c.startsWith("POST"))).toEqual([]);
  });
});
