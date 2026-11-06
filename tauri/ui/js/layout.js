// Keeps every column's x.com webview over its .column-slot box. Webviews
// are native views on top of this page, not DOM elements, so whenever a
// slot moves or changes size (window resize, horizontal scroll, add /
// remove / reorder, column width, ⚙ panel opening) the new rectangles are
// sent to Rust in one batch, at most once per frame.
import { setColumnBounds } from './api.js';

const columnsEl = document.getElementById('columns');
let scheduled = false;

export function slotBounds(slot) {
  const r = slot.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
}

export function scheduleLayout() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    // The shell is 0×0 while the window is minimized; sending that would
    // squash every column (see column_set_bounds in commands.rs).
    if (columnsEl.clientHeight === 0) return;
    const bounds = Array.from(columnsEl.querySelectorAll('.column'))
      .filter((el) => el._opened)
      .map((el) => ({ id: el.dataset.id, ...slotBounds(el._slot) }));
    if (bounds.length) setColumnBounds(bounds).catch((e) => console.error('layout', e));
  });
}

const resizeObserver = new ResizeObserver(scheduleLayout);

/** Watch a column's slot for size changes (width drag, ⚙ panel). */
export function observeSlot(slot) {
  resizeObserver.observe(slot);
}

export function unobserveSlot(slot) {
  resizeObserver.unobserve(slot);
}

// Called by Rust after a column leaves video fullscreen (fullscreen.rs).
window.relayoutColumns = scheduleLayout;

// Called by Rust (scroll_columns) for a horizontal wheel over a column's
// x.com page, which the shell can't see directly. The scroll event then
// moves the webviews via scheduleLayout.
window.scrollColumnsBy = (dx) => {
  columnsEl.scrollLeft += dx;
};

resizeObserver.observe(columnsEl);
columnsEl.addEventListener('scroll', scheduleLayout, { passive: true });
window.addEventListener('resize', scheduleLayout);
