import type { RefMap } from "./types";
import { randomId } from "./utils";

export type ContinuationEntry = {
  id: string;
  url: string;
  text: string;
  refMap: RefMap;
  createdAt: number;
};

export class ContinuationStore {
  private entries = new Map<string, ContinuationEntry>();
  constructor(private readonly maxAgeMs = 15 * 60 * 1000) {}

  create(url: string, text: string, refMap: RefMap): ContinuationEntry {
    this.gc();
    const entry = { id: randomId("cont"), url, text, refMap, createdAt: Date.now() };
    this.entries.set(entry.id, entry);
    return entry;
  }

  get(id: string): ContinuationEntry | undefined {
    this.gc();
    return this.entries.get(id);
  }

  clear(): void {
    this.entries.clear();
  }

  private gc(): void {
    const cutoff = Date.now() - this.maxAgeMs;
    for (const [id, entry] of this.entries) {
      if (entry.createdAt < cutoff) this.entries.delete(id);
    }
  }
}

export const CONTINUATION_CHUNK_CHARS = 48_000;
