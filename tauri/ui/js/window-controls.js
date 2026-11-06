// The window has no OS title bar (see lib.rs), so the toolbar plays that
// role: drag its empty space to move the window, double-click it to
// maximize / restore, and the ─ □ ✕ buttons on the right.
const win = window.__TAURI__.window.getCurrentWindow();
const toolbar = document.getElementById('toolbar');
const maxBtn = document.getElementById('win-max');

document.getElementById('win-min').addEventListener('click', () => win.minimize());
maxBtn.addEventListener('click', () => win.toggleMaximize());
document.getElementById('win-close').addEventListener('click', () => win.close());

// Only the toolbar's empty space drags; inputs, selects and buttons keep working.
const isEmptySpace = (target) => !target.closest('input, select, button, label, textarea');

toolbar.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || !isEmptySpace(e.target)) return;
  if (e.detail === 2) {
    win.toggleMaximize();
  } else {
    win.startDragging();
  }
});

async function syncMaximized() {
  const maximized = await win.isMaximized();
  document.body.classList.toggle('maximized', maximized);
  maxBtn.title = maximized ? '元に戻す' : '最大化';
  maxBtn.setAttribute('aria-label', maxBtn.title);
}

syncMaximized();
win.onResized(syncMaximized);
