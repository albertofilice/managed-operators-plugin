import * as React from 'react';
import { loadClusterRows, type OperatorRow } from './useManagedClusterSubscriptions';

/**
 * Loads the full rows (InstallPlan, policy and CSV details) of one cluster at a time, on demand.
 * Used with Search rows on large fleets so only the clusters someone opens hit the MCE proxy.
 */
export function useClusterDetail(
  enabled: boolean,
  refreshEpoch: number,
): {
  detail: Record<string, OperatorRow[]>;
  loading: Record<string, boolean>;
  errors: Record<string, unknown>;
  // eslint-disable-next-line no-unused-vars
  load: (_clusterKey: string) => void;
} {
  const [detail, setDetail] = React.useState<Record<string, OperatorRow[]>>({});
  const [loading, setLoading] = React.useState<Record<string, boolean>>({});
  const [errors, setErrors] = React.useState<Record<string, unknown>>({});
  const detailRef = React.useRef(detail);
  React.useEffect(() => {
    detailRef.current = detail;
  }, [detail]);
  const inflight = React.useRef(new Set<string>());
  const generation = React.useRef(0);

  React.useEffect(() => {
    generation.current += 1;
    inflight.current.clear();
    setDetail({});
    setLoading({});
    setErrors({});
  }, [enabled, refreshEpoch]);

  const load = React.useCallback(
    (clusterKey: string) => {
      if (!enabled || detailRef.current[clusterKey] || inflight.current.has(clusterKey)) return;
      const gen = generation.current;
      inflight.current.add(clusterKey);
      setLoading((l) => ({ ...l, [clusterKey]: true }));
      loadClusterRows(clusterKey, refreshEpoch)
        .then((rows) => {
          if (gen === generation.current) setDetail((d) => ({ ...d, [clusterKey]: rows }));
        })
        .catch((e) => {
          if (gen === generation.current) setErrors((x) => ({ ...x, [clusterKey]: e }));
        })
        .finally(() => {
          if (gen !== generation.current) return;
          inflight.current.delete(clusterKey);
          setLoading((l) => ({ ...l, [clusterKey]: false }));
        });
    },
    [enabled, refreshEpoch],
  );

  return { detail, loading, errors, load };
}
