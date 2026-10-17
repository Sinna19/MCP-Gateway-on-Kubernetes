// The OpenAI-compatible chat message shapes the agent sends to and receives from the LLM.
export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface LlmTool {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
}

export type LlmFn = (messages: ChatMessage[], tools: LlmTool[], signal: AbortSignal) => Promise<ChatMessage>;
