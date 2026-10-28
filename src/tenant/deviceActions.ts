import { useCallback } from 'react';
import {
  ASSIGN_ACTION_MUTATION,
  applyOptimisticDeviceUpdate,
  queryCache,
  rollbackOptimisticDeviceUpdate,
  type Action,
} from '../data';
import { useTenantMutation } from './hooks';

export interface ActionExecutionResult {
  success: boolean;
  error?: string;
}

export interface UseOptimisticDeviceActionResult {
  executeAction: (
    deviceId: string,
    action: Action
  ) => Promise<ActionExecutionResult>;
  loading: boolean;
  error: string | null;
}

/**
 * useOptimisticDeviceAction:
 * Manages device actions (e.g. "Lock device") with:
 * 1. Optimistic state transitions on both the device row (ListDevices) and detail panel (DeviceDetail)
 * 2. Per-device field-level rollback upon GraphQL failure (Requirement 2.3)
 * 3. Targeted cache invalidation of the device history query without refetching the full list (Requirement 2.4)
 * 4. Structural tenant isolation via useTenantMutation and cache-generation guards (Requirement 2.1)
 */
export function useOptimisticDeviceAction(): UseOptimisticDeviceActionResult {
  const {
    mutateData,
    loading,
    errors,
  } = useTenantMutation<{ assignAction: boolean }, { deviceId: string; actionId: string }>(
    ASSIGN_ACTION_MUTATION,
    { throwError: true }
  );

  const executeAction = useCallback(
    async (
      deviceId: string,
      action: Action
    ): Promise<ActionExecutionResult> => {
      const startGeneration = queryCache.getGeneration();

      // 1. Apply optimistic update to both ListDevices and DeviceDetail in cache;
      //    captures a per-device field snapshot (bound to current cache generation) for rollback.
      const rollbackSnapshot = applyOptimisticDeviceUpdate(deviceId, action);

      try {
        // 2. Dispatch wire mutation via useTenantMutation with throwError: true
        await mutateData({ deviceId, actionId: action.id });

        // Guard against a tenant switch occurring while the mutation was in flight
        if (queryCache.getGeneration() !== startGeneration) {
          return { success: false };
        }

        // 3. Targeted cache invalidation on success:
        // Evicts cached history for this device and triggers active refetch handler
        // to show the newly prepended audit record from the server.
        // Crucial architectural guarantee: The device list query is NOT refetched!
        queryCache.invalidate(`device:${deviceId}:history`);

        return { success: true };
      } catch (err: unknown) {
        // 4. Deterministic per-device rollback on failure (no-op if tenant switched):
        rollbackOptimisticDeviceUpdate(rollbackSnapshot);

        if (queryCache.getGeneration() !== startGeneration) {
          return { success: false };
        }

        const errorMsg =
          err instanceof Error
            ? err.message
            : 'Failed to assign action to device';

        return { success: false, error: errorMsg };
      }
    },
    [mutateData]
  );

  return {
    executeAction,
    loading,
    error: errors[0] ?? null,
  };
}
