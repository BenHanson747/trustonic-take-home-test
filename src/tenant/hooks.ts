import { useCallback, useMemo } from 'react';
import { useQuery, useMutation, canonicalize } from '../data';
import type {
  UseQueryOptions,
  UseQueryResult,
  UseMutationOptions,
  UseMutationResult,
} from '../data';
import { useTenant } from './context';

/**
 * useTenantQuery:
 * Thin wrapper over `useQuery` that injects the active `tenantId` from `TenantContext`.
 * Guarantees structural tenant scoping across all query call sites without manual discipline.
 *
 * Even if callers invoke `refetch()` with no arguments or `refetch(newVars, true)` with
 * `replace: true`, the active `tenantId` is guaranteed to remain attached to the wire variables.
 */
export function useTenantQuery<TData, TVars extends Record<string, unknown> = Record<string, unknown>>(
  query: string,
  options: UseQueryOptions<TVars> = {}
): UseQueryResult<TData, TVars> {
  const { tenantId } = useTenant();

  // Value-based comparison of variables to prevent unstable reference loops
  const serializedVars =
    options.variables !== undefined ? canonicalize(options.variables) : '';
  const scopedVariables = useMemo(() => {
    return {
      ...(options.variables ?? {}),
      tenantId,
    } as TVars & { tenantId: string };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serializedVars, tenantId]);

  const {
    loading,
    errors,
    data,
    refetch: rawRefetch,
    reset,
  } = useQuery<TData, TVars & { tenantId: string }>(query, {
    ...options,
    variables: scopedVariables,
  });

  // Always attach the active `tenantId`, whether `overrideVars` is provided or omitted
  const refetch = useCallback(
    async (overrideVars?: TVars, replace = false): Promise<void> => {
      const varsWithTenant = {
        ...(overrideVars ?? {}),
        tenantId,
      } as TVars & { tenantId: string };

      return rawRefetch(varsWithTenant, replace);
    },
    [rawRefetch, tenantId]
  );

  return {
    loading,
    errors,
    data,
    refetch,
    reset,
  };
}

/**
 * useTenantMutation:
 * Thin wrapper over `useMutation` that injects the active `tenantId` from `TenantContext`.
 * Guarantees structural tenant scoping across all mutation call sites.
 *
 * Even if callers invoke `mutateData(newVars, true)` with `replace: true`, the active `tenantId`
 * is guaranteed to remain attached to the wire payload.
 */
export function useTenantMutation<TData, TVars extends Record<string, unknown> = Record<string, unknown>>(
  query: string,
  options: UseMutationOptions<TVars> = {}
): UseMutationResult<TData, TVars> {
  const { tenantId } = useTenant();

  const serializedVars =
    options.variables !== undefined ? canonicalize(options.variables) : '';
  const scopedVariables = useMemo(() => {
    return {
      ...(options.variables ?? {}),
      tenantId,
    } as TVars & { tenantId: string };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serializedVars, tenantId]);

  const {
    loading,
    errors,
    mutateData: rawMutateData,
  } = useMutation<TData, TVars & { tenantId: string }>(query, {
    ...options,
    variables: scopedVariables,
  });

  // Always attach the active `tenantId`, whether `overrideVars` is provided or omitted
  const mutateData = useCallback(
    async (overrideVars?: TVars, replace = false): Promise<TData | undefined> => {
      const varsWithTenant = {
        ...(overrideVars ?? {}),
        tenantId,
      } as TVars & { tenantId: string };

      return rawMutateData(varsWithTenant, replace);
    },
    [rawMutateData, tenantId]
  );

  return {
    loading,
    errors,
    mutateData,
  };
}
