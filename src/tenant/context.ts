import { createContext, useContext } from 'react';
import type { TenantContextValue } from './types';

export const TenantContext = createContext<TenantContextValue | undefined>(undefined);

/**
 * useTenant:
 * Accesses active tenant state and updater from React context.
 * Throws a clear error if called outside <TenantProvider>.
 */
export function useTenant(): TenantContextValue {
  const context = useContext(TenantContext);
  if (!context) {
    throw new Error('useTenant must be used within a <TenantProvider>');
  }
  return context;
}
