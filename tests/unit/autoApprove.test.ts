import './sdkStub';
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AUTO_APPROVE_SCRIPT, manifests } from '../../src/utils/autoApproveJob';

const ANN = 'managed-operators-plugin.openshift.io/auto-approve-regex';
const CREATED = 'console.openshift.io/managed-operators-plugin-created';

type Case = {
  annotations?: Record<string, string>;
  upgradeApproval?: string;
  versions?: string[];
  installed?: string;
  pending?: string[];
};

/** Runs the real script with a fake `oc` that serves one OperatorPolicy and records patches. */
function run(c: Case): string {
  const dir = mkdtempSync(join(tmpdir(), 'mop-'));
  const policy = {
    items: [
      {
        metadata: {
          namespace: 'c1',
          name: 'p',
          annotations: c.annotations ?? { [ANN]: '^smb\\.v4\\.20\\..*$', [CREATED]: 'true' },
        },
        spec: {
          subscription: { namespace: 'ns', name: 'smb' },
          upgradeApproval: c.upgradeApproval ?? 'Automatic',
          ...(c.versions ? { versions: c.versions } : {}),
        },
      },
    ],
  };
  const plans = {
    items: (c.pending ?? []).map((n) => ({
      spec: { approved: false, clusterServiceVersionNames: [n] },
    })),
  };
  writeFileSync(join(dir, 'policy.json'), JSON.stringify(policy));
  writeFileSync(join(dir, 'plans.json'), JSON.stringify(plans));
  writeFileSync(
    join(dir, 'oc'),
    `#!/bin/bash
D="${dir}"
case "$*" in
  *"get operatorpolicies"*) cat "$D/policy.json";;
  *"get subscriptions"*) printf '%s' '${c.installed ?? 'smb.v4.20.1'}';;
  *"get installplans"*) cat "$D/plans.json";;
  *patch*) echo "PATCH $*";;
esac
`,
  );
  chmodSync(join(dir, 'oc'), 0o755);
  writeFileSync(join(dir, 'run.sh'), AUTO_APPROVE_SCRIPT);
  const r = spawnSync('bash', [join(dir, 'run.sh')], {
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
    encoding: 'utf8',
  });
  return `${r.stdout}${r.stderr}`;
}

test('script is valid bash', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mop-'));
  writeFileSync(join(dir, 's.sh'), AUTO_APPROVE_SCRIPT);
  assert.equal(spawnSync('bash', ['-n', join(dir, 's.sh')]).status, 0);
});

test('approves a matching CSV on the same major and adds it to versions', () => {
  const out = run({ versions: ['smb.v4.20.1'], pending: ['smb.v4.20.2'] });
  assert.match(out, /PATCH .*smb\.v4\.20\.1.*smb\.v4\.20\.2/s);
  assert.match(out, /added to spec\.versions/);
});

test('allows moving to a newer minor when the regex says so', () => {
  const out = run({
    annotations: { [ANN]: '^smb\\.v4\\.21\\..*$', [CREATED]: 'true' },
    versions: ['smb.v4.20.1'],
    pending: ['smb.v4.21.0'],
  });
  assert.match(out, /added to spec\.versions/);
});

test('ignores CSVs the regex does not match', () => {
  const out = run({ versions: ['smb.v4.20.1'], pending: ['smb.v4.21.0'] });
  assert.match(out, /regex mismatch/);
  assert.doesNotMatch(out, /PATCH/);
});

test('never crosses a major version', () => {
  const out = run({
    annotations: { [ANN]: '^smb\\.v5\\..*$', [CREATED]: 'true' },
    versions: ['smb.v4.20.1'],
    pending: ['smb.v5.0.0'],
  });
  assert.match(out, /different major/);
  assert.doesNotMatch(out, /PATCH/);
});

test('skips policies that are not created from the plugin', () => {
  const out = run({
    annotations: { [ANN]: '^smb\\.v4\\.20\\..*$' },
    versions: ['smb.v4.20.1'],
    pending: ['smb.v4.20.2'],
  });
  assert.doesNotMatch(out, /PATCH|policy c1/);
});

test('skips upgradeApproval None and Automatic without versions', () => {
  for (const c of [
    { upgradeApproval: 'None', versions: ['smb.v4.20.1'], pending: ['smb.v4.20.2'] },
    { upgradeApproval: 'Automatic', pending: ['smb.v4.20.2'] },
  ]) {
    const out = run(c);
    assert.match(out, /needs upgradeApproval Automatic and a non-empty versions list/);
    assert.doesNotMatch(out, /PATCH/);
  }
});

test('does not re-add an already allowed CSV', () => {
  const out = run({ versions: ['smb.v4.20.1', 'smb.v4.20.2'], pending: ['smb.v4.20.2'] });
  assert.match(out, /already allowed/);
  assert.doesNotMatch(out, /PATCH/);
});

test('manifests are namespaced consistently and idempotent-safe', () => {
  const kinds = manifests().map((m) => (m.body as { kind: string }).kind);
  assert.deepEqual(kinds, [
    'Namespace',
    'ServiceAccount',
    'ClusterRole',
    'ClusterRoleBinding',
    'ConfigMap',
    'CronJob',
  ]);
});
