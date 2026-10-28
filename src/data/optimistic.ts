import {
  queryCache,
  type CacheSnapshot,
  type DeviceStateUpdate,
} from './cache';
import type { Action, Policy, State } from './types';

const STATE_BY_ID: Record<number, State> = {
  1: { id: 1, name: 'ENROLLED' },
  2: { id: 2, name: 'ACTIVE' },
  3: { id: 3, name: 'LOCKED' },
  4: { id: 4, name: 'RELEASED' },
};

const POLICY_BY_STATE_ID: Record<number, Policy> = {
  2: { id: 'pol-1', name: 'Financing Baseline', color: '#2f8f4e' },
  3: { id: 'pol-3', name: 'Hard Lock', color: '#b3261e' },
  4: { id: 'pol-1', name: 'Financing Baseline', color: '#2f8f4e' },
};

/**
 * Derives the optimistic device `state` and `policy` from the server-provided `Action`.
 */
export function getOptimisticStateForAction(action: Action): DeviceStateUpdate {
  const state = STATE_BY_ID[action.stateId] ?? {
    id: action.stateId,
    name: 'LOCKED',
  };
  const basePolicy = POLICY_BY_STATE_ID[action.stateId] ?? POLICY_BY_STATE_ID[3];
  return {
    state,
    policy: action.policyName
      ? { ...basePolicy, name: action.policyName }
      : basePolicy,
  };
}

/**
 * Optimistically applies an action transition to both ListDevices and DeviceDetail in cache.
 * Returns a per-device field snapshot for deterministic rollback.
 */
export function applyOptimisticDeviceUpdate(
  deviceId: string,
  action: Action
): CacheSnapshot {
  const targetState = getOptimisticStateForAction(action);
  return queryCache.updateDeviceInCache(deviceId, targetState);
}

/**
 * Reverts the affected device's fields in the cache using a captured snapshot.
 */
export function rollbackOptimisticDeviceUpdate(snapshot: CacheSnapshot): void {
  queryCache.restoreSnapshot(snapshot);
}
