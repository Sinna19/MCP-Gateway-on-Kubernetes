// An expected chat failure with the HTTP status the route should answer with.
export class ChatError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
