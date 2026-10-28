import { useCallback, useMemo, useState } from 'react';
import { fetchGraphQL } from './client';
import type { UseMutationOptions, UseMutationResult } from './types';
import { canonicalize, formatGraphQLError, resolveVariables } from './utils';

export function useMutation<TData, TVars = unknown>(
  query: string,
  options: UseMutationOptions<TVars> = {}
): UseMutationResult<TData, TVars> {
  const { variables: defaultVariables, throwError = false } = options;

  const [loading, setLoading] = useState<boolean>(false);
  const [errors, setErrors] = useState<string[]>([]);

  const serializedDefaultVars =
    defaultVariables !== undefined ? canonicalize(defaultVariables) : '';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableDefaultVars = useMemo(() => defaultVariables, [serializedDefaultVars]);

  const mutateData = useCallback(
    async (overrideVars?: TVars, replace = false): Promise<TData | undefined> => {
      setLoading(true);
      setErrors([]);

      const varsToSend = resolveVariables(stableDefaultVars, overrideVars, replace);

      try {
        const response = await fetchGraphQL<TData>({
          query,
          variables: varsToSend,
        });

        const errorMsgs = (response.errors ?? []).map(formatGraphQLError);

        if (errorMsgs.length > 0) {
          setErrors(errorMsgs);
          setLoading(false);

          if (throwError) {
            const err = new Error(errorMsgs.join('; '));
            (err as unknown as { graphQLErrors: string[] }).graphQLErrors = errorMsgs;
            throw err;
          }

          return response.data;
        }

        setLoading(false);
        return response.data;
      } catch (err: unknown) {
        setLoading(false);

        const msg = err instanceof Error ? err.message : 'Unknown mutation error';
        setErrors([msg]);

        if (throwError) {
          throw err;
        }

        return undefined;
      }
    },
    [query, stableDefaultVars, throwError]
  );

  return {
    loading,
    errors,
    mutateData,
  };
}
