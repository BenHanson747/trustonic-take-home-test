import { HttpResponse } from "msw";
import { graphql } from "msw/graphql";

const endpoint = graphql.link("http://localhost:3000/graphql");

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
  1: "ENROLLED",
  2: "ACTIVE",
  3: "LOCKED",
  4: "RELEASED",
};

const POLICIES: Record<string, { name: string; color: string }> = {
  "pol-1": { name: "Financing Baseline", color: "#2f8f4e" },
  "pol-2": { name: "Delinquent 30d", color: "#c98a1b" },
  "pol-3": { name: "Hard Lock", color: "#b3261e" },
};

const BRANDS: Array<[string, string]> = [
  ["Samsung", "Galaxy A15"],
  ["Samsung", "Galaxy S23"],
  ["Xiaomi", "Redmi Note 13"],
  ["Motorola", "Moto G54"],
  ["Tecno", "Spark 20"],
  ["Infinix", "Hot 40i"],
];

function seed(): SeedDevice[] {
  const out: SeedDevice[] = [];
  for (let i = 0; i < 60; i++) {
    const tenantId = i % 3 === 0 ? "tenant-beta" : "tenant-alpha";
    const [brandName, modelMarketingName] = BRANDS[i % BRANDS.length];
    const suffix = tenantId === "tenant-beta" ? "B" : "A";
    out.push({
      id: "dev-" + String(i).padStart(4, "0"),
      tenantId,
      serialNumber: "SN-" + String(i).padStart(4, "0") + "-" + suffix,
      imei1: String(356000000000000 + i * 7919),
      imei2: String(357000000000000 + i * 7919),
      brandName,
      modelMarketingName,
      stateId: (i % 4) + 1,
      policyId: "pol-" + ((i % 3) + 1),
      lastCheckin: new Date(Date.now() - i * 3600000).toISOString(),
      firstEnrollAt: new Date(Date.now() - i * 86400000 * 3).toISOString(),
    });
  }
  // The partial-response device. Belongs to tenant-alpha.
  out.push({
    id: "dev-poison",
    tenantId: "tenant-alpha",
    serialNumber: "SN-0000-POISON",
    imei1: "350000000000001",
    imei2: "350000000000002",
    brandName: "Nokia",
    modelMarketingName: "G22",
    stateId: 2,
    policyId: "pol-1",
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
      type: i === n - 1 ? "ENROLMENT" : "POLICY_CHANGE",
      createdAt: new Date(Date.now() - (i + 1) * 86400000).toISOString(),
      email: "operator" + ((i % 3) + 1) + "@example.com",
      policyName: POLICIES["pol-" + ((i % 3) + 1)].name,
      nextPolicyName: POLICIES["pol-" + (((i + 1) % 3) + 1)].name,
      actionName: i === n - 1 ? "Enrol device" : "Apply policy",
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
  return HttpResponse.json<{ errors: Array<{ message: string }> }>(
    { errors: [{ message }] },
    { status: 200 },
  );
}

function requireTenant(tenantId: unknown): string | null {
  return typeof tenantId === "string" && tenantId.length > 0 ? tenantId : null;
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
    serviceType: {
      id: "1",
      name: "DEVICE_FINANCING",
      label: "Device Financing",
    },
    state: { id: d.stateId, name: STATES[d.stateId] },
    lastCheckin: d.lastCheckin,
    lastChanged: d.lastCheckin,
  };
}

/* ------------------------------------------------------------------ */
/* Handlers                                                           */
/* ------------------------------------------------------------------ */

export const handlers = [
  endpoint.query("ListDevices", async ({ variables }) => {
    // Out-of-order responses are guaranteed here. This is deliberate.
    await sleep(jitter(150, 1200));

    const tenantId = requireTenant(variables.tenantId);
    if (!tenantId) return gqlError("tenantId is required");

    const imei = variables.imei as string | undefined;
    const serialNumber = variables.serialNumber as string | undefined;
    const stateId = variables.stateId as number | undefined;
    const page = Number(variables.page ?? 1);
    const pageSize = Number(variables.pageSize ?? 10);

    let rows = DEVICES.filter((d) => d.tenantId === tenantId);
    if (imei) {
      rows = rows.filter(
        (d) => d.imei1.includes(imei) || d.imei2.includes(imei),
      );
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

  endpoint.query("DeviceDetail", async ({ variables }) => {
    await sleep(jitter(120, 900));

    const tenantId = requireTenant(variables.tenantId);
    if (!tenantId) return gqlError("tenantId is required");

    const d = DEVICES.find(
      (x) => x.id === variables.deviceId && x.tenantId === tenantId,
    );
    if (!d) return gqlError("Device not found for this tenant");

    const detail = {
      id: d.id,
      serialNumber: d.serialNumber,
      deviceBrandName: d.brandName,
      deviceModelMarketingName: d.modelMarketingName,
      IMEIs: [
        { imei: d.imei1, isPrimary: true },
        { imei: d.imei2, isPrimary: false },
      ],
      imsi: "2140" + d.id.replace(/\D/g, "").padStart(11, "0"),
      locale: "en-GB",
      state: { id: d.stateId, name: STATES[d.stateId] },
      policy: { id: d.policyId, ...POLICIES[d.policyId] },
      serviceType: {
        id: "1",
        name: "DEVICE_FINANCING",
        label: "Device Financing",
      },
      lastCheckin: {
        label: "Last seen",
        date: d.lastCheckin,
        color: "#2f8f4e",
      },
      firstEnrollAt: d.firstEnrollAt,
    };

    // Partially resolved payload: data AND errors together.
    if (d.id === "dev-poison") {
      return HttpResponse.json({
        data: { deviceDetail: { ...detail, imsi: null, policy: null } },
        errors: [
          {
            message: "Subscriber record unavailable",
            path: ["deviceDetail", "imsi"],
          },
          {
            message: "Policy service timed out",
            path: ["deviceDetail", "policy"],
          },
        ],
      });
    }

    return HttpResponse.json({ data: { deviceDetail: detail } });
  }),

  endpoint.query("ListDeviceHistory", async ({ variables }) => {
    await sleep(jitter(120, 900));

    const tenantId = requireTenant(variables.tenantId);
    if (!tenantId) return gqlError("tenantId is required");

    const d = DEVICES.find(
      (x) => x.id === variables.deviceId && x.tenantId === tenantId,
    );
    if (!d) return gqlError("Device not found for this tenant");

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

  endpoint.query("ListAvailableActions", async ({ variables }) => {
    await sleep(jitter(80, 400));

    const tenantId = requireTenant(variables.tenantId);
    if (!tenantId) return gqlError("tenantId is required");

    const stateId = Number(variables.stateId);
    const all = [
      {
        id: "act-lock",
        actionName: "Lock device",
        policyName: "Hard Lock",
        stateId: 3,
        serviceName: "DEVICE_FINANCING",
      },
      {
        id: "act-unlock",
        actionName: "Unlock device",
        policyName: "Financing Baseline",
        stateId: 2,
        serviceName: "DEVICE_FINANCING",
      },
      {
        id: "act-release",
        actionName: "Release device",
        policyName: "Financing Baseline",
        stateId: 4,
        serviceName: "DEVICE_FINANCING",
      },
    ];
    // A device already in a state cannot transition into it again.
    return HttpResponse.json({
      data: { listAvailableActions: all.filter((a) => a.stateId !== stateId) },
    });
  }),

  endpoint.mutation("AssignAction", async ({ variables }) => {
    await sleep(jitter(400, 1100));

    const tenantId = requireTenant(variables.tenantId);
    if (!tenantId) return gqlError("tenantId is required");

    const d = DEVICES.find(
      (x) => x.id === variables.deviceId && x.tenantId === tenantId,
    );
    if (!d) return gqlError("Device not found for this tenant");

    const actionId = String(variables.actionId);

    // Deliberate failure case: locking an already-locked device.
    if (actionId === "act-lock" && d.stateId === 3) {
      return gqlError("Device is already locked (state transition rejected)");
    }

    const nextState =
      actionId === "act-lock" ? 3 : actionId === "act-release" ? 4 : 2;
    const nextPolicy = actionId === "act-lock" ? "pol-3" : "pol-1";
    const prevPolicyName = POLICIES[d.policyId].name;

    d.stateId = nextState;
    d.policyId = nextPolicy;
    d.lastCheckin = new Date().toISOString();

    historyFor(d.id).unshift({
      type: "POLICY_CHANGE",
      createdAt: new Date().toISOString(),
      email: "you@example.com",
      policyName: prevPolicyName,
      nextPolicyName: POLICIES[nextPolicy].name,
      actionName: actionId === "act-lock" ? "Lock device" : "Unlock device",
    });

    return HttpResponse.json({ data: { assignAction: true } });
  }),
];
