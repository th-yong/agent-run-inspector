import { readdirSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKIP_DIRS = new Set(['node_modules', '.git', 'coverage']);

// External URLs allowed inside src/ and web/ (prefix match).
export const URL_ALLOWLIST = [
  'http://127.0.0.1',
  'http://localhost',
  'http://www.w3.org/2000/svg',
  'https://github.com/th-yong/agent-run-inspector',
  'https://api.github.com/repos/th-yong/agent-run-inspector/releases/latest', // update check (src/update-check.js, src/macos/app.js)
  'https://registry.npmjs.org/agent-run-inspector/-/agent-run-inspector-', // Mac app: is the new version on npm yet
];

const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/;

function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:\\'"`])\/\/.*$/gm, '$1');
}

// Returns a list of { line, rule, message } for one file. `relPath` uses forward slashes.
export function checkSource(relPath, text) {
  const out = [];
  const inSrcWeb = /^(src|web)\//.test(relPath);
  const inCode = /^(src|web|bin)\//.test(relPath);
  const isStrings = /(^|\/)strings\.js$/.test(relPath);
  const add = (index, rule, message) => {
    const line = text.slice(0, index).split('\n').length;
    out.push({ line, rule, message });
  };

  const code = stripComments(text);

  if (inSrcWeb) {
    for (const m of code.matchAll(/https?:\/\/[^\s'"`)<>]+/g)) {
      if (!URL_ALLOWLIST.some((p) => m[0].startsWith(p))) {
        add(m.index, 'external-url', `external URL literal not allowed: ${m[0]}`);
      }
    }
  }
  for (const m of inCode ? code.matchAll(/\bchild_process\s*\.\s*exec\s*\(|(?<![.\w])exec\s*\(/g) : []) {
    if (/child_process\s*\.\s*exec/.test(m[0]) || /from\s+['"](node:)?child_process['"]/.test(code)) {
      add(m.index, 'exec', 'child_process.exec( is forbidden; use execFile with an args array');
    }
  }
  for (const m of inCode ? code.matchAll(/shell\s*:\s*true/g) : []) {
    add(m.index, 'shell-true', 'shell: true is forbidden');
  }
  if (/^web\//.test(relPath)) {
    for (const m of code.matchAll(/style\s*=\s*["']/g)) {
      add(m.index, 'inline-style', 'inline style="..." is forbidden in web/');
    }
  }
  if (inCode && !isStrings) {
    const m = HANGUL.exec(code);
    if (m) add(m.index, 'hangul', 'Hangul literal outside strings.js');
  }
  return out;
}

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, files);
    else if (name.endsWith('.js')) files.push(p);
  }
  return files;
}

export function lintAll(root = ROOT) {
  const problems = [];
  for (const file of walk(root)) {
    const rel = relative(root, file).split(sep).join('/');
    try {
      execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    } catch (err) {
      problems.push(`${rel}: syntax error\n${String(err.stderr ?? err.message).trim()}`);
      continue;
    }
    for (const v of checkSource(rel, readFileSync(file, 'utf8'))) {
      problems.push(`${rel}:${v.line}: [${v.rule}] ${v.message}`);
    }
  }
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const problems = lintAll();
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
  console.log('lint ok');
}
