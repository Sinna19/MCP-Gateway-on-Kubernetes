import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { admin, member, renderAt, stubApi, type Reply } from "./helpers";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const bob = { id: "2", email: member.email, role: "member", disabled: false, createdAt: "2026-10-01T00:00:00Z", activeKeys: 1 };
const me = { id: "1", email: admin.email, role: "admin", disabled: false, createdAt: "2026-10-01T00:00:00Z", activeKeys: 0 };
const bobKey = { id: "7", name: "laptop", prefix: "umk_ab12", owner: member.email, createdAt: "2026-10-02T00:00:00Z", lastUsedAt: null, revokedAt: null };
const bobOldKey = { ...bobKey, id: "6", name: "old", prefix: "umk_cd34", revokedAt: "2026-10-03T00:00:00Z" };
const pending = { id: "3", email: "new@urumi.local", role: "member", expiresAt: "2026-10-30T00:00:00Z", createdAt: "2026-10-16T00:00:00Z" };

// A fake gateway: logged in as `who`, with fixed lists. `write` answers everything else.
function gateway(write: (path: string, init: RequestInit) => Reply = () => ({ status: 200, body: {} }), who = admin) {
  return (path: string, init: RequestInit): Reply => {
    const method = init.method ?? "GET";
    if (path === "/me") return { status: 200, body: who };
    if (method === "GET" && path === "/members") return { status: 200, body: [me, bob] };
    if (method === "GET" && path === "/invites") return { status: 200, body: [pending] };
    if (method === "GET" && path === "/keys?all=true") return { status: 200, body: [bobKey, bobOldKey] };
    return write(path, init);
  };
}

const bodyOf = (init: RequestInit | undefined) => JSON.parse(String(init?.body));
const rowOf = async (email: string) => (await screen.findByText(email, { selector: "td" })).closest("tr") as HTMLElement;

async function openMembers() {
  renderAt("/members");
  await screen.findByRole("heading", { name: "Members" });
}

describe("members", () => {
  it("lists members with their active key count", async () => {
    stubApi(gateway());
    await openMembers();
    const row = await rowOf(bob.email);
    expect(within(row).getByText("1")).toBeInTheDocument();
  });

  it("shows 'blocked' instead of the key count for a disabled member", async () => {
    const base = gateway();
    stubApi((path, init) =>
      path === "/members" && (init.method ?? "GET") === "GET" ? { status: 200, body: [me, { ...bob, disabled: true }] } : base(path, init),
    );
    await openMembers();
    const row = await rowOf(bob.email);
    expect(within(row).getByText("blocked")).toBeInTheDocument();
    expect(within(row).queryByText("1")).not.toBeInTheDocument();
  });

  it("role change sends PATCH with the role", async () => {
    const { calls, inits } = stubApi(gateway());
    await openMembers();
    const row = await rowOf(bob.email);
    await userEvent.selectOptions(within(row).getByRole("combobox"), "admin");
    await waitFor(() => expect(calls).toContain("PATCH /members/2"));
    expect(bodyOf(inits[calls.indexOf("PATCH /members/2")])).toEqual({ role: "admin" });
  });

  it("Disable sends disabled:true and the hint says it blocks keys and sessions", async () => {
    const { calls, inits } = stubApi(gateway());
    await openMembers();
    expect(await screen.findByText(/blocks all their keys and ends their sessions/i)).toBeInTheDocument();
    const row = await rowOf(bob.email);
    await userEvent.click(within(row).getByRole("button", { name: "Disable" }));
    await waitFor(() => expect(calls).toContain("PATCH /members/2"));
    expect(bodyOf(inits[calls.indexOf("PATCH /members/2")])).toEqual({ disabled: true });
  });

  it("shows the API message on a 409 last-admin reply", async () => {
    stubApi(gateway((p) => (p === "/members/2" ? { status: 409, body: { error: "at least one other enabled admin is required" } } : { status: 200 })));
    await openMembers();
    const row = await rowOf(bob.email);
    await userEvent.selectOptions(within(row).getByRole("combobox"), "admin");
    expect(await screen.findByRole("alert")).toHaveTextContent("at least one other enabled admin is required");
  });

  it("disables the role select and Disable button on the logged-in admin's own row", async () => {
    stubApi(gateway());
    await openMembers();
    const row = await rowOf(me.email);
    expect(within(row).getByRole("combobox")).toBeDisabled();
    expect(within(row).getByRole("button", { name: "Disable" })).toBeDisabled();
    const other = await rowOf(bob.email);
    expect(within(other).getByRole("combobox")).toBeEnabled();
  });

  it("a member visiting /members is redirected and never calls the members API", async () => {
    const { calls } = stubApi(gateway(undefined, member));
    renderAt("/members");
    await screen.findByRole("heading", { name: "My Keys" });
    expect(calls).not.toContain("GET /members");
    expect(calls).not.toContain("GET /keys?all=true");
  });
});

