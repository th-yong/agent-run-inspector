// Redact toggle (top right). The server owns the level: the screen asks, the server answers, and the screen can
// never go below the level the server started with. After a change the page reloads so no old text stays in memory.
import { S } from './strings.js';

const RANK = { off: 0, basic: 1, strict: 2 };
const rank = (m) => RANK[m] ?? 0;

/** The level a click asks for, or null when the toggle is locked (the server started with redaction on). */
export function nextMode(mode, floor) {
  if (rank(floor) > 0) return null;
  return rank(mode) > 0 ? 'off' : 'basic';
}

/** What the button shows for a server state { mode, floor }. */
export function toggleView(st) {
  const mode = st && RANK[st.mode] !== undefined ? st.mode : 'off';
  const floor = st && RANK[st.floor] !== undefined ? st.floor : 'off';
  const on = rank(mode) > 0;
  const locked = nextMode(mode, floor) === null;
  const text = mode === 'strict' ? S.redact.strict : on ? S.redact.on : S.redact.off;
  const title = locked ? S.redact.locked : on ? S.redact.turnOff : S.redact.turnOn;
  return { on, locked, text, title, mode, floor };
}

export async function fetchRedact() {
  const res = await fetch('/api/redact', { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function postRedact(mode) {
  const res = await fetch('/api/redact', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode }) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Wires the button. `onUnauthorized` is called for a 401; the page reloads after a successful change. */
export function mountRedactToggle(btn, { onReload = () => location.reload() } = {}) {
  let st = null;
  const paint = () => {
    const v = toggleView(st);
    btn.hidden = st === null;
    btn.setAttribute('aria-pressed', String(v.on));
    btn.disabled = v.locked;
    btn.title = v.title;
    btn.dataset.mode = v.mode;
    btn.textContent = v.text;
  };
  btn.addEventListener('click', async () => {
    const target = nextMode(st?.mode, st?.floor);
    if (!target) return;
    btn.disabled = true;
    try {
      st = await postRedact(target);
      onReload();
    } catch {
      paint();
    }
  });
  paint();
  fetchRedact().then((s) => { st = s; paint(); }).catch(() => {});
}
