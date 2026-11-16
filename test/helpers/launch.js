// Runs bin/cli.js as a child process; all waits are output based.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../../bin/cli.js', import.meta.url));

export function launch(args, home, extraEnv = {}) {
  const child = spawn(process.execPath, [cli, ...args], { env: { PATH: process.env.PATH, HOME: home, ARI_NO_UPDATE_CHECK: '1', ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
  const out = { stdout: '', stderr: '' };
  const waiters = [];
  const poke = () => waiters.splice(0).forEach((w) => w());
  child.stdout.on('data', (d) => { out.stdout += d; poke(); });
  child.stderr.on('data', (d) => { out.stderr += d; poke(); });
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => { out.code = code; out.signal = signal; poke(); resolve(code); }));
  const waitFor = (cond, ms = 15000) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout; stdout=${out.stdout} stderr=${out.stderr}`)), ms);
    const check = () => {
      if (cond(out)) { clearTimeout(timer); resolve(); } else waiters.push(check);
    };
    check();
  });
  return { child, out, exited, waitFor };
}


export const addressOf = async (run) => {
  await run.waitFor((o) => /^http:\/\/127\.0\.0\.1:\d+\/\?t=\S+\n/m.test(o.stdout));
  return new URL(run.out.stdout.split('\n')[0]);
};

/** Waits for the address line, stops the child with SIGTERM and returns { code, out }. */
export async function runAndStop(args, home, extraEnv) {
  const run = launch(args, home, extraEnv);
  try {
    await addressOf(run);
    run.child.kill('SIGTERM');
    return { code: await run.exited, out: run.out };
  } finally {
    run.child.kill('SIGKILL');
  }
}
