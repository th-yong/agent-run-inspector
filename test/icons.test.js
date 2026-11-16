import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ICONS, hasIcon, getIcon, SIMPLE_ICONS_VERSION } from '../web/icons.js';
import { contrast, themeColor, buildSource, wantedSlugs, LIGHT_BG, DARK_BG } from '../scripts/build-icons.js';

const map = JSON.parse(readFileSync(new URL('../brand-map.json', import.meta.url), 'utf8'));
const source = readFileSync(new URL('../web/icons.js', import.meta.url), 'utf8');

test('generated file header names version and license', () => {
  assert.match(source.split('\n').slice(0, 3).join('\n'), /generated, do not edit/);
  assert.match(source.split('\n').slice(0, 4).join('\n'), /simple-icons 15\.22\.0 \(CC0-1\.0\)/);
  assert.equal(SIMPLE_ICONS_VERSION, map.simpleIconsVersion);
});

test('azure, aws and playwright have no icon (category symbol)', () => {
  for (const slug of ['microsoftazure', 'amazonwebservices', 'playwright']) assert.equal(hasIcon(slug), false);
  assert.equal(getIcon('playwright'), undefined);
  assert.equal(hasIcon('toString'), false);
});

test('every other slug in brand-map.json has an icon', () => {
  for (const slug of wantedSlugs(map)) {
    if (['microsoftazure', 'amazonwebservices', 'playwright'].includes(slug)) continue;
    assert.ok(hasIcon(slug), slug);
  }
});

test('colors are the brand color, or the theme text color for black / gray logos only', () => {
  for (const [slug, icon] of Object.entries(ICONS)) {
    assert.ok(icon.path.length > 20, slug);
    const brand = icon.light === 'currentColor' ? icon.dark : icon.light;
    for (const c of [icon.light, icon.dark]) assert.ok(c === brand || c === 'currentColor', `${slug} ${c}`);
  }
  assert.deepEqual([ICONS.claude.light, ICONS.claude.dark], ['#d97757', '#d97757']);
  assert.deepEqual([ICONS.github.light, ICONS.github.dark], ['#181717', 'currentColor']);
  assert.deepEqual([ICONS.sentry.light, ICONS.sentry.dark], ['#362d59', '#362d59']); // low contrast, but never shifted
});

test('logos the owners do not allow here are not drawn (category symbol instead)', () => {
  for (const slug of map.noIcon.slugs) assert.equal(hasIcon(slug), false, slug);
  assert.ok(map.noIcon.slugs.includes('openai') && map.noIcon.slugs.includes('gmail'));
  assert.ok(!wantedSlugs({ ...map, noIcon: { slugs: ['github'] } }).includes('github'));
});

test('themeColor: keeps saturated colors, uses text color for gray logos without contrast', () => {
  assert.equal(themeColor('#d97757', LIGHT_BG), '#d97757');
  assert.equal(themeColor('#222222', DARK_BG), 'currentColor');
  assert.equal(themeColor('#4a154b', DARK_BG), '#4a154b');
  assert.ok(contrast('#ffffff', DARK_BG) > 3);
});

test('buildSource is deterministic and skips slugs missing from simple-icons', () => {
  const m = { simpleIconsVersion: '1.0.0', providers: { a: 'foo' }, tools: [{ slug: 'bar' }, { slug: 'gone' }] };
  const icons = { foo: { path: 'M0 0h1v1z', hex: 'D97757' }, bar: { path: 'M1 1h2v2z', hex: '000000' } };
  const a = buildSource(m, icons);
  assert.equal(a, buildSource(m, { ...icons }));
  assert.match(a, /"bar": \{ path: "M1 1h2v2z", light: '#000000', dark: 'currentColor' \}/);
  assert.doesNotMatch(a, /gone/);
});
