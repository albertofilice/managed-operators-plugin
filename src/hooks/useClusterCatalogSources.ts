import * as React from 'react';
import { consoleFetchJSON } from '@openshift-console/dynamic-plugin-sdk';
import type { CatalogSourceKind, CatalogSourceList } from '../types/catalogSource';
import { clusterApiPath } from '../utils/clusterApi';

export function useClusterCatalogSources(clusterKey: string | undefined) {
  const [items, setItems] = React.useState<CatalogSourceKind[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<unknown>();

  React.useEffect(() => {
    if (!clusterKey) {
      setItems([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    (async () => {
      try {
        const path = clusterApiPath(
          clusterKey,
          '/apis/operators.coreos.com/v1alpha1/namespaces/openshift-marketplace/catalogsources',
        );
        const list = (await consoleFetchJSON(path, 'GET')) as CatalogSourceList;
        if (!cancelled) {
          setItems(list.items ?? []);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e);
          setItems([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clusterKey]);

  return { catalogSources: items, loadingCs: loading, csError: error };
}
