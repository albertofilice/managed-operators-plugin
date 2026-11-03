import './sdkStub';
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { parsePluginConfig } from '../../src/utils/pluginConfig';

test('config: explicit readOnly true/"true" is read-only', () => {
  assert.deepEqual(parsePluginConfig(200, { readOnly: true }), { readOnly: true });
  assert.deepEqual(parsePluginConfig(200, { readOnly: 'true' }), { readOnly: true });
});

test('config: readOnly false or missing is writable', () => {
  assert.deepEqual(parsePluginConfig(200, { readOnly: false }), { readOnly: false });
  assert.deepEqual(parsePluginConfig(200, {}), { readOnly: false });
  assert.deepEqual(parsePluginConfig(200, null), { readOnly: false });
});

test('config: 404 (chart without config.json) stays writable, other errors fail closed', () => {
  assert.deepEqual(parsePluginConfig(404, null), { readOnly: false });
  assert.deepEqual(parsePluginConfig(500, null), { readOnly: true });
  assert.deepEqual(parsePluginConfig(403, null), { readOnly: true });
});

const helm = spawnSync('helm', ['version', '--short'], { encoding: 'utf8' });
const render = (extra: string[]) =>
  spawnSync(
    'helm',
    ['template', 't', 'charts/openshift-console-plugin', '--set', 'plugin.image=x', ...extra],
    { encoding: 'utf8' },
  ).stdout;

test(
  'helm: plugin.readOnly is published as config.json and rolls the pods',
  { skip: helm.status !== 0 },
  () => {
    assert.match(render([]), /\{"readOnly": false\}/);
    const ro = render(['--set', 'plugin.readOnly=true']);
    assert.match(ro, /\{"readOnly": true\}/);
    assert.match(ro, /checksum\/config:/);
    assert.notEqual(
      render([]).match(/checksum\/config: (\w+)/)?.[1],
      ro.match(/checksum\/config: (\w+)/)?.[1],
    );
  },
);
