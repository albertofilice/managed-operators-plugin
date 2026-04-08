import * as React from 'react';
import { consoleFetchJSON } from '@openshift-console/dynamic-plugin-sdk';
import type { ClusterServiceVersionKind, InstallPlanKind, InstallPlanList } from '../types/olm';
import type { SubscriptionKind, SubscriptionList } from '../types/subscription';
import { clusterApiPath, HUB_SUBSCRIPTIONS_PATH } from '../utils/clusterApi';
import {
  cachedConsoleFetchJson,
  MANAGED_OPERATORS_GET_CACHE_TTL_MS,
  subscriptionGetCacheKey,
} from '../utils/managedOperatorsGetCache';
import { SUBSCRIPTION_ENROLL_OPERATOR_POLICY_LABEL } from '../constants/subscriptionMigration';
import {
  OP_POLICY_MANAGED_ANNOTATION,
  OP_POLICY_MANAGED_LABEL,
  parseOperatorPolicyRefFromManagedValue,
} from '../utils/operatorPolicySubscriptionRef';

export type OperatorRow = {
  /** Key for managed-cluster proxy API (ManagedCluster name or __hub_direct__). */
  clusterKey: string;
  /** Label shown in the UI (accordion title). */
  clusterDisplayName: string;
  namespace: string;
  name: string;
  csvVersion: string;
  csvFullName: string;
  installPlanApproval: 'Automatic' | 'Manual' | '—';
  csvPhase: string;
  csvSucceeded: boolean;
  /** OLM `Subscription.status.state` rewritten for clarity (see `formatSubscriptionStateDisplay`). */
  subscriptionStateDisplay: string;
  /** Human-readable pending upgrade / install plan info, or null if none detected */
  upgradePending: string | null;
  /** Subscription annotation value or short label when OperatorPolicy-managed. */
  operatorPolicyManagedDisplay: string | null;
  /** Parsed ref for GET OperatorPolicy (namespace + name), if annotation is parseable. */
  operatorPolicyRef: { namespace: string; name: string } | null;
  /** Subscription is governed by OperatorPolicy (ACM annotation or managed label). */
  policyGovernanceManaged: boolean;
  /** Plugin migration label applied; create a matching OperatorPolicy next (Install operators or automation). */
  migrationEnrollLabelRequested: boolean;
};

/**
 * Maps raw OLM subscription state to UI text. `AtLatestKnown` is unclear next to CSV status;
 * when the CSV exists and is Succeeded we show "Succeeded"; if the CSV is missing or not ready we
 * avoid implying the subscription is fully healthy.
 */
export function formatSubscriptionStateDisplay(
  rawState: string | undefined,
  csvSucceeded: boolean,
  csvPresent: boolean,
  csvPhase: string,
): string {
  const raw = (rawState ?? '').trim();

  if (!csvPresent || !csvSucceeded) {
    if (raw === 'AtLatestKnown') {
      if (!csvPresent) {
        return 'Pending (CSV missing or not loaded)';
      }
      return `Pending (CSV ${csvPhase})`;
    }
  }

  if (raw === 'AtLatestKnown' && csvSucceeded) {
    return 'Succeeded';
  }

  if (raw === 'UpgradeAvailable') {
    return 'Upgrade available';
  }

  if (!raw) {
    return '—';
  }

  return raw;
}

export function csvNameToVersion(csv?: string): string {
  if (!csv) return '—';
  const parts = csv.split('.');
  if (parts.length < 2) return csv;
  return parts.slice(1).join('.');
}

async function fetchSubscriptionsForCluster(
  clusterName: string,
  refreshEpoch: number,
): Promise<SubscriptionKind[]> {
  if (clusterName === '__hub_direct__') {
    const list = await cachedConsoleFetchJson(
      subscriptionGetCacheKey(refreshEpoch, HUB_SUBSCRIPTIONS_PATH),
      MANAGED_OPERATORS_GET_CACHE_TTL_MS,
      () => consoleFetchJSON(HUB_SUBSCRIPTIONS_PATH, 'GET') as Promise<SubscriptionList>,
    );
    return list.items ?? [];
  }
  const path = clusterApiPath(
    clusterName,
    '/apis/operators.coreos.com/v1alpha1/subscriptions',
  );
  const list = await cachedConsoleFetchJson(
    subscriptionGetCacheKey(refreshEpoch, path),
    MANAGED_OPERATORS_GET_CACHE_TTL_MS,
    () => consoleFetchJSON(path, 'GET') as Promise<SubscriptionList>,
  );
  return list.items ?? [];
}

