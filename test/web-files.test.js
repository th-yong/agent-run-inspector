// Every module the browser imports must be on the static allowlist, or the page silently fails to start.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

test('each web/*.js file is served', () => {
  const src = readFileSync(fileURLToPath(new URL('../src/server/static.js', import.meta.url)), 'utf8');
  for (const f of readdirSync(fileURLToPath(new URL('../web', import.meta.url))).filter((n) => n.endsWith('.js'))) {
    assert.ok(src.includes(`'${f}'`), `${f} is not in the static allowlist`);
  }
});
