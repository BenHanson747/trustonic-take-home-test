import { useState } from 'react';
import { LIST_DEVICES_QUERY, formatDate, type Device, type DeviceList as DeviceListType } from '../data';
import { useTenant } from '../tenant/context';
import { useTenantQuery } from '../tenant/hooks';
import { useDebounce } from './useDebounce';

export interface DeviceListProps {
  selectedDeviceId: string | null;
  onSelectDevice: (deviceId: string) => void;
}

const PAGE_SIZE = 10;

export function DeviceList({ selectedDeviceId, onSelectDevice }: DeviceListProps) {
  const { tenantId } = useTenant();
  const [searchInput, setSearchInput] = useState<string>('');
  const [stateFilter, setStateFilter] = useState<number | undefined>(undefined);
  const [page, setPage] = useState<number>(1);

  const debouncedSearch = useDebounce(searchInput.trim(), 300);

  // Reset to page 1 when tenant, search, or state filter changes (Requirement 1.1 & 2.1)
  const filterKey = `${tenantId}|${debouncedSearch}|${stateFilter ?? ''}`;
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (prevFilterKey !== filterKey) {
    setPrevFilterKey(filterKey);
    setPage(1);
  }

  // TODO(unified-search): The mock `ListDevices` handler applies `imei` and `serialNumber`
  // sequentially with logical AND rather than OR, so passing both variables for a single search
  // box returns 0 rows. We route digit-only queries to `imei` and alphanumeric queries (e.g.
  // "SN-0042") to `serialNumber`. With a real backend we would request a single `search` parameter
  // (or expose an explicit IMEI / Serial field selector).
  const isImeiQuery = Boolean(debouncedSearch && /^\d+$/.test(debouncedSearch));
  const queryImei = isImeiQuery ? debouncedSearch : undefined;
  const querySerialNumber = !isImeiQuery && debouncedSearch ? debouncedSearch : undefined;

  const { data, loading, errors } = useTenantQuery<{ listDevices: DeviceListType }>(
    LIST_DEVICES_QUERY,
    {
      variables: {
        imei: queryImei,
        serialNumber: querySerialNumber,
        stateId: stateFilter,
        page,
        pageSize: PAGE_SIZE,
      },
      queryKey: 'devices:list',
      fetchFirst: true,
    }
  );

  const deviceList = data?.listDevices?.deviceList ?? [];
  const totalCount = data?.listDevices?.pageInfo?.total_count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const hasPrevious = page > 1;
  const hasNext = page < totalPages;

  return (
    <div>
      <div className="flex-between" style={{ marginBottom: 12 }}>
        <h2>Devices</h2>
        {loading && <span className="text-muted">Loading...</span>}
      </div>

      {/* Search & Filter Toolbar */}
      <div className="toolbar" role="search" aria-label="Device Search and Filter">
        <input
          type="text"
          id="device-search"
          data-testid="search-input"
          placeholder="Search by serial number (e.g. SN-0001) or IMEI..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          aria-label="Search devices by IMEI or serial number"
        />

        <div className="flex-row">
          <label htmlFor="state-filter">State:</label>
          <select
            id="state-filter"
            data-testid="state-filter"
            value={stateFilter ?? ''}
            onChange={(e) => {
              const val = e.target.value;
              setStateFilter(val === '' ? undefined : Number(val));
            }}
          >
            <option value="">All States</option>
            <option value="1">ENROLLED</option>
            <option value="2">ACTIVE</option>
            <option value="3">LOCKED</option>
            <option value="4">RELEASED</option>
          </select>
        </div>
      </div>

      {errors.length > 0 && (
        <div className="alert alert--error" role="alert">
          <span>Error loading devices: {errors.join(', ')}</span>
        </div>
      )}

      {/* Device Table */}
      <table className="device-table" data-testid="device-table">
        <thead>
          <tr>
            <th scope="col">Serial Number</th>
            <th scope="col">Primary IMEI</th>
            <th scope="col">Model</th>
            <th scope="col">State</th>
            <th scope="col">Last Check-in</th>
          </tr>
        </thead>
        <tbody>
          {loading && deviceList.length === 0 ? (
            <tr>
              <td colSpan={5} className="text-muted">Loading device list...</td>
            </tr>
          ) : errors.length > 0 && deviceList.length === 0 ? null : deviceList.length === 0 ? (
            <tr>
              <td colSpan={5} className="text-muted">No devices found.</td>
            </tr>
          ) : (
            deviceList.map((device: Device) => {
              const isSelected = selectedDeviceId === device.id;
              const primaryImei =
                device.IMEIs?.find((i) => i.isPrimary)?.imei ?? device.IMEIs?.[0]?.imei ?? '—';

              return (
                <tr
                  key={device.id}
                  data-testid={`device-row-${device.id}`}
                  className={`device-row ${isSelected ? 'device-row--selected' : ''}`}
                  onClick={() => onSelectDevice(device.id)}
                >
                  <td className="font-mono"><strong>{device.serialNumber}</strong></td>
                  <td className="font-mono">{primaryImei}</td>
                  <td>{device.modelMarketingName}</td>
                  <td><strong>{device.state?.name ?? 'UNKNOWN'}</strong></td>
                  <td className="text-muted">{formatDate(device.lastCheckin)}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>

      {/* Server-Driven Pagination */}
      <footer className="pagination-bar" aria-label="Device List Pagination">
        <span>
          Page <strong>{page}</strong> of <strong>{totalPages}</strong> ({totalCount} total)
        </span>

        <div className="flex-row">
          <button
            type="button"
            data-testid="prev-page-btn"
            disabled={!hasPrevious || loading}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </button>
          <button
            type="button"
            data-testid="next-page-btn"
            disabled={!hasNext || loading}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      </footer>
    </div>
  );
}
