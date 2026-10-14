export class TtlCache<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 100,
    private readonly now: () => number = Date.now,
    /** How long past its TTL an entry is kept for `getStale` (stale-while-revalidate); `get` never returns it. */
    private readonly graceMs = 0,
  ) {}

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      if (entry.expiresAt + this.graceMs <= this.now()) this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /** The value even if it has expired, as long as it is within the grace period; `fresh` says which. */
  getStale(key: string): { value: V; fresh: boolean } | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    const t = this.now();
    if (entry.expiresAt > t) return { value: entry.value, fresh: true };
    if (entry.expiresAt + this.graceMs > t) return { value: entry.value, fresh: false };
    this.entries.delete(key);
    return undefined;
  }

  set(key: string, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}
