/**
 * Extracts the operation name from a GraphQL document string.
 * Example: `query ListDevices(...) { ... }` => 'ListDevices'
 */
export function extractOperationName(query: string): string | undefined {
  const match = /(?:query|mutation|subscription)\s+([A-Za-z0-9_]+)/.exec(query);
  return match ? match[1] : undefined;
}

/**
 * Deterministically serializes any JS value into a canonical JSON string.
 * Object keys are sorted and `undefined` fields are stripped to ensure
 * { a: 1, b: 2 }, { b: 2, a: 1 }, and { a: 1, b: undefined, c: 2 } match.
 */
export function canonicalize(val: unknown): string {
  if (val === undefined) {
    return 'null';
  }
  if (val === null || typeof val !== 'object') {
    return JSON.stringify(val);
  }
  if (Array.isArray(val)) {
    return '[' + val.map(canonicalize).join(',') + ']';
  }
  const record = val as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  const entries = keys.map((key) => {
    return `${JSON.stringify(key)}:${canonicalize(record[key])}`;
  });
  return '{' + entries.join(',') + '}';
}

/**
 * Merges variables: if replace is true, override is used directly;
 * if replace is false, override is merged on top of base.
 */
export function resolveVariables<TVars>(
  base: TVars | undefined,
  override: TVars | undefined,
  replace = false
): TVars | undefined {
  if (replace) {
    return override;
  }
  if (!base) return override;
  if (!override) return base;
  return { ...base, ...override };
}

/**
 * True for the error a `fetch` rejects with when its AbortSignal fires.
 */
export function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === 'AbortError') ||
    (err instanceof Error && err.name === 'AbortError')
  );
}

/**
 * Flattens a GraphQL error into the `string[]` the hook contract exposes.
 * Field-level errors keep their `path` as a prefix (e.g. `deviceDetail.imsi: Subscriber record
 * unavailable`) so consumers can attribute an error to a field without matching on prose.
 */
export function formatGraphQLError(error: { message: string; path?: Array<string | number> }): string {
  return error.path && error.path.length > 0
    ? `${error.path.join('.')}: ${error.message}`
    : error.message;
}

/**
 * Returns the message of the error attributed to `path` (as produced by `formatGraphQLError`),
 * or undefined if that field resolved cleanly.
 */
export function findFieldError(errors: string[], path: string): string | undefined {
  const prefix = `${path}: `;
  const match = errors.find((e) => e.startsWith(prefix));
  return match?.slice(prefix.length);
}

/**
 * Formats an ISO timestamp string into a concise locale date + time string.
 */
export function formatDate(isoStr?: string): string {
  if (!isoStr) return '—';
  try {
    const d = new Date(isoStr);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  } catch {
    return isoStr;
  }
}
