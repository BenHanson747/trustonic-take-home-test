import { useCallback, useEffect, useRef, useState } from 'react';
import { queryCache } from './cache';
import { fetchGraphQL } from './client';
import type { GraphQLResponse, UseQueryOptions, UseQueryResult } from './types';
import {
  canonicalize,
  formatGraphQLError,
  isAbortError,
  resolveVariables,
} from './utils';

export function useQuery<TData, TVars = unknown>(
  query: string,
  options: UseQueryOptions<TVars> = {}
): UseQueryResult<TData, TVars> {
  const { variables: initialVariables, fetchFirst = false, queryKey } = options;

  // Configured variables from options (kept in sync even when fetchFirst is false)
  const configuredVarsRef = useRef<TVars | undefined>(initialVariables);
  // Most recent variables used for a fetch (used when revalidating via queryCache.invalidate)
  const activeVarsRef = useRef<TVars | undefined>(initialVariables);

  // Race condition shield: monotonically increasing request identifier
  const requestIdRef = useRef<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef<boolean>(true);

  // Value-based serialization computed once per render (used for both initialKey and effect dependency)
  const serializedVars = canonicalize(initialVariables ?? {});
  const initialKey = `${query.trim()}::${serializedVars}`;

  // Lazy state initialization avoids querying cache on every render
  const [data, setData] = useState<TData | undefined>(
    () => queryCache.get<TData>(initialKey)?.data
  );
  const [errors, setErrors] = useState<string[]>(
    () => queryCache.get<TData>(initialKey)?.errors ?? []
  );
  const [loading, setLoading] = useState<boolean>(() => {
    if (queryCache.get<TData>(initialKey)) return false;
    return Boolean(fetchFirst);
  });

  const activeCacheKeyRef = useRef<string>(initialKey);

  // Extract tenantId from variables if present to shield against cross-tenant frame leaks
  const currentTenantId = (initialVariables as { tenantId?: string } | undefined)?.tenantId;
  const [prevTenantId, setPrevTenantId] = useState<string | undefined>(currentTenantId);
  const [prevKey, setPrevKey] = useState<string>(initialKey);

  // Synchronously adjust state during render when tenant or query variables change:
  // - Cross-tenant change: immediately clear data & errors (zero-frame isolation, Requirement 2.1).
  // - Same-tenant variable change: retain prior `data` so lists do not flicker on search/page
  //   changes (Requirement 1.3.1), but immediately clear stale `errors` so a previous device's
  //   field errors are never shown on the next device while its request is in flight.
  if (prevTenantId !== currentTenantId) {
    setPrevTenantId(currentTenantId);
    setPrevKey(initialKey);
    setData(undefined);
    setErrors([]);
    setLoading(Boolean(fetchFirst));
  } else if (prevKey !== initialKey) {
    setPrevKey(initialKey);
    const cached = queryCache.get<TData>(initialKey);
    if (cached) {
      setData(cached.data);
      setErrors(cached.errors ?? []);
      setLoading(false);
    } else {
      setErrors([]);
      if (fetchFirst) {
        setLoading(true);
      }
    }
  }

  /**
   * Internal fetch executor.
   * Enforces:
   * 1. Monotonic request sequencing (race condition prevention)
   * 2. Fast-path TTL cache check before AbortController allocation
   * 3. In-flight request deduplication
   * 4. Preservation of both `data` and `errors` on partial responses
   */
  const executeFetch = useCallback(
    async (
      varsToFetch: TVars | undefined,
      execOptions: { bypassCache?: boolean } = {}
    ): Promise<void> => {
      // 1. Advance request counter for this hook instance
      const currentRequestId = ++requestIdRef.current;

      // 2. Abort previous in-flight request made by this hook instance
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }

      const cacheKey = queryCache.getCacheKey(query, varsToFetch);
      activeCacheKeyRef.current = cacheKey;

      if (queryKey) {
        queryCache.associateQueryKey(cacheKey, queryKey);
      }

      // 3. Fast-path cache lookup before allocating AbortController or toggling loading
      if (!execOptions.bypassCache) {
        const cached = queryCache.get<TData>(cacheKey);
        if (cached) {
          if (currentRequestId === requestIdRef.current && isMountedRef.current) {
            setData(cached.data);
            setErrors(cached.errors ?? []);
            setLoading(false);
          }
          return;
        }
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;

      // Register with active controller registry for global abort (e.g. tenant switch)
      const unregisterActiveController = queryCache.registerActiveController(controller);

      // Register with global queryKey controller registry if queryKey was provided
      const unregisterKeyController = queryKey
        ? queryCache.registerController(queryKey, controller)
        : undefined;

      setErrors([]);
      setLoading(true);

      try {
        // 4. In-flight Promise deduplication:
        // If an identical request is already traveling on the wire, piggyback onto it.
        let fetchPromise = queryCache.getInFlight<GraphQLResponse<TData>>(cacheKey);

        if (!fetchPromise) {
          fetchPromise = fetchGraphQL<TData>({
            query,
            variables: varsToFetch,
            signal: controller.signal,
          });

          queryCache.setInFlight(cacheKey, fetchPromise);

          fetchPromise
            .catch(() => {})
            .finally(() => {
              queryCache.clearInFlight(cacheKey);
            });
        }

        let response: GraphQLResponse<TData>;
        try {
          response = await fetchPromise;
        } catch (err: unknown) {
          if (isAbortError(err) && !controller.signal.aborted && isMountedRef.current) {
            // Deduplicated promise was aborted by an earlier or sibling caller; retry with our own signal.
            queryCache.clearInFlight(cacheKey);
            response = await fetchGraphQL<TData>({
              query,
              variables: varsToFetch,
              signal: controller.signal,
            });
          } else {
            throw err;
          }
        }

        // 5. Race condition & abort check:
        if (
          currentRequestId !== requestIdRef.current ||
          !isMountedRef.current ||
          controller.signal.aborted
        ) {
          if (currentRequestId === requestIdRef.current && isMountedRef.current) {
            setLoading(false);
          }
          return;
        }

        const errorMsgs = (response.errors ?? []).map(formatGraphQLError);

        // Save to cache (which also notifies active cache subscribers)
        queryCache.set(cacheKey, response.data, errorMsgs);
        setLoading(false);
      } catch (err: unknown) {
        if (
          isAbortError(err) ||
          controller.signal.aborted ||
          currentRequestId !== requestIdRef.current ||
          !isMountedRef.current
        ) {
          if (currentRequestId === requestIdRef.current && isMountedRef.current) {
            setLoading(false);
          }
          return;
        }

        const message = err instanceof Error ? err.message : 'Unknown network error';
        setErrors([message]);
        setLoading(false);
      } finally {
        unregisterActiveController();
        unregisterKeyController?.();
      }
    },
    [query, queryKey]
  );

  /**
   * refetch:
   * `replace: false` (default) merges passed variables over the ones the hook was configured with.
   * `replace: true` uses the passed variables as-is.
   */
  const refetch = useCallback(
    async (overrideVars?: TVars, replace = false): Promise<void> => {
      const merged = resolveVariables(configuredVarsRef.current, overrideVars, replace);
      activeVarsRef.current = merged;
      await executeFetch(merged, { bypassCache: true });
    },
    [executeFetch]
  );

  /**
   * reset:
   * Clears local state and cancels in-flight request for that key or hook.
   */
  const reset = useCallback(
    (keyToReset?: string) => {
      requestIdRef.current++;

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }

      const targetKey = keyToReset || queryKey;
      if (targetKey) {
        queryCache.abortQueryKey(targetKey);
      }

      setData(undefined);
      setErrors([]);
      setLoading(false);
    },
    [queryKey]
  );

  // Subscribe to cache updates (including optimistic updates, rollbacks, and fetch resolutions)
  useEffect(() => {
    return queryCache.subscribe((key, entry) => {
      if (key === activeCacheKeyRef.current && entry !== undefined && isMountedRef.current) {
        setData(entry.data as TData);
        setErrors(entry.errors ?? []);
      }
    });
  }, []);

  // Register refetch handler for targeted cache invalidations
  useEffect(() => {
    return queryCache.registerRefetchHandler(queryKey, () =>
      executeFetch(activeVarsRef.current, { bypassCache: true })
    );
  }, [queryKey, executeFetch]);

  // Keep configuredVarsRef & activeVarsRef synchronized with value-based variable changes
  // (even when fetchFirst is false, so a subsequent imperative `refetch()` always uses current variables)
  useEffect(() => {
    isMountedRef.current = true;
    let cancelled = false;

    configuredVarsRef.current = initialVariables;
    activeVarsRef.current = initialVariables;

    if (fetchFirst) {
      void Promise.resolve().then(() => {
        if (!cancelled && isMountedRef.current) {
          executeFetch(initialVariables).catch(() => {});
        }
      });
    }

    return () => {
      cancelled = true;
      isMountedRef.current = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      queryCache.clearInFlight(activeCacheKeyRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchFirst, serializedVars, executeFetch]);

  return {
    loading,
    errors,
    data,
    refetch,
    reset,
  };
}
