// Column drag-to-reorder (⠿ handle) and width resize (strip on the right).
//
// Pointer events with pointer capture rather than HTML5 drag & drop: the
// x.com webviews are native views over the shell, so the shell gets no
// dragover/drop while the mouse is over one. With capture, the shell keeps
// receiving the moves, and the drop target is worked out from the column
// rectangles instead.
import { MAX_WIDTH, MIN_WIDTH } from './column-types.js';
import { scheduleLayout } from './layout.js';

const columnsEl = document.getElementById('columns');

/** onDrop(srcId, targetId) is called when a column is dropped on another. */
export function enableReorder(handle, wrap, onDrop) {
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    wrap.classList.add('dragging');
    let target = null;

    const onMove = (ev) => {
      const over = Array.from(columnsEl.querySelectorAll('.column')).find((el) => {
        const r = el.getBoundingClientRect();
        return ev.clientX >= r.left && ev.clientX < r.right;
      });
      const next = over && over !== wrap ? over : null;
      if (next !== target) {
        target?.classList.remove('drag-over');
        next?.classList.add('drag-over');
        target = next;
      }
    };
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      wrap.classList.remove('dragging');
      target?.classList.remove('drag-over');
      if (target) onDrop(wrap.dataset.id, target.dataset.id);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  });
}

/** onDone(width) is called with the final width (px). */
export function enableResize(resizeHandle, wrap, onDone) {
  resizeHandle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    resizeHandle.setPointerCapture(e.pointerId);
    resizeHandle.classList.add('resizing');
    const startX = e.clientX;
    const startWidth = wrap.getBoundingClientRect().width;

    const onMove = (ev) => {
      const width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + (ev.clientX - startX)));
      wrap.style.width = `${width}px`;
      scheduleLayout();
    };
    const onUp = () => {
      resizeHandle.removeEventListener('pointermove', onMove);
      resizeHandle.removeEventListener('pointerup', onUp);
      resizeHandle.removeEventListener('pointercancel', onUp);
      resizeHandle.classList.remove('resizing');
      onDone(Math.round(wrap.getBoundingClientRect().width));
    };
    resizeHandle.addEventListener('pointermove', onMove);
    resizeHandle.addEventListener('pointerup', onUp);
    resizeHandle.addEventListener('pointercancel', onUp);
  });
}
