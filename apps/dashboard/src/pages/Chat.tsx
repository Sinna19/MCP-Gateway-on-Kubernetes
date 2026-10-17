import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api";

// The OpenAI-shaped messages the server expects back on the next request.
interface Msg {
  role: "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: unknown[];
  tool_call_id?: string;
}

interface ToolCallView {
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  summary: string;
}

interface Pending {
  id: string;
  tool: string;
  args: Record<string, unknown>;
}

interface ChatResponse {
  reply: string;
  messages: Msg[];
  toolCalls: ToolCallView[];
  pendingToolCall?: Pending;
}

// What is drawn on screen. Every string below is rendered as a React text child: no markdown, no links, no HTML.
type Entry = { kind: "user" | "assistant"; text: string } | ({ kind: "tool" } & ToolCallView);

function errorText(err: unknown, confirming: boolean): string {
  if (!(err instanceof ApiError)) return "Request failed, try again";
  if (err.status === 503) return "Chat isn't configured";
  if (err.status === 429) return "Chat is busy or rate limited, try again in a moment";
  if (err.status === 413) return "Conversation too long, start a new chat";
  if (err.status === 404 && confirming) return "Confirmation expired, ask again";
  return err.message;
}

const MAX_ARGS_CHARS = 2048;

// Only the display is cut; the server runs the full stored args when you confirm.
function ArgsBlock({ args }: { args: Record<string, unknown> }) {
  const full = JSON.stringify(args, null, 2);
  const shown = full.length > MAX_ARGS_CHARS ? `${full.slice(0, MAX_ARGS_CHARS)}
(truncated, ${full.length} chars)` : full;
  return <pre>{shown}</pre>;
}

export function Chat() {
  const [history, setHistory] = useState<Msg[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // A ref, not state: two clicks in the same tick both see the old state, but they see the same ref.
  const inFlight = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" }); // jsdom has no scrollIntoView
  }, [entries, pending, busy]);

  useEffect(() => {
    if (!busy && !pending) inputRef.current?.focus();
  }, [busy, pending]);

  // One request. `sent` is the history the server gets; `shown` are the entries to add if it works.
  const run = async (sent: Msg[], shown: Entry[], confirm?: { id: string; approve: boolean }) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const res = await api<ChatResponse>("/chat", { method: "POST", body: confirm ? { messages: sent, confirm } : { messages: sent } });
      // While a write is pending the server returns no messages; it keeps the turn and returns all of it after the confirm.
      setHistory([...sent, ...res.messages]);
      const cards: Entry[] = res.toolCalls.map((c) => ({ kind: "tool", ...c }));
      const reply: Entry[] = res.reply ? [{ kind: "assistant", text: res.reply }] : [];
      setEntries((old) => [...old, ...shown, ...cards, ...reply]);
      setPending(res.pendingToolCall ?? null);
      if (!confirm) setInput("");
    } catch (err) {
      setError(errorText(err, confirm !== undefined));
      if (confirm && err instanceof ApiError && err.status === 404) setPending(null);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const send = () => {
    const text = input.trim();
    if (!text || busy || pending) return;
    void run([...history, { role: "user", content: text }], [{ kind: "user", text }]);
  };

  const answer = (approve: boolean) => {
    if (!pending) return;
    void run(history, [], { id: pending.id, approve });
  };

  const newChat = () => {
    setHistory([]);
    setEntries([]);
    setPending(null);
    setInput("");
    setError("");
  };

  return (
    <>
      <h1>Chat</h1>
      <button onClick={newChat} disabled={busy}>
        New chat
      </button>
      <div className="chat-log">
        {entries.map((e, i) =>
          e.kind === "tool" ? (
            <div key={i} className="chat-card" data-testid="tool-card">
              <strong>{e.tool}</strong> <span>{e.ok ? "ok" : "error"}</span>
              <ArgsBlock args={e.args} />
              <p>{e.summary}</p>
            </div>
          ) : (
            <p key={i} className={`chat-${e.kind}`}>
              <strong>{e.kind === "user" ? "You" : "Assistant"}:</strong> {e.text}
            </p>
          ),
        )}
        {pending && (
          <div className="chat-card chat-pending" data-testid="pending-card">
            <p>Waiting for your OK to run:</p>
            <strong>{pending.tool}</strong>
            <button onClick={() => answer(true)} disabled={busy}>
              Confirm
            </button>{" "}
            <button onClick={() => answer(false)} disabled={busy}>
              Decline
            </button>
            <ArgsBlock args={pending.args} />
          </div>
        )}
        {busy && <p role="status">Thinking…</p>}
        <div ref={endRef} />
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="chat-input">
        <label>
          Message
          <textarea
            ref={inputRef}
            value={input}
            rows={3}
            disabled={busy || pending !== null}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
          />
        </label>
        <button onClick={send} disabled={busy || pending !== null || input.trim() === ""}>
          Send
        </button>
        {pending && <p>Confirm or decline the action above first</p>}
      </div>
    </>
  );
}
