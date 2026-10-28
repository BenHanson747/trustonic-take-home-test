import type { GraphQLResponse } from './types';
import { extractOperationName } from './utils';

export const GRAPHQL_ENDPOINT = 'http://localhost:3000/graphql';

export interface FetchGraphQLOptions {
  query: string;
  variables?: unknown;
  signal?: AbortSignal;
}

/**
 * Low-level GraphQL transport over native fetch.
 * Dispatches to the MSW GraphQL endpoint.
 *
 * Aborts are NOT converted into a synthetic GraphQL error: an aborted `fetch` rejects with
 * `AbortError` so callers can distinguish cancellation from a real server error.
 */
export async function fetchGraphQL<TData = unknown>({
  query,
  variables,
  signal,
}: FetchGraphQLOptions): Promise<GraphQLResponse<TData>> {
  const operationName = extractOperationName(query);

  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      query,
      variables: variables ?? {},
      operationName,
    }),
    signal,
  });

  if (!response.ok) {
    const errorMessage = `HTTP error ${response.status}: ${response.statusText}`;
    try {
      const errJson = await response.json();
      if (errJson.errors && Array.isArray(errJson.errors)) {
        return errJson as GraphQLResponse<TData>;
      }
    } catch {
      // ignore JSON parse failure on non-ok HTTP
    }
    return {
      errors: [{ message: errorMessage }],
    };
  }

  const json = (await response.json()) as GraphQLResponse<TData>;
  return json;
}
