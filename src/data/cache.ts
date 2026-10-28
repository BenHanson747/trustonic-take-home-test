import type { Device, DeviceDetail, PageInfo, Policy, State } from './types';
import { canonicalize } from './utils';

export interface CacheEntry<TData = unknown> {
  data?: TData;
  errors?: string[];
  timestamp: number;
}

export interface DeviceRollbackRecord {
  key: string;
  kind: 'list' | 'detail';
  state: State;
  policy: Policy | null;
}

export interface CacheSnapshot {
  deviceId: string;
  generation: number;
  records: DeviceRollbackRecord[];
}

export interface DeviceStateUpdate {
  state: State;
  policy: Policy;
}

type CacheListener = (key: string, entry: CacheEntry<unknown> | undefined) => void;

function cloneValue<T>(val: T): T {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(val);
    } catch {
      // fallback
    }
  }
  return JSON.parse(JSON.stringify(val)) as T;
}

/**
 * Default Cache TTL: 30 seconds.
 */
export const DEFAULT_CACHE_TTL_MS = 30_000;

export class QueryCache {
  // TODO(cache-eviction): Bound `this.cache` with an LRU max-entries cap (e.g. 200 keys) or
  // periodic sweep so long-lived single-tenant sessions across many filter permutations cannot
  // grow unbounded between lazy TTL reads.
  private cache = new Map<string, CacheEntry<unknown>>();
  private inFlight = new Map<string, Promise<unknown>>();
  private controllersByQueryKey = new Map<string, Set<AbortController>>();
  private activeControllers = new Set<AbortController>();
  private listeners = new Set<CacheListener>();

  // TODO(entity-invalidation): Index cache keys by entity (`Map<\`${__typename}:${id}\`, Set<cacheKey>>`)
  // on `set()` so mutations can invalidate or patch by entity ID (`Device:dev-0042`) without caller-supplied
  // `queryKey` strings or payload-shape inspection. See NOTES.md §4.
  private queryKeyToCacheKeys = new Map<string, Set<string>>();
  private refetchHandlersByQueryKey = new Map<string, Set<() => Promise<void>>>();

  // Incremented on `clear()` (e.g. tenant switch) so in-flight optimistic rollbacks from a
  // previous tenant cannot write stale entries back into a freshly cleared cache.
  private generation = 0;

  public getGeneration(): number {
    return this.generation;
  }

  /**
   * Generates a stable module-level cache key based on query document and canonical variables.
   */
  public getCacheKey(query: string, variables: unknown): string {
    return `${query.trim()}::${canonicalize(variables ?? {})}`;
  }

  public get<TData>(key: string, ttlMs: number = DEFAULT_CACHE_TTL_MS): CacheEntry<TData> | undefined {
    const entry = this.cache.get(key) as CacheEntry<TData> | undefined;
    if (!entry) return undefined;

    if (Date.now() - entry.timestamp > ttlMs) {
      this.cache.delete(key);
      return undefined;
    }
    return entry;
  }

  public set<TData>(key: string, data: TData | undefined, errors: string[] = []): void {
    const entry: CacheEntry<TData> = {
      data,
      errors,
      timestamp: Date.now(),
    };
    this.cache.set(key, entry as CacheEntry<unknown>);
    this.notifyListeners(key, entry as CacheEntry<unknown>);
  }

  /**
   * Clears cached responses and aborts all in-flight requests (e.g. on tenant switch).
   * Note: `refetchHandlersByQueryKey` is intentionally preserved because its entries are tied
   * to mounted component lifecycles via `useEffect` cleanup rather than cache contents.
   */
  public clear(): void {
    this.generation++;
    this.abortAll();
    this.cache.clear();
    this.inFlight.clear();
    this.queryKeyToCacheKeys.clear();
  }

  /**
   * Associates a runtime wire cacheKey with a logical queryKey (e.g. 'device:dev-0001:history').
   */
  public associateQueryKey(cacheKey: string, queryKey: string): void {
    let set = this.queryKeyToCacheKeys.get(queryKey);
    if (!set) {
      set = new Set();
      this.queryKeyToCacheKeys.set(queryKey, set);
    }
    set.add(cacheKey);
  }

