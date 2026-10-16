import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { member, renderAt, stubApi, type Reply } from "./helpers";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const mine = { id: "7", name: "laptop", prefix: "umk_ab12", owner: member.email, createdAt: "2026-10-02T00:00:00Z", lastUsedAt: null, revokedAt: null };
const gone = { ...mine, id: "6", name: "old", revokedAt: "2026-10-03T00:00:00Z" };

function gateway(write: (path: string, init: RequestInit) => Reply = () => ({ status: 200, body: {} })) {
  return (path: string, init: RequestInit): Reply => {
    if (path === "/me") return { status: 200, body: member };
    if ((init.method ?? "GET") === "GET" && path === "/keys") return { status: 200, body: [mine, gone] };
    return write(path, init);
  };
}

async function openKeys() {
  renderAt("/keys");
  await screen.findByRole("heading", { name: "My Keys" });
}

// Made up at run time so no key-looking literal sits in the source.
const newKey = () => `umk_${crypto.randomUUID().replaceAll("-", "")}`;

describe("my keys", () => {
  it("lists only my keys (never all=true) and shows the prefix, not a key", async () => {
    const { calls } = stubApi(gateway());
    await openKeys();
    const row = (await screen.findByText("laptop", { selector: "td" })).closest("tr") as HTMLElement;
    expect(within(row).getByText(/umk_ab12/)).toBeInTheDocument();
    expect(calls.filter((c) => c.startsWith("GET /keys"))).toEqual(["GET /keys"]);
    expect(screen.getByText("old", { selector: "td" }).closest("tr")).toHaveTextContent(/revoked/i);
  });

  it("Generate posts the name and shows the key once; Dismiss removes it from the DOM", async () => {
    const key = newKey();
    const { calls, inits } = stubApi(gateway((p, i) => (p === "/keys" && i.method === "POST" ? { status: 201, body: { id: "8", name: "ci", key } } : { status: 200 })));
    await openKeys();
    await userEvent.type(await screen.findByLabelText("Name"), "ci");
    await userEvent.click(screen.getByRole("button", { name: "Generate key" }));
    await waitFor(() => expect(calls).toContain("POST /keys"));
    expect(JSON.parse(String(inits[calls.indexOf("POST /keys")]?.body))).toEqual({ name: "ci" });
    const box = (await screen.findByLabelText("New API key")) as HTMLInputElement;
    expect(box.value).toBe(key);
    expect(box.readOnly).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: /saved it/i }));
    expect(screen.queryByLabelText("New API key")).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(key);
  });

  it("works without navigator.clipboard: key is shown, no Copy button, nothing throws", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    const key = newKey();
    stubApi(gateway((p, i) => (p === "/keys" && i.method === "POST" ? { status: 201, body: { id: "8", name: "ci", key } } : { status: 200 })));
    await openKeys();
    await userEvent.type(await screen.findByLabelText("Name"), "ci");
    await userEvent.click(screen.getByRole("button", { name: "Generate key" }));
    expect(((await screen.findByLabelText("New API key")) as HTMLInputElement).value).toBe(key);
    expect(screen.queryByRole("button", { name: "Copy" })).not.toBeInTheDocument();
  });

  it("never writes the key to the console", async () => {
    const key = newKey();
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m));
    stubApi(gateway((p, i) => (p === "/keys" && i.method === "POST" ? { status: 201, body: { id: "8", name: "ci", key } } : { status: 200 })));
    await openKeys();
    await userEvent.type(await screen.findByLabelText("Name"), "ci");
    await userEvent.click(screen.getByRole("button", { name: "Generate key" }));
    await screen.findByLabelText("New API key");
    for (const s of spies) expect(JSON.stringify(s.mock.calls)).not.toContain(key);
  });

  it("Revoke asks first and sends DELETE only after a yes", async () => {
    vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    const { calls } = stubApi(gateway((p, i) => (i.method === "DELETE" ? { status: 204 } : { status: 200 })));
    await openKeys();
    const row = (await screen.findByText("laptop", { selector: "td" })).closest("tr") as HTMLElement;
    const btn = within(row).getByRole("button", { name: "Revoke" });
    await userEvent.click(btn);
    expect(calls).not.toContain("DELETE /keys/7");
    await userEvent.click(btn);
    await waitFor(() => expect(calls).toContain("DELETE /keys/7"));
    await waitFor(() => expect(calls.filter((c) => c === "GET /keys").length).toBeGreaterThanOrEqual(2));
  });
});
