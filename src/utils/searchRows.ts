import type { OperatorRow } from '../hooks/useManagedClusterSubscriptions';
import {
  csvNameToVersion,
  formatSubscriptionStateDisplay,
} from '../hooks/useManagedClusterSubscriptions';
import { OP_POLICY_MANAGED_LABEL } from './operatorPolicySubscriptionRef';
import type { SearchItem } from './searchApi';

const OLM_GROUP = 'operators.coreos.com';

/** ACM Search encodes labels as `k=v; k2=v2`. */
function hasLabel(item: SearchItem, key: string): boolean {
  return (item.label ?? '').split('; ').some((l) => l === key || l.startsWith(`${key}=`));
}

export function csvKey(cluster: string, namespace: string, name: string): string {
  return `${cluster}|${namespace}|${name}`;
}

/** Names of the CSVs the subscriptions report as installed, to look up in Search. */
export function installedCsvNames(subs: SearchItem[]): string[] {
  return [...new Set(subs.map((s) => s.installplan).filter(Boolean))];
}

/**
 * Builds the rows the Overview needs from Search items. Search does not index InstallPlan approval
 * or annotations, so: "upgrade pending" is the Subscription state `UpgradePending`, "has policy
 * ref" is the OperatorPolicy-managed label, and plugin-created/external cannot be told apart.
 */
export function rowsFromSearch(
  subs: SearchItem[],
  csvs: SearchItem[],
  clusterNames: string[],
): OperatorRow[] {
  const ready = new Set(clusterNames);
  const csvByKey = new Map(csvs.map((c) => [csvKey(c.cluster, c.namespace, c.name), c]));
  const rows: OperatorRow[] = [];
  for (const s of subs) {
    if (!ready.has(s.cluster)) continue;
    const csvName = s.installplan ?? '';
    const csv = csvName ? csvByKey.get(csvKey(s.cluster, s.namespace, csvName)) : undefined;
    const csvPhase = csv?.phase ?? 'Unknown';
    const csvSucceeded = csvPhase === 'Succeeded';
    const governed = hasLabel(s, OP_POLICY_MANAGED_LABEL);
    rows.push({
      clusterKey: s.cluster,
      clusterDisplayName: s.cluster,
      namespace: s.namespace,
      name: s.name,
      csvVersion: csv?.version ?? csvNameToVersion(csvName),
      csvFullName: csvName || '—',
      installPlanApproval: '—',
      csvPhase,
      csvSucceeded,
      subscriptionStateDisplay: formatSubscriptionStateDisplay(
        s.phase,
        csvSucceeded,
        Boolean(csv),
        csvPhase,
      ),
      upgradePending: s.phase === 'UpgradePending' ? 'UpgradePending' : null,
      installPlanRef: null,
      installPlanApprovalRequired: false,
      operatorPolicyManagedDisplay: governed ? '(OperatorPolicy)' : null,
      // The policy name is not indexed; the placeholder only marks "has a policy reference".
      operatorPolicyRef: governed ? { namespace: '', name: '' } : null,
      policyGovernanceManaged: governed,
      migrationEnrollLabelRequested: false,
      installPrefillQuery: {
        packageName: s.package || s.name,
        subscriptionNamespace: s.namespace,
        channel: s.channel ?? '',
        source: s.source ?? '',
        sourceNamespace: '',
        installPlanApproval: 'Automatic',
        startingCSV: csvName,
      },
    });
  }
  rows.sort(
    (a, b) =>
      a.clusterDisplayName.localeCompare(b.clusterDisplayName) ||
      a.namespace.localeCompare(b.namespace) ||
      a.name.localeCompare(b.name),
  );
  return rows;
}

export const SEARCH_OLM_FILTERS = [{ property: 'apigroup', values: [OLM_GROUP] }];

/** Above this many Ready clusters, Installed Operators lists from Search and loads details per cluster. */
export const LAZY_CLUSTER_THRESHOLD = 10;

/** Replaces the Search rows of every cluster whose details are loaded with the detailed rows. */
export function mergeClusterRows(
  base: OperatorRow[],
  detail: Record<string, OperatorRow[]>,
): OperatorRow[] {
  const merged = base.filter((r) => !detail[r.clusterKey]);
  for (const rows of Object.values(detail)) merged.push(...rows);
  merged.sort(
    (a, b) =>
      a.clusterDisplayName.localeCompare(b.clusterDisplayName) ||
      a.namespace.localeCompare(b.namespace) ||
      a.name.localeCompare(b.name),
  );
  return merged;
}
