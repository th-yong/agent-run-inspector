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

test('all colors reach 3:1 on the card background', () => {
  for (const [slug, icon] of Object.entries(ICONS)) {
    assert.ok(icon.path.length > 20, slug);
    for (const [color, bg] of [[icon.light, LIGHT_BG], [icon.dark, DARK_BG]]) {
      if (color === 'currentColor') continue; // theme text color: black on light, white on dark
      assert.ok(contrast(color, bg) >= 3, `${slug} ${color} on ${bg}`);
    }
  }
});

test('color rules: openai text in both themes, Claude kept, Slack lightened in dark, GitHub white in dark', () => {
  assert.deepEqual([ICONS.openai.light, ICONS.openai.dark], ['currentColor', 'currentColor']);
  assert.deepEqual([ICONS.claude.light, ICONS.claude.dark], ['#d97757', '#d97757']);
  assert.equal(ICONS.github.dark, 'currentColor');
  assert.notEqual(ICONS.slack.dark, '#4a154b');
  assert.ok(contrast(ICONS.slack.dark, DARK_BG) >= 3);
});

test('themeColor: shifts saturated colors, falls back to text for gray or too-far colors', () => {
  assert.equal(themeColor('#d97757', LIGHT_BG, -1), '#d97757');
  assert.equal(themeColor('#222222', DARK_BG, +1), 'currentColor');
  assert.equal(themeColor('#172b4d', DARK_BG, +1), 'currentColor');
  assert.ok(contrast(themeColor('#4a154b', DARK_BG, +1), DARK_BG) >= 3);
});

test('buildSource is deterministic and skips slugs missing from simple-icons', () => {
  const m = { simpleIconsVersion: '1.0.0', providers: { a: 'foo' }, colorOverrides: {}, tools: [{ slug: 'bar' }, { slug: 'gone' }] };
  const icons = { foo: { path: 'M0 0h1v1z', hex: 'D97757' }, bar: { path: 'M1 1h2v2z', hex: '000000' } };
  const a = buildSource(m, icons);
  assert.equal(a, buildSource(m, { ...icons }));
  assert.match(a, /"bar": \{ path: "M1 1h2v2z", light: '#000000', dark: 'currentColor' \}/);
  assert.doesNotMatch(a, /gone/);
});
