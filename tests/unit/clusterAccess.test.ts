import './sdkStub';
import { test, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  access,
  accessKey,
  checkClusterAccess,
  peekAccess,
  resetAccessCache,
} from '../../src/utils/clusterAccess';

beforeEach(resetAccessCache);

const reply = (allowed: boolean) => async () => ({ status: { allowed } });

test('reviews name the managed cluster, and the hub key is passed through', async () => {
  const seen: string[] = [];
  const f = async (cluster: string) => {
    seen.push(cluster);
    return { status: { allowed: true } };
  };
  await checkClusterAccess('prod-1', access.approveInstallPlan('ns'), f);
  await checkClusterAccess('__hub_direct__', access.approveInstallPlan('ns'), f);
  assert.deepEqual(seen, ['prod-1', '__hub_direct__']);
});

test('sends the resource attributes and caches the answer', async () => {
  let calls = 0;
  let sent: { spec: { resourceAttributes: unknown } } | undefined;
  const f = async (_u: string, body: unknown) => {
    calls += 1;
    sent = body as typeof sent;
    return { status: { allowed: false } };
  };
  const a = access.deleteSubscription('openshift-operators');
  assert.equal(await checkClusterAccess('c', a, f), false);
  assert.equal(await checkClusterAccess('c', a, f), false);
  // one cluster-wide review (denied) plus the namespace one; the second call is cached
  assert.equal(calls, 2);
  assert.deepEqual(sent?.spec.resourceAttributes, {
    group: 'operators.coreos.com',
    resource: 'subscriptions',
    verb: 'delete',
    namespace: 'openshift-operators',
  });
  assert.equal(peekAccess('c', a), false);
});

test('concurrent identical checks share one request', async () => {
  let calls = 0;
  const f = async () => {
    calls += 1;
    return { status: { allowed: true } };
  };
  const a = access.createClusterRole();
  await Promise.all([checkClusterAccess('c', a, f), checkClusterAccess('c', a, f)]);
  assert.equal(calls, 1);
});

test('a failing review allows the action (the server still enforces) ', async () => {
  const f = async () => {
    throw new Error('proxy down');
  };
  assert.equal(await checkClusterAccess('c', access.createOperatorPolicy('ns'), f), true);
});

test('cluster, namespace and verb all take part in the cache key', async () => {
  await checkClusterAccess('c1', access.approveInstallPlan('a'), reply(false));
  assert.equal(peekAccess('c1', access.approveInstallPlan('a')), false);
  assert.equal(peekAccess('c2', access.approveInstallPlan('a')), undefined);
  assert.equal(peekAccess('c1', access.approveInstallPlan('b')), undefined);
  assert.notEqual(
    accessKey('c', access.patchSubscription('n')),
    accessKey('c', access.deleteSubscription('n')),
  );
});

test('an expired answer is refetched, but stays readable as stale meanwhile', async () => {
  const a = access.approveInstallPlan('ns');
  await checkClusterAccess('c', a, reply(false));
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 60 * 60_000;
    assert.equal(peekAccess('c', a), undefined);
    assert.equal(peekAccess('c', a, true), false);
    assert.equal(await checkClusterAccess('c', a, reply(true)), true);
  } finally {
    Date.now = realNow;
  }
});

test('a cluster-wide grant answers for every namespace with a single review', async () => {
  let calls = 0;
  const f = async () => {
    calls += 1;
    return { status: { allowed: true } };
  };
  const results = await Promise.all(
    ['a', 'b', 'c', 'd'].map((ns) => checkClusterAccess('c', access.deleteSubscription(ns), f)),
  );
  assert.deepEqual(results, [true, true, true, true]);
  assert.equal(calls, 1);
  assert.equal(peekAccess('c', access.deleteSubscription('zzz')), true);
});

test('when the cluster-wide review is denied each namespace is reviewed on its own', async () => {
  const seen: string[] = [];
  const f = async (_u: string, body: unknown) => {
    const attrs = (body as { spec: { resourceAttributes: { namespace?: string } } }).spec
      .resourceAttributes;
    seen.push(attrs.namespace ?? '*');
    return { status: { allowed: attrs.namespace === 'mine' } };
  };
  assert.equal(await checkClusterAccess('c', access.deleteSubscription('mine'), f), true);
  assert.equal(await checkClusterAccess('c', access.deleteSubscription('other'), f), false);
  assert.deepEqual(seen, ['*', 'mine', 'other']);
  assert.equal(peekAccess('c', access.deleteSubscription('other')), false);
});
