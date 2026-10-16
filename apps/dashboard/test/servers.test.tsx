import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { admin, renderAt, stubApi, type Reply } from "./helpers";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const fx = {
  slug: "fx",
  enabled: true,
  status: "connected",
  tools: [
    { name: "fx__convert_currency", description: "Convert an amount" },
    { name: "fx__list_rates", description: "List rates" },
  ],
  url: "http://fx-mcp:3000/mcp",
  headerName: "Authorization",
  hasCredential: true,
};
const notes = { ...fx, slug: "notes", status: "unreachable", tools: [], url: "http://notes-mcp:3000/mcp", headerName: null, hasCredential: false };

// A fake gateway: logged in as admin, GET /servers answers with `list`, writes answer with `write`.
function gateway(list: unknown[], write: (path: string, init: RequestInit) => Reply = () => ({ status: 200, body: {} })) {
  return (path: string, init: RequestInit): Reply => {
    if (path === "/me") return { status: 200, body: admin };
    if (path === "/servers" && (init.method ?? "GET") === "GET") return { status: 200, body: list };
    return write(path, init);
  };
}

const bodyOf = (init: RequestInit | undefined) => JSON.parse(String(init?.body));

async function openServers() {
  renderAt("/servers");
  await screen.findByRole("heading", { name: "Servers" });
}

async function openEdit(slug: string) {
  const row = (await screen.findByText(slug, { selector: "td" })).closest("tr") as HTMLElement;
  await userEvent.click(within(row).getByRole("button", { name: "Edit" }));
}

describe("list", () => {
  it("shows status and tool names for each server", async () => {
    stubApi(gateway([fx, notes]));
    await openServers();
    const row = (await screen.findByText("fx", { selector: "td" })).closest("tr") as HTMLElement;
    expect(within(row).getByText("connected")).toBeInTheDocument();
    expect(within(row).getByText("fx__list_rates")).toBeInTheDocument();
    const other = screen.getByText("notes", { selector: "td" }).closest("tr") as HTMLElement;
    expect(within(other).getByText("unreachable")).toBeInTheDocument();
  });

  it("shows 'No servers yet' and the add form when there are none", async () => {
    stubApi(gateway([]));
    await openServers();
    expect(await screen.findByText("No servers yet")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add server" })).toBeInTheDocument();
  });
});

describe("add", () => {
  it("posts a bearer credential, then reloads the list", async () => {
    const token = crypto.randomUUID();
    const { calls, inits } = stubApi(gateway([], () => ({ status: 201, body: {} })));
    await openServers();
    await screen.findByText("No servers yet");
    await userEvent.type(screen.getByLabelText("Slug"), "fx");
    await userEvent.type(screen.getByLabelText("URL"), "http://fx-mcp:3000/mcp");
    await userEvent.click(screen.getByLabelText("Bearer token"));
    await userEvent.type(screen.getByLabelText("Token"), token);
    await userEvent.click(screen.getByRole("button", { name: "Add server" }));
    await waitFor(() => expect(calls).toContain("POST /servers"));
    const post = inits[calls.indexOf("POST /servers")];
    expect(bodyOf(post)).toEqual({ slug: "fx", url: "http://fx-mcp:3000/mcp", auth: { type: "bearer", token } });
    await waitFor(() => expect(calls.filter((c) => c === "GET /servers").length).toBeGreaterThanOrEqual(2));
  });
});

describe("edit", () => {
  it("shows the slug read-only and never pre-fills a credential", async () => {
    stubApi(gateway([fx]));
    await openServers();
    await openEdit("fx");
    expect(screen.getByTestId("edit-slug")).toHaveTextContent("fx");
    expect(screen.queryByLabelText("Slug")).not.toBeInTheDocument();
    expect(screen.getByLabelText("URL")).toHaveValue("http://fx-mcp:3000/mcp");
    expect(screen.getByLabelText("Keep the stored credential")).toBeChecked();
    expect(document.querySelectorAll('input[type="password"]').length).toBe(0);
    await userEvent.click(screen.getByLabelText("Replace"));
    for (const input of document.querySelectorAll('input[type="password"]')) expect(input).toHaveValue("");
  });

  it("sends nothing when the url is unchanged and Keep is selected", async () => {
    const { calls } = stubApi(gateway([fx]));
    await openServers();
    await openEdit("fx");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("nothing to save")).toBeInTheDocument();
    expect(calls.filter((c) => c.startsWith("PATCH"))).toEqual([]);
  });

  it("changing the url disables Keep, and Replace sends url and auth", async () => {
    const token = crypto.randomUUID();
    const { calls, inits } = stubApi(gateway([fx]));
    await openServers();
    await openEdit("fx");
    const url = screen.getByLabelText("URL");
    await userEvent.clear(url);
    await userEvent.type(url, "http://fx-mcp:3000/other");
    expect(screen.getByLabelText("Keep the stored credential")).toBeDisabled();
    expect(screen.getByLabelText("Replace")).toBeChecked();
    await userEvent.click(screen.getByLabelText("Bearer token"));
    await userEvent.type(screen.getByLabelText("Token"), token);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls).toContain("PATCH /servers/fx"));
    expect(bodyOf(inits[calls.indexOf("PATCH /servers/fx")])).toEqual({
      url: "http://fx-mcp:3000/other",
      auth: { type: "bearer", token },
    });
  });

  it("Remove sends auth: null, also together with a url change", async () => {
    const { calls, inits } = stubApi(gateway([fx]));
    await openServers();
    await openEdit("fx");
    const url = screen.getByLabelText("URL");
    await userEvent.clear(url);
    await userEvent.type(url, "http://fx-mcp:3000/other");
    await userEvent.click(screen.getByLabelText("Remove"));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls).toContain("PATCH /servers/fx"));
    expect(bodyOf(inits[calls.indexOf("PATCH /servers/fx")])).toEqual({ url: "http://fx-mcp:3000/other", auth: null });
  });

  it("credential inputs use autocomplete=new-password and are emptied after a failed save", async () => {
    const token = crypto.randomUUID();
    stubApi(gateway([fx], () => ({ status: 400, body: { error: "must be an http(s) URL" } })));
    await openServers();
    await openEdit("fx");
    await userEvent.click(screen.getByLabelText("Replace"));
    await userEvent.click(screen.getByLabelText("Bearer token"));
    const field = screen.getByLabelText("Token");
    expect(field).toHaveAttribute("autocomplete", "new-password");
    expect(field).toHaveAttribute("type", "password");
    await userEvent.type(field, token);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("must be an http(s) URL");
    expect(screen.getByLabelText("Token")).toHaveValue("");
  });
});

