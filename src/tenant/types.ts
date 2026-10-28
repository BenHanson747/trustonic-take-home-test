import type { ReactNode } from 'react';

export type TenantId = 'tenant-alpha' | 'tenant-beta';

export const AVAILABLE_TENANTS: readonly TenantId[] = ['tenant-alpha', 'tenant-beta'] as const;

export interface TenantContextValue {
  tenantId: TenantId;
  setTenantId: (id: TenantId) => void;
  availableTenants: readonly TenantId[];
}

export interface TenantProviderProps {
  children: ReactNode;
  initialTenantId?: TenantId;
}
