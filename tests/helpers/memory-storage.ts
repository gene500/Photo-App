/** In-memory Storage for tests (Node 25 ships a global `localStorage` stub that shadows jsdom's). `failWrites` simulates a full quota. */
export class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  failWrites: ((key: string) => boolean) | null = null;
  /** A real-looking quota: total characters of keys plus values; a write that would exceed it throws. */
  quota: number | null = null;
  used(): number { let n = 0; for (const [k, v] of this.map) n += k.length + v.length; return n; }
  get length() { return this.map.size; }
  clear() { this.map.clear(); }
  getItem(k: string) { return this.map.get(k) ?? null; }
  key(i: number) { return [...this.map.keys()][i] ?? null; }
  removeItem(k: string) { this.map.delete(k); }
  setItem(k: string, v: string) {
    if (this.failWrites?.(k)) throw new DOMException("full", "QuotaExceededError");
    if (this.quota !== null) {
      const next = this.used() - (this.map.has(k) ? k.length + this.map.get(k)!.length : 0) + k.length + String(v).length;
      if (next > this.quota) throw new DOMException("full", "QuotaExceededError");
    }
    this.map.set(k, String(v));
  }
  [name: string]: unknown;
}

export function installMemoryStorage(): MemoryStorage {
  const s = new MemoryStorage();
  Object.defineProperty(globalThis, "localStorage", { value: s, configurable: true, writable: true });
  return s;
}
