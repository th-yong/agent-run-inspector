// Redaction (server side only). One place decides what leaves the server:
//   off    nothing hidden
//   basic  message bodies, tool inputs (key names only), tasks, commands and error text hidden
//   strict basic + session title, project, branch, cwd and the log folder paths
// The screen can raise the level (POST /api/redact) but never go below the level the server started with.
import { MSG } from '../strings.js';

export const MODES = ['off', 'basic', 'strict'];
const rank = (m) => MODES.indexOf(m);

const PATH_LIKE = /[\\/]|^~|^[A-Za-z]:|\.[A-Za-z0-9]{1,6}$/;
/** True when an object key looks like a file path (keys can be sensitive too). */
export const pathLikeKey = (k) => PATH_LIKE.test(k);

const hiddenText = (v) => (typeof v === 'string' ? MSG.charsHidden(v.length) : MSG.hidden);

// A preview ({ text, length, truncated, keys? }) becomes { hidden, length, keys? } without any body.
function hidePreview(p) {
  if (!p) return p;
  const out = { hidden: true, length: p.length };
  if (Array.isArray(p.keys)) out.keys = p.keys.map((k) => (pathLikeKey(k) ? MSG.hidden : k));
  return out;
}

function hideSpan(s, mode) {
  const out = { ...s };
  delete out.task;
  delete out.command;
  if (out.error) out.error = { ...out.error, message: hiddenText(out.error.message), hidden: true };
  if (mode === 'strict' && out.kind === 'session') out.name = MSG.hidden;
  return out;
}

function hideSummary(s) {
  const out = { ...s, project: MSG.hidden };
  delete out.title;
  delete out.cwd;
  delete out.branch;
  return out;
}

export function createRedactor({ mode = 'off' } = {}) {
  if (!MODES.includes(mode)) throw new Error(`Unknown redact mode: ${mode}`);
  const floor = mode;
  let current = mode;

  const isOn = () => current !== 'off';
  const isStrict = () => current === 'strict';

  /** @returns {boolean} false when the request would go below the starting level. */
  function set(next) {
    if (!MODES.includes(next) || rank(next) < rank(floor)) return false;
    current = next;
    return true;
  }

  const summary = (s) => (isStrict() ? hideSummary(s) : s);
  const span = (s) => (isOn() ? hideSpan(s, current) : s);

  /**
   * The one function every API response goes through.
   * kind: 'sessions' | 'session' | 'detail' | 'roots'
   */
  function apply(kind, body) {
    if (!isOn()) return body;
    switch (kind) {
      case 'sessions':
        return { ...body, sessions: body.sessions.map(summary) };
      case 'session':
        return {
          ...body,
          summary: summary(body.summary),
          spans: body.spans.map(span),
          markers: body.markers.map((m) => (m && typeof m === 'object' ? hideMarker(m) : m)),
        };
      case 'detail':
        return {
          ...body,
          ...(isStrict() && body.kind === 'session' ? { name: MSG.hidden } : {}),
          input: hidePreview(body.input),
          output: hidePreview(body.output),
          ...(body.error ? { error: { ...body.error, message: hiddenText(body.error.message), hidden: true } } : {}),
        };
      case 'roots':
        return isStrict() ? { ...body, roots: body.roots.map(({ path, ...rest }) => rest) } : body;
      default:
        return body;
    }
  }

  return { mode: () => current, floor: () => floor, set, apply };
}

// Markers are small timeline points; drop any free text they carry.
function hideMarker(m) {
  const out = { ...m };
  for (const k of ['text', 'message', 'title', 'summary', 'content']) if (k in out) delete out[k];
  return out;
}
