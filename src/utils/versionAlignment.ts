import type { OperatorRow } from '../hooks/useManagedClusterSubscriptions';

export type VersionGroup = { version: string; clusters: string[] };

export type OperatorAlignment = {
  /** OLM package name (`Subscription.spec.name`), falling back to the Subscription name. */
  operator: string;
  /** Same installed version on every cluster that has the operator. */
  aligned: boolean;
  /** Distinct installed versions, each with the clusters running it (newest first). */
  versions: VersionGroup[];
  clusterCount: number;
};

export type AlignmentSummary = {
  /** Operators installed on two or more clusters, misaligned first, then by name. */
  comparable: OperatorAlignment[];
  aligned: number;
  misaligned: number;
  /** Operators found on one cluster only (nothing to compare against). */
  singleCluster: number;
};

const UNKNOWN_VERSION = '—';

function compareVersions(a: string, b: string): number {
  return b.localeCompare(a, undefined, { numeric: true });
}

/** Compares the installed operator version across clusters (hub included). */
export function computeVersionAlignment(rows: OperatorRow[]): AlignmentSummary {
  const byOperator = new Map<string, Map<string, Set<string>>>();
  for (const r of rows) {
    if (!r.csvVersion || r.csvVersion === UNKNOWN_VERSION) continue;
    const operator = r.installPrefillQuery?.packageName || r.name;
    const versions = byOperator.get(operator) ?? new Map<string, Set<string>>();
    const clusters = versions.get(r.csvVersion) ?? new Set<string>();
    clusters.add(r.clusterDisplayName);
    versions.set(r.csvVersion, clusters);
    byOperator.set(operator, versions);
  }

  const comparable: OperatorAlignment[] = [];
  let singleCluster = 0;
  for (const [operator, versions] of byOperator) {
    const clusterCount = new Set([...versions.values()].flatMap((c) => [...c])).size;
    if (clusterCount < 2) {
      singleCluster += 1;
      continue;
    }
    comparable.push({
      operator,
      aligned: versions.size === 1,
      clusterCount,
      versions: [...versions.entries()]
        .sort(([a], [b]) => compareVersions(a, b))
        .map(([version, clusters]) => ({ version, clusters: [...clusters].sort() })),
    });
  }
  comparable.sort(
    (a, b) => Number(a.aligned) - Number(b.aligned) || a.operator.localeCompare(b.operator),
  );
  const aligned = comparable.filter((o) => o.aligned).length;
  return { comparable, aligned, misaligned: comparable.length - aligned, singleCluster };
}
