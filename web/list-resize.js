// Drag the line between the session list and the run to change the list's width (220-640 px).
// Remembered per browser; a double click goes back to the default.
const KEY = 'ari.listWidth';
const MIN = 220;
const MAX = 640;
export const clampWidth = (w) => Math.round(Math.min(MAX, Math.max(MIN, w)));

export function mountListResize(app, label) {
  const bar = document.createElement('div');
  bar.className = 'list-resizer';
  bar.setAttribute('role', 'separator');
  bar.setAttribute('aria-orientation', 'vertical');
  bar.setAttribute('aria-label', label);
  bar.tabIndex = 0;
  app.append(bar);
  const set = (w, save = true) => {
    if (w === null) app.style.removeProperty('--list-w');
    else app.style.setProperty('--list-w', `${clampWidth(w)}px`);
    if (save) try { if (w === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, String(clampWidth(w))); } catch { /* storage blocked */ }
  };
  try { const w = Number(localStorage.getItem(KEY)); if (w) set(w, false); } catch { /* storage blocked */ }
  const width = () => app.querySelector('.list').getBoundingClientRect().width;
  bar.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    bar.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const w0 = width();
    document.body.classList.add('resizing');
    const move = (ev) => set(w0 + ev.clientX - x0, false);
    const up = (ev) => {
      bar.removeEventListener('pointermove', move);
      bar.removeEventListener('pointerup', up);
      document.body.classList.remove('resizing');
      set(w0 + ev.clientX - x0);
    };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up);
  });
  bar.addEventListener('dblclick', () => set(null));
  bar.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); set(width() + (e.key === 'ArrowLeft' ? -16 : 16)); }
  });
}
