import * as React from 'react';
import { consoleFetchJSON } from '@openshift-console/dynamic-plugin-sdk';
import type { OperatorPolicyKind } from '../types/operatorPolicy';
import { PLUGIN_CREATED_ANNOTATION } from '../constants/operatorPolicyPlugin';
import { clusterApiPath } from '../utils/clusterApi';
import {
  cachedConsoleFetchJson,
  MANAGED_OPERATORS_GET_CACHE_TTL_MS,
  operatorPolicyGetCacheKey,
} from '../utils/managedOperatorsGetCache';
import { listOperatorPolicyListing } from '../utils/listOperatorPolicies';
import { isNotFoundError } from '../utils/policyLookup';
import type { OperatorRow } from './useManagedClusterSubscriptions';

/** Resolved metadata for one subscription↔policy ref (same fetch as plugin-created check). */
export type PolicyLineMeta = {
  pluginCreated: boolean;
  /** The subscription names an OperatorPolicy that does not exist on the cluster (deleted, never created). */
  missing?: boolean;
  remediation?: 'inform' | 'enforce';
};

export type PluginPolicyEditableMap = Record<string, PolicyLineMeta>;

function refKey(r: OperatorRow): string | null {
  if (!r.operatorPolicyRef) return null;
  return `${r.clusterKey}|${r.operatorPolicyRef.namespace}|${r.operatorPolicyRef.name}`;
}

function metaFromPolicy(policy: OperatorPolicyKind): PolicyLineMeta {
  const raw = policy.spec?.remediationAction;
  const remediation = raw === 'inform' || raw === 'enforce' ? raw : undefined;
  return {
    pluginCreated: policy.metadata?.annotations?.[PLUGIN_CREATED_ANNOTATION] === 'true',
    remediation,
  };
}

/**
 * For each subscription with an OperatorPolicy ref, resolve the policy and check the plugin annotation.
 * Loads policies with one list per managed cluster when possible, then GET only for refs missing from
 * the list (other namespaces / RBAC). Used to show "Edit policy" only when editable from this console.
 * Policies without the annotation (hub Policy, YAML, GitOps, etc.) are "external" for this UI.
 */
export function usePluginPolicyEditableMap(
  rows: OperatorRow[],
  /** Bump when subscriptions are explicitly refreshed so policy list / GET cache misses. */
  policyListCacheScope = 0,
): {
  loading: boolean;
  // eslint-disable-next-line no-unused-vars
  canEditPlugin: (_: OperatorRow) => boolean;
  /** OperatorPolicy exists on cluster but was not created from this plugin (e.g. hub `Policy` → reconciled OperatorPolicy). */
  // eslint-disable-next-line no-unused-vars
  isExternalGovernancePolicy: (_: OperatorRow) => boolean;
  /** The subscription points at an OperatorPolicy that no longer exists on the cluster. */
  // eslint-disable-next-line no-unused-vars
  isMissingPolicy: (_: OperatorRow) => boolean;
  /** Policy spec uses remediation inform (observe-only until enforced elsewhere). */
  // eslint-disable-next-line no-unused-vars
  isInformRemediation: (_: OperatorRow) => boolean;
} {
  const [map, setMap] = React.useState<PluginPolicyEditableMap>({});

  const [loading, setLoading] = React.useState(false);

  const serialized = React.useMemo(() => {
    const keys = new Set<string>();
    for (const r of rows) {
      const k = refKey(r);
      if (k) keys.add(k);
    }
    return [...keys].sort().join('\n');
  }, [rows]);

  React.useEffect(() => {
    if (!serialized) {
      setMap({});
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const entries = serialized.split('\n').filter(Boolean);

    (async () => {
      const next: PluginPolicyEditableMap = {};
      const clusterKeys = new Set<string>();
      for (const line of entries) {
        const clusterKey = line.split('|')[0];
        if (clusterKey) clusterKeys.add(clusterKey);
      }

      const policyPath = (namespace: string, name: string) =>
        `/apis/policy.open-cluster-management.io/v1beta1/namespaces/${encodeURIComponent(namespace)}/operatorpolicies/${encodeURIComponent(name)}`;

      await Promise.all(
        [...clusterKeys].map(async (clusterKey) => {
          const { items: policies, complete } = await listOperatorPolicyListing(clusterKey, {
            listScope: policyListCacheScope,
          });
          const byNsName = new Map<string, OperatorPolicyKind>();
          for (const p of policies) {
            const ns = p.metadata?.namespace;
            const n = p.metadata?.name;
            if (ns && n) byNsName.set(`${ns}|${n}`, p);
          }

          const linesHere = entries.filter((line) => line.split('|')[0] === clusterKey);

          await Promise.all(
            linesHere.map(async (line) => {
              const parts = line.split('|');
              const namespace = parts[1];
              const name = parts[2];
              if (!namespace || !name) return;

              const cached = byNsName.get(`${namespace}|${name}`);
              if (cached) {
                next[line] = metaFromPolicy(cached);
                return;
              }

              // The cluster-wide list answered and does not have it: it is not there, no need to ask.
              if (complete) {
                next[line] = { pluginCreated: false, missing: true };
                return;
              }

              try {
                const url = clusterApiPath(clusterKey, policyPath(namespace, name));
                const policy = await cachedConsoleFetchJson(
                  operatorPolicyGetCacheKey(policyListCacheScope, url),
                  MANAGED_OPERATORS_GET_CACHE_TTL_MS,
                  () => consoleFetchJSON(url, 'GET') as Promise<OperatorPolicyKind>,
                );
                next[line] = metaFromPolicy(policy);
              } catch (e) {
                next[line] = isNotFoundError(e)
                  ? { pluginCreated: false, missing: true }
                  : { pluginCreated: false };
              }
            }),
          );
        }),
      );

      if (!cancelled) {
        setMap(next);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [serialized, policyListCacheScope]);

  const canEditPlugin = React.useCallback(
    (r: OperatorRow) => {
      const k = refKey(r);
      if (!k) return false;
      return map[k]?.pluginCreated === true;
    },
    [map],
  );

  const isExternalGovernancePolicy = React.useCallback(
    (r: OperatorRow) => {
      const k = refKey(r);
      if (!k || loading) return false;
      return map[k]?.pluginCreated === false && !map[k]?.missing;
    },
    [loading, map],
  );

  const isMissingPolicy = React.useCallback(
    (r: OperatorRow) => {
      const k = refKey(r);
      if (!k || loading) return false;
      return map[k]?.missing === true;
    },
    [loading, map],
  );

  const isInformRemediation = React.useCallback(
    (r: OperatorRow) => {
      const k = refKey(r);
      if (!k || loading) return false;
      return map[k]?.remediation === 'inform';
    },
    [loading, map],
  );

  return {
    loading,
    canEditPlugin,
    isExternalGovernancePolicy,
    isMissingPolicy,
    isInformRemediation,
  };
}