describe("invites", () => {
  it("posts email and role, shows the full link once in a read-only input", async () => {
    const { calls, inits } = stubApi(gateway((p, i) => (p === "/invites" && i.method === "POST" ? { status: 201, body: { id: "4", path: "/invite/tok123" } } : { status: 200 })));
    await openMembers();
    await userEvent.type(await screen.findByLabelText("Email"), "carol@urumi.local");
    await userEvent.click(screen.getByRole("button", { name: "Create invite" }));
    await waitFor(() => expect(calls).toContain("POST /invites"));
    expect(bodyOf(inits[calls.indexOf("POST /invites")])).toEqual({ email: "carol@urumi.local", role: "member" });
    const link = (await screen.findByLabelText("Invite link")) as HTMLInputElement;
    expect(link.value).toBe(`${window.location.origin}/invite/tok123`);
    expect(link.readOnly).toBe(true);
  });

  it("works without navigator.clipboard: link is still shown and there is no Copy button", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    stubApi(gateway((p, i) => (p === "/invites" && i.method === "POST" ? { status: 201, body: { id: "4", path: "/invite/tok123" } } : { status: 200 })));
    await openMembers();
    await userEvent.type(await screen.findByLabelText("Email"), "carol@urumi.local");
    await userEvent.click(screen.getByRole("button", { name: "Create invite" }));
    expect(await screen.findByLabelText("Invite link")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy" })).not.toBeInTheDocument();
  });

  it("lists pending invites without any link, and Cancel sends DELETE", async () => {
    const { calls } = stubApi(gateway((p, i) => (i.method === "DELETE" ? { status: 204 } : { status: 200 })));
    await openMembers();
    const row = await rowOf(pending.email);
    expect(row.textContent).not.toContain("/invite/");
    await userEvent.click(within(row).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(calls).toContain("DELETE /invites/3"));
  });
});

describe("member keys", () => {
  async function openKeys(email: string) {
    const row = await rowOf(email);
    const next = row.nextElementSibling as HTMLElement;
    return next;
  }

  it("shows each key's name, prefix and revoked state, never a full key", async () => {
    stubApi(gateway());
    await openMembers();
    const keys = await openKeys(bob.email);
    expect(within(keys).getByText("laptop")).toBeInTheDocument();
    expect(within(keys).getByText(/umk_ab12/)).toBeInTheDocument();
    expect(within(keys).getByText("old")).toBeInTheDocument();
    expect(within(keys).getByText(/revoked/i)).toBeInTheDocument();
    // only the active key has a Revoke button
    expect(within(keys).getAllByRole("button", { name: "Revoke" })).toHaveLength(1);
  });

  it("says '1 key' for one key and 'N keys' for more", async () => {
    const base = gateway();
    stubApi((path, init) => (path === "/keys?all=true" ? { status: 200, body: [bobKey] } : base(path, init)));
    await openMembers();
    expect(within(await openKeys(bob.email)).getByText("1 key")).toBeInTheDocument();
  });

  it("says '2 keys' when a member has two", async () => {
    stubApi(gateway());
    await openMembers();
    expect(within(await openKeys(bob.email)).getByText("2 keys")).toBeInTheDocument();
  });

  it("Revoke asks first and sends DELETE only after a yes, then reloads", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    const { calls } = stubApi(gateway((p, i) => (i.method === "DELETE" ? { status: 204 } : { status: 200 })));
    await openMembers();
    const keys = await openKeys(bob.email);
    const btn = within(keys).getByRole("button", { name: "Revoke" });
    await userEvent.click(btn);
    expect(calls).not.toContain("DELETE /keys/7");
    await userEvent.click(btn);
    await waitFor(() => expect(calls).toContain("DELETE /keys/7"));
    expect(confirm).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(calls.filter((c) => c === "GET /keys?all=true").length).toBeGreaterThanOrEqual(2));
  });
});
