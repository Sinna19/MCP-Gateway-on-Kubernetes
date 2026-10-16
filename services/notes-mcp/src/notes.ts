export const MAX_TEXT = 2000;
export const MAX_NOTES = 500;
export const MAX_PRODUCT = 100;
export const MAX_LIST = 50;

export interface Note {
  id: number;
  text: string;
  product?: string;
  createdAt: string;
}

// Notes live in memory only: they are lost on restart and shared by every caller.
export class NoteStore {
  private notes: Note[] = [];
  private nextId = 1;
  // lowercased tag -> the spelling first used, so "Mug" and "mug" are one product.
  private canonical = new Map<string, string>();

  add(text: string, product?: string): Note {
    const body = text.trim();
    if (!body) throw new Error("Note text is empty");
    if (body.length > MAX_TEXT) throw new Error(`Note text is longer than ${MAX_TEXT} characters`);
    if (this.notes.length >= MAX_NOTES) throw new Error(`Note store is full (${MAX_NOTES} notes)`);
    const tag = product?.trim();
    if (tag && tag.length > MAX_PRODUCT) throw new Error(`Product is longer than ${MAX_PRODUCT} characters`);

    const note: Note = { id: this.nextId++, text: body, createdAt: new Date().toISOString() };
    if (tag) {
      const key = tag.toLowerCase();
      if (!this.canonical.has(key)) this.canonical.set(key, tag);
      note.product = this.canonical.get(key);
    }
    this.notes.push(note);
    return note;
  }

  // Newest first, never more than MAX_LIST so tool output stays small.
  list(opts: { product?: string; limit?: number }): Note[] {
    const key = opts.product?.trim().toLowerCase();
    const limit = Math.min(opts.limit ?? MAX_LIST, MAX_LIST);
    return this.notes
      .filter((n) => !key || n.product?.toLowerCase() === key)
      .reverse()
      .slice(0, limit);
  }

  products(): { product: string; notes: number }[] {
    const counts = new Map<string, number>();
    for (const n of this.notes) if (n.product) counts.set(n.product, (counts.get(n.product) ?? 0) + 1);
    return [...counts].map(([product, notes]) => ({ product, notes })).sort((a, b) => a.product.localeCompare(b.product));
  }
}
