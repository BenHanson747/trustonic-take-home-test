# Trustonic Senior Frontend Engineer - Take-Home Exercise: ALPS Device Console

**Level:** Senior Frontend Engineer
**Time budget:** 3–4 hours.

We are not expecting a polished or pixel-perfect UI, and we are not scoring you on CSS. We care about how you build a **data layer** for a multi-tenant GraphQL console: how you scope requests to a tenant, how you survive out-of-order responses, how you make a mutation feel instant without lying to the user, and what you choose to leave undone.

If you run out of time, leave `TODO` comments explaining what you would do next. A well-reasoned TODO scores better than a rushed half-feature.

---

## Overview

ALPS is a device-lifecycle protection platform. Operators (mobile network carriers, retailers, lenders) enrol handsets, apply policies to them, and remotely lock, unlock or message a device when a customer stops paying or reports it stolen.

You are building a slice of the operator console:

1. A searchable, paginated **device list**
2. A **device detail** panel showing that device's action history
3. A **"Lock device"** action that mutates server state

Everything runs locally against a mock GraphQL server you paste in from this document. **No API keys, no accounts, no backend, no network access required.**

The one piece of domain context that matters: **every operator belongs to a tenant, and every request is scoped to a `tenantId`.** In production that ID comes from the signed-in user's token. In this exercise it comes from a context you control, and there is a tenant switcher in the UI. Tenant isolation is a core requirement, not a nice-to-have.

---

## Getting Started

```bash
npm create vite@latest alps-console -- --template react-ts
cd alps-console
npm install
npm install --save-dev msw
npx msw init public/ --save
npm run dev
```

