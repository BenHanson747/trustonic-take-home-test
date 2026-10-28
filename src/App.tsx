import { useState } from 'react';
import { TenantProvider } from './tenant';
import { useTenant } from './tenant/context';
import { Header, DeviceList, DeviceDetail } from './components';

function ConsoleDashboard() {
  const { tenantId } = useTenant();
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

  // Requirement 2.1: Tenant Isolation
  // When switching tenants, reset selected device during render AND key the workspace by
  // `tenantId` so no cross-tenant records, pagination, or mutation state linger for even a frame.
  const [prevTenantId, setPrevTenantId] = useState(tenantId);
  if (prevTenantId !== tenantId) {
    setPrevTenantId(tenantId);
    setSelectedDeviceId(null);
  }

  return (
    <div className="app-shell">
      <Header />

      <main key={tenantId} className="dashboard-layout" id="main-content">
        <section className="panel" aria-label="Device Inventory Section">
          <DeviceList
            selectedDeviceId={selectedDeviceId}
            onSelectDevice={setSelectedDeviceId}
          />
        </section>

        <section className="panel" aria-label="Device Detail Section">
          <DeviceDetail deviceId={selectedDeviceId} />
        </section>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <TenantProvider initialTenantId="tenant-alpha">
      <ConsoleDashboard />
    </TenantProvider>
  );
}
