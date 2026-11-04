import type { Plugin } from 'graphql-yoga';

/** Stub for `extensions.cost` (real cost accounting is a later task; see docs/spec/admin-api-mvp.md 1.6). */
export function useCostExtension(): Plugin {
  return {
    onExecute: () => ({
      onExecuteDone({ result, setResult }) {
        if ('data' in result || 'errors' in result) {
          setResult({
            ...result,
            extensions: { ...result.extensions, cost: { requestedQueryCost: 0, actualQueryCost: 0, throttleStatus: { maximumAvailable: 2000, currentlyAvailable: 2000, restoreRate: 100 } } },
          });
        }
      },
    }),
  };
}
