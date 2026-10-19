import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import type { AuthUser } from "../api-keys.js";
import type { CallSource } from "../gateway.js";
import { ChatError, LlmError } from "./errors.js";
import type { PendingStore } from "./pending.js";
import { SYSTEM_PROMPT, cleanText, resultText, toLlmTools, wrapToolResult } from "./prompt.js";
import type { ChatMessage, LlmFn, ToolCall } from "./types.js";

export type { LlmFn } from "./types.js";

const MAX_HISTORY = 20;
const SUMMARY_CHARS = 200;
const ONE_WRITE = "not run: confirm one write at a time";
const MAX_CALLS_PER_STEP = 5;
const TOO_MANY = "not run: too many tool calls in one step";
const OUT_OF_TIME = "not run: out of time";
const STOPPED = "This took too long, so I stopped. Ask again to continue.";

// What the agent needs from the Gateway class (the same object /mcp uses).
export interface ChatGateway {
  listTools(): Tool[];
  callTool(user: AuthUser, name: string, args: Record<string, unknown> | undefined, source: CallSource): Promise<CallToolResult>;
}

export interface AgentOptions {
  gateway: ChatGateway;
  llm: LlmFn;
  readOnlyTools: Set<string>; // from config: the gateway decides what needs a confirm, not the LLM and not the upstream
  pending: PendingStore;
  maxSteps?: number;
  llmTimeoutMs?: number;
  budgetMs?: number;
  now?: () => number; // tests move the clock to hit the deadline
  beforeTurn?: (user: AuthUser) => Promise<void>; // runs once per request before any LLM call; throws ChatError to refuse (the daily cap)
}

export interface ChatInput {
  user: AuthUser;
  messages: ChatMessage[];
  confirm?: { id: string; approve: boolean };
}

export interface ToolCallView {
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  summary: string;
}

export interface ChatResult {
  reply: string;
  messages: ChatMessage[]; // this turn's new messages, for the client to append; empty while a confirm is pending
  toolCalls: ToolCallView[]; // calls made during this request
  steps: number; // LLM calls made during this request (for the one log line)
  pendingToolCall?: { id: string; tool: string; args: Record<string, unknown> };
}

// The client's history is context only: rebuilt field by field, capped, and never executed.
function sanitizeHistory(messages: ChatMessage[]): ChatMessage[] {
  const clean: ChatMessage[] = messages.map((m) => {
    if (m.role === "user") return { role: "user", content: String(m.content ?? "") };
    if (m.role === "tool") return { role: "tool", tool_call_id: String(m.tool_call_id ?? ""), content: String(m.content ?? "") };
    if (m.role === "assistant") {
      const calls = (m.tool_calls ?? []).map((c) => ({ id: String(c.id), type: "function" as const, function: { name: String(c.function.name), arguments: String(c.function.arguments) } }));
      return { role: "assistant", content: m.content === null ? null : String(m.content), ...(calls.length > 0 ? { tool_calls: calls } : {}) };
    }
    throw new ChatError(400, "unsupported message role");
  });
  const recent = clean.slice(-MAX_HISTORY);
  while (recent.length > 0 && recent[0]!.role !== "user") recent.shift();
  if (recent.at(-1)?.role !== "user") throw new ChatError(400, "the last message must be from the user");
  return recent;
}

