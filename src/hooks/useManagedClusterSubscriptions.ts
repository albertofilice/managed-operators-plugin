import * as React from 'react';
import { consoleFetchJSON } from '@openshift-console/dynamic-plugin-sdk';
import type { ClusterServiceVersionKind, InstallPlanKind } from '../types/olm';
import type { SubscriptionKind } from '../types/subscription';
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
  formatOperatorPolicyManagedDisplay,
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
  /** InstallPlan detected for this subscription (namespace/name), if any. */
  installPlanRef: { namespace: string; name: string } | null;
  /** InstallPlan requires manual approval (spec.approval=Manual and spec.approved=false). */
  installPlanApprovalRequired: boolean;
  /** Subscription annotation value or short label when OperatorPolicy-managed. */
  operatorPolicyManagedDisplay: string | null;
  /** Parsed ref for GET OperatorPolicy (namespace + name), if annotation is parseable. */
  operatorPolicyRef: { namespace: string; name: string } | null;
  /** Subscription is governed by OperatorPolicy (ACM annotation or managed label). */
  policyGovernanceManaged: boolean;
  /** Plugin migration label applied; create a matching OperatorPolicy next (Install operators or automation). */
  migrationEnrollLabelRequested: boolean;
  /** Subscription spec snapshot for Install operators deep link (Create policy after migration). */
  installPrefillQuery: {
    packageName: string;
    subscriptionNamespace: string;
    channel: string;
    source: string;
    sourceNamespace: string;
    installPlanApproval: 'Automatic' | 'Manual';
    startingCSV: string;
  } | null;
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

function appendQuery(url: string, params: Record<string, string>): string {
  const sep = url.includes('?') ? '&' : '?';
  const q = new URLSearchParams(params);
  return `${url}${sep}${q.toString()}`;
}

async function* listPagedItems<TItem>(options: {
  refreshEpoch: number;
  baseUrl: string;
  limit: number;
}): AsyncGenerator<TItem[]> {
  let cont = '';
  while (true) {
    const pageUrl = appendQuery(options.baseUrl, {
      limit: String(options.limit),
      ...(cont ? { continue: cont } : {}),
    });
    const list = await cachedConsoleFetchJson(
      subscriptionGetCacheKey(options.refreshEpoch, pageUrl),
      MANAGED_OPERATORS_GET_CACHE_TTL_MS,
      () =>
        consoleFetchJSON(pageUrl, 'GET') as Promise<{
          items?: TItem[];
          metadata?: { continue?: string };
        }>,
    );
    const items = list.items ?? [];
    yield items;
    cont = list.metadata?.continue ?? '';
    if (!cont) break;
  }
}

