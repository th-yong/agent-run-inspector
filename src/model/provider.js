import { readFileSync } from 'node:fs';

const BRAND_MAP = JSON.parse(readFileSync(new URL('../../brand-map.json', import.meta.url), 'utf8'));

/** @returns {Set<string>} providers that have a logo mapping */
export const KNOWN_PROVIDERS = new Set(Object.keys(BRAND_MAP.providers));

/**
 * Model name -> provider (spec section 4).
 * @param {string | undefined | null} model
 * @returns {import('./types.js').Provider}
 */
export function providerOf(model) {
  if (typeof model !== 'string') return 'other';
  let name = model.trim().toLowerCase();
  const slash = name.lastIndexOf('/');
  if (slash !== -1) name = name.slice(slash + 1);
  if (!name) return 'other';
  if (name.startsWith('claude-') || name.includes('-claude') || /^(opus|sonnet|haiku|fable)/.test(name)) {
    return 'anthropic';
  }
  if (/^(gpt-|o1|o3|o4|codex)/.test(name)) return 'openai';
  if (name.includes('gemini')) return 'google';
  return 'other';
}

/** simple-icons slug for a provider, or null for 'other'. */
export function providerSlug(provider) {
  return BRAND_MAP.providers[provider] ?? null;
}
