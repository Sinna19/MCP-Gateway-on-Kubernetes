import type { ChatMessage, LlmFn, ToolCall } from "./types.js";

export interface LlmConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}

// OpenAI-compatible /chat/completions over plain fetch. Errors carry the status only, never the body or the key.
export function createLlm({ baseUrl, model, apiKey }: LlmConfig): LlmFn {
  const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
  return async (messages, tools, signal) => {
    const body = { model, messages, ...(tools.length > 0 ? { tools, parallel_tool_calls: false } : {}) };
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      redirect: "error",
      signal,
    });
    if (!res.ok) throw new Error(`llm responded ${res.status}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string | null; tool_calls?: unknown } }[] };
    const message = data.choices?.[0]?.message;
    if (!message) throw new Error("llm response had no message");
    return normalize(message);
  };
}

function normalize(message: { content?: string | null; tool_calls?: unknown }): ChatMessage {
  const calls: ToolCall[] = [];
  if (Array.isArray(message.tool_calls)) {
    for (const c of message.tool_calls as { id?: unknown; function?: { name?: unknown; arguments?: unknown } }[]) {
      if (typeof c?.id === "string" && typeof c.function?.name === "string") {
        calls.push({ id: c.id, type: "function", function: { name: c.function.name, arguments: typeof c.function.arguments === "string" ? c.function.arguments : "{}" } });
      }
    }
  }
  return { role: "assistant", content: message.content ?? null, ...(calls.length > 0 ? { tool_calls: calls } : {}) };
}
