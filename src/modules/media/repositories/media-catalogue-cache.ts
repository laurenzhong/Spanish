/**
 * A tiny in-process cache for catalogue reads.
 *
 * The media catalogue is public, changes only when the daily publishing
 * pipeline runs, and costs a wide three-table join against a remote pooler
 * (one statement measured at 0.5-3 s, plus ~2 s of connection handshake after
 * the pool goes idle). Re-reading it on every shelf render and on every channel
 * switch is what made `/learn` stream its content ~3 s late.
 *
 * Deliberately not a generic framework: it caches one query shape, keys on the
 * serialised query, de-duplicates concurrent loads, and keeps serving the last
 * good value when a refresh fails. Per-user data must never be cached here -
 * callers pass only catalogue queries.
 */
export type CatalogueCacheOptions = Readonly<{
  ttlMs: number;
  /** Injectable clock; tests use it to expire entries without waiting. */
  now?: () => number;
  /** Shared maps so Next's per-route module instances see the same cache. */
  entries?: Map<string, CatalogueCacheEntry<unknown>>;
  inFlight?: Map<string, Promise<unknown>>;
}>;

export type CatalogueCacheEntry<T> = Readonly<{ expiresAt: number; value: T }>;

export function createCatalogueCache(options: CatalogueCacheOptions) {
  const now = options.now ?? Date.now;
  const entries = options.entries ?? new Map<string, CatalogueCacheEntry<unknown>>();
  const inFlight = options.inFlight ?? new Map<string, Promise<unknown>>();

  return {
    async load<T>(key: string, loader: () => Promise<T>): Promise<T> {
      const cached = entries.get(key) as CatalogueCacheEntry<T> | undefined;
      if (cached && cached.expiresAt > now()) return cached.value;

      const pending = inFlight.get(key) as Promise<T> | undefined;
      if (pending) return pending;

      const request = loader()
        .then((value) => {
          entries.set(key, { expiresAt: now() + options.ttlMs, value });
          return value;
        })
        .catch((error: unknown) => {
          // A refresh failure must not blank a catalogue that was readable a
          // moment ago: an out-of-date shelf beats an error page, and the next
          // call retries the refresh.
          const stale = entries.get(key) as CatalogueCacheEntry<T> | undefined;
          if (stale) return stale.value;
          throw error;
        })
        .finally(() => {
          inFlight.delete(key);
        });
      inFlight.set(key, request as Promise<unknown>);
      return request;
    },
    /** Test seam; production code never clears the shared cache. */
    clear() {
      entries.clear();
      inFlight.clear();
    },
  };
}
