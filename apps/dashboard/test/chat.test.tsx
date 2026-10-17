import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { admin, member, renderAt, stubApi, type Reply } from "./helpers";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const bodyOf = (init: RequestInit | undefined) => JSON.parse(String(init?.body));
type ChatBody = { messages: { role: string }[]; confirm?: { id: string; approve: boolean } };
const uuid = "6f1c2a52-6f0e-4a0b-9d0e-3b7f1a2c4d5e";

// A fake gateway: logged in as `who`, and `chat` answers POST /chat.
function gateway(chat: (body: ChatBody) => Reply | Promise<Reply>, who = admin) {
  return (path: string, init: RequestInit): Reply | Promise<Reply> => {
    if (path === "/me") return { status: 200, body: who };
    if (path === "/chat") return chat(bodyOf(init));
    return { status: 200, body: [] };
  };
}

const readTurn = {
  reply: "You have two products.",
  messages: [
    { role: "assistant", content: null, tool_calls: [{ id: "t1", type: "function", function: { name: "woo__list_products", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "t1", content: "<tool_output>...</tool_output>" },
    { role: "assistant", content: "You have two products." },
  ],
  toolCalls: [{ tool: "woo__list_products", args: { per_page: 5 }, ok: true, summary: "2 products" }],
};

const pendingTurn = {
  reply: "",
  messages: [],
  toolCalls: [],
  pendingToolCall: { id: uuid, tool: "woo__create_product", args: { name: "Widget", regular_price: "19.99" } },
};

async function openChat(who = admin) {
  renderAt("/chat");
  await screen.findByRole("heading", { name: "Chat" });
  return who;
}

const ask = async (text: string) => {
  await userEvent.type(screen.getByLabelText("Message"), text);
  await userEvent.click(screen.getByRole("button", { name: "Send" }));
};

describe("chat page", () => {
  it("a read turn shows the reply and a tool card with name, args, ok and summary; the next send carries the history", async () => {
    let n = 0;
    const { inits, calls } = stubApi(gateway(() => (n++ === 0 ? { status: 200, body: readTurn } : { status: 200, body: { reply: "second answer", messages: [{ role: "assistant", content: "second answer" }], toolCalls: [] } })));
    await openChat();
    await ask("list products");
    expect(await screen.findByText("You have two products.")).toBeInTheDocument();
    const card = screen.getByText("woo__list_products").closest("[data-testid='tool-card']") as HTMLElement;
    expect(card).toHaveTextContent("ok");
    expect(card).toHaveTextContent("2 products");
    expect(card.querySelector("pre")?.textContent).toBe(JSON.stringify({ per_page: 5 }, null, 2));

    await ask("and orders?");
    await screen.findByText(/second answer/);
    const second = bodyOf(inits[calls.lastIndexOf("POST /chat")]);
    expect(second.messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant", "tool", "assistant", "user"]);
    expect(second.confirm).toBeUndefined();
  });

  it("a pending write shows a confirm card, blocks the input, and Confirm sends confirm:{id, approve:true} once", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { calls, inits } = stubApi(
      gateway(async (body) => {
        if (!body.confirm) return { status: 200, body: pendingTurn };
        await gate;
        return { status: 200, body: { reply: "Created Widget.", messages: [{ role: "assistant", content: "Created Widget." }], toolCalls: [{ tool: "woo__create_product", args: {}, ok: true, summary: "created" }] } };
      }),
    );
    await openChat();
    await ask("create a product");
    const confirm = await screen.findByRole("button", { name: "Confirm" });
    expect(screen.getByText("woo__create_product")).toBeInTheDocument();
    expect(screen.getByText(/Confirm or decline the action above first/)).toBeInTheDocument();
    expect(screen.getByLabelText("Message")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();

    await userEvent.dblClick(confirm);
    release();
    expect(await screen.findByText("Created Widget.")).toBeInTheDocument();
    const posts = calls.filter((c) => c === "POST /chat");
    expect(posts).toHaveLength(2); // the question and exactly one confirm
    expect(bodyOf(inits[calls.lastIndexOf("POST /chat")]).confirm).toEqual({ id: uuid, approve: true });
    expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Message")).toBeEnabled();
  });

  it("the confirm card puts Confirm above the args and cuts long args at 2 KB", async () => {
    const big = { name: "Widget", note: "x".repeat(5000) };
    stubApi(gateway(() => ({ status: 200, body: { ...pendingTurn, pendingToolCall: { ...pendingTurn.pendingToolCall, args: big } } })));
    await openChat();
    await ask("create a product");
    const confirm = await screen.findByRole("button", { name: "Confirm" });
    const card = screen.getByTestId("pending-card");
    const pre = card.querySelector("pre")!;
    const full = JSON.stringify(big, null, 2);
    expect(confirm.compareDocumentPosition(pre) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(pre.textContent!.startsWith(full.slice(0, 2048))).toBe(true);
    expect(pre.textContent).toContain(`(truncated, ${full.length} chars)`);
    expect(pre.textContent!.length).toBeLessThan(2048 + 60);
  });

  it("short args are shown whole, without a truncation note", async () => {
    stubApi(gateway(() => ({ status: 200, body: pendingTurn })));
    await openChat();
    await ask("create a product");
    await screen.findByRole("button", { name: "Confirm" });
    expect(screen.getByTestId("pending-card").querySelector("pre")!.textContent).toBe(JSON.stringify(pendingTurn.pendingToolCall.args, null, 2));
  });

  it("Decline sends approve:false", async () => {
    const { calls, inits } = stubApi(
      gateway((body) =>
        body.confirm
          ? { status: 200, body: { reply: "Okay, I did not create it.", messages: [{ role: "assistant", content: "Okay, I did not create it." }], toolCalls: [{ tool: "woo__create_product", args: {}, ok: false, summary: "declined by the user" }] } }
          : { status: 200, body: pendingTurn },
      ),
    );
    await openChat();
    await ask("create a product");
    await userEvent.click(await screen.findByRole("button", { name: "Decline" }));
    expect(await screen.findByText("Okay, I did not create it.")).toBeInTheDocument();
    expect(bodyOf(inits[calls.lastIndexOf("POST /chat")]).confirm).toEqual({ id: uuid, approve: false });
  });

  it("renders a reply containing HTML as literal text, never as an element", async () => {
    const evil = '<img src=x onerror="alert(1)">';
    stubApi(gateway(() => ({ status: 200, body: { reply: evil, messages: [{ role: "assistant", content: evil }], toolCalls: [{ tool: "a__b", args: { html: evil }, ok: true, summary: evil }] } })));
    await openChat();
    await ask("hi");
    await waitFor(() => expect(screen.getAllByText(evil, { exact: false }).length).toBeGreaterThan(0));
    expect(document.body.querySelector("img")).toBeNull();
    expect(document.body.querySelector("main a")).toBeNull(); // no links inside the page body
  });

  it("disables the input and shows Thinking while a request is in flight", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    stubApi(
      gateway(async () => {
        await gate;
        return { status: 200, body: { reply: "done", messages: [{ role: "assistant", content: "done" }], toolCalls: [] } };
      }),
    );
    await openChat();
    await ask("hi");
    expect(await screen.findByRole("status")).toHaveTextContent(/thinking/i);
    expect(screen.getByLabelText("Message")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    release();
    expect(await screen.findByText("done")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Message")).toBeEnabled());
    expect(screen.getByLabelText("Message")).toHaveFocus();
  });

  it("Enter sends and Shift+Enter adds a newline", async () => {
    const { calls } = stubApi(gateway(() => ({ status: 200, body: { reply: "r", messages: [{ role: "assistant", content: "r" }], toolCalls: [] } })));
    await openChat();
    const box = screen.getByLabelText("Message") as HTMLTextAreaElement;
    await userEvent.type(box, "one{Shift>}{Enter}{/Shift}two");
    expect(box.value).toBe("one\ntwo");
    expect(calls).not.toContain("POST /chat");
    await userEvent.type(box, "{Enter}");
    await waitFor(() => expect(calls).toContain("POST /chat"));
  });

  it("New chat clears the conversation", async () => {
    stubApi(gateway(() => ({ status: 200, body: readTurn })));
    await openChat();
    await ask("list products");
    await screen.findByText("You have two products.");
    await userEvent.click(screen.getByRole("button", { name: "New chat" }));
    expect(screen.queryByText("You have two products.")).not.toBeInTheDocument();
  });

  it("a member can use the chat page", async () => {
    stubApi(gateway(() => ({ status: 200, body: readTurn }), member));
    renderAt("/chat");
    expect(await screen.findByRole("heading", { name: "Chat" })).toBeInTheDocument();
  });
});

describe("chat errors", () => {
  const cases: [number, string][] = [
    [503, "Chat isn't configured"],
    [429, "busy or rate limited"],
    [413, "Conversation too long, start a new chat"],
  ];
  it.each(cases)("maps %i to a clear message and keeps the typed text", async (status, text) => {
    stubApi(gateway(() => ({ status, body: { error: "raw server text" } })));
    await openChat();
    await ask("hello");
    expect(await screen.findByRole("alert")).toHaveTextContent(text);
    expect(screen.getByLabelText("Message")).toBeEnabled();
    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toBe("hello");
  });

  it("404 on confirm says the confirmation expired and removes the card", async () => {
    stubApi(gateway((body) => (body.confirm ? { status: 404, body: { error: "confirmation not found or expired, ask again" } } : { status: 200, body: pendingTurn })));
    await openChat();
    await ask("create a product");
    await userEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Confirmation expired, ask again");
    expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Message")).toBeEnabled();
  });
});