function parseArgs(call: ToolCall): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(call.function.arguments || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export class ChatAgent {
  private readonly inFlight = new Set<number>();
  private readonly maxSteps: number;
  private readonly llmTimeoutMs: number;
  private readonly budgetMs: number;
  private readonly now: () => number;

  constructor(private readonly options: AgentOptions) {
    this.maxSteps = options.maxSteps ?? 8;
    this.llmTimeoutMs = options.llmTimeoutMs ?? 20_000;
    this.budgetMs = options.budgetMs ?? 55_000;
    this.now = options.now ?? Date.now;
  }

  // One request per user at a time, so a stuck tab cannot keep spending LLM credits.
  async run(input: ChatInput): Promise<ChatResult> {
    const userId = input.user.id;
    if (this.inFlight.has(userId)) throw new ChatError(429, "chat busy: wait for the previous reply");
    this.inFlight.add(userId);
    try {
      // After the busy check, so a refused-as-busy request spends no turn; before runTurn, so a capped confirm keeps its pending entry.
      await this.options.beforeTurn?.(input.user);
      return await this.runTurn(input);
    } finally {
      this.inFlight.delete(userId);
    }
  }

  private async runTurn({ user, messages, confirm }: ChatInput): Promise<ChatResult> {
    const deadline = this.now() + this.budgetMs;
    const toolCalls: ToolCallView[] = [];
    let convo: ChatMessage[];
    let turnStart: number;
    let steps = 0;

    if (confirm) {
      // Resume exactly what the server proposed; the messages and args the client sent are ignored.
      const entry = this.options.pending.take(user.id, confirm.id);
      convo = entry.messages;
      turnStart = entry.turnStart;
      if (confirm.approve) {
        await this.execute(user, entry.tool, entry.args, entry.toolCallId, convo, toolCalls, deadline);
      } else {
        convo.push({ role: "tool", tool_call_id: entry.toolCallId, content: "user declined" });
        toolCalls.push({ tool: entry.tool, args: entry.args, ok: false, summary: "declined by the user" });
      }
    } else {
      // A new message supersedes anything still waiting for a click.
      this.options.pending.clearUser(user.id);
      convo = sanitizeHistory(messages);
      turnStart = convo.length;
    }

    const finish = (reply: string, addMessage: boolean): ChatResult => {
      if (addMessage) convo.push({ role: "assistant", content: reply });
      return { reply, messages: convo.slice(turnStart), toolCalls, steps };
    };

    for (let step = 0; step < this.maxSteps; step++) {
      const left = deadline - this.now();
      if (left <= 0) return finish(STOPPED, true);
      const tools = this.options.gateway.listTools();
      const signal = AbortSignal.any([AbortSignal.timeout(this.llmTimeoutMs), AbortSignal.timeout(left)]);

      let assistant: ChatMessage;
      steps++;
      try {
        assistant = await this.options.llm([{ role: "system", content: SYSTEM_PROMPT }, ...convo], toLlmTools(tools), signal);
      } catch (err) {
        console.error("chat: llm call failed:", err instanceof Error ? err.message : err);
        if (signal.aborted) return finish("The model took too long to answer.", true);
        if (err instanceof LlmError && err.status === 429) return finish("The model is rate limited, try again in a moment.", true);
        return finish("The model call failed.", true);
      }
      convo.push(assistant);
      const calls = assistant.tool_calls ?? [];
      if (calls.length === 0) return finish(assistant.content ?? "", false);

      const known = new Set(tools.map((t) => t.name));
      let pendingCall: { call: ToolCall; args: Record<string, unknown> } | null = null;
      for (const [i, call] of calls.entries()) {
        const name = call.function.name;
        const args = parseArgs(call);
        if (i >= MAX_CALLS_PER_STEP) {
          this.refuse(convo, toolCalls, name, call.id, args ?? {}, TOO_MANY);
        } else if (!args) {
          this.refuse(convo, toolCalls, name, call.id, {}, "invalid arguments: must be a JSON object");
        } else if (this.options.readOnlyTools.has(name) || !known.has(name)) {
          // Unknown names go through callTool too: it answers with an error and audits the attempt.
          await this.execute(user, name, args, call.id, convo, toolCalls, deadline);
        } else if (!pendingCall) {
          pendingCall = { call, args };
        } else {
          this.refuse(convo, toolCalls, name, call.id, args, ONE_WRITE);
        }
      }
      if (pendingCall) {
        const { call, args } = pendingCall;
        const id = this.options.pending.add({ userId: user.id, tool: call.function.name, args, toolCallId: call.id, messages: convo, turnStart });
        return { reply: "", messages: [], toolCalls, steps, pendingToolCall: { id, tool: call.function.name, args } };
      }
    }
    return finish(`I stopped after ${this.maxSteps} steps without a final answer.`, true);
  }

  private async execute(user: AuthUser, name: string, args: Record<string, unknown>, callId: string, convo: ChatMessage[], views: ToolCallView[], deadline: number): Promise<void> {
    // Checked before every call: a step with several slow calls cannot run past the budget.
    if (this.now() >= deadline) return this.refuse(convo, views, name, callId, args, OUT_OF_TIME);
    const result = await this.options.gateway.callTool(user, name, args, "chat");
    convo.push({ role: "tool", tool_call_id: callId, content: wrapToolResult(name, result) });
    views.push({ tool: name, args, ok: !result.isError, summary: cleanText(resultText(result), SUMMARY_CHARS) });
  }

  private refuse(convo: ChatMessage[], views: ToolCallView[], name: string, callId: string, args: Record<string, unknown>, why: string): void {
    convo.push({ role: "tool", tool_call_id: callId, content: why });
    views.push({ tool: name.slice(0, 100), args, ok: false, summary: why });
  }
}
