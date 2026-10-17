// An expected chat failure with the HTTP status the route should answer with.
export class ChatError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// A failed LLM provider call. Carries the HTTP status only, never the response body or the key.
export class LlmError extends Error {
  constructor(readonly status: number) {
    super(`llm responded ${status}`);
  }
}
