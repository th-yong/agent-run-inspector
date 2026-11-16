// Builds web/icons.js from simple-icons (CC0-1.0), keeping only the slugs listed in brand-map.json.
// Usage: node scripts/build-icons.js [--from <extracted simple-icons package dir>]
// Without --from it runs `npm pack simple-icons@<version>` in a temp folder (simple-icons is never a dependency).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const LIGHT_BG = '#ffffff';
export const DARK_BG = '#17181b';
export const TEXT = 'currentColor'; // theme text color (black on light, white on dark)
export const MIN_CONTRAST = 3;
export const MIN_SATURATION = 0.25;

const toRgb = (hex) => [0, 2, 4].map((i) => parseInt(hex.slice(1 + i, 3 + i), 16) / 255);

export function luminance(hex) {
  const [r, g, b] = toRgb(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function rgbToHsl(hex) {
  const [r, g, b] = toRgb(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

// Brand color for one theme, never shifted (owners' guidelines forbid changed colors). A gray / black /
// white logo that lacks 3:1 on the background is drawn in the theme text color: the owner's own
// black or white variant. A saturated brand color is kept even when its contrast is low.
export function themeColor(hex, bg) {
  if (contrast(hex, bg) >= MIN_CONTRAST) return hex;
  return rgbToHsl(hex)[1] < MIN_SATURATION ? TEXT : hex;
}

export function colorsFor(slug, hex) {
  const brand = '#' + hex.toLowerCase();
  return { light: themeColor(brand, LIGHT_BG), dark: themeColor(brand, DARK_BG) };
}

export function wantedSlugs(map) {
  const skip = new Set(map.noIcon?.slugs ?? []);
  const slugs = new Set([...Object.values(map.providers), ...map.tools.map((t) => t.slug)]);
  return [...slugs].filter((s) => !skip.has(s)).sort();
}

// icons: { slug: { path, hex } } available in simple-icons. Slugs missing there are skipped (category symbol).
export function buildSource(map, icons) {
  const entries = [];
  for (const slug of wantedSlugs(map)) {
    const icon = icons[slug];
    if (!icon) continue;
    const { light, dark } = colorsFor(slug, icon.hex);
    entries.push(`  ${JSON.stringify(slug)}: { path: ${JSON.stringify(icon.path)}, light: '${light}', dark: '${dark}' },`);
  }
  return `// generated, do not edit: run \`node scripts/build-icons.js\`.
// Brand icons from simple-icons ${map.simpleIconsVersion} (CC0-1.0), only the slugs in brand-map.json.
// Trademarks belong to their owners; see THIRD_PARTY_NOTICES.md. Colors are the brand's own; 'currentColor' = the\n// theme text color, used only for black / gray logos (the owner's black or white variant).
export const SIMPLE_ICONS_VERSION = '${map.simpleIconsVersion}';

export const ICONS = {
${entries.join('\n')}
};

export function hasIcon(slug) {
  return Object.hasOwn(ICONS, slug);
}

export function getIcon(slug) {
  return hasIcon(slug) ? ICONS[slug] : undefined;
}
`;
}

export function loadPackage(dir, slugs) {
  const data = JSON.parse(readFileSync(join(dir, 'data', 'simple-icons.json'), 'utf8'));
  const bySlug = new Map(data.map((d) => [d.slug, d.hex]));
  const icons = {};
  for (const slug of slugs) {
    if (!bySlug.has(slug)) continue;
    const svg = readFileSync(join(dir, 'icons', `${slug}.svg`), 'utf8');
    const path = /<path d="([^"]+)"/.exec(svg)?.[1];
    if (path) icons[slug] = { path, hex: bySlug.get(slug) };
  }
  return icons;
}

function fetchPackage(version) {
  const tmp = mkdtempSync(join(tmpdir(), 'ari-icons-'));
  execFileSync('npm', ['pack', `simple-icons@${version}`, '--silent'], { cwd: tmp, stdio: 'ignore' });
  execFileSync('tar', ['-xzf', `simple-icons-${version}.tgz`], { cwd: tmp });
  return tmp;
}

function main(argv) {
  const map = JSON.parse(readFileSync(join(ROOT, 'brand-map.json'), 'utf8'));
  const fromIdx = argv.indexOf('--from');
  const tmp = fromIdx >= 0 ? null : fetchPackage(map.simpleIconsVersion);
  const dir = fromIdx >= 0 ? argv[fromIdx + 1] : join(tmp, 'package');
  try {
    const icons = loadPackage(dir, wantedSlugs(map));
    mkdirSync(join(ROOT, 'web'), { recursive: true });
    writeFileSync(join(ROOT, 'web', 'icons.js'), buildSource(map, icons));
    const missing = wantedSlugs(map).filter((s) => !icons[s]);
    console.log(`web/icons.js: ${Object.keys(icons).length} icons; not in simple-icons: ${missing.join(', ') || 'none'}`);
  } finally {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
