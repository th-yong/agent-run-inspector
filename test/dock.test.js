import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dockUrl, pinToDock, unpinFromDock } from '../src/dock.js';

const APP = '/Users/u/Applications/Agent Run Inspector.app';

// A fake Dock: persistent-apps as a list of URLs (null = a tile without a file URL, e.g. a spacer).
function fakeDock(urls) {
  const dock = { apps: [...urls], exported: null, calls: [] };
  dock.run = async (file, args) => {
    dock.calls.push([file.split('/').pop(), args[0]]);
    if (file === 'defaults' && args[0] === 'export') { dock.exported = [...dock.apps]; return { stdout: '' }; }
    if (file === 'defaults' && args[0] === 'import') { dock.apps = [...dock.exported]; return { stdout: '' }; }
    if (file === 'defaults' && args[0] === 'write') { dock.apps.push(args[4].match(/<string>([^<]+)<\/string>/)[1]); return { stdout: '' }; }
    if (file === 'killall') return { stdout: '' };
    const cmd = args[1];
    let m = cmd.match(/^Print :persistent-apps:(\d+)$/);
    if (m) { if (+m[1] >= dock.exported.length) throw new Error('Does Not Exist'); return { stdout: 'Dict {}' }; }
    m = cmd.match(/^Print :persistent-apps:(\d+):tile-data:file-data:_CFURLString$/);
    if (m) { const u = dock.exported[+m[1]]; if (!u) throw new Error('Does Not Exist'); return { stdout: `${u}\n` }; }
    m = cmd.match(/^Delete :persistent-apps:(\d+)$/);
    if (m) { dock.exported.splice(+m[1], 1); return { stdout: '' }; }
    throw new Error(`unexpected ${file} ${args.join(' ')}`);
  };
  return dock;
}

test('dockUrl matches how the Dock stores an app', () => {
  assert.equal(dockUrl(APP), 'file:///Users/u/Applications/Agent%20Run%20Inspector.app/');
});

test('pin adds once and restarts the Dock; unpin removes only that entry', async () => {
  const other = 'file:///Applications/Safari.app/';
  const d = fakeDock([other, null, 'file:///Applications/Mail.app/']);
  assert.equal(await pinToDock(APP, d.run), true);
  assert.deepEqual(d.apps, [other, null, 'file:///Applications/Mail.app/', dockUrl(APP)]);
  assert.ok(d.calls.some(([f]) => f === 'killall'));
  d.calls.length = 0;
  assert.equal(await pinToDock(APP, d.run), false); // already there: no second entry, no Dock restart
  assert.ok(!d.calls.some(([f]) => f === 'killall'));
  assert.equal(await unpinFromDock(APP, d.run), true);
  assert.deepEqual(d.apps, [other, null, 'file:///Applications/Mail.app/']);
  assert.equal(await unpinFromDock(APP, d.run), false);
});
