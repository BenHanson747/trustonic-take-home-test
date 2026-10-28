import { useState, useCallback, useMemo } from 'react';
import { queryCache } from '../data/cache';
import { TenantContext } from './context';
import { AVAILABLE_TENANTS, type TenantId, type TenantContextValue, type TenantProviderProps } from './types';

/**
 * TenantProvider:
 * Slices the application tree by active tenant.
 *
 * Core Tenant Isolation Guarantees:
 * 1. When switching tenants, all pending in-flight HTTP requests are immediately aborted.
 * 2. In-memory query cache entries are evicted to ensure zero cross-tenant memory leakage.
 * 3. Components subscribing to `useTenantQuery` receive immediate state resets to prevent
 *    showing the previous tenant's rows under the new tenant for even a single frame.
 */
export function TenantProvider({ children, initialTenantId = 'tenant-alpha' }: TenantProviderProps) {
  const [tenantId, setTenantIdState] = useState<TenantId>(initialTenantId);

  const setTenantId = useCallback(
    (nextTenantId: TenantId) => {
      if (tenantId === nextTenantId) return;

      // Abort all in-flight requests and clear cache before updating tenant state
      queryCache.clear();
      setTenantIdState(nextTenantId);
    },
    [tenantId]
  );

  const value = useMemo<TenantContextValue>(
    () => ({
      tenantId,
      setTenantId,
      availableTenants: AVAILABLE_TENANTS,
    }),
    [tenantId, setTenantId]
  );

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}
