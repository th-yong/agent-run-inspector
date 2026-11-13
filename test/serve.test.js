// Starts the real CLI as a child process on a synthetic fixture root. Waits are output/response based.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { mkdtempSync, cpSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, addressOf } from './helpers/launch.js';

const fixtures = fileURLToPath(new URL('./fixtures/claude-code/projects', import.meta.url));
const MARK = 'SECRET-MARKER';

function setup() {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'ari-serve-')));
  const root = join(home, 'projects');
  cpSync(fixtures, root, { recursive: true });
  return { home, root };
}

function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get(url, { headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    }).on('error', reject);
  });
}

async function login(addr) {
  const r = await get(addr.href);
  assert.equal(r.status, 302);
  return r.headers['set-cookie'][0].split(';')[0];
}

test('ari serves the API, streams over SSE and exits 0 on SIGTERM', async () => {
  const { home, root } = setup();
  const run = launch(['--no-open', '--root', root], home);
  try {
    const addr = await addressOf(run);
    assert.equal(run.out.stdout.trim().split('\n').length, 1, 'only the address line');
    assert.equal((await get(`http://${addr.host}/api/sessions`)).status, 401);
    const cookie = await login(addr);

    const list = await get(`http://${addr.host}/api/sessions`, { cookie });
    assert.equal(list.status, 200);
    const { sessions } = JSON.parse(list.body);
    assert.ok(sessions.length >= 2);
    assert.equal((await get(`http://${addr.host}/`, { cookie })).status, 200); // placeholder or UI, never an error

    // SSE: a new session file shows up on the list stream.
    const req = http.get(`http://${addr.host}/api/sessions/stream`, { headers: { cookie } });
    const res = await new Promise((resolve) => req.on('response', resolve));
    assert.match(res.headers['content-type'], /text\/event-stream/);
    let buf = '';
    const arrived = new Promise((resolve) => res.on('data', (d) => {
      buf += d;
      if (/"type":"session"/.test(buf)) resolve();
    }));
    await new Promise((resolve) => { res.once('data', resolve); }); // ": ok"
    const sid = '00000000-0000-4000-8000-0000000000c9';
    const ts = new Date().toISOString();
    writeFileSync(join(root, '-synthetic-demo-app', `${sid}.jsonl`), JSON.stringify({
      type: 'user', uuid: 'u1', parentUuid: null, isSidechain: false, sessionId: sid, cwd: '/synthetic/demo-app',
      timestamp: ts, message: { role: 'user', content: 'hello' },
    }) + '\n');
    await arrived;
    assert.ok(buf.includes(sid));

    run.child.kill('SIGTERM');
    assert.equal(await run.exited, 0);
    req.destroy();
  } finally {
    run.child.kill('SIGKILL');
  }
  assert.ok(!run.out.stdout.includes(MARK) && !run.out.stderr.includes(MARK), 'no record text on the console');
});

test('--session puts the id in the address; SIGINT exits 0', async () => {
  const { home, root } = setup();
  const run = launch(['--no-open', '--root', root, '--session', 'abc', '--redact=strict'], home);
  try {
    const addr = await addressOf(run);
    assert.equal(addr.searchParams.get('s'), 'abc');
    const cookie = await login(addr);
    const d = await get(`http://${addr.host}/api/sessions`, { cookie });
    assert.ok(!d.body.includes(MARK));
    run.child.kill('SIGINT');
    assert.equal(await run.exited, 0);
  } finally {
    run.child.kill('SIGKILL');
  }
});

test('--source codex hides Claude Code sessions', async () => {
  const { home, root } = setup();
  const run = launch(['--root', root, '--source', 'codex'], home);
  try {
    const addr = await addressOf(run);
    const cookie = await login(addr);
    const r = await get(`http://${addr.host}/api/sessions`, { cookie });
    assert.deepEqual(JSON.parse(r.body).sessions, []);
    run.child.kill('SIGTERM');
    await run.exited;
  } finally {
    run.child.kill('SIGKILL');
  }
});

test('port already in use -> clear message, exit 2', async () => {
  const { home, root } = setup();
  const blocker = net.createServer();
  await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve));
  try {
    const run = launch(['--root', root, '--port', String(blocker.address().port)], home);
    assert.equal(await run.exited, 2);
    assert.match(run.out.stderr, /already in use/);
  } finally {
    blocker.close();
  }
});
