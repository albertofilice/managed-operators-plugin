import './sdkStub';
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { csvFilename, toCsv } from '../../src/utils/csv';
import { alignmentCsv, operatorsCsv } from '../../src/utils/exportCsv';
import { computeVersionAlignment } from '../../src/utils/versionAlignment';
import type { OperatorRow } from '../../src/hooks/useManagedClusterSubscriptions';

const row = (cluster: string, pkg: string, version: string, extra: Partial<OperatorRow> = {}) =>
  ({
    clusterDisplayName: cluster,
    namespace: 'openshift-operators',
    name: pkg,
    csvFullName: `${pkg}.v${version}`,
    csvVersion: version,
    csvPhase: 'Succeeded',
    installPlanApproval: 'Manual',
    subscriptionStateDisplay: 'AtLatestKnown',
    upgradePending: null,
    policyGovernanceManaged: false,
    operatorPolicyRef: null,
    installPrefillQuery: { packageName: pkg },
    ...extra,
  }) as unknown as OperatorRow;

test('quotes commas, quotes and newlines; CRLF line ends', () => {
  assert.equal(
    toCsv([['a,b', 'say "hi"', 'x\ny']]),
    '"a,b","say ""hi""","x\ny"\r\n'.replace('x\ny', 'x\ny'),
  );
  assert.equal(toCsv([['a'], ['b']]), 'a\r\nb\r\n');
});

test('neutralises cells that a spreadsheet would run as a formula', () => {
  assert.equal(toCsv([['=1+1', '+x', '-x', '@x', 'ok']]), "'=1+1,'+x,'-x,'@x,ok\r\n");
});

test('null and undefined become empty cells', () => {
  assert.equal(toCsv([[null, undefined, 0, false]]), ',,0,false\r\n');
});

test('filename carries the date', () => {
  assert.equal(csvFilename('x', new Date('2026-11-23T10:00:00Z')), 'x-2026-11-23.csv');
});

test('alignment csv: one line per operator, version and cluster, with status', () => {
  const s = computeVersionAlignment([
    row('c1', 'amq', '2.9.3'),
    row('c2', 'amq', '2.9.0'),
    row('c1', 'eso', '0.11.0'),
    row('c2', 'eso', '0.11.0'),
    row('c1', 'solo', '1.0.0'),
  ]);
  const lines = alignmentCsv(s).trim().split('\r\n');
  assert.equal(lines[0], 'operator,status,version,cluster');
  assert.deepEqual(lines.slice(1), [
    'amq,not aligned,2.9.3,c1',
    'amq,not aligned,2.9.0,c2',
    'eso,aligned,0.11.0,c1',
    'eso,aligned,0.11.0,c2',
    'solo,single cluster,1.0.0,c1',
  ]);
});

test('alignment csv with no data has only the header', () => {
  assert.equal(alignmentCsv(computeVersionAlignment([])), 'operator,status,version,cluster\r\n');
});

test('operators csv lists the given rows', () => {
  const csv = operatorsCsv([
    row('c1', 'amq', '2.9.3', {
      policyGovernanceManaged: true,
      operatorPolicyRef: { namespace: 'c1', name: 'install-amq' },
      upgradePending: 'InstallPlan install-x',
    }),
  ]);
  const [h, l] = csv.trim().split('\r\n');
  assert.ok(h.startsWith('cluster,namespace,subscription,package,csv,version'));
  assert.equal(
    l,
    'c1,openshift-operators,amq,amq,amq.v2.9.3,2.9.3,Succeeded,Manual,AtLatestKnown,InstallPlan install-x,yes,c1/install-amq',
  );
});
