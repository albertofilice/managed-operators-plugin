/**
 * Query params for /install-operators deep link from Installed Operators (migration → Create policy).
 * Prefix mop_ avoids collisions with other console query keys.
 */
export const MOP_Q = {
  cluster: 'mop_cluster',
  package: 'mop_pkg',
  subNs: 'mop_subns',
  channel: 'mop_ch',
  catalogSource: 'mop_cs',
  catalogSourceNs: 'mop_cns',
  approval: 'mop_appr',
  startingCsv: 'mop_csv',
  policyNs: 'mop_pns',
} as const;

export type InstallOperatorsUrlPrefill = {
  cluster: string;
  packageName: string;
  subscriptionNamespace?: string;
  channel?: string;
  catalogSource?: string;
  catalogSourceNamespace?: string;
  installPlanApproval?: 'Automatic' | 'Manual';
  startingCSV?: string;
  policyNamespace?: string;
};

export function parseInstallOperatorsPrefill(search: string): InstallOperatorsUrlPrefill | null {
  const q = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const cluster = q.get(MOP_Q.cluster)?.trim();
  const packageName = q.get(MOP_Q.package)?.trim();
  if (!cluster || !packageName) return null;
  const appr = q.get(MOP_Q.approval)?.trim();
  return {
    cluster,
    packageName,
    subscriptionNamespace: q.get(MOP_Q.subNs)?.trim() || undefined,
    channel: q.get(MOP_Q.channel)?.trim() || undefined,
    catalogSource: q.get(MOP_Q.catalogSource)?.trim() || undefined,
    catalogSourceNamespace: q.get(MOP_Q.catalogSourceNs)?.trim() || undefined,
    installPlanApproval:
      appr === 'Manual' ? 'Manual' : appr === 'Automatic' ? 'Automatic' : undefined,
    startingCSV: q.get(MOP_Q.startingCsv)?.trim() || undefined,
    policyNamespace: q.get(MOP_Q.policyNs)?.trim() || undefined,
  };
}

/** Applied in OperatorPolicyFormModal after create defaults from PackageManifest. */
export type OperatorPolicySubscriptionPrefill = {
  subscriptionNamespace?: string;
  policyNamespace?: string;
  channel?: string;
  sourceName?: string;
  sourceNamespace?: string;
  upgradeApproval?: 'Automatic' | 'None';
  startingCSV?: string;
};

export function urlPrefillToModalPrefill(u: InstallOperatorsUrlPrefill): OperatorPolicySubscriptionPrefill {
  return {
    subscriptionNamespace: u.subscriptionNamespace,
    policyNamespace: u.policyNamespace,
    channel: u.channel,
    sourceName: u.catalogSource,
    sourceNamespace: u.catalogSourceNamespace,
    upgradeApproval:
      u.installPlanApproval === 'Manual'
        ? 'None'
        : u.installPlanApproval === 'Automatic'
          ? 'Automatic'
          : undefined,
    startingCSV: u.startingCSV,
  };
}
