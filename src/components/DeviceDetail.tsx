import { useState } from 'react';
import {
  DEVICE_DETAIL_QUERY,
  LIST_AVAILABLE_ACTIONS_QUERY,
  findFieldError,
  formatDate,
  type Action,
  type DeviceDetail as DeviceDetailType,
} from '../data';
import { useOptimisticDeviceAction } from '../tenant/deviceActions';
import { useTenantQuery } from '../tenant/hooks';
import { DeviceHistory } from './DeviceHistory';

export interface DeviceDetailProps {
  deviceId: string | null;
}

export function DeviceDetail({ deviceId }: DeviceDetailProps) {
  const [actionError, setActionError] = useState<string | null>(null);

  // Clear action error immediately during render when switching selected devices
  const [prevDeviceId, setPrevDeviceId] = useState<string | null>(deviceId);
  if (prevDeviceId !== deviceId) {
    setPrevDeviceId(deviceId);
    setActionError(null);
  }

  // 1. Primary deviceDetail query (fires immediately on selection alongside DeviceHistory)
  const {
    data: detailData,
    loading: detailLoading,
    errors: detailErrors,
  } = useTenantQuery<{ deviceDetail: DeviceDetailType | null }>(DEVICE_DETAIL_QUERY, {
    variables: { deviceId: deviceId ?? '' },
    queryKey: deviceId ? `device:${deviceId}:detail` : undefined,
    fetchFirst: Boolean(deviceId),
  });

  // Guard against showing the previous device's cached detail while the newly selected device is in flight
  const rawDevice = detailData?.deviceDetail;
  const device = rawDevice?.id === deviceId ? rawDevice : undefined;
  const stateId = device?.state?.id;

  // 2. Available actions query for current stateId (Requirement 2.3)
  const {
    data: actionsData,
    loading: actionsLoading,
    errors: actionsErrors,
  } = useTenantQuery<{ listAvailableActions: Action[] }>(LIST_AVAILABLE_ACTIONS_QUERY, {
    variables: {
      stateId: stateId != null ? String(stateId) : undefined,
    },
    queryKey: stateId != null ? `actions:state:${stateId}` : undefined,
    fetchFirst: Boolean(deviceId && stateId != null),
  });

  // When a device is already in LOCKED state (stateId === 3), the mock's ListAvailableActions(stateId: "3")
  // filters out stateId === 3, yet Requirement 2.3 specifies testing `assignAction` failure + rollback on a
  // LOCKED device without hardcoding an actionId. Querying without stateId resolves the server's lock Action.
  const { data: allActionsData } = useTenantQuery<{ listAvailableActions: Action[] }>(
    LIST_AVAILABLE_ACTIONS_QUERY,
    {
      variables: {},
      queryKey: 'actions:catalog',
      fetchFirst: Boolean(deviceId && stateId === 3),
    }
  );

  // 3. Optimistic device action coordinator
  const { executeAction, loading: actionMutating } = useOptimisticDeviceAction();

  if (!deviceId) {
    return (
      <aside aria-label="Device detail placeholder">
        <h2>Device Detail</h2>
        <p className="text-muted" style={{ marginTop: 8 }}>
          Select a device from the list to view its details and action history.
        </p>
      </aside>
    );
  }

  const availableActions = actionsData?.listAvailableActions ?? [];
  const catalogActions = allActionsData?.listAvailableActions ?? [];

  // Resolve "Lock device" action from listAvailableActions without hardcoding actionId
  const lockAction =
    availableActions.find((a) => a.stateId === 3) ??
    catalogActions.find((a) => a.stateId === 3);

  const handleLockDevice = async () => {
    if (!device || !lockAction) return;
    setActionError(null);

    const result = await executeAction(device.id, lockAction);
    if (!result.success && result.error) {
      setActionError(result.error);
    }
  };

  // Attribute field-level errors via their GraphQL error `path` prefix (`deviceDetail.imsi`, `deviceDetail.policy`)
  const imsiError = findFieldError(detailErrors, 'deviceDetail.imsi');
  const policyError = findFieldError(detailErrors, 'deviceDetail.policy');

  return (
    <aside aria-label={`Details for device ${device?.serialNumber ?? deviceId}`}>
      {detailLoading && !device ? (
        <div>
          <h2>Device Detail</h2>
          <p className="text-muted" style={{ marginTop: 12 }}>Loading device details...</p>
        </div>
      ) : detailErrors.length > 0 && !device ? (
        <div>
          <h2>Device Detail</h2>
          <div className="alert alert--error" role="alert">
            <p>Failed to load device details: {detailErrors.join(', ')}</p>
          </div>
        </div>
      ) : !device ? (
        <div>
          <h2>Device Detail</h2>
          <p className="text-muted" style={{ marginTop: 12 }}>Device not found.</p>
        </div>
      ) : (
        <div>
          <div>
            <h2>{device.serialNumber} ({device.state?.name ?? 'UNKNOWN'})</h2>
            <p className="text-muted">
              {device.deviceBrandName} {device.deviceModelMarketingName}
            </p>
          </div>

          {/* Partial Error Banner for SN-0000-POISON */}
          {detailErrors.length > 0 && (
            <div className="alert alert--warning" role="alert" data-testid="partial-error-banner">
              <strong>Partial response warning:</strong>
              <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                {detailErrors.map((err, idx) => (
                  <li key={idx}>{err}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Mutation Error Notice (Requirement 2.3) */}
          {actionError && (
            <div className="alert alert--error" role="alert">
              <span>{actionError}</span>
            </div>
          )}

          {/* Lock Device Action (Requirement 2.3) */}
          <section className="detail-section" aria-label="Device Actions">
            <div className="flex-between" style={{ marginBottom: 8 }}>
              <h3>Actions</h3>
              {actionsLoading && <span className="text-muted">Loading actions...</span>}
            </div>

            {actionsErrors.length > 0 && (
              <p className="alert alert--error">Could not load actions: {actionsErrors.join(', ')}</p>
            )}

            <button
              type="button"
              className="btn-primary"
              data-testid="lock-device-btn"
              disabled={actionMutating || !lockAction}
              onClick={handleLockDevice}
            >
              {actionMutating ? 'Locking...' : (lockAction?.actionName ?? 'Lock device')}
            </button>
          </section>

          {/* Device Attributes Grid */}
          <section className="detail-grid" aria-label="Hardware Specifications">
            <div className="spec-item">
              <span className="spec-label">Primary IMEI</span>
              <span className="font-mono">
                {device.IMEIs?.find((i) => i.isPrimary)?.imei ?? device.IMEIs?.[0]?.imei ?? '—'}
              </span>
            </div>

            <div className="spec-item">
              <span className="spec-label">Secondary IMEI</span>
              <span className="font-mono">
                {device.IMEIs?.find((i) => !i.isPrimary)?.imei ?? 'None'}
              </span>
            </div>

            <div className="spec-item">
              <span className="spec-label">IMSI</span>
              {device.imsi ? (
                <span className="font-mono">{device.imsi}</span>
              ) : (
                <span className="text-muted">{imsiError ?? 'Unavailable'}</span>
              )}
            </div>

            <div className="spec-item">
              <span className="spec-label">Policy</span>
              {device.policy ? (
                <span>{device.policy.name}</span>
              ) : (
                <span className="text-muted">{policyError ?? 'Unavailable'}</span>
              )}
            </div>

            <div className="spec-item">
              <span className="spec-label">Service Type</span>
              <span>{device.serviceType?.label ?? device.serviceType?.name ?? '—'}</span>
            </div>

            <div className="spec-item">
              <span className="spec-label">Locale</span>
              <span>{device.locale ?? '—'}</span>
            </div>

            <div className="spec-item">
              <span className="spec-label">First Enrolled</span>
              <span>{formatDate(device.firstEnrollAt)}</span>
            </div>

            <div className="spec-item">
              <span className="spec-label">Last Check-in</span>
              <span>{formatDate(device.lastCheckin?.date)}</span>
            </div>
          </section>
        </div>
      )}

      {/* Audit Trail Section — mounted immediately on selection for parallel fetch & independent error handling */}
      <DeviceHistory key={deviceId} deviceId={deviceId} />
    </aside>
  );
}
