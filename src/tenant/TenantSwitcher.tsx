import { useTenant } from './context';
import type { TenantId } from './types';

export function TenantSwitcher() {
  const { tenantId, setTenantId, availableTenants } = useTenant();

  return (
    <div className="flex-row">
      <label htmlFor="tenant-select">Tenant:</label>
      <select
        id="tenant-select"
        data-testid="tenant-select"
        value={tenantId}
        onChange={(e) => setTenantId(e.target.value as TenantId)}
      >
        {availableTenants.map((id) => (
          <option key={id} value={id}>
            {id}
          </option>
        ))}
      </select>
    </div>
  );
}
