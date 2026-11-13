import { firstCommandWord, isShellTool } from './tool-brand.js';

const BY_TOOL = new Map([
  ['read', 'file'], ['notebookread', 'file'], ['view', 'file'], ['read_file', 'file'], ['write', 'file'],
  ['edit', 'edit'], ['multiedit', 'edit'], ['notebookedit', 'edit'], ['apply_patch', 'edit'], ['str_replace_editor', 'edit'],
  ['grep', 'search'], ['glob', 'search'], ['ls', 'search'], ['toolsearch', 'search'],
  ['webfetch', 'web'], ['websearch', 'web'], ['web_search', 'web'],
  ['agent', 'agent'], ['task', 'agent'], ['spawn_agent', 'agent'], ['send_input', 'agent'], ['wait_agent', 'agent'],
]);
const DB_CMDS = new Set(['psql', 'pg_dump', 'pg_restore', 'redis-cli', 'mysql', 'sqlite3', 'mongosh']);

/**
 * Category symbol used when no brand icon exists. Always set, even when a brand is also set.
 * @param {{ name: string, command?: string }} tool
 * @returns {import('./types.js').ToolCategory}
 */
export function toolCategoryOf({ name, command }) {
  if (typeof name !== 'string') return 'other';
  const lower = name.toLowerCase();
  if (lower.startsWith('mcp__')) return 'mcp';
  if (isShellTool(lower)) {
    const word = firstCommandWord(command);
    if (word === 'git' || word === 'gh') return 'git';
    if (word && DB_CMDS.has(word)) return 'db';
    return 'shell';
  }
  return BY_TOOL.get(lower) ?? 'other';
}
