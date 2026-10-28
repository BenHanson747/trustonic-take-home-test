import { act, renderHook, waitFor } from '@testing-library/react';
import { HttpResponse } from 'msw';
import { graphql } from 'msw/graphql';
import { describe, expect, it } from 'vitest';
import {
  GRAPHQL_ENDPOINT,
  LIST_DEVICES_QUERY,
  useQuery,
  type DeviceList,
} from '../data';
import { server } from './setup';

interface ListDevicesResponse {
  listDevices: DeviceList;
}

type ListDevicesVariables = {
  tenantId?: string;
  serialNumber?: string;
};

const endpoint = graphql.link(GRAPHQL_ENDPOINT);

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function createMockDevice(id: string, serialNumber: string) {
  return {
    id,
    serialNumber,
    modelMarketingName: 'Galaxy S23',
    brandName: 'Samsung',
    IMEIs: [{ imei: '356000000007919', isPrimary: true }],
    serviceType: { id: '1', name: 'DEVICE_FINANCING', label: 'Device Financing' },
    state: { id: 2, name: 'ACTIVE' },
    policy: { id: 'pol-1', name: 'Financing Baseline', color: '#2f8f4e' },
    lastCheckin: '2026-10-28T10:00:00.000Z',
  };
}

describe('useQuery race condition protection (Requirement 2.2)', () => {
  it('discards a stale earlier response that resolves after a fresher request', async () => {
    const slowFirstRequest = createDeferred<void>();
    const fastSecondRequest = createDeferred<void>();
    const staleResponseSent = createDeferred<void>();
    const dispatchedSerials: string[] = [];

    server.use(
      endpoint.query('ListDevices', async ({ variables }) => {
        const serial = String(variables.serialNumber ?? '');
        dispatchedSerials.push(serial);

        if (serial === 'FIRST-SLOW') {
          await slowFirstRequest.promise;
          staleResponseSent.resolve();
          return HttpResponse.json({
            data: {
              listDevices: {
                pageInfo: { total_count: 1 },
                deviceList: [createMockDevice('dev-slow', 'SN-STALE')],
              },
            },
          });
        }

        await fastSecondRequest.promise;
        return HttpResponse.json({
          data: {
            listDevices: {
              pageInfo: { total_count: 1 },
              deviceList: [createMockDevice('dev-fast', 'SN-FRESH')],
            },
          },
        });
      })
    );

    const { result, rerender } = renderHook(
      ({ serialNumber }: { serialNumber: string }) =>
        useQuery<ListDevicesResponse, ListDevicesVariables>(LIST_DEVICES_QUERY, {
          variables: { tenantId: 'tenant-alpha', serialNumber },
          fetchFirst: true,
          queryKey: 'devices:list',
        }),
      { initialProps: { serialNumber: 'FIRST-SLOW' } }
    );

    await waitFor(() => {
      expect(dispatchedSerials).toEqual(['FIRST-SLOW']);
    });

    // Trigger a newer request before the first request settles
    rerender({ serialNumber: 'SECOND-FAST' });

    await waitFor(() => {
      expect(dispatchedSerials).toEqual(['FIRST-SLOW', 'SECOND-FAST']);
    });

    // Resolve the second (newer) request first
    await act(async () => {
      fastSecondRequest.resolve();
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.data?.listDevices.deviceList[0].serialNumber).toBe('SN-FRESH');
    });

    // Resolve the first (stale) request last and wait for the handler + microtask queue to flush
    await act(async () => {
      slowFirstRequest.resolve();
      await staleResponseSent.promise;
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(result.current.data?.listDevices.deviceList[0].serialNumber).toBe('SN-FRESH');
    expect(result.current.errors).toEqual([]);
  });
});
