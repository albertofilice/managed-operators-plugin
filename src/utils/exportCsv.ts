import type { OperatorRow } from '../hooks/useManagedClusterSubscriptions';
import type { AlignmentSummary, OperatorAlignment } from './versionAlignment';
import { toCsv, type CsvCell } from './csv';

const ALIGNMENT_HEADER = ['operator', 'status', 'version', 'cluster'];

function alignmentLines(o: OperatorAlignment, status: string): CsvCell[][] {
  return o.versions.flatMap((v) => v.clusters.map((c) => [o.operator, status, v.version, c]));
}

/** One line per operator, version and cluster: filters and pivots straight in a spreadsheet. */
export function alignmentCsv(s: AlignmentSummary): string {
  return toCsv([
    ALIGNMENT_HEADER,
    ...s.comparable.flatMap((o) => alignmentLines(o, o.aligned ? 'aligned' : 'not aligned')),
    ...s.singleClusterOperators.flatMap((o) => alignmentLines(o, 'single cluster')),
  ]);
}

const OPERATOR_HEADER = [
  'cluster',
  'namespace',
  'subscription',
  'package',
  'csv',
  'version',
  'csv_phase',
  'approval',
  'subscription_state',
  'upgrade_pending',
  'governed',
  'operator_policy',
];

/** The rows currently shown on Installed Operators (after filter and search). */
export function operatorsCsv(rows: OperatorRow[]): string {
  return toCsv([
    OPERATOR_HEADER,
    ...rows.map((r) => [
      r.clusterDisplayName,
      r.namespace,
      r.name,
      r.installPrefillQuery?.packageName,
      r.csvFullName,
      r.csvVersion,
      r.csvPhase,
      r.installPlanApproval,
      r.subscriptionStateDisplay,
      r.upgradePending,
      r.policyGovernanceManaged ? 'yes' : 'no',
      r.operatorPolicyRef ? `${r.operatorPolicyRef.namespace}/${r.operatorPolicyRef.name}` : '',
    ]),
  ]);
}
