export interface PageInfo {
  total_count: number;
}

export interface IMEI {
  imei: string;
  isPrimary: boolean;
}

export interface State {
  id: number;
  name: string;
}

export interface Policy {
  id: string;
  name: string;
  color: string;
}

export interface ServiceType {
  id: string;
  name: string;
  label: string;
}

export interface Device {
  id: string;
  serialNumber: string;
  IMEIs: IMEI[];
  modelMarketingName: string;
  brandName: string;
  policy: Policy;
  serviceType: ServiceType;
  state: State;
  lastCheckin: string;
  lastChanged?: string;
}

export interface DeviceList {
  pageInfo: PageInfo;
  deviceList: Device[];
}

export interface LastCheckIn {
  label: string;
  date: string;
  color: string;
}

export interface DeviceDetail {
  id: string;
  serialNumber: string;
  deviceBrandName: string;
  deviceModelMarketingName: string;
  IMEIs: IMEI[];
  imsi: string | null;
  locale: string;
  state: State;
  policy: Policy | null;
  serviceType: ServiceType;
  lastCheckin: LastCheckIn;
  firstEnrollAt: string;
}

export interface History {
  type: string;
  createdAt: string;
  email: string;
  policyName: string;
  nextPolicyName: string;
  actionName: string;
}

export interface DeviceHistories {
  histories: History[];
  pageInfo: PageInfo;
}

export interface Action {
  id: string;
  actionName: string;
  policyName: string;
  stateId: number;
  serviceName: string;
}

/* ------------------------------------------------------------------ */
/* GraphQL Request & Response Types                                   */
/* ------------------------------------------------------------------ */

export interface GraphQLErrorLocation {
  line: number;
  column: number;
}

export interface GraphQLErrorItem {
  message: string;
  locations?: GraphQLErrorLocation[];
  path?: Array<string | number>;
  extensions?: Record<string, unknown>;
}

export interface GraphQLResponse<TData = unknown> {
  data?: TData;
  errors?: GraphQLErrorItem[];
}

/* ------------------------------------------------------------------ */
/* Hook Types (Specified in Contract)                                 */
/* ------------------------------------------------------------------ */

export type UseQueryResult<TData, TVars> = {
  loading: boolean;
  errors: string[];
  data: TData | undefined;
  refetch: (variables?: TVars, replace?: boolean) => Promise<void>;
  reset: (queryKey?: string) => void;
};

export interface UseQueryOptions<TVars> {
  variables?: TVars;
  fetchFirst?: boolean; // when true, fire on mount and on variable change
  queryKey?: string;    // stable handle for cancellation / invalidation
}

export type UseMutationResult<TData, TVars> = {
  loading: boolean;
  errors: string[];
  mutateData: (variables?: TVars, replace?: boolean) => Promise<TData | undefined>;
};

export interface UseMutationOptions<TVars> {
  variables?: TVars;
  throwError?: boolean;
}