describe("enable, disable, delete", () => {
  it("Disable sends PATCH enabled:false", async () => {
    const { calls, inits } = stubApi(gateway([fx]));
    await openServers();
    const row = (await screen.findByText("fx", { selector: "td" })).closest("tr") as HTMLElement;
    await userEvent.click(within(row).getByRole("button", { name: "Disable" }));
    await waitFor(() => expect(calls).toContain("PATCH /servers/fx"));
    expect(bodyOf(inits[calls.indexOf("PATCH /servers/fx")])).toEqual({ enabled: false });
  });

  it("Delete asks first and sends DELETE only after a yes", async () => {
    const { calls } = stubApi(gateway([fx], () => ({ status: 204 })));
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    await openServers();
    const row = (await screen.findByText("fx", { selector: "td" })).closest("tr") as HTMLElement;
    await userEvent.click(within(row).getByRole("button", { name: "Delete" }));
    expect(calls).not.toContain("DELETE /servers/fx");
    await userEvent.click(within(row).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(calls).toContain("DELETE /servers/fx"));
    expect(confirm).toHaveBeenCalledTimes(2);
  });
});

describe("polling", () => {
  const gets = (calls: string[]) => calls.filter((c) => c === "GET /servers").length;

  it("polls every 5s, skips while hidden, and never stacks requests", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let release: (r: Reply) => void = () => {};
    let slow = false;
    const { calls } = stubApi((path, init) => {
      if (slow && path === "/servers") return new Promise<Reply>((r) => (release = r));
      return gateway([fx])(path, init);
    });
    await openServers();
    await screen.findByText("fx", { selector: "td" });
    const base = gets(calls);

    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(gets(calls)).toBe(base + 1);

    // hidden tab: ticks do nothing
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(() => vi.advanceTimersByTimeAsync(10000));
    expect(gets(calls)).toBe(base + 1);
    visibility.mockReturnValue("visible");

    // slow gateway: one request in flight, later ticks do not start another
    slow = true;
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(gets(calls)).toBe(base + 2);
    await act(() => vi.advanceTimersByTimeAsync(15000));
    expect(gets(calls)).toBe(base + 2);
    release({ status: 200, body: [fx] });
  });

  it("a poll does not reset text typed into an open edit form", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { calls } = stubApi(gateway([fx]));
    await openServers();
    await openEdit("fx");
    const url = screen.getByLabelText("URL");
    await userEvent.clear(url);
    await userEvent.type(url, "http://typing-in-progress");
    const before = gets(calls);
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(gets(calls)).toBe(before + 1);
    expect(screen.getByLabelText("URL")).toHaveValue("http://typing-in-progress");
  });

  it("stops polling after unmount", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { calls } = stubApi(gateway([fx]));
    const { unmount } = (await import("./helpers")).renderAt("/servers");
    await screen.findByText("fx", { selector: "td" });
    unmount();
    const before = gets(calls);
    await act(() => vi.advanceTimersByTimeAsync(20000));
    expect(gets(calls)).toBe(before);
  });
});
