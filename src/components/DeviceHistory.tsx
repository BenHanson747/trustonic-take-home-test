import { useState } from 'react';
import { LIST_DEVICE_HISTORY_QUERY, formatDate, type DeviceHistories } from '../data';
import { useTenantQuery } from '../tenant/hooks';

export interface DeviceHistoryProps {
  deviceId: string;
}

const PAGE_SIZE = 5;

export function DeviceHistory({ deviceId }: DeviceHistoryProps) {
  const [page, setPage] = useState<number>(1);

  // Logical queryKey matches invalidation target in useOptimisticDeviceAction
  const queryKey = `device:${deviceId}:history`;

  const { data, loading, errors } = useTenantQuery<{
    listDeviceHistory: DeviceHistories;
  }>(LIST_DEVICE_HISTORY_QUERY, {
    variables: {
      deviceId,
      page,
      pageSize: PAGE_SIZE,
    },
    queryKey,
    fetchFirst: true,
  });

  const historyResult = data?.listDeviceHistory;
  const histories = historyResult?.histories ?? [];
  const totalCount = historyResult?.pageInfo?.total_count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const hasPrevious = page > 1;
  const hasNext = page < totalPages;

  return (
    <section className="detail-section" aria-labelledby="history-heading">
      <div className="flex-between">
        <h3 id="history-heading">Action History</h3>
        {loading && <span className="text-muted">Loading history...</span>}
      </div>

      {errors.length > 0 && (
        <div className="alert alert--error" role="alert">
          <span>Failed to load history: {errors.join(', ')}</span>
        </div>
      )}

      {loading && histories.length === 0 ? (
        <p className="text-muted" style={{ marginTop: 8 }}>Loading history...</p>
      ) : errors.length > 0 && histories.length === 0 ? null : histories.length === 0 ? (
        <p className="text-muted" style={{ marginTop: 8 }}>No history records found.</p>
      ) : (
        <div>
          <ol className="history-list">
            {histories.map((item, idx) => (
              <li key={`${item.createdAt}-${idx}`} className="history-item">
                <div className="flex-between">
                  <strong>{item.actionName} ({item.type})</strong>
                  <time className="text-muted" dateTime={item.createdAt}>
                    {formatDate(item.createdAt)}
                  </time>
                </div>
                <div className="text-muted" style={{ marginTop: 4 }}>
                  <span>{item.email}</span>
                  {item.policyName && (
                    <span>
                      {' • '}Policy: {item.policyName}
                      {item.nextPolicyName && item.nextPolicyName !== item.policyName
                        ? ` → ${item.nextPolicyName}`
                        : ''}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ol>

          <div className="pagination-bar">
            <span>
              Page {page} of {totalPages} ({totalCount} entries)
            </span>
            <div className="flex-row">
              <button
                type="button"
                onClick={() => setPage((p) => p - 1)}
                disabled={!hasPrevious || loading}
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => p + 1)}
                disabled={!hasNext || loading}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
