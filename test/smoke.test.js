import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('--version prints the package version', () => {
  const out = execFileSync(process.execPath, [cli, '--version'], { encoding: 'utf8' });
  assert.equal(out.trim(), pkg.version);
});

test('package has no dependencies and declares both bins', () => {
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
  assert.equal(pkg.bin.ari, 'bin/cli.js');
  assert.equal(pkg.bin['agent-run-inspector'], 'bin/cli.js');
  assert.equal(pkg.engines.node, '>=22');
});
