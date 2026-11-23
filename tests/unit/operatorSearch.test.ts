import './sdkStub';
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { rowMatchesText, searchTerms } from '../../src/utils/operatorSearch';
import type { OperatorRow } from '../../src/hooks/useManagedClusterSubscriptions';

const row = (over: Partial<OperatorRow> = {}): OperatorRow =>
  ({
    clusterKey: 'c1',
    clusterDisplayName: 'prod-west-1',
    namespace: 'openshift-operators',
    name: 'amq-streams',
    csvFullName: 'amqstreams.v2.9.0-1',
    operatorPolicyManagedDisplay: null,
    operatorPolicyRef: { namespace: 'prod-west-1', name: 'install-amq-streams' },
    installPrefillQuery: { packageName: 'amq-streams' },
    ...over,
  }) as unknown as OperatorRow;

test('empty or blank text matches everything', () => {
  assert.equal(rowMatchesText(row(), ''), true);
  assert.equal(rowMatchesText(row(), '   '), true);
});

test('matches name, csv, namespace, cluster and policy, ignoring case', () => {
  assert.equal(rowMatchesText(row(), 'AMQ'), true);
  assert.equal(rowMatchesText(row(), 'v2.9'), true);
  assert.equal(rowMatchesText(row(), 'openshift-operators'), true);
  assert.equal(rowMatchesText(row(), 'WEST'), true);
  assert.equal(rowMatchesText(row(), 'install-amq'), true);
});

test('every word must match (AND), in any order', () => {
  assert.equal(rowMatchesText(row(), 'amq west'), true);
  assert.equal(rowMatchesText(row(), 'west amq'), true);
  assert.equal(rowMatchesText(row(), 'amq east'), false);
});

test('no match for an unrelated operator', () => {
  assert.equal(rowMatchesText(row(), 'gatekeeper'), false);
});

test('searchTerms trims and lower-cases', () => {
  assert.deepEqual(searchTerms('  Foo   BAR '), ['foo', 'bar']);
});
