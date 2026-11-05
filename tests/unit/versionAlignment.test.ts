import './sdkStub';
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { computeVersionAlignment } from '../../src/utils/versionAlignment';

const row = (cluster: string, pkg: string, csvVersion: string) =>
  ({
    clusterDisplayName: cluster,
    name: pkg,
    csvVersion,
    installPrefillQuery: { packageName: pkg },
  }) as never;

test('same version on every cluster is aligned', () => {
  const s = computeVersionAlignment([
    row('a', 'rhacs-operator', 'v4.11.5'),
    row('b', 'rhacs-operator', 'v4.11.5'),
  ]);
  assert.equal(s.aligned, 1);
  assert.equal(s.misaligned, 0);
  assert.equal(s.comparable[0].aligned, true);
});

test('different versions are misaligned, grouped and sorted newest first', () => {
  const s = computeVersionAlignment([
    row('a', 'op', 'v1.9.0'),
    row('b', 'op', 'v1.10.0'),
    row('c', 'op', 'v1.9.0'),
  ]);
  assert.equal(s.misaligned, 1);
  assert.deepEqual(s.comparable[0].versions, [
    { version: 'v1.10.0', clusters: ['b'] },
    { version: 'v1.9.0', clusters: ['a', 'c'] },
  ]);
});

test('operators on one cluster only are not comparable; unknown versions are ignored', () => {
  const s = computeVersionAlignment([
    row('a', 'solo', 'v1.0.0'),
    row('a', 'op', 'v1.0.0'),
    row('b', 'op', '—'),
  ]);
  assert.equal(s.comparable.length, 0);
  assert.equal(s.singleCluster, 2);
});

test('misaligned operators are listed before aligned ones', () => {
  const s = computeVersionAlignment([
    row('a', 'zzz', 'v1'),
    row('b', 'zzz', 'v2'),
    row('a', 'aaa', 'v1'),
    row('b', 'aaa', 'v1'),
  ]);
  assert.deepEqual(
    s.comparable.map((o) => o.operator),
    ['zzz', 'aaa'],
  );
});
