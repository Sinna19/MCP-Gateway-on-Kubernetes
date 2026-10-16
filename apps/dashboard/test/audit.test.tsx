import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { admin, member, renderAt, stubApi, type Reply } from "./helpers";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const row = (id: number, over: Record<string, unknown> = {}) => ({
  id: String(id),
  user: "bob@urumi.local",
  server: "woo",
  tool: "list_products",
  startedAt: "2026-10-10T10:00:00Z",
  durationMs: 12,
  outcome: "ok",
  error: null,
  source: "mcp",
  ...over,
});

const members = [
  { id: "1", email: admin.email, role: "admin", disabled: false, activeKeys: 1 },
  { id: "2", email: member.email, role: "member", disabled: false, activeKeys: 1 },
];

function gateway(me: typeof admin, audit: (path: string) => Reply | Promise<Reply>) {
  return (path: string): Reply | Promise<Reply> => {
    if (path === "/me") return { status: 200, body: me };
    if (path === "/members") return { status: 200, body: members };
    if (path.startsWith("/audit")) return audit(path);
    return { status: 404, body: { error: "nope" } };
  };
}

async function openAudit() {
  renderAt("/audit");
  await screen.findByRole("heading", { name: "Audit log" });
}

describe("audit page", () => {
  it("shows rows with user, source, server, tool, duration and outcome", async () => {
    stubApi(gateway(admin, () => ({ status: 200, body: [row(2, { source: "chat", tool: "convert" }), row(1)] })));
    await openAudit();
    expect(await screen.findByText("convert", { selector: "td" })).toBeInTheDocument();
    expect(screen.getByText("chat", { selector: "td" })).toBeInTheDocument();
    expect(screen.getAllByText("12 ms", { selector: "td" })).toHaveLength(2);
  });

  it("sends filters to the API with a limit, and starts again from the newest", async () => {
    const { calls } = stubApi(gateway(admin, () => ({ status: 200, body: [row(1)] })));
    await openAudit();
    await screen.findByText("list_products", { selector: "td" });
    await userEvent.selectOptions(screen.getByLabelText("Outcome"), "error");
    await userEvent.selectOptions(screen.getByLabelText("Source"), "chat");
    await userEvent.selectOptions(screen.getByLabelText("User"), "2");
    await userEvent.type(screen.getByLabelText("Server"), "fx");
    await waitFor(() => {
      const last = calls.filter((c) => c.startsWith("GET /audit")).at(-1) ?? "";
      const params = new URLSearchParams(last.split("?")[1]);
      expect(Object.fromEntries(params)).toEqual({ outcome: "error", source: "chat", user: "2", server: "fx", limit: "50" });
    });
  });

  it("Load older asks for before=<last id>, appends, and disappears after a short page", async () => {
    const full = Array.from({ length: 50 }, (_, i) => row(100 - i, { tool: `t${100 - i}` }));
    const { calls } = stubApi(
      gateway(admin, (path) => (path.includes("before=") ? { status: 200, body: [row(50, { tool: "last-one" })] } : { status: 200, body: full })),
    );
    await openAudit();
    await screen.findByText("t100", { selector: "td" });
    await userEvent.click(screen.getByRole("button", { name: "Load older" }));
    expect(await screen.findByText("last-one", { selector: "td" })).toBeInTheDocument();
    expect(screen.getByText("t100", { selector: "td" })).toBeInTheDocument();
    expect(calls.some((c) => c.includes("before=51"))).toBe(true);
    expect(screen.queryByRole("button", { name: "Load older" })).not.toBeInTheDocument();
  });

  it("a member gets no User filter and never asks for the member list", async () => {
    const { calls } = stubApi(gateway(member, () => ({ status: 200, body: [row(1)] })));
    await openAudit();
    await screen.findByText("list_products", { selector: "td" });
    expect(screen.queryByLabelText("User")).not.toBeInTheDocument();
    expect(calls).not.toContain("GET /members");
  });

  it("renders untrusted text as text, never as HTML", async () => {
    const evil = "<img src=x onerror=alert(1)>";
    stubApi(gateway(admin, () => ({ status: 200, body: [row(1, { outcome: "error", error: evil, tool: "<b>bold</b>", server: "<i>s</i>" })] })));
    await openAudit();
    expect(await screen.findByText(evil, { selector: "td" })).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("tbody b, tbody i")).toBeNull();
  });

  it("shows (deleted) for a removed user and - for a missing server", async () => {
    stubApi(gateway(admin, () => ({ status: 200, body: [row(1, { user: null, server: null })] })));
    await openAudit();
    expect(await screen.findByText("(deleted)", { selector: "td" })).toBeInTheDocument();
    expect(screen.getByText("-", { selector: "td" })).toBeInTheDocument();
  });

  it("keeps only the latest filter's result when an older response lands last", async () => {
    const resolvers: Record<string, (r: Reply) => void> = {};
    stubApi(
      gateway(admin, (path) => {
        if (path.includes("outcome=error")) return new Promise<Reply>((resolve) => (resolvers.error = resolve));
        if (path.includes("outcome=ok")) return new Promise<Reply>((resolve) => (resolvers.ok = resolve));
        return { status: 200, body: [] };
      }),
    );
    await openAudit();
    await userEvent.selectOptions(screen.getByLabelText("Outcome"), "error");
    await userEvent.selectOptions(screen.getByLabelText("Outcome"), "ok");
    await waitFor(() => expect(resolvers.ok).toBeDefined());
    resolvers.ok?.({ status: 200, body: [row(2, { tool: "second-filter" })] });
    await screen.findByText("second-filter", { selector: "td" });
    resolvers.error?.({ status: 200, body: [row(1, { tool: "first-filter" })] });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText("first-filter")).not.toBeInTheDocument();
    expect(screen.getByText("second-filter", { selector: "td" })).toBeInTheDocument();
  });

  it("drops an in-flight Load older when a filter changes", async () => {
    const full = Array.from({ length: 50 }, (_, i) => row(100 - i, { tool: `t${100 - i}` }));
    let release: (r: Reply) => void = () => {};
    stubApi(
      gateway(admin, (path) => {
        if (path.includes("before=")) return new Promise<Reply>((resolve) => (release = resolve));
        if (path.includes("outcome=error")) return { status: 200, body: [row(9, { tool: "filtered" })] };
        return { status: 200, body: full };
      }),
    );
    await openAudit();
    await screen.findByText("t100", { selector: "td" });
    await userEvent.click(screen.getByRole("button", { name: "Load older" }));
    await userEvent.selectOptions(screen.getByLabelText("Outcome"), "error");
    await screen.findByText("filtered", { selector: "td" });
    release({ status: 200, body: [row(5, { tool: "stale-page" })] });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText("stale-page")).not.toBeInTheDocument();
  });
});
