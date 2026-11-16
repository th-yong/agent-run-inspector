// Keeps Agent Run Inspector.app in the Dock (macOS). Reads go through "defaults export" and
// PlistBuddy, writes through "defaults write"/"defaults import", so cfprefsd stays in charge of the
// Dock preferences; the Dock restarts (killall Dock) only when something changed.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const BUDDY = '/usr/libexec/PlistBuddy';

/** The Dock's URL for an app bundle: file:///…/Agent%20Run%20Inspector.app/ */
export const dockUrl = (app) => `${pathToFileURL(app).href.replace(/\/$/, '')}/`;

/** Index of the app in persistent-apps of an exported Dock plist, or -1. */
async function findEntry(run, file, url) {
  for (let i = 0; i < 500; i++) {
    try { await run(BUDDY, ['-c', `Print :persistent-apps:${i}`, file]); } catch { return -1; } // past the end
    try {
      const { stdout } = await run(BUDDY, ['-c', `Print :persistent-apps:${i}:tile-data:file-data:_CFURLString`, file]);
      if (String(stdout).trim() === url) return i;
    } catch { /* a spacer or folder tile has no file URL */ }
  }
  return -1;
}

async function withExport(run, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'ari-dock-'));
  const file = join(dir, 'dock.plist');
  try {
    await run('defaults', ['export', 'com.apple.dock', file]);
    return await fn(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Adds the app at the end of the Dock's apps unless it is there. Returns true when it added it. */
export function pinToDock(app, run) {
  const url = dockUrl(app);
  return withExport(run, async (file) => {
    if ((await findEntry(run, file, url)) >= 0) return false;
    const tile = '<dict><key>tile-data</key><dict><key>file-data</key><dict>'
      + `<key>_CFURLString</key><string>${url.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</string>`
      + '<key>_CFURLStringType</key><integer>15</integer></dict></dict></dict>';
    await run('defaults', ['write', 'com.apple.dock', 'persistent-apps', '-array-add', tile]);
    await run('killall', ['Dock']);
    return true;
  });
}

/** Removes the app from the Dock if it is there. Returns true when it removed it. */
export function unpinFromDock(app, run) {
  const url = dockUrl(app);
  return withExport(run, async (file) => {
    const i = await findEntry(run, file, url);
    if (i < 0) return false;
    await run(BUDDY, ['-c', `Delete :persistent-apps:${i}`, file]);
    await run('defaults', ['import', 'com.apple.dock', file]);
    await run('killall', ['Dock']);
    return true;
  });
}