async function fetchInstallPlansForCluster(
  clusterKey: string,
  refreshEpoch: number,
): Promise<InstallPlanKind[]> {
  try {
    const baseUrl = clusterApiPath(clusterKey, '/apis/operators.coreos.com/v1alpha1/installplans');
    const all: InstallPlanKind[] = [];
    for await (const page of listPagedItems<InstallPlanKind>({
      refreshEpoch,
      baseUrl,
      limit: 250,
    })) {
      all.push(...page);
    }
    return all;
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

async function mapWithConcurrency<TIn>(
  inputs: TIn[],
  concurrency: number,
  // eslint-disable-next-line no-unused-vars
  mapper: (_input: TIn) => Promise<void>,
  options?: { delayMs?: number },
): Promise<void> {
  const delayMs = Math.max(0, options?.delayMs ?? 0);
  let idx = 0;
  const workers = new Array(Math.max(1, Math.min(concurrency, inputs.length)))
    .fill(null)
    .map(async () => {
      while (true) {
        const cur = idx++;
        if (cur >= inputs.length) return;
        await mapper(inputs[cur]);
        if (delayMs > 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
        }
      }
    });
  await Promise.all(workers);
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
      ip.metadata?.ownerReferences?.some(
        (ref) => ref.kind === 'Subscription' && ref.name === subName,
      ),
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

function installPlanRef(
  ip: InstallPlanKind | undefined,
): { namespace: string; name: string } | null {
  const name = ip?.metadata?.name;
  const namespace = ip?.metadata?.namespace;
  if (!name || !namespace) return null;
  return { namespace, name };
}

function installPlanNeedsApproval(ip: InstallPlanKind | undefined): boolean {
  return ip?.spec?.approval === 'Manual' && ip?.spec?.approved === false;
}

async function enrichSubscriptionsWithInstallPlans(options: {
  clusterKey: string;
  displayName: string;
  subs: SubscriptionKind[];
  installPlans: InstallPlanKind[];
  refreshEpoch: number;
}): Promise<OperatorRow[]> {
  const { clusterKey, displayName, subs, installPlans, refreshEpoch } = options;

  const csvKeys = new Map<string, { ns: string; csv: string }>();
  for (const sub of subs) {
    const csv = sub.status?.currentCSV ?? sub.status?.installedCSV;
    const ns = sub.metadata?.namespace;
    if (csv && ns) {
      csvKeys.set(`${ns}|${csv}`, { ns, csv });
    }
  }

  const csvMap = new Map<string, ClusterServiceVersionKind | null>();
  const csvEntries = [...csvKeys.entries()];
  await mapWithConcurrency(
    csvEntries,
    10,
    async ([key, { ns, csv }]) => {
      const data = await fetchCsv(clusterKey, ns, csv, refreshEpoch);
      csvMap.set(key, data);
    },
    { delayMs: 40 },
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
    const ipRef = installPlanRef(ip);
    const installPlanApprovalRequired = installPlanNeedsApproval(ip);

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
      ? formatOperatorPolicyManagedDisplay(managedAnn)
      : hasManagedLabel
        ? '(OperatorPolicy)'
        : null;

    const pkgSpecName = (sub.spec?.name ?? name).trim();
    const subChannel = (sub.spec?.channel ?? '').trim();
    const subSource = (sub.spec?.source ?? '').trim();
    const subSourceNs = (sub.spec?.sourceNamespace ?? '').trim();
    const prefillApproval: 'Automatic' | 'Manual' = approval === 'Manual' ? 'Manual' : 'Automatic';
    const installPrefillQuery =
      pkgSpecName && ns !== '—' && name !== '—'
        ? {
            packageName: pkgSpecName,
            subscriptionNamespace: ns,
            channel: subChannel,
            source: subSource,
            sourceNamespace: subSourceNs,
            installPlanApproval: prefillApproval,
            startingCSV: csvName,
          }
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
      installPlanRef: ipRef,
      installPlanApprovalRequired,
      operatorPolicyManagedDisplay,
      operatorPolicyRef: ref,
      policyGovernanceManaged,
      migrationEnrollLabelRequested,
      installPrefillQuery,
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

  const namesSorted = React.useMemo(
    () => (clusterNames.length > 0 ? [...clusterNames].sort() : ['__hub_direct__']),
    [clusterNames],
  );

  React.useEffect(() => {
    let cancelled = false;

    setLoaded(false);
    setError(undefined);
    setRows([]);

    const epoch = refreshEpoch;

    (async () => {
      const next: OperatorRow[] = [];
      const errors: unknown[] = [];

      const sortRows = (rowsToSort: OperatorRow[]) => {
        rowsToSort.sort(
          (a, b) =>
            a.clusterDisplayName.localeCompare(b.clusterDisplayName) ||
            a.namespace.localeCompare(b.namespace) ||
            a.name.localeCompare(b.name),
        );
      };

      const work = namesSorted.map(async (clusterKey) => {
        const displayName = displayClusterName(clusterKey);

        const installPlans = await fetchInstallPlansForCluster(clusterKey, epoch);

        const baseUrl =
          clusterKey === '__hub_direct__'
            ? HUB_SUBSCRIPTIONS_PATH
            : clusterApiPath(clusterKey, '/apis/operators.coreos.com/v1alpha1/subscriptions');

        const limit = 250;
        for await (const subsPage of listPagedItems<SubscriptionKind>({
          refreshEpoch: epoch,
          baseUrl,
          limit,
        })) {
          const pageRows = await enrichSubscriptionsWithInstallPlans({
            clusterKey,
            displayName,
            subs: subsPage,
            installPlans,
            refreshEpoch: epoch,
          });

          if (cancelled) return;
          next.push(...pageRows);
          sortRows(next);
          setRows([...next]);
        }
      });

      await Promise.all(
        work.map((p) =>
          p
            .then(() => undefined)
            .catch((e) => {
              if (cancelled) return;
              errors.push(e);
              if (errors.length === 1) setError(e);
            }),
        ),
      );

      if (cancelled) return;
      setLoaded(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [namesSorted, refreshEpoch]);

  return { rows, loaded, error };
}
