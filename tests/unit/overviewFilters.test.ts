import './sdkStub';
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  installedOperatorsHref,
  parseOverviewFilter,
  rowMatchesOverviewFilter,
} from '../../src/utils/overviewFilters';

const row = (over: Record<string, unknown>) =>
  ({
    csvSucceeded: true,
    upgradePending: null,
    policyGovernanceManaged: false,
    operatorPolicyRef: null,
    ...over,
  }) as never;

const ctx = { canEditPlugin: () => false, isExternalGovernancePolicy: () => true };

test('parseOverviewFilter accepts known filters and rejects the rest', () => {
  assert.equal(parseOverviewFilter('?filter=upgrade_pending'), 'upgrade_pending');
  assert.equal(parseOverviewFilter('?cluster=a&filter=external'), 'external');
  assert.equal(parseOverviewFilter('?filter=nope'), null);
  assert.equal(parseOverviewFilter(''), null);
});

test('installedOperatorsHref builds the drill-down url', () => {
  assert.equal(installedOperatorsHref(), '/multicloud/ecosystem/installed-operators');
  assert.equal(
    installedOperatorsHref('csv_other', 'c1'),
    '/multicloud/ecosystem/installed-operators?cluster=c1&filter=csv_other',
  );
});

test('rowMatchesOverviewFilter', () => {
  assert.equal(rowMatchesOverviewFilter(row({}), 'csv_succeeded', ctx), true);
  assert.equal(rowMatchesOverviewFilter(row({ csvSucceeded: false }), 'csv_other', ctx), true);
  assert.equal(
    rowMatchesOverviewFilter(row({ upgradePending: 'x' }), 'upgrade_pending', ctx),
    true,
  );
  assert.equal(rowMatchesOverviewFilter(row({}), 'upgrade_none', ctx), true);
  assert.equal(
    rowMatchesOverviewFilter(row({ policyGovernanceManaged: true }), 'governed', ctx),
    true,
  );
  assert.equal(rowMatchesOverviewFilter(row({}), 'standalone', ctx), true);
  const withRef = row({ operatorPolicyRef: { namespace: 'a', name: 'b' } });
  assert.equal(rowMatchesOverviewFilter(withRef, 'policy_ref', ctx), true);
  assert.equal(rowMatchesOverviewFilter(withRef, 'external', ctx), true);
  assert.equal(rowMatchesOverviewFilter(row({}), 'external', ctx), false);
  assert.equal(rowMatchesOverviewFilter(row({}), 'plugin', ctx), false);
});
