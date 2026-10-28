# Notes

## 1. Fixing the race condition (§2.2)

In `useQuery` (`src/data/useQuery.ts`), each hook instance tracks an `AbortController` alongside a `requestIdRef` counter that bumps on every fetch. Whenever a new request starts (or `reset` is called), the previous controller is aborted. When a response comes back, it only updates the cache and component state if `currentRequestId === requestIdRef.current` and the signal hasn't been aborted.

One edge case: if two components share the same in-flight request and one of them unmounts/aborts early, the other component checks that its own controller is still active and re-runs the fetch so it doesn't get stuck waiting on a cancelled promise.

## 2. Multi-tenancy & clearing state on tenant switch (§2.1)

**Injecting `tenantId`:**
`tenantId` comes from `TenantContext` (`src/tenant/TenantProvider.tsx`) and gets merged into variables inside `useTenantQuery` and `useTenantMutation` (`src/tenant/hooks.ts`). This happens both on the initial query and on manual `refetch` / `mutateData` calls (even if the caller passes `replace: true` or no variables). Reading it from React context rather than a global variable or `sessionStorage` keeps it in sync with the component tree.

**Why adding `tenantId` to the cache key isn't enough:**
Even with `tenantId` in the cache key, three things would still hang onto the old tenant's data:
1. Local `useState` inside mounted `useQuery` hooks (plus `selectedDeviceId` in `App`).
2. In-flight network requests or optimistic rollbacks that started before the switch.
3. Cached responses from the previous tenant still sitting in memory.

**What happens when switching tenants:**
1. `setTenantId` calls `queryCache.clear()`, which bumps a `generation` counter, aborts any in-flight requests, and clears the cache map.
2. `useQuery` checks if `tenantId` changed during render and immediately resets `{ data: undefined, errors: [], loading: fetchFirst }` so the old tenant's rows don't flash on screen for a frame. (When refetching within the *same* tenant—like during search or pagination—it keeps the previous `data` around so the table doesn't flicker.)
3. `App` resets `selectedDeviceId` and puts `key={tenantId}` on `<main>`, and `useOptimisticDeviceAction` checks the cache generation before rolling back so an old failed mutation can't overwrite the new tenant's state.

## 3. Cache TTL

I set `DEFAULT_CACHE_TTL_MS` to **30 seconds** (`src/data/cache.ts`).

When clicking back and forth between devices in the list or paging around, 30s avoids hitting the mock server's 150–1200ms delay every time while still keeping fields like `state` and `lastCheckin` reasonably fresh. Explicit `refetch()` and `queryCache.invalidate()` calls bypass the TTL and always hit the network.

## 4. Optimistic updates, rollback & cache invalidation (§2.3 & §2.4)

**Keeping the list and detail panel in sync:**
Both `DeviceList` and `DeviceDetail` subscribe to `queryCache`. When you click **"Lock device"**, `useOptimisticDeviceAction` (`src/tenant/deviceActions.ts`) calls `queryCache.updateDeviceInCache(deviceId, targetState)`, which updates that device inside both the cached `ListDevices` array and the `DeviceDetail` entry, then notifies subscribers so both views update right away.

**Rollback:**
Instead of snapshotting the entire cache (which would wipe out unrelated updates if two mutations happened around the same time), `updateDeviceInCache` just saves the previous `state` and `policy` values for that specific device. If `assignAction` fails, `restoreSnapshot` puts those fields back.

**Other approaches I considered:**
- *Normalized cache*: Mentioned as out of scope in the prompt, and overkill for a couple of queries.
- *Lifting device state up into `App.tsx`*: Would bypass `useQuery` and couple the components too tightly.
- *Keeping a separate "optimistic overrides" map*: Would mean merging state in every component and figuring out when to clear overrides.

**Targeted invalidation vs. entity invalidation (§2.4):**
After a successful mutation, `queryCache.invalidate('device:${deviceId}:history')` only marks that device's history query as stale and refetches it, leaving `devices:list` alone.

If we wanted to invalidate by *entity* instead of by query key, `queryCache.set()` could walk incoming response payloads for objects with an `id` and maintain a lookup map (`Device:dev-0042` -> `Set<cacheKey>`). For queries like `listDeviceHistory` where the items don't include the parent `Device` object directly, we'd also need a way to tag the query with the parent entity ID.

## 5. Handling partial `data` + `errors` (`SN-0000-POISON`, §1.3.2)

GraphQL can return partial `data` alongside field-level `errors`. `useQuery` keeps both rather than treating `response.errors` as a total failure, and formats each error with its field path (e.g. `deviceDetail.imsi: Subscriber record unavailable`).

When you click `SN-0000-POISON`, the detail panel renders everything that succeeded (model, IMEIs, status, dates, actions, and history), shows a warning banner for the partial failure, and displays the specific error messages inline next to the `IMSI` and `Policy` fields.

## 6. Trade-offs, skipped items & mock notes

- **Left out (per scope):** Normalized caching, cache eviction/GC (left a `TODO` in `src/data/cache.ts`), subscriptions, refetch on window focus, automatic retries, URL routing, and auth.
- **Search input (IMEI vs. Serial):** The mock `ListDevices` handler checks `imei` AND `serialNumber` if both are passed, which returns no results when using a single search bar. As a quick workaround (`src/components/DeviceList.tsx`), purely numeric searches pass `imei` and alphanumeric searches (like `SN-0042`) pass `serialNumber`. With a real backend I'd ask for a single `search` filter parameter.
- **Testing rollback on an already-locked device:** Section 2.3 asks to test rollback by locking an already-`LOCKED` device without hardcoding `actionId`. However, `ListAvailableActions` in the mock filters out the lock action when `stateId === 3` (`LOCKED`). To make the button available in the UI without hardcoding the ID, `DeviceDetail` fetches `listAvailableActions` without the `stateId` filter when the device is locked so it can still look up the lock action from the server.
- **MSW setup:** `npm install --save-dev msw` pulled in MSW v3 (`^3.0.3`), which needed a couple of small compatibility tweaks: importing `graphql` from `msw/graphql`, adding `graphql` as a dev dependency, typing `HttpResponse.json` in `gqlError`, and setting `onUnhandledRequest: 'bypass'` in `src/main.tsx`. None of the mock logic, seed data, or delays were changed.

