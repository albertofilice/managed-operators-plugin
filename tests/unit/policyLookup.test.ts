import './sdkStub';
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { isNotFoundError } from '../../src/utils/policyLookup';

test('recognises a 404 however the console error carries it', () => {
  assert.equal(isNotFoundError({ response: { status: 404 } }), true);
  assert.equal(isNotFoundError({ code: 404 }), true);
  assert.equal(isNotFoundError({ status: 404 }), true);
});

test('other failures and non-errors are not "not found"', () => {
  assert.equal(isNotFoundError({ response: { status: 403 } }), false);
  assert.equal(isNotFoundError({ code: 500 }), false);
  assert.equal(isNotFoundError(new Error('network')), false);
  assert.equal(isNotFoundError(null), false);
  assert.equal(isNotFoundError(undefined), false);
});
