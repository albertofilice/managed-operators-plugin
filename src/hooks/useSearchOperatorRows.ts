import * as React from 'react';
import type { OperatorRow } from './useManagedClusterSubscriptions';
import { searchItems } from '../utils/searchApi';
import { SEARCH_OLM_FILTERS, installedCsvNames, rowsFromSearch } from '../utils/searchRows';

export type SearchRowsState = {
  rows: OperatorRow[];
  loaded: boolean;
  /** Search could not be used (disabled, unreachable, or has no data yet): use the per-cluster proxy. */
  unavailable: boolean;
  reason?: string;
};

/**
 * Loads every Subscription and its installed CSV for the given clusters with two Search queries,
 * instead of listing each cluster through the MCE proxy.
 */
export function useSearchOperatorRows(clusterNames: string[], enabled: boolean): SearchRowsState {
  const [state, setState] = React.useState<SearchRowsState>({
    rows: [],
    loaded: false,
    unavailable: false,
  });
  const key = clusterNames.join('\n');

  React.useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    setState({ rows: [], loaded: false, unavailable: false });
    (async () => {
      try {
        const clusters = { property: 'cluster', values: clusterNames };
        const subs = await searchItems([
          { property: 'kind', values: ['Subscription'] },
          ...SEARCH_OLM_FILTERS,
          clusters,
        ]);
        const names = installedCsvNames(subs);
        const csvs = names.length
          ? await searchItems([
              { property: 'kind', values: ['ClusterServiceVersion'] },
              ...SEARCH_OLM_FILTERS,
              clusters,
              { property: 'name', values: names },
            ])
          : [];
        if (cancelled) return;
        const rows = rowsFromSearch(subs, csvs, clusterNames);
        if (rows.length === 0 && clusterNames.length > 0) {
          setState({ rows: [], loaded: true, unavailable: true, reason: 'no data' });
          return;
        }
        setState({ rows, loaded: true, unavailable: false });
      } catch (e) {
        if (!cancelled) {
          setState({ rows: [], loaded: true, unavailable: true, reason: String(e) });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // `clusterNames` is represented by `key`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  return state;
}
