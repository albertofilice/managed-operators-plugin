import './sdkStub';
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { installedCsvNames, rowsFromSearch } from '../../src/utils/searchRows';
import { searchItems, SEARCH_PATH } from '../../src/utils/searchApi';
import { computeVersionAlignment } from '../../src/utils/versionAlignment';

const sub = (over: Record<string, string>) => ({
  cluster: 'a',
  namespace: 'ns',
  name: 'op',
  package: 'op',
  channel: 'stable',
  source: 'redhat-operators',
  installplan: 'op.v1.2.0',
  phase: 'AtLatestKnown',
  label: '',
  ...over,
});
const csv = (over: Record<string, string>) => ({
  cluster: 'a',
  namespace: 'ns',
  name: 'op.v1.2.0',
  phase: 'Succeeded',
  version: '1.2.0',
  ...over,
});

test('maps a subscription and its installed CSV', () => {
  const [r] = rowsFromSearch([sub({})], [csv({})], ['a']);
  assert.equal(r.csvVersion, '1.2.0');
  assert.equal(r.csvSucceeded, true);
  assert.equal(r.upgradePending, null);
  assert.equal(r.policyGovernanceManaged, false);
  assert.equal(r.installPrefillQuery?.packageName, 'op');
});

test('UpgradePending state and the OperatorPolicy label are carried over', () => {
  const [r] = rowsFromSearch(
    [
      sub({
        phase: 'UpgradePending',
        label: 'a=b; operatorpolicy.policy.open-cluster-management.io/managed=',
      }),
    ],
    [csv({})],
    ['a'],
  );
  assert.ok(r.upgradePending);
  assert.equal(r.policyGovernanceManaged, true);
  assert.ok(r.operatorPolicyRef);
});

test('a missing CSV is not reported as healthy; version falls back to the CSV name', () => {
  const [r] = rowsFromSearch([sub({})], [], ['a']);
  assert.equal(r.csvSucceeded, false);
  assert.equal(r.csvPhase, 'Unknown');
  assert.equal(r.csvVersion, 'v1.2.0');
});

test('CSVs are matched per cluster and namespace; other clusters are dropped', () => {
  const rows = rowsFromSearch(
    [sub({ cluster: 'a' }), sub({ cluster: 'b' }), sub({ cluster: 'gone' })],
    [csv({ cluster: 'a', phase: 'Failed' }), csv({ cluster: 'b' })],
    ['a', 'b'],
  );
  assert.deepEqual(
    rows.map((r) => [r.clusterKey, r.csvPhase]),
    [
      ['a', 'Failed'],
      ['b', 'Succeeded'],
    ],
  );
});

test('feeds the version alignment card', () => {
  const rows = rowsFromSearch(
    [sub({ cluster: 'a' }), sub({ cluster: 'b', installplan: 'op.v1.3.0' })],
    [csv({ cluster: 'a' }), csv({ cluster: 'b', name: 'op.v1.3.0', version: '1.3.0' })],
    ['a', 'b'],
  );
  assert.equal(computeVersionAlignment(rows).misaligned, 1);
});

test('installedCsvNames is deduplicated and skips empty values', () => {
  assert.deepEqual(installedCsvNames([sub({}), sub({ cluster: 'b' }), sub({ installplan: '' })]), [
    'op.v1.2.0',
  ]);
});

test('searchItems posts a GraphQL query and returns the items', async () => {
  let url = '';
  let body: { variables: { input: Array<{ limit: number }> } } | undefined;
  const items = await searchItems(
    [{ property: 'kind', values: ['Subscription'] }],
    async (u, b) => {
      url = u;
      body = b as typeof body;
      return { data: { searchResult: [{ items: [{ name: 'x' }] }] } };
    },
  );
  assert.equal(url, SEARCH_PATH);
  assert.equal(body?.variables.input[0].limit, -1);
  assert.deepEqual(items, [{ name: 'x' }]);
});

test('GraphQL errors and malformed answers reject so the caller can fall back', async () => {
  await assert.rejects(
    searchItems([], async () => ({ errors: [{ message: 'boom' }] })),
    /boom/,
  );
  await assert.rejects(
    searchItems([], async () => ({ data: null })),
    /Unexpected/,
  );
  await assert.rejects(
    searchItems([], async () => {
      throw new Error('404');
    }),
    /404/,
  );
});