async function fetchInstallPlansForCluster(
  clusterKey: string,
  refreshEpoch: number,
): Promise<InstallPlanKind[]> {
  try {
    const path = clusterApiPath(clusterKey, '/apis/operators.coreos.com/v1alpha1/installplans');
    const list = await cachedConsoleFetchJson(
      subscriptionGetCacheKey(refreshEpoch, path),
      MANAGED_OPERATORS_GET_CACHE_TTL_MS,
      () => consoleFetchJSON(path, 'GET') as Promise<InstallPlanList>,
    );
    return list.items ?? [];
  } catch {
    return [];
  }
}

async function fetchCsv(
  clusterKey: string,
  namespace: string,
  csvName: string,
  refreshEpoch: number,
): Promise<ClusterServiceVersionKind | null> {
  try {
    const path = clusterApiPath(
      clusterKey,
      `/apis/operators.coreos.com/v1alpha1/namespaces/${encodeURIComponent(namespace)}/clusterserviceversions/${encodeURIComponent(csvName)}`,
    );
    return await cachedConsoleFetchJson(
      subscriptionGetCacheKey(refreshEpoch, path),
      MANAGED_OPERATORS_GET_CACHE_TTL_MS,
      () => consoleFetchJSON(path, 'GET') as Promise<ClusterServiceVersionKind>,
    );
  } catch {
    return null;
  }
}

function installPlanForSubscription(
  sub: SubscriptionKind,
  plans: InstallPlanKind[],
): InstallPlanKind | undefined {
  const ns = sub.metadata?.namespace;
  const subName = sub.metadata?.name;
  if (!ns || !subName) return undefined;

  const byOwner = plans.find(
    (ip) =>
      ip.metadata?.namespace === ns &&
      ip.metadata?.ownerReferences?.some((ref) => ref.kind === 'Subscription' && ref.name === subName),
  );
  if (byOwner) return byOwner;

  const ref = sub.status?.installPlanRef;
  if (ref?.name) {
    const refNs = ref.namespace ?? ns;
    return plans.find((ip) => ip.metadata?.name === ref.name && ip.metadata?.namespace === refNs);
  }
  return undefined;
}

function buildUpgradeMessage(
  sub: SubscriptionKind,
  ip: InstallPlanKind | undefined,
): string | null {
  if (sub.status?.state === 'UpgradeAvailable') {
    if (ip?.metadata?.name) {
      const ph = ip.status?.phase ?? ip.status?.state ?? '';
      if (ph && ph !== 'Complete') {
        return `Upgrade available — InstallPlan ${ip.metadata.name} (${ph})`;
      }
    }
    return 'Upgrade available';
  }

  if (!ip) return null;

  const phase = ip.status?.phase ?? ip.status?.state ?? '';
  if (!phase || phase === 'Complete') return null;

  const manual =
    ip.spec?.approval === 'Manual' && ip.spec?.approved === false ? ' (approval required)' : '';
  return `InstallPlan ${ip.metadata?.name ?? '—'}: ${phase}${manual}`;
}

