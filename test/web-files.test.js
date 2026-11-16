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

test('the web app manifest and its icons are public files that exist', async () => {
  const { PUBLIC_FILES } = await import('../src/server/static.js');
  const web = (f) => fileURLToPath(new URL(`../web/${f}`, import.meta.url));
  for (const f of PUBLIC_FILES) assert.ok(readFileSync(web(f)).length > 0, f);
  const m = JSON.parse(readFileSync(web('manifest.webmanifest'), 'utf8'));
  for (const i of m.icons) {
    assert.ok(PUBLIC_FILES.includes(i.src.slice(1)), `${i.src} must be public`);
    const png = readFileSync(web(i.src.slice(1)));
    assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, i.sizes); // PNG IHDR width x height
  }
  assert.ok(readFileSync(web('index.html'), 'utf8').includes('rel="manifest" href="/manifest.webmanifest"'));
  const icon = readFileSync(web('index.html'), 'utf8').match(/<link rel="icon"[^>]*href="\/([^"]+)"/)?.[1];
  assert.ok(PUBLIC_FILES.includes(icon), 'the tab icon is a public file'); // fetched without the cookie too
});