  /**
   * Registers a refetch handler so targeted cache invalidations can notify active query instances.
   */
  public registerRefetchHandler(
    queryKey: string | undefined,
    refetch: () => Promise<void>
  ): () => void {
    if (!queryKey) {
      return () => {};
    }

    let handlers = this.refetchHandlersByQueryKey.get(queryKey);
    if (!handlers) {
      handlers = new Set();
      this.refetchHandlersByQueryKey.set(queryKey, handlers);
    }
    handlers.add(refetch);

    return () => {
      const current = this.refetchHandlersByQueryKey.get(queryKey);
      if (current) {
        current.delete(refetch);
        if (current.size === 0) {
          this.refetchHandlersByQueryKey.delete(queryKey);
        }
      }
    };
  }

  /**
   * Targeted invalidation by queryKey.
   * Evicts matching entries from cache and triggers active refetch handlers.
   */
  public invalidate(queryKey: string): void {
    const cKeys = this.queryKeyToCacheKeys.get(queryKey);
    if (cKeys) {
      for (const ck of cKeys) {
        this.cache.delete(ck);
        this.notifyListeners(ck, undefined);
      }
    }

    const handlers = this.refetchHandlersByQueryKey.get(queryKey);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          void handler();
        } catch {
          // safety
        }
      });
    }
  }

  /**
   * Single-pass atomic update of a device across both ListDevices and DeviceDetail cached payloads.
   * Captures per-device field values (rather than whole-entry clones) so rolling back one device
   * never clobbers a concurrent update to another device on the same page.
   */
  public updateDeviceInCache(
    deviceId: string,
    update: DeviceStateUpdate
  ): CacheSnapshot {
    const records: DeviceRollbackRecord[] = [];
    const now = Date.now();

    for (const [key, entry] of this.cache.entries()) {
      if (!entry.data || typeof entry.data !== 'object') continue;
      const d = entry.data as Record<string, unknown>;

      // Case 1: ListDevices payload containing deviceId
      if (d.listDevices && typeof d.listDevices === 'object') {
        const listObj = d.listDevices as { pageInfo: PageInfo; deviceList?: Device[] };
        const target = Array.isArray(listObj.deviceList)
          ? listObj.deviceList.find((item) => item.id === deviceId)
          : undefined;

        if (target && listObj.deviceList) {
          records.push({
            key,
            kind: 'list',
            state: cloneValue(target.state),
            policy: cloneValue(target.policy),
          });

          const updatedEntry: CacheEntry<unknown> = {
            ...entry,
            timestamp: now,
            data: {
              ...d,
              listDevices: {
                ...listObj,
                deviceList: listObj.deviceList.map((device) =>
                  device.id === deviceId
                    ? {
                        ...device,
                        state: update.state,
                        policy: update.policy,
                      }
                    : device
                ),
              },
            },
          };
          this.cache.set(key, updatedEntry);
          this.notifyListeners(key, updatedEntry);
          continue;
        }
      }

      // Case 2: DeviceDetail payload matching deviceId
      if (d.deviceDetail && typeof d.deviceDetail === 'object') {
        const detailObj = d.deviceDetail as DeviceDetail;
        if (detailObj.id === deviceId) {
          records.push({
            key,
            kind: 'detail',
            state: cloneValue(detailObj.state),
            policy: cloneValue(detailObj.policy),
          });

          const updatedEntry: CacheEntry<unknown> = {
            ...entry,
            timestamp: now,
            data: {
              ...d,
              deviceDetail: {
                ...detailObj,
                state: update.state,
                policy: update.policy,
              },
            },
          };
          this.cache.set(key, updatedEntry);
          this.notifyListeners(key, updatedEntry);
        }
      }
    }

    return {
      deviceId,
      generation: this.generation,
      records,
    };
  }

  /**
   * Restores only the affected device's prior fields in still-live cache entries.
   * - If `clear()` ran since the snapshot was taken (e.g. tenant switch), does nothing so
   *   previous-tenant entries are never written back into the cache.
   * - Within `ListDevices` entries, only `device.id === snapshot.deviceId` is reverted, preserving
   *   any concurrent updates to sibling rows on the same page.
   */
  public restoreSnapshot(snapshot: CacheSnapshot): void {
    if (snapshot.generation !== this.generation) {
      return;
    }

    const now = Date.now();

    for (const record of snapshot.records) {
      const currentEntry = this.cache.get(record.key);
      if (!currentEntry || !currentEntry.data || typeof currentEntry.data !== 'object') {
        continue;
      }

      const d = currentEntry.data as Record<string, unknown>;

      if (record.kind === 'list' && d.listDevices && typeof d.listDevices === 'object') {
        const listObj = d.listDevices as { pageInfo: PageInfo; deviceList?: Device[] };
        if (!Array.isArray(listObj.deviceList)) continue;

        const restoredEntry: CacheEntry<unknown> = {
          ...currentEntry,
          timestamp: now,
          data: {
            ...d,
            listDevices: {
              ...listObj,
              deviceList: listObj.deviceList.map((device) =>
                device.id === snapshot.deviceId
                  ? {
                      ...device,
                      state: record.state,
                      policy: record.policy ?? device.policy,
                    }
                  : device
              ),
            },
          },
        };
        this.cache.set(record.key, restoredEntry);
        this.notifyListeners(record.key, restoredEntry);
      } else if (record.kind === 'detail' && d.deviceDetail && typeof d.deviceDetail === 'object') {
        const detailObj = d.deviceDetail as DeviceDetail;
        if (detailObj.id !== snapshot.deviceId) continue;

        const restoredEntry: CacheEntry<unknown> = {
          ...currentEntry,
          timestamp: now,
          data: {
            ...d,
            deviceDetail: {
              ...detailObj,
              state: record.state,
              policy: record.policy,
            },
          },
        };
        this.cache.set(record.key, restoredEntry);
        this.notifyListeners(record.key, restoredEntry);
      }
    }
  }

  /**
   * Registers any active controller for global lifecycle management (e.g. aborting everything on tenant switch).
   */
  public registerActiveController(controller: AbortController): () => void {
    this.activeControllers.add(controller);
    return () => {
      this.activeControllers.delete(controller);
    };
  }

  /**
   * Aborts all active in-flight requests across the entire application.
   */
  public abortAll(): void {
    this.activeControllers.forEach((ctrl) => {
      try {
        ctrl.abort();
      } catch {
        // ignore already aborted
      }
    });
    this.activeControllers.clear();
    this.controllersByQueryKey.clear();
  }

  /**
   * In-flight deduplication:
   * Returns existing in-flight Promise if identical query + variables are requested in the same tick.
   */
  public getInFlight<T>(key: string): Promise<T> | undefined {
    return this.inFlight.get(key) as Promise<T> | undefined;
  }

  public setInFlight<T>(key: string, promise: Promise<T>): void {
    this.inFlight.set(key, promise);
  }

  public clearInFlight(key: string): void {
    this.inFlight.delete(key);
  }

  /**
   * Registers an AbortController for a stable queryKey handle.
   */
  public registerController(queryKey: string, controller: AbortController): () => void {
    let set = this.controllersByQueryKey.get(queryKey);
    if (!set) {
      set = new Set();
      this.controllersByQueryKey.set(queryKey, set);
    }
    set.add(controller);

    return () => {
      const current = this.controllersByQueryKey.get(queryKey);
      if (current) {
        current.delete(controller);
        if (current.size === 0) {
          this.controllersByQueryKey.delete(queryKey);
        }
      }
    };
  }

  /**
   * Aborts all in-flight requests registered under a given queryKey.
   */
  public abortQueryKey(queryKey: string): void {
    const controllers = this.controllersByQueryKey.get(queryKey);
    if (controllers) {
      controllers.forEach((ctrl) => {
        try {
          ctrl.abort();
        } catch {
          // ignore already aborted
        }
      });
      this.controllersByQueryKey.delete(queryKey);
    }
  }

  /**
   * Subscribe to cache updates for reactive re-renders when targeted updates happen.
   */
  public subscribe(listener: CacheListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(key: string, entry: CacheEntry<unknown> | undefined): void {
    this.listeners.forEach((listener) => {
      try {
        listener(key, entry);
      } catch {
        // safety
      }
    });
  }
}

// Module-level singleton cache
export const queryCache = new QueryCache();