Then create the three files in [Appendix A](#appendix-a--the-mock-server) — the schema, the mock handlers, and the worker bootstrap — and wire the bootstrap into your `main.tsx`.

The mock endpoint is `http://localhost:3000/graphql`. It is intercepted in the browser by MSW; nothing leaves your machine.

---

## The data layer you must build

**Do not use Apollo Client, urql, TanStack Query, SWR, or any other data-fetching library.** Transport is plain `fetch`. You are building the hooks yourself.

This is not busywork or a hazing ritual. The real console has a hand-rolled GraphQL layer, and this exercise asks you to build the same public surface so that the follow-up conversation is about your design decisions rather than a library's defaults. The contract below is the one our code actually exposes.

```ts
type UseQueryResult<TData, TVars> = {
  loading: boolean;
  errors: string[];
  data: TData | undefined;
  refetch: (variables?: TVars, replace?: boolean) => Promise<void>;
  reset: (queryKey?: string) => void;
};

function useQuery<TData, TVars>(
  query: string,
  options: {
    variables?: TVars;
    fetchFirst?: boolean; // when true, fire on mount and on variable change
    queryKey?: string;    // stable handle for cancellation / invalidation
  },
): UseQueryResult<TData, TVars>;

type UseMutationResult<TData, TVars> = {
  loading: boolean;
  errors: string[];
  mutateData: (variables?: TVars, replace?: boolean) => Promise<TData | undefined>;
};

function useMutation<TData, TVars>(
  query: string,
  options: { variables?: TVars; throwError?: boolean },
): UseMutationResult<TData, TVars>;
```

Required semantics:

- **`fetchFirst`** — when `true`, the query fires on mount and again whenever `variables` change. Note that a fresh object literal is a new reference on every render; make sure you compare by value, not identity, or you will loop.
- **`refetch(variables, replace)`** — `replace: false` (the default) merges the passed variables over the ones the hook was configured with; `replace: true` uses them as-is.
- **`reset(queryKey)`** — clears local state and **cancels the in-flight request** for that key.
- **`throwError`** on `useMutation` — when `true`, GraphQL errors are thrown to the caller instead of being swallowed into `errors`. The lock flow needs this; think about why a mutation would default to the other behaviour.
- **A module-level request cache**, keyed on the query document plus its variables. Two components mounting with identical query and variables in the same tick must produce **one** network request, both receiving the result. Cached entries revalidate after a TTL you choose — state your value and your reasoning in `NOTES.md`.
- **`useTenantQuery` / `useTenantMutation`** — thin wrappers that inject the current `tenantId` so no call site has to pass it. This is the layer that makes requirement 2.1 structural rather than a matter of discipline.

Build the smallest thing that satisfies this contract honestly. We are not asking for a production cache — no normalisation, no garbage collection, no subscriptions, no suspense integration. If you find yourself writing a scheduler, stop and leave a TODO instead.

---

## Part 1 — Core (required)

### 1.1 Device list

- A **debounced** search input matching against IMEI and serial number.
- Results in a table or grid showing: serial number, primary IMEI, model marketing name, current state, and last check-in.
- **Server-driven pagination.** `listDevices` takes `page` and `pageSize` and returns `pageInfo { total_count }`. Note what that does *not* give you: there is no `next` cursor and no `pages` count. Deriving the page count and disabling the "next" control is your problem.
- A state filter (`stateId`) alongside the text search. Changing either resets to page 1.

### 1.2 Device detail

- Selecting a device fires a **second query**, `deviceDetail`, plus a **third**, `listDeviceHistory`, for that device's audit trail (event type, policy transition, timestamp, operator email).
- The history list is independently paginated.
- This must be fetched on selection. Do not carry list data over and present it as detail — the two payloads genuinely differ.

### 1.3 Async states

Loading, error, and empty-result states for all three queries, handled independently. A failing history query must not blank the device detail beside it.

Two specific decisions your hook has to make, both of which we will ask you about:

1. **Does a refetch clear `data` while the new request is in flight?** Blanking on every keystroke makes a list flicker; keeping stale data risks showing one tenant's rows under another tenant's name. Pick a behaviour, and make sure it is a decision rather than an accident.
2. **What happens when a response has both `data` and `errors`?** One seeded device (serial `SN-0000-POISON`) returns exactly that — a partially resolved payload where `imsi` and `policy` are `null` and two field-level errors explain why. The naive branch is `if (errors.length) { setErrors(...) } else { setData(...) }`, which throws away a perfectly good payload. Decide what to render and defend it. Blanking the screen on a partial success is a real bug we have shipped.

---

## Part 2 — Senior requirements (required)

These are the reason the exercise exists. Part 1 without Part 2 is an incomplete submission.

### 2.1 Tenant scoping

- `tenantId` lives in a React context (`TenantContext`) with a switcher in the UI. Seeded tenants: `tenant-alpha` and `tenant-beta`. They have **disjoint device sets**.
- Every query and mutation must carry the current `tenantId`, injected by `useTenantQuery` / `useTenantMutation` rather than passed at the call site. The mock **rejects any operation without one** — treat that error as a bug in your code, not a mock quirk.
- Switching tenant must not leak the previous tenant's rows, detail panel, or in-flight responses into the new tenant's view. Not for a frame.

The injection point is the interesting design decision, so make it deliberately. Reading `tenantId` out of module scope or `sessionStorage` inside the hook is the tempting shortcut: it needs no plumbing and every call site gets it for free. It also means the value React renders with and the value your fetch actually sends can diverge, and nothing re-renders when it changes. Sourcing it from context costs you a provider and makes the hook subject to React's lifecycle. Pick one, and be ready to say what the other one breaks.

Then the second-order question: your cache is keyed on query plus variables, and `tenantId` is one of those variables. Does that make you safe, or merely lucky? What is still holding the previous tenant's data after a switch?

### 2.2 Race conditions

The mock delays `listDevices` by a **randomised 150–1200 ms**. Typing quickly *will* produce out-of-order responses — an earlier request landing after a later one.

A stale response must never overwrite fresher state. Debouncing alone does not solve this; it only narrows the window. Show us the mechanism that actually closes it.

Note where the problem lives. A naive `fetchQuery` awaits its response and then calls `setData` unconditionally — by the time it resolves, it has no idea whether it is still the newest request in flight. Whatever you do about that (an `AbortController`, a monotonically increasing request id compared on resolve, a `queryKey`-scoped cancellation) belongs **inside the hook**, not sprinkled through the components that call it. A component author should not have to think about this.

The same hazard applies when selecting device A and then quickly selecting device B.

### 2.3 Mutation with optimistic update and rollback

- A **"Lock device"** button on the detail panel calling `assignAction(tenantId, deviceId, actionId)` through `useTenantMutation`, with `throwError: true`.
- The available actions for a device come from `listAvailableActions(tenantId, stateId)` — do not hardcode an action ID.
- Update the UI **optimistically**: the device's state should change in both the detail panel and its row in the list before the server responds.
- The mock **fails `assignAction` for any device already in the `LOCKED` state**, returning a GraphQL error. On failure, roll the optimistic change back everywhere you applied it and surface the error to the user.

Optimism is the awkward requirement here, because the contract above gives you two hooks that each own their own `data` and know nothing about each other. The list's `useQuery` holds the row; the detail's `useQuery` holds the panel; the mutation has to move both and then move both back. Whatever you reach for — a shared cache the hooks read through, an override layer above them, lifting the mutation's state to a common ancestor — is a real architectural decision. Make it explicitly and write down what you rejected.

### 2.4 Cache invalidation

After a **successful** lock, the affected device's row and detail must reflect the new state and gain a new history entry — **without refetching the entire device list**. Targeted invalidation, not a sledgehammer.

This is what `queryKey` is for in the contract. A cache keyed only on `JSON.stringify({ query, variables })` can be *cleared*, but it cannot easily be asked "which entry holds device `dev-0042`?" — so decide what a key needs to carry for this requirement to be answerable, and say in `NOTES.md` what you would need to change to invalidate by entity rather than by query.

### 2.5 One test

Vitest + React Testing Library. **One** test, covering either:

- the race condition in 2.2 (a stale response arriving last does not win), or
- the rollback in 2.3 (a failed mutation restores the prior state).

Test the hook directly with `renderHook`, not the markup. Since you own the data layer, both hazards are unit-testable without rendering a single component — which is one of the arguments for owning it. One good test beats five shallow ones.

---

## Explicitly out of scope

Do not spend time on: authentication or login, Ant Design or any specific component library, internationalisation, responsive breakpoints, visual polish, a router (a single page is fine), or persistence across reloads.

Also not wanted, even though a real cache would have them: normalised entity storage, garbage collection or eviction, subscriptions, refetch-on-window-focus, retry with backoff, or Suspense integration. Naming them in `NOTES.md` as things you consciously skipped is worth more than half-building one.

---

## Submission

Please share:

1. A link to a repo (GitHub, GitLab, or a zip).
2. A short `NOTES.md` covering:
   - How you closed the race condition, in two or three sentences.
   - Where `tenantId` is injected, and what happens to cached data on a tenant switch.
   - Your cache TTL, and why that number.
   - How the optimistic update reaches both the list row and the detail panel, and what you rejected.
   - What a partial `data` + `errors` response renders, and why.
   - What you left undone, and what you would do next.

---

## Appendix A — the mock server

Three files. Paste them in as-is; you should not need to modify them. If you find yourself editing the handlers to make something pass, that is a signal worth mentioning in `NOTES.md` instead.

### `src/mocks/schema.graphql`

```graphql
type PageInfo {
  total_count: Int
}

type IMEI {
  imei: String
  isPrimary: Boolean
}

type State {
  id: Int!
  name: String
}

type Policy {
  id: ID!
  name: String
  color: String
}

type ServiceType {
  id: ID
  name: String
  label: String
}

type Device {
  id: ID!
  serialNumber: String
  IMEIs: [IMEI]
  modelMarketingName: String
  brandName: String
  policy: Policy!
  serviceType: ServiceType!
  state: State
  lastCheckin: String
  lastChanged: String
}

type DeviceList {
  pageInfo: PageInfo
  deviceList: [Device]
}

type LastCheckIn {
  label: String
  date: String
  color: String
}

type DeviceDetail {
  id: ID!
  serialNumber: String
  deviceBrandName: String
  deviceModelMarketingName: String
  IMEIs: [IMEI]
  imsi: String
  locale: String
  state: State
  policy: Policy
  serviceType: ServiceType
  lastCheckin: LastCheckIn
  firstEnrollAt: String
}

type History {
  type: String
  createdAt: String
  email: String
  policyName: String
  nextPolicyName: String
  actionName: String
}

type DeviceHistories {
  histories: [History]
  pageInfo: PageInfo
}

type Action {
  id: String!
  actionName: String
  policyName: String
  stateId: Int
  serviceName: String
}

type Query {
  listDevices(
    tenantId: String
    imei: String
    serialNumber: String
    stateId: Int
    page: Int
    pageSize: Int
  ): DeviceList

  deviceDetail(tenantId: String!, deviceId: String!): DeviceDetail

  listDeviceHistory(
    tenantId: String!
    deviceId: String!
    page: Int
    pageSize: Int
  ): DeviceHistories

  listAvailableActions(tenantId: String, stateId: String): [Action]
}

type Mutation {
  assignAction(tenantId: String!, deviceId: String!, actionId: String!): Boolean
}
```

### `src/mocks/handlers.ts`

```ts
import { HttpResponse, graphql } from 'msw';

const endpoint = graphql.link('http://localhost:3000/graphql');

/* ------------------------------------------------------------------ */
/* Seed data                                                          */
/* ------------------------------------------------------------------ */

type SeedDevice = {
  id: string;
  tenantId: string;
  serialNumber: string;
  imei1: string;
  imei2: string;
  brandName: string;
  modelMarketingName: string;
  stateId: number;
  policyId: string;
  lastCheckin: string;
  firstEnrollAt: string;
};

const STATES: Record<number, string> = {
  1: 'ENROLLED',
  2: 'ACTIVE',
  3: 'LOCKED',
  4: 'RELEASED',
};

const POLICIES: Record<string, { name: string; color: string }> = {
  'pol-1': { name: 'Financing Baseline', color: '#2f8f4e' },
  'pol-2': { name: 'Delinquent 30d', color: '#c98a1b' },
  'pol-3': { name: 'Hard Lock', color: '#b3261e' },
};

const BRANDS: Array<[string, string]> = [
  ['Samsung', 'Galaxy A15'],
  ['Samsung', 'Galaxy S23'],
  ['Xiaomi', 'Redmi Note 13'],
  ['Motorola', 'Moto G54'],
  ['Tecno', 'Spark 20'],
  ['Infinix', 'Hot 40i'],
];

function seed(): SeedDevice[] {
  const out: SeedDevice[] = [];
  for (let i = 0; i < 60; i++) {
    const tenantId = i % 3 === 0 ? 'tenant-beta' : 'tenant-alpha';
    const [brandName, modelMarketingName] = BRANDS[i % BRANDS.length];
    const suffix = tenantId === 'tenant-beta' ? 'B' : 'A';
    out.push({
      id: 'dev-' + String(i).padStart(4, '0'),
      tenantId,
      serialNumber: 'SN-' + String(i).padStart(4, '0') + '-' + suffix,
      imei1: String(356000000000000 + i * 7919),
      imei2: String(357000000000000 + i * 7919),
      brandName,
      modelMarketingName,
      stateId: (i % 4) + 1,
      policyId: 'pol-' + ((i % 3) + 1),
      lastCheckin: new Date(Date.now() - i * 3600000).toISOString(),
      firstEnrollAt: new Date(Date.now() - i * 86400000 * 3).toISOString(),
    });
  }
  // The partial-response device. Belongs to tenant-alpha.
  out.push({
    id: 'dev-poison',
    tenantId: 'tenant-alpha',
    serialNumber: 'SN-0000-POISON',
    imei1: '350000000000001',
    imei2: '350000000000002',
    brandName: 'Nokia',
    modelMarketingName: 'G22',
    stateId: 2,
    policyId: 'pol-1',
    lastCheckin: new Date().toISOString(),
    firstEnrollAt: new Date(Date.now() - 86400000 * 400).toISOString(),
  });
  return out;
}

const DEVICES = seed();

type HistoryRow = {
  type: string;
  createdAt: string;
  email: string;
  policyName: string;
  nextPolicyName: string;
  actionName: string;
};

const HISTORY: Record<string, HistoryRow[]> = {};

function historyFor(deviceId: string): HistoryRow[] {
  if (!HISTORY[deviceId]) {
    const n = 3 + (deviceId.charCodeAt(deviceId.length - 1) % 12);
    HISTORY[deviceId] = Array.from({ length: n }, (_, i) => ({
      type: i === n - 1 ? 'ENROLMENT' : 'POLICY_CHANGE',
      createdAt: new Date(Date.now() - (i + 1) * 86400000).toISOString(),
      email: 'operator' + ((i % 3) + 1) + '@example.com',
      policyName: POLICIES['pol-' + ((i % 3) + 1)].name,
      nextPolicyName: POLICIES['pol-' + (((i + 1) % 3) + 1)].name,
      actionName: i === n - 1 ? 'Enrol device' : 'Apply policy',
    }));
  }
  return HISTORY[deviceId];
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = (min: number, max: number) => min + Math.random() * (max - min);

function gqlError(message: string) {
  return HttpResponse.json({ errors: [{ message }] }, { status: 200 });
}

function requireTenant(tenantId: unknown): string | null {
  return typeof tenantId === 'string' && tenantId.length > 0 ? tenantId : null;
}

function toDevice(d: SeedDevice) {
  return {
    id: d.id,
    serialNumber: d.serialNumber,
    IMEIs: [
      { imei: d.imei1, isPrimary: true },
      { imei: d.imei2, isPrimary: false },
    ],
    modelMarketingName: d.modelMarketingName,
    brandName: d.brandName,
    policy: { id: d.policyId, ...POLICIES[d.policyId] },
    serviceType: { id: '1', name: 'DEVICE_FINANCING', label: 'Device Financing' },
    state: { id: d.stateId, name: STATES[d.stateId] },
    lastCheckin: d.lastCheckin,
    lastChanged: d.lastCheckin,
  };
}

/* ------------------------------------------------------------------ */
/* Handlers                                                           */
/* ------------------------------------------------------------------ */

export const handlers = [
  endpoint.query('ListDevices', async ({ variables }) => {
    // Out-of-order responses are guaranteed here. This is deliberate.
    await sleep(jitter(150, 1200));

    const tenantId = requireTenant(variables.tenantId);
    if (!tenantId) return gqlError('tenantId is required');

    const imei = variables.imei as string | undefined;
    const serialNumber = variables.serialNumber as string | undefined;
    const stateId = variables.stateId as number | undefined;
    const page = Number(variables.page ?? 1);
    const pageSize = Number(variables.pageSize ?? 10);

    let rows = DEVICES.filter((d) => d.tenantId === tenantId);
    if (imei) {
      rows = rows.filter((d) => d.imei1.includes(imei) || d.imei2.includes(imei));
    }
    if (serialNumber) {
      const q = serialNumber.toLowerCase();
      rows = rows.filter((d) => d.serialNumber.toLowerCase().includes(q));
    }
    if (stateId != null) {
      rows = rows.filter((d) => d.stateId === Number(stateId));
    }

    const start = (page - 1) * pageSize;
    return HttpResponse.json({
      data: {
        listDevices: {
          pageInfo: { total_count: rows.length },
          deviceList: rows.slice(start, start + pageSize).map(toDevice),
        },
      },
    });
  }),

  endpoint.query('DeviceDetail', async ({ variables }) => {
    await sleep(jitter(120, 900));

    const tenantId = requireTenant(variables.tenantId);
    if (!tenantId) return gqlError('tenantId is required');

    const d = DEVICES.find((x) => x.id === variables.deviceId && x.tenantId === tenantId);
    if (!d) return gqlError('Device not found for this tenant');

    const detail = {
      id: d.id,
      serialNumber: d.serialNumber,
      deviceBrandName: d.brandName,
      deviceModelMarketingName: d.modelMarketingName,
      IMEIs: [
        { imei: d.imei1, isPrimary: true },
        { imei: d.imei2, isPrimary: false },
      ],
      imsi: '2140' + d.id.replace(/\D/g, '').padStart(11, '0'),
      locale: 'en-GB',
      state: { id: d.stateId, name: STATES[d.stateId] },
      policy: { id: d.policyId, ...POLICIES[d.policyId] },
      serviceType: { id: '1', name: 'DEVICE_FINANCING', label: 'Device Financing' },
      lastCheckin: { label: 'Last seen', date: d.lastCheckin, color: '#2f8f4e' },
      firstEnrollAt: d.firstEnrollAt,
    };

    // Partially resolved payload: data AND errors together.
    if (d.id === 'dev-poison') {
      return HttpResponse.json({
        data: { deviceDetail: { ...detail, imsi: null, policy: null } },
        errors: [
          { message: 'Subscriber record unavailable', path: ['deviceDetail', 'imsi'] },
          { message: 'Policy service timed out', path: ['deviceDetail', 'policy'] },
        ],
      });
    }

    return HttpResponse.json({ data: { deviceDetail: detail } });
  }),

  endpoint.query('ListDeviceHistory', async ({ variables }) => {
    await sleep(jitter(120, 900));

    const tenantId = requireTenant(variables.tenantId);
    if (!tenantId) return gqlError('tenantId is required');

    const d = DEVICES.find((x) => x.id === variables.deviceId && x.tenantId === tenantId);
    if (!d) return gqlError('Device not found for this tenant');

    const page = Number(variables.page ?? 1);
    const pageSize = Number(variables.pageSize ?? 5);
    const rows = historyFor(d.id);
    const start = (page - 1) * pageSize;

    return HttpResponse.json({
      data: {
        listDeviceHistory: {
          pageInfo: { total_count: rows.length },
          histories: rows.slice(start, start + pageSize),
        },
      },
    });
  }),

  endpoint.query('ListAvailableActions', async ({ variables }) => {
    await sleep(jitter(80, 400));

    const tenantId = requireTenant(variables.tenantId);
    if (!tenantId) return gqlError('tenantId is required');

    const stateId = Number(variables.stateId);
    const all = [
      { id: 'act-lock', actionName: 'Lock device', policyName: 'Hard Lock', stateId: 3, serviceName: 'DEVICE_FINANCING' },
      { id: 'act-unlock', actionName: 'Unlock device', policyName: 'Financing Baseline', stateId: 2, serviceName: 'DEVICE_FINANCING' },
      { id: 'act-release', actionName: 'Release device', policyName: 'Financing Baseline', stateId: 4, serviceName: 'DEVICE_FINANCING' },
    ];
    // A device already in a state cannot transition into it again.
    return HttpResponse.json({
      data: { listAvailableActions: all.filter((a) => a.stateId !== stateId) },
    });
  }),

  endpoint.mutation('AssignAction', async ({ variables }) => {
    await sleep(jitter(400, 1100));

    const tenantId = requireTenant(variables.tenantId);
    if (!tenantId) return gqlError('tenantId is required');

    const d = DEVICES.find((x) => x.id === variables.deviceId && x.tenantId === tenantId);
    if (!d) return gqlError('Device not found for this tenant');

    const actionId = String(variables.actionId);

    // Deliberate failure case: locking an already-locked device.
    if (actionId === 'act-lock' && d.stateId === 3) {
      return gqlError('Device is already locked (state transition rejected)');
    }

    const nextState = actionId === 'act-lock' ? 3 : actionId === 'act-release' ? 4 : 2;
    const nextPolicy = actionId === 'act-lock' ? 'pol-3' : 'pol-1';
    const prevPolicyName = POLICIES[d.policyId].name;

    d.stateId = nextState;
    d.policyId = nextPolicy;
    d.lastCheckin = new Date().toISOString();

    historyFor(d.id).unshift({
      type: 'POLICY_CHANGE',
      createdAt: new Date().toISOString(),
      email: 'you@example.com',
      policyName: prevPolicyName,
      nextPolicyName: POLICIES[nextPolicy].name,
      actionName: actionId === 'act-lock' ? 'Lock device' : 'Unlock device',
    });

    return HttpResponse.json({ data: { assignAction: true } });
  }),
];
```

### `src/mocks/browser.ts`

```ts
import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';

export const worker = setupWorker(...handlers);
```

### Bootstrap in `src/main.tsx`

```ts
async function enableMocking() {
  const { worker } = await import('./mocks/browser');
  return worker.start({ onUnhandledRequest: 'bypass' });
}

enableMocking().then(() => {
  // ...your existing ReactDOM.createRoot(...).render(...)
});
```

For the Vitest test in 2.5, use `setupServer` from `msw/node` in a setup file rather than the browser worker, and override handlers per test to control timing deterministically. Do not rely on the random jitter in a test.

---

## Appendix B — reference operations

```graphql
query ListDevices(
  $tenantId: String
  $imei: String
  $serialNumber: String
  $stateId: Int
  $page: Int
  $pageSize: Int
) {
  listDevices(
    tenantId: $tenantId
    imei: $imei
    serialNumber: $serialNumber
    stateId: $stateId
    page: $page
    pageSize: $pageSize
  ) {
    pageInfo {
      total_count
    }
    deviceList {
      id
      serialNumber
      modelMarketingName
      brandName
      IMEIs {
        imei
        isPrimary
      }
      state {
        id
        name
      }
      policy {
        id
        name
        color
      }
      lastCheckin
    }
  }
}

query DeviceDetail($tenantId: String!, $deviceId: String!) {
  deviceDetail(tenantId: $tenantId, deviceId: $deviceId) {
    id
    serialNumber
    deviceBrandName
    deviceModelMarketingName
    imsi
    locale
    firstEnrollAt
    IMEIs {
      imei
      isPrimary
    }
    state {
      id
      name
    }
    policy {
      id
      name
      color
    }
    lastCheckin {
      label
      date
      color
    }
  }
}

query ListDeviceHistory($tenantId: String!, $deviceId: String!, $page: Int, $pageSize: Int) {
  listDeviceHistory(tenantId: $tenantId, deviceId: $deviceId, page: $page, pageSize: $pageSize) {
    pageInfo {
      total_count
    }
    histories {
      type
      createdAt
      email
      policyName
      nextPolicyName
      actionName
    }
  }
}

query ListAvailableActions($tenantId: String, $stateId: String) {
  listAvailableActions(tenantId: $tenantId, stateId: $stateId) {
    id
    actionName
    policyName
    stateId
  }
}

mutation AssignAction($tenantId: String!, $deviceId: String!, $actionId: String!) {
  assignAction(tenantId: $tenantId, deviceId: $deviceId, actionId: $actionId)
}
```

**Operation names matter.** The mock dispatches on them (`ListDevices`, `DeviceDetail`, `ListDeviceHistory`, `ListAvailableActions`, `AssignAction`). An anonymous or renamed operation will not be intercepted.

---
