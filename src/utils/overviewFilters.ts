import type { OperatorRow } from '../hooks/useManagedClusterSubscriptions';

/** Query param on /installed-operators used by Overview drill-down links. */
export const OVERVIEW_FILTER_PARAM = 'filter';

export const OVERVIEW_FILTERS = [
  'csv_succeeded',
  'csv_other',
  'upgrade_pending',
  'upgrade_none',
  'governed',
  'standalone',
  'policy_ref',
  'no_policy_ref',
  'external',
  'plugin',
] as const;

export type OverviewFilter = (typeof OVERVIEW_FILTERS)[number];

export function parseOverviewFilter(search: string): OverviewFilter | null {
  const v = new URLSearchParams(search).get(OVERVIEW_FILTER_PARAM)?.trim();
  return (OVERVIEW_FILTERS as readonly string[]).includes(v ?? '') ? (v as OverviewFilter) : null;
}

export function installedOperatorsHref(filter?: OverviewFilter, cluster?: string): string {
  const q = new URLSearchParams();
  if (cluster) q.set('cluster', cluster);
  if (filter) q.set(OVERVIEW_FILTER_PARAM, filter);
  const s = q.toString();
  return `/multicloud/ecosystem/installed-operators${s ? `?${s}` : ''}`;
}

/* eslint-disable no-unused-vars */
export type OverviewFilterContext = {
  canEditPlugin: (r: OperatorRow) => boolean;
  isExternalGovernancePolicy: (r: OperatorRow) => boolean;
};
/* eslint-enable no-unused-vars */

export function rowMatchesOverviewFilter(
  r: OperatorRow,
  filter: OverviewFilter,
  ctx: OverviewFilterContext,
): boolean {
  switch (filter) {
    case 'csv_succeeded':
      return r.csvSucceeded;
    case 'csv_other':
      return !r.csvSucceeded;
    case 'upgrade_pending':
      return Boolean(r.upgradePending);
    case 'upgrade_none':
      return !r.upgradePending;
    case 'governed':
      return r.policyGovernanceManaged;
    case 'standalone':
      return !r.policyGovernanceManaged;
    case 'policy_ref':
      return Boolean(r.operatorPolicyRef);
    case 'no_policy_ref':
      return !r.operatorPolicyRef;
    case 'external':
      return Boolean(r.operatorPolicyRef) && ctx.isExternalGovernancePolicy(r);
    case 'plugin':
      return ctx.canEditPlugin(r);
  }
}
