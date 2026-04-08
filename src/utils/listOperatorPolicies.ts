import { consoleFetchJSON } from '@openshift-console/dynamic-plugin-sdk';
import type { OperatorPolicyKind, OperatorPolicyList } from '../types/operatorPolicy';
import { clusterApiPath } from './clusterApi';

const GROUP = '/apis/policy.open-cluster-management.io/v1beta1';

/** List OperatorPolicies on the managed cluster (cluster-wide list first, then known namespaces). */
export async function listOperatorPoliciesForCluster(clusterKey: string): Promise<OperatorPolicyKind[]> {
  try {
    const list = (await consoleFetchJSON(
      clusterApiPath(clusterKey, `${GROUP}/operatorpolicies`),
      'GET',
    )) as OperatorPolicyList;
    if (list.items?.length) {
      return dedupeByUid(list.items);
    }
  } catch {
    /* cluster-wide list not available */
  }

  const namespaces = Array.from(
    new Set([
      clusterKey,
      'open-cluster-management',
      'open-cluster-management-policies',
      'open-cluster-management-global-set',
      'local-cluster',
    ]),
  );

  const merged: OperatorPolicyKind[] = [];
  for (const ns of namespaces) {
    try {
      const list = (await consoleFetchJSON(
        clusterApiPath(clusterKey, `${GROUP}/namespaces/${encodeURIComponent(ns)}/operatorpolicies`),
        'GET',
      )) as OperatorPolicyList;
      merged.push(...(list.items ?? []));
    } catch {
      /* missing namespace or RBAC */
    }
  }
  return dedupeByUid(merged);
}

function dedupeByUid(items: OperatorPolicyKind[]): OperatorPolicyKind[] {
  const seen = new Set<string>();
  const out: OperatorPolicyKind[] = [];
  for (const it of items) {
    const u = it.metadata?.uid ?? `${it.metadata?.namespace}/${it.metadata?.name}`;
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(it);
  }
  return out;
}