async function enrichSubscriptionsForCluster(
  clusterKey: string,
  displayName: string,
  subs: SubscriptionKind[],
  refreshEpoch: number,
): Promise<OperatorRow[]> {
  const [installPlans] = await Promise.all([
    fetchInstallPlansForCluster(clusterKey, refreshEpoch),
  ]);

  const csvKeys = new Map<string, { ns: string; csv: string }>();
  for (const sub of subs) {
    const csv = sub.status?.currentCSV ?? sub.status?.installedCSV;
    const ns = sub.metadata?.namespace;
    if (csv && ns) {
      csvKeys.set(`${ns}|${csv}`, { ns, csv });
    }
  }

  const csvMap = new Map<string, ClusterServiceVersionKind | null>();
  await Promise.all(
    [...csvKeys.entries()].map(async ([key, { ns, csv }]) => {
      const data = await fetchCsv(clusterKey, ns, csv, refreshEpoch);
      csvMap.set(key, data);
    }),
  );

  return subs.map((sub) => {
    const ns = sub.metadata?.namespace ?? '—';
    const name = sub.metadata?.name ?? '—';
    const approval = sub.spec?.installPlanApproval;
    const csvName = sub.status?.currentCSV ?? sub.status?.installedCSV ?? '';
    const csvKey = csvName && ns !== '—' ? `${ns}|${csvName}` : '';
    const csv = csvKey ? csvMap.get(csvKey) : null;
    const csvPhase = csv?.status?.phase ?? 'Unknown';
    const csvSucceeded = csvPhase === 'Succeeded';
    const csvPresent = Boolean(csvName && csv);

    const ip = installPlanForSubscription(sub, installPlans);
    const upgradePending = buildUpgradeMessage(sub, ip);

    const rawSubState = sub.status?.state;
    const subscriptionStateDisplay = formatSubscriptionStateDisplay(
      rawSubState,
      csvSucceeded,
      csvPresent,
      csvPhase,
    );

    const managedAnn = sub.metadata?.annotations?.[OP_POLICY_MANAGED_ANNOTATION];
    const ref = managedAnn ? parseOperatorPolicyRefFromManagedValue(managedAnn) : null;
    const hasManagedLabel = sub.metadata?.labels?.[OP_POLICY_MANAGED_LABEL] !== undefined;
    const policyGovernanceManaged = Boolean(managedAnn || hasManagedLabel);
    const enrollRaw = sub.metadata?.labels?.[SUBSCRIPTION_ENROLL_OPERATOR_POLICY_LABEL];
    const migrationEnrollLabelRequested =
      enrollRaw === 'true' || enrollRaw === 'True' || enrollRaw === '1';

    const operatorPolicyManagedDisplay = managedAnn
      ? managedAnn
      : hasManagedLabel
        ? '(OperatorPolicy)'
        : null;

    return {
      clusterKey: clusterKey,
      clusterDisplayName: displayName,
      namespace: ns,
      name,
      csvVersion: csvNameToVersion(csvName),
      csvFullName: csvName || '—',
      installPlanApproval: approval === 'Automatic' || approval === 'Manual' ? approval : '—',
      csvPhase,
      csvSucceeded,
      subscriptionStateDisplay,
      upgradePending,
      operatorPolicyManagedDisplay,
      operatorPolicyRef: ref,
      policyGovernanceManaged,
      migrationEnrollLabelRequested,
    };
  });
}

function displayClusterName(requested: string): string {
  if (requested === '__hub_direct__') return 'Hub (current session)';
  return requested;
}

export function useManagedClusterSubscriptions(clusterNames: string[], refreshEpoch = 0) {
  const [rows, setRows] = React.useState<OperatorRow[]>([]);
  const [loaded, setLoaded] = React.useState(false);
  const [error, setError] = React.useState<unknown>();

  const key = `${clusterNames.join('\0')}\0${refreshEpoch}`;

  React.useEffect(() => {
    let cancelled = false;

    const names =
      clusterNames.length > 0 ? [...clusterNames].sort() : ['__hub_direct__'];

    setLoaded(false);
    setError(undefined);

    const epoch = refreshEpoch;

    (async () => {
      const results = await Promise.allSettled(
        names.map(async (clusterKey) => {
          const subs = await fetchSubscriptionsForCluster(clusterKey, epoch);
          const displayName = displayClusterName(clusterKey);
          return enrichSubscriptionsForCluster(clusterKey, displayName, subs, epoch);
        }),
      );
      if (cancelled) return;

      const next: OperatorRow[] = [];
      const errors: unknown[] = [];

      results.forEach((result) => {
        if (result.status === 'rejected') {
          errors.push(result.reason);
          return;
        }
        next.push(...result.value);
      });

      next.sort(
        (a, b) =>
          a.clusterDisplayName.localeCompare(b.clusterDisplayName) ||
          a.namespace.localeCompare(b.namespace) ||
          a.name.localeCompare(b.name),
      );
      setRows(next);
      if (errors.length > 0) {
        setError(errors[0]);
      }
      setLoaded(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [key]);

  return { rows, loaded, error };
}
