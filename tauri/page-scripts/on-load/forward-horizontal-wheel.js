// Horizontal wheel (tilt wheel / Shift+wheel) → scroll the column strip.
//
// In the Electron version a column is a <webview> inside the shell's DOM,
// so a horizontal scroll the page doesn't use bubbles out to the strip.
// Here each column is a separate native webview on top of the shell, so
// the shell never sees wheel events over a column. This forwards them,
// unless something inside the page (e.g. a photo carousel) can scroll
// that way itself.
//
// Uses the scroll_columns command (capabilities/x-pages.json).
(() => {
  const canScrollX = (el, dx) => {
    for (; el && el !== document.documentElement; el = el.parentElement) {
      if (el.scrollWidth <= el.clientWidth) continue;
      const overflow = getComputedStyle(el).overflowX;
      if (overflow !== 'auto' && overflow !== 'scroll') continue;
      if (dx > 0 ? el.scrollLeft + el.clientWidth < el.scrollWidth - 1 : el.scrollLeft > 0) return true;
    }
    return false;
  };

  // Batched to one IPC call per frame; a tilt wheel fires very often.
  let pending = 0;
  let scheduled = false;
  const flush = () => {
    scheduled = false;
    const dx = pending;
    pending = 0;
    const ipc = window.__TAURI_INTERNALS__;
    if (dx && ipc) ipc.invoke('scroll_columns', { dx }).catch(() => {});
  };

  window.addEventListener('wheel', (e) => {
    let dx = e.deltaX;
    if (!dx && e.shiftKey) dx = e.deltaY;
    if (!dx || Math.abs(dx) < Math.abs(e.shiftKey ? 0 : e.deltaY)) return;
    if (canScrollX(e.target, dx)) return;
    // deltaMode 1 = lines, 2 = pages; the strip scrolls in pixels.
    pending += e.deltaMode === 1 ? dx * 40 : e.deltaMode === 2 ? dx * 400 : dx;
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(flush);
    }
  }, { passive: true, capture: true });
})();
