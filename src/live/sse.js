// Server-sent events: pushes session-list and per-session span changes to open screens.
// - The server numbers every event (`seq`, one monotonic counter for the whole hub) and sends it as `id:`.
// - Each feed (the list, and one per opened session) keeps a short buffer. A client that reconnects with
//   Last-Event-ID gets what it missed; if the buffer no longer reaches back that far (or the id is from a
//   previous server run) it gets one `resync` event and must reload the full session.
// - Buffers hold raw events; the redactor is applied when an event is written, so a mode change takes
//   effect for everything sent afterwards and nothing unredacted ever leaves the process.
// - Child files are not tied to a parent session by the watcher: after each batch the hub asks
//   index.list() again, and index.open() re-parses a session whose files changed.
import { TotalsTree } from '../model/totals.js';

export const PING_MS = 15000;
export const SWEEP_MS = 30000; // how often to re-check whether a running session has gone quiet
const BUFFER_MAX = 500;
const STATE_MAX = 32;
const SLOW_CLIENT_BYTES = 4 * 1024 * 1024;

class Feed {
  constructor(floor) {
    this.floor = floor; // every event with seq > floor is in `buf` (until trimmed)
    this.buf = [];
    this.clients = new Set();
  }

  push(ev) {
    this.buf.push(ev);
    while (this.buf.length > BUFFER_MAX) this.floor = this.buf.shift().seq;
  }
}

/**
 * @param {{ index: { list(): object[], open(id: string): object }, redactor: { apply(kind: string, body: object): object },
 *   pingMs?: number, sweepMs?: number, seqBase?: number }} opts
 */
export function createLiveHub({ index, redactor, pingMs = PING_MS, sweepMs = SWEEP_MS, seqBase = Date.now() }) {
  // Starting from the clock keeps ids of a restarted server above the ones clients remember.
  let seq = seqBase;
  const listFeed = new Feed(seq);
  const listSeen = new Map(); // session id -> JSON of the last summary sent
  const states = new Map(); // session id -> { feed, tree, spans: Map(id -> { json, seq }), totalsJson, reportedUsd }
  let closed = false;

  const write = (res, ev) => {
    const body = redactor.apply('event', ev.data);
    res.write(`id: ${ev.seq}\ndata: ${JSON.stringify(body)}\n\n`);
  };

  function emit(feed, data) {
    const ev = { seq: ++seq, data };
    feed.push(ev);
    for (const res of feed.clients) {
      try {
        write(res, ev);
        if (res.writableLength > SLOW_CLIENT_BYTES) res.destroy();
      } catch {
        feed.clients.delete(res);
      }
    }
    return ev.seq;
  }

  // Brings a session's state up to date with an opened session; emits one event per changed span.
  function sync(id, opened) {
    let st = states.get(id);
    const fresh = !st;
    if (fresh) {
      st = { feed: new Feed(seq), tree: new TotalsTree(), spans: new Map(), totalsJson: null, reportedUsd: null };
      states.set(id, st);
      while (states.size > STATE_MAX) {
        const oldest = [...states].find(([, s]) => s.feed.clients.size === 0);
        if (!oldest) break;
        states.delete(oldest[0]);
      }
    }
    st.reportedUsd = opened.reportedUsd ?? null;
    for (const span of opened.spans) {
      const json = JSON.stringify(span);
      const prev = st.spans.get(span.id);
      if (prev && prev.json === json) continue;
      st.tree.upsert(span);
      if (fresh) {
        st.spans.set(span.id, { json, seq: 0 });
      } else {
        const n = emit(st.feed, { type: 'span', span: { ...span, seq: seq + 1 } });
        st.spans.set(span.id, { json, seq: n });
      }
    }
    const totals = st.tree.snapshot({ reportedUsd: st.reportedUsd });
    const totalsJson = JSON.stringify(totals);
    if (totalsJson !== st.totalsJson) {
      if (!fresh && st.totalsJson !== null) emit(st.feed, { type: 'totals', totals });
      st.totalsJson = totalsJson;
    }
    return st;
  }

  /** Current seq of a session after syncing it, and its spans stamped with the seq of their last change. */
  function track(id, opened) {
    const st = sync(id, opened);
    return {
      seq,
      spans: opened.spans.map((s) => ({ ...s, seq: st.spans.get(s.id)?.seq ?? 0 })),
    };
  }

  let hasRunning = false;
  // The index drops a session from "running" by the clock, so no file change announces it.
  const sweep = setInterval(() => {
    if (!closed && hasRunning && listFeed.clients.size) {
      try { diffList(); } catch { /* the next tick tries again */ }
    }
  }, sweepMs);
  sweep.unref?.();

  function diffList() {
    const summaries = index.list();
    const first = listSeen.size === 0;
    const now = new Set();
    hasRunning = false;
    for (const summary of summaries) {
      now.add(summary.id);
      if (summary.status === 'running') hasRunning = true;
      const json = JSON.stringify(summary);
      if (listSeen.get(summary.id) === json) continue;
      listSeen.set(summary.id, json);
      if (!first) emit(listFeed, { type: 'session', summary });
    }
    // a session left the list (folded under its Orca bot or lead, or out of the window): clients reload it
    let gone = false;
    for (const id of listSeen.keys()) if (!now.has(id)) { listSeen.delete(id); gone = true; }
    if (gone && !first) emit(listFeed, { type: 'resync' });
    return summaries;
  }

  /** Feed this to createWatcher({ onBatch }). Works from what the index sees, not from the batch lines. */
  function onBatch() {
    if (closed) return;
    const before = new Map(listSeen);
    const summaries = diffList();
    for (const summary of summaries) {
      if (!states.has(summary.id) || before.get(summary.id) === listSeen.get(summary.id)) continue;
      try {
        sync(summary.id, index.open(summary.id));
      } catch {
        // the session vanished or cannot be parsed right now; the next batch tries again
      }
    }
  }

  function startStream(req, res, feed) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    const raw = req.headers['last-event-id'];
    const last = raw === undefined ? null : Number(raw);
    let replay = [];
    let resync = false;
    if (last !== null) {
      if (!Number.isInteger(last) || last > seq || last < feed.floor) resync = true;
      else replay = feed.buf.filter((e) => e.seq > last);
    }
    res.write(': ok\n\n');
    if (resync) res.write('data: {"type":"resync"}\n\n');
    for (const ev of replay) write(res, ev);
    feed.clients.add(res);
    const ping = setInterval(() => {
      try { res.write(': ping\n\n'); } catch { cleanup(); }
    }, pingMs);
    ping.unref?.();
    function cleanup() {
      clearInterval(ping);
      feed.clients.delete(res);
    }
    res.on('close', cleanup);
    res.on('error', cleanup);
    req.on('close', cleanup);
    return true;
  }

  /** GET /api/sessions/stream */
  function streamList(req, res) {
    diffList(); // learn the current state so the first change shows up as a change
    return startStream(req, res, listFeed);
  }

  /** GET /api/sessions/:id/stream; `opened` is the result of index.open(id). */
  function streamSession(req, res, id, opened) {
    return startStream(req, res, sync(id, opened).feed);
  }

  function close() {
    closed = true;
    clearInterval(sweep);
    for (const feed of [listFeed, ...[...states.values()].map((s) => s.feed)]) {
      for (const res of feed.clients) res.end();
      feed.clients.clear();
    }
  }

  const clientCount = () => listFeed.clients.size + [...states.values()].reduce((n, s) => n + s.feed.clients.size, 0);
  return { onBatch, streamList, streamSession, track, close, clientCount, currentSeq: () => seq };
}
