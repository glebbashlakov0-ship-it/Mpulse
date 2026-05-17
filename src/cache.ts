export type CacheStore = {
  get<T>(key: string): T | null;
  getEntry<T>(key: string): CacheReadResult<T> | null;
  set<T>(key: string, value: T, ttlMs: number): void;
  getOrSet<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T>;
  delete(key: string): void;
  clear(): void;
};

type CacheEntry = {
  createdAt: number;
  expiresAt: number;
  value: unknown;
};

export type CacheReadResult<T> = {
  value: T;
  createdAt: string;
  expiresAt: string;
  isStale: boolean;
};

export class MemoryCacheStore implements CacheStore {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(private readonly enabled = true) {}

  get<T>(key: string): T | null {
    if (!this.enabled) {
      return null;
    }

    const entry = this.entries.get(key);
    if (!entry) {
      return null;
    }

    if (entry.expiresAt <= Date.now()) {
      return null;
    }

    return entry.value as T;
  }

  getEntry<T>(key: string): CacheReadResult<T> | null {
    if (!this.enabled) {
      return null;
    }

    const entry = this.entries.get(key);
    if (!entry) {
      return null;
    }

    return {
      value: entry.value as T,
      createdAt: new Date(entry.createdAt).toISOString(),
      expiresAt: new Date(entry.expiresAt).toISOString(),
      isStale: entry.expiresAt <= Date.now(),
    };
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    if (!this.enabled || ttlMs <= 0) {
      return;
    }

    this.entries.set(key, {
      createdAt: Date.now(),
      expiresAt: Date.now() + ttlMs,
      value,
    });
  }

  async getOrSet<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    const pending = this.inFlight.get(key);
    if (pending) {
      return pending as Promise<T>;
    }

    const loadPromise = loader()
      .then((value) => {
        this.set(key, value, ttlMs);
        return value;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });

    this.inFlight.set(key, loadPromise);
    return loadPromise;
  }

  delete(key: string): void {
    this.entries.delete(key);
    this.inFlight.delete(key);
  }

  clear(): void {
    this.entries.clear();
    this.inFlight.clear();
  }
}

export function createCacheKey(scope: string, input: Record<string, unknown> = {}) {
  const stableInput = Object.fromEntries(
    Object.entries(input)
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .sort(([left], [right]) => left.localeCompare(right)),
  );

  return `${scope}:${JSON.stringify(stableInput)}`;
}
