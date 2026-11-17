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

test('reviews go through the MCE proxy for managed clusters and to the hub directly otherwise', async () => {
  const urls: string[] = [];
  const f = async (url: string) => {
    urls.push(url);
    return { status: { allowed: true } };
  };
  await checkClusterAccess('prod-1', access.approveInstallPlan('ns'), f);
  await checkClusterAccess('__hub_direct__', access.approveInstallPlan('ns'), f);
  assert.equal(
    urls[0],
    '/api/proxy/plugin/mce/console/multicloud/managedclusterproxy/prod-1/apis/authorization.k8s.io/v1/selfsubjectaccessreviews',
  );
  assert.equal(urls[1], '/apis/authorization.k8s.io/v1/selfsubjectaccessreviews');
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
  assert.equal(calls, 1);
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
  await checkClusterAccess('c1', access.approveInstallPlan('a'), reply(true));
  assert.equal(peekAccess('c1', access.approveInstallPlan('a')), true);
  assert.equal(peekAccess('c2', access.approveInstallPlan('a')), undefined);
  assert.equal(peekAccess('c1', access.approveInstallPlan('b')), undefined);
  assert.notEqual(
    accessKey('c', access.patchSubscription('n')),
    accessKey('c', access.deleteSubscription('n')),
  );
});
