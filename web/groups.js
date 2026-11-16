// Session groups on the screen: loaded from and saved to the server (/api/groups, groups.json), so the
// app window, the browser and the menu bar panel share them. Pure helpers first (tested), then the store
// and the picker in the run header.
import { S } from './strings.js';

/** The group a session is in, or null. */
export const groupOf = (groups, sessionId) => groups.find((g) => g.sessions.includes(sessionId)) ?? null;

/** Groups with `sessionId` moved into `groupId` (null: out of every group). */
export function assign(groups, sessionId, groupId) {
  return groups.map((g) => {
    const rest = g.sessions.filter((s) => s !== sessionId);
    return { ...g, sessions: g.id === groupId ? [...rest, sessionId] : rest };
  });
}

/** A lowercase id from the name, unique among `groups`. */
export function newGroupId(groups, name) {
  const base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'group';
  let id = base;
  for (let n = 2; groups.some((g) => g.id === id); n++) id = `${base}-${n}`;
  return id;
}

// ---- store ----
let groups = [];
const subs = new Set();
const notify = () => { for (const fn of subs) fn(groups); };

export const getGroups = () => groups;
export function onGroups(fn) { subs.add(fn); return () => subs.delete(fn); }

export async function loadGroups() {
  try {
    const res = await fetch('/api/groups', { headers: { accept: 'application/json' } });
    if (res.ok) { groups = (await res.json()).groups ?? []; notify(); }
  } catch { /* the list works without groups */ }
  return groups;
}

async function save(next) {
  const res = await fetch('/api/groups', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ groups: next }) });
  if (!res.ok) throw new Error(String(res.status));
  groups = (await res.json()).groups;
  notify();
}

export const setGroupOf = (sessionId, groupId) => save(assign(groups, sessionId, groupId));

export function createGroup(name, sessionId) {
  const id = newGroupId(groups, name);
  const next = [...groups, { id, name: String(name).trim().slice(0, 40), sessions: [] }];
  return save(sessionId ? assign(next, sessionId, id) : next);
}

export const deleteGroup = (id) => save(groups.filter((g) => g.id !== id));

// ---- picker: "Group: [None ▾]" in the run header ----
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const NEW = '__new__';

/** A select for the shown session's group, with "New group…" turning into a name field. `getId()` = session id. */
export function createGroupPicker(getId) {
  const box = el('span', 'grp-pick');
  const select = el('select');
  select.setAttribute('aria-label', S.groups.label);
  const input = el('input', 'grp-new');
  input.placeholder = S.groups.newPlaceholder;
  input.maxLength = 40;
  input.hidden = true;
  box.append(select, input);

  function paint() {
    const id = getId();
    const current = id ? groupOf(groups, id)?.id ?? '' : '';
    const opts = [new Option(S.groups.none, ''), ...groups.map((g) => new Option(g.name, g.id)), new Option(S.groups.newOption, NEW)];
    select.replaceChildren(...opts);
    select.value = current;
  }
  select.addEventListener('change', () => {
    const id = getId();
    if (!id) return;
    if (select.value === NEW) {
      select.hidden = true;
      input.hidden = false;
      input.value = '';
      input.focus();
      return;
    }
    setGroupOf(id, select.value || null).catch(paint);
  });
  const done = (ok) => {
    const name = input.value.trim();
    input.hidden = true;
    select.hidden = false;
    if (ok && name) createGroup(name, getId()).catch(paint); else paint();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') done(true);
    if (e.key === 'Escape') done(false);
  });
  input.addEventListener('blur', () => { if (!input.hidden) done(true); });
  const off = onGroups(paint);
  paint();
  return { el: box, update: paint, destroy: off };
}

// ---- list actions: right-click menu on a session row ----
let menu = null;
const closeMenu = () => { menu?.remove(); menu = null; };

/** A small menu at (x, y): move the session to a group, make a new one, or take it out of its group. */
export function showGroupMenu(x, y, sessionId) {
  closeMenu();
  const current = groupOf(groups, sessionId)?.id ?? null;
  menu = el('div', 'grp-menu');
  menu.setAttribute('role', 'menu');
  menu.append(el('div', 'grp-menu-h', S.groups.addTo));
  const item = (label, fn, cls = '') => {
    const b = el('button', `grp-menu-i ${cls}`.trim(), label);
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.addEventListener('click', () => { closeMenu(); fn(); });
    menu.append(b);
    return b;
  };
  for (const g of groups) item(`${g.id === current ? '✓ ' : ''}${g.name}`, () => setGroupOf(sessionId, g.id).catch(() => {}), g.id === current ? 'on' : '');
  const nb = el('button', 'grp-menu-i', S.groups.newOption);
  nb.type = 'button';
  nb.addEventListener('click', () => {
    const input = el('input', 'grp-new');
    input.placeholder = S.groups.newPlaceholder;
    input.maxLength = 40;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && input.value.trim()) { createGroup(input.value, sessionId).catch(() => {}); closeMenu(); }
      if (e.key === 'Escape') closeMenu();
    });
    nb.replaceWith(input);
    input.focus();
  });
  menu.append(nb);
  if (current) item(S.groups.remove, () => setGroupOf(sessionId, null).catch(() => {}), 'danger');
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, innerWidth - r.width - 8)}px`;
  menu.style.top = `${Math.min(y, innerHeight - r.height - 8)}px`;
}

/** Right click on a group chip: delete the group (its sessions are only ungrouped). */
export function showGroupChipMenu(x, y, groupId) {
  closeMenu();
  menu = el('div', 'grp-menu');
  menu.setAttribute('role', 'menu');
  const b = el('button', 'grp-menu-i danger', S.groups.del);
  b.type = 'button';
  b.setAttribute('role', 'menuitem');
  b.addEventListener('click', () => { closeMenu(); deleteGroup(groupId).catch(() => {}); });
  menu.append(b);
  document.body.append(menu);
  menu.style.left = `${Math.min(x, innerWidth - 200)}px`;
  menu.style.top = `${y}px`;
}

globalThis.document?.addEventListener('mousedown', (e) => { if (menu && !menu.contains(e.target)) closeMenu(); });
globalThis.document?.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
