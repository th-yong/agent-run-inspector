import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkForUpdate, isNewer } from '../src/update-check.js';

test('isNewer compares x.y.z and ignores pre-releases and junk', () => {
  assert.equal(isNewer('0.5.0', '0.4.2'), true);
  assert.equal(isNewer('0.4.10', '0.4.9'), true);
  assert.equal(isNewer('0.4.2', '0.4.2'), false);
  assert.equal(isNewer('0.4.1', '0.4.2'), false);
  assert.equal(isNewer('0.5.0-beta.1', '0.4.2'), false);
  assert.equal(isNewer(null, '0.4.2'), false);
});

test('checkForUpdate: asks once an hour, caches, stays quiet on failure or when turned off', async () => {
  const env = { HOME: mkdtempSync(join(tmpdir(), 'ari-up-')) };
  let calls = 0;
  const ok = async () => { calls++; return { ok: true, json: async () => ({ tag_name: 'v0.9.0' }) }; };
  assert.equal(await checkForUpdate({ version: '0.4.2', env, now: 1000, fetchImpl: ok }), '0.9.0');
  assert.equal(await checkForUpdate({ version: '0.4.2', env, now: 2000, fetchImpl: ok }), '0.9.0');
  assert.equal(calls, 1);
  const cache = JSON.parse(readFileSync(join(env.HOME, '.config', 'agent-run-inspector', 'update-check.json'), 'utf8'));
  assert.equal(cache.latest, '0.9.0');

  const day = 24 * 60 * 60 * 1000;
  const fail = async () => { calls++; throw new Error('offline'); };
  assert.equal(await checkForUpdate({ version: '0.9.0', env, now: 1000 + day, fetchImpl: fail }), null);
  assert.equal(calls, 2);

  const notFound = async () => ({ ok: false, json: async () => ({}) });
  const fresh = { HOME: mkdtempSync(join(tmpdir(), 'ari-up-')) };
  assert.equal(await checkForUpdate({ version: '0.4.2', env: fresh, now: 1, fetchImpl: notFound }), null);

  const never = async () => { throw new Error('must not be called'); };
  for (const off of ['CI', 'ARI_NO_UPDATE_CHECK', 'NO_UPDATE_NOTIFIER']) {
    assert.equal(await checkForUpdate({ version: '0.0.1', env: { ...fresh, [off]: '1' }, now: 9 * day, fetchImpl: never }), null);
  }
});
