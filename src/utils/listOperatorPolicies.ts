import { consoleFetchJSON } from '@openshift-console/dynamic-plugin-sdk';
import type { OperatorPolicyKind, OperatorPolicyList } from '../types/operatorPolicy';
import { clusterApiPath } from './clusterApi';
import {
  cachedConsoleFetchJson,
  MANAGED_OPERATORS_GET_CACHE_TTL_MS,
  operatorPolicyListCacheKey,
} from './managedOperatorsGetCache';

const GROUP = '/apis/policy.open-cluster-management.io/v1beta1';

export type ListOperatorPoliciesOptions = {
  /** Invalidate cache when subscriptions refresh (e.g. Installed Operators page). */
  listScope?: number;
  bypassCache?: boolean;
};

async function fetchPolicyList(
  clusterKey: string,
  apiPath: string,
  listScope: number,
  bypassCache: boolean,
): Promise<OperatorPolicyList> {
  const url = clusterApiPath(clusterKey, apiPath);
  return cachedConsoleFetchJson(
    operatorPolicyListCacheKey(listScope, url),
    MANAGED_OPERATORS_GET_CACHE_TTL_MS,
    () => consoleFetchJSON(url, 'GET') as Promise<OperatorPolicyList>,
    { bypassCache },
  );
}

/** List OperatorPolicies on the managed cluster (cluster-wide list first, then known namespaces). */
export async function listOperatorPoliciesForCluster(
  clusterKey: string,
  options?: ListOperatorPoliciesOptions,
): Promise<OperatorPolicyKind[]> {
  const listScope = options?.listScope ?? 0;
  const bypassCache = options?.bypassCache ?? false;

  try {
    const list = await fetchPolicyList(clusterKey, `${GROUP}/operatorpolicies`, listScope, bypassCache);
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
      const list = await fetchPolicyList(
        clusterKey,
        `${GROUP}/namespaces/${encodeURIComponent(ns)}/operatorpolicies`,
        listScope,
        bypassCache,
      );
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
