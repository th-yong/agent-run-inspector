import { test } from 'node:test';
import assert from 'node:assert/strict';
import { providerOf, providerSlug } from '../src/model/provider.js';
import { toolBrandOf, firstCommandWord } from '../src/model/tool-brand.js';
import { toolCategoryOf } from '../src/model/tool-category.js';

test('providerOf table', () => {
  const rows = [
    ['claude-opus-4-1', 'anthropic'], ['Claude-Sonnet-4', 'anthropic'], ['anthropic/claude-3-5-haiku', 'anthropic'],
    ['us.anthropic-claude-x', 'anthropic'], ['opus', 'anthropic'], ['sonnet-5', 'anthropic'], ['haiku', 'anthropic'], ['fable', 'anthropic'],
    ['gpt-5', 'openai'], ['openai/gpt-4o', 'openai'], ['o1', 'openai'], ['o3-mini', 'openai'], ['o4-mini', 'openai'],
    ['codex', 'openai'], ['codex-mini-latest', 'openai'],
    ['gemini-2.5-pro', 'google'], ['google/gemini-flash', 'google'],
    ['llama-3', 'other'], ['<synthetic>', 'other'], ['', 'other'], [undefined, 'other'], [null, 'other'], [42, 'other'],
  ];
  for (const [model, want] of rows) assert.equal(providerOf(model), want, String(model));
});

test('providerSlug', () => {
  assert.equal(providerSlug('anthropic'), 'claude');
  assert.equal(providerSlug('openai'), 'openai');
  assert.equal(providerSlug('google'), 'googlegemini');
  assert.equal(providerSlug('other'), null);
});

test('toolBrand rule 1: MCP server name', () => {
  const rows = [
    ['mcp__github__create_issue', 'github'], ['mcp__Notion__search', 'notion'],
    ['mcp__claude-in-chrome__navigate', 'googlechrome'], ['mcp__google-drive__list', 'googledrive'],
    ['mcp__playwright__click', 'playwright'], ['mcp__unknown__x', undefined],
  ];
  for (const [name, want] of rows) assert.equal(toolBrandOf({ name }), want, name);
});

test('toolBrand rule 2: name prefix', () => {
  assert.equal(toolBrandOf({ name: 'github.pr' }), 'github');
  assert.equal(toolBrandOf({ name: 'notion.page' }), 'notion');
  assert.equal(toolBrandOf({ name: 'Read' }), undefined);
});

test('toolBrand rule 3: Bash first word', () => {
  const rows = [
    ['gh pr list', 'github'], ['git status', 'git'], ['docker ps', 'docker'], ['kubectl get pods', 'kubernetes'],
    ['psql -c x', 'postgresql'], ['npx foo', 'npm'], ['npm test', 'npm'], ['pip install x', 'python'], ['python3 a.py', 'python'],
    ['uvx tool', 'uv'], ['gcloud auth', 'googlecloud'], ['az login', 'microsoftazure'], ['aws s3 ls', 'amazonwebservices'],
    ['playwright test', 'playwright'],
    ['FOO=1 BAR=2 gh pr view', 'github'], ['sudo docker ps', 'docker'], ['sudo -E git log', 'git'],
    ['env NODE_ENV=x npm run a', 'npm'], ['time git pull', 'git'], ['/usr/bin/git status', 'git'], ['GH pr', 'github'],
    ['ls -la', undefined], ['', undefined],
  ];
  for (const [command, want] of rows) {
    for (const name of ['Bash', 'exec', 'exec_command', 'shell']) {
      assert.equal(toolBrandOf({ name, command }), want, `${name}: ${command}`);
    }
  }
  assert.equal(toolBrandOf({ name: 'Bash' }), undefined);
  assert.equal(firstCommandWord('sudo'), null);
});

test('toolBrand rule 4 / error: errors never get a brand', () => {
  assert.equal(toolBrandOf({ name: 'Bash', command: 'git push', isError: true }), undefined);
  assert.equal(toolBrandOf({ name: 'mcp__github__x', isError: true }), undefined);
});

test('toolCategory table', () => {
  const rows = [
    [{ name: 'Read' }, 'file'], [{ name: 'Write' }, 'file'], [{ name: 'Edit' }, 'edit'], [{ name: 'apply_patch' }, 'edit'],
    [{ name: 'Grep' }, 'search'], [{ name: 'Glob' }, 'search'], [{ name: 'WebFetch' }, 'web'], [{ name: 'WebSearch' }, 'web'],
    [{ name: 'Agent' }, 'agent'], [{ name: 'Task' }, 'agent'], [{ name: 'spawn_agent' }, 'agent'],
    [{ name: 'mcp__github__x' }, 'mcp'], [{ name: 'Bash', command: 'ls' }, 'shell'], [{ name: 'exec_command', command: 'git log' }, 'git'],
    [{ name: 'Bash', command: 'psql -c 1' }, 'db'], [{ name: 'Whatever' }, 'other'], [{}, 'other'],
  ];
  for (const [tool, want] of rows) assert.equal(toolCategoryOf(tool), want, JSON.stringify(tool));
});

test('brand-less brands still get slug and category together', () => {
  for (const [name, command, slug] of [
    ['Bash', 'az login', 'microsoftazure'], ['Bash', 'aws s3 ls', 'amazonwebservices'], ['mcp__playwright__click', undefined, 'playwright'],
  ]) {
    assert.equal(toolBrandOf({ name, command }), slug);
    assert.ok(toolCategoryOf({ name, command }));
  }
});
