import { randomUUID } from "node:crypto";
import { ChatError } from "./errors.js";
import type { ChatMessage } from "./types.js";

export interface PendingEntry {
  userId: number;
  tool: string;
  args: Record<string, unknown>;
  toolCallId: string;
  messages: ChatMessage[]; // the whole conversation as the provider needs it, minus the call we are waiting on
  turnStart: number; // index in `messages` where this turn's new messages begin
}

interface Stored extends PendingEntry {
  expiresAt: number;
}

// Write calls the LLM asked for and the user has not confirmed yet. In memory on purpose (gateway runs 1 replica).
export class PendingStore {
  private readonly entries = new Map<string, Stored>(); // insertion order = oldest first

  constructor(
    private readonly ttlMs = 5 * 60_000,
    private readonly maxPerUser = 5,
    private readonly now: () => number = Date.now,
  ) {}

  add(entry: PendingEntry): string {
    this.sweep();
    const mine = [...this.entries].filter(([, e]) => e.userId === entry.userId);
    for (const [oldId] of mine.slice(0, Math.max(0, mine.length - this.maxPerUser + 1))) this.entries.delete(oldId);
    const id = randomUUID();
    this.entries.set(id, { ...entry, expiresAt: this.now() + this.ttlMs });
    return id;
  }

  // Single use. Someone else's id looks the same as an unknown one.
  take(userId: number, id: string): PendingEntry {
    this.sweep();
    const found = this.entries.get(id);
    if (!found || found.userId !== userId) throw new ChatError(404, "confirmation not found or expired, ask again");
    this.entries.delete(id);
    return found;
  }

  size(): number {
    this.sweep();
    return this.entries.size;
  }

  private sweep(): void {
    const t = this.now();
    for (const [id, e] of this.entries) if (e.expiresAt <= t) this.entries.delete(id);
  }
}
