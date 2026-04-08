import * as React from 'react';
import { consoleFetchJSON } from '@openshift-console/dynamic-plugin-sdk';
import type { OperatorPolicyKind } from '../types/operatorPolicy';
import { PLUGIN_CREATED_ANNOTATION } from '../constants/operatorPolicyPlugin';
import { clusterApiPath } from '../utils/clusterApi';
import { listOperatorPoliciesForCluster } from '../utils/listOperatorPolicies';
import type { OperatorRow } from './useManagedClusterSubscriptions';

export type PluginPolicyEditableMap = Record<string, boolean>;

function refKey(r: OperatorRow): string | null {
  if (!r.operatorPolicyRef) return null;
  return `${r.clusterKey}|${r.operatorPolicyRef.namespace}|${r.operatorPolicyRef.name}`;
}

/**
 * For each subscription with an OperatorPolicy ref, resolve the policy and check the plugin annotation.
 * Loads policies with one list per managed cluster when possible, then GET only for refs missing from
 * the list (other namespaces / RBAC). Used to show "Edit policy" only when editable from this console.
 * Policies without the annotation (hub Policy, YAML, GitOps, etc.) are "external" for this UI.
 */
export function usePluginPolicyEditableMap(rows: OperatorRow[]): {
  loading: boolean;
  canEditPlugin: (r: OperatorRow) => boolean;
  /** OperatorPolicy exists on cluster but was not created from this plugin (e.g. hub `Policy` → reconciled OperatorPolicy). */
  isExternalGovernancePolicy: (r: OperatorRow) => boolean;
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

      const isPluginCreated = (policy: OperatorPolicyKind) =>
        policy.metadata?.annotations?.[PLUGIN_CREATED_ANNOTATION] === 'true';

      await Promise.all(
        [...clusterKeys].map(async (clusterKey) => {
          const policies = await listOperatorPoliciesForCluster(clusterKey);
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
                next[line] = isPluginCreated(cached);
                return;
              }

              try {
                const url = clusterApiPath(clusterKey, policyPath(namespace, name));
                const policy = (await consoleFetchJSON(url, 'GET')) as OperatorPolicyKind;
                next[line] = isPluginCreated(policy);
              } catch {
                next[line] = false;
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
  }, [serialized]);

  const canEditPlugin = React.useCallback(
    (r: OperatorRow) => {
      const k = refKey(r);
      if (!k) return false;
      return map[k] === true;
    },
    [map],
  );

  const isExternalGovernancePolicy = React.useCallback(
    (r: OperatorRow) => {
      const k = refKey(r);
      if (!k || loading) return false;
      return map[k] === false;
    },
    [loading, map],
  );

  return { loading, canEditPlugin, isExternalGovernancePolicy };
}
