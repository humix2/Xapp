// Entry point of the shell UI: column list, toolbar, per-column header.
import * as api from './api.js';
import {
  DEFAULT_REFRESH_MS, DEFAULT_WIDTH, DEFAULT_ZOOM, OPERATOR_OPTIONS,
  columnHomeTooltip, columnKind, columnTitle, columnUrl, pageSettings,
} from './column-types.js';
import { buildSettingsPanel } from './column-settings.js';
import { clearSettle, runDiffUpdate } from './diff-update.js';
import { enableReorder, enableResize } from './drag.js';
import { observeSlot, scheduleLayout, slotBounds, unobserveSlot } from './layout.js';

const columnsEl = document.getElementById('columns');
const form = document.getElementById('add-column-form');
const typeSelect = document.getElementById('type-select');
const queryInput = document.getElementById('query-input');
const sortSelect = document.getElementById('sort-select');
const searchOperatorsEl = document.getElementById('search-operators');
const updateAllBtn = document.getElementById('update-all-btn');
const composeBtn = document.getElementById('compose-btn');

let columns = [];

const persist = () => api.saveColumns(columns).catch((e) => console.error('save', e));
const columnEl = (id) => columnsEl.querySelector(`.column[data-id="${id}"]`);

function mkBtn(label, title, onClick) {
  const b = document.createElement('button');
  b.textContent = label;
  b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

function scheduleRefresh(wrap, col) {
  clearInterval(wrap._refreshTimer);
  const ms = col.refreshMs ?? DEFAULT_REFRESH_MS;
  wrap._refreshTimer = ms ? setInterval(() => runDiffUpdate(wrap), ms) : null;
}

function createColumnElement(col) {
  const id = col.id;
  const wrap = document.createElement('div');
  wrap.className = 'column';
  wrap.dataset.id = id;
  wrap.style.width = `${col.width ?? DEFAULT_WIDTH}px`;

  // Header: ⠿ title status | buttons
  const header = document.createElement('div');
  header.className = 'column-header';
  const titleGroup = document.createElement('div');
  titleGroup.className = 'column-title-group';
  const handle = document.createElement('span');
  handle.className = 'drag-handle';
  handle.textContent = '⠿';
  handle.title = 'ドラッグして並べ替え';
  const title = document.createElement('span');
  title.className = 'column-title';
  const retitle = () => { title.textContent = title.title = columnTitle(col); };
  retitle();
  const statusEl = document.createElement('span');
  statusEl.className = 'column-status';
  wrap._statusEl = statusEl;
  titleGroup.append(handle, title, statusEl);

  const reload = () => api.navigateColumn(id, columnUrl(col)).catch(() => {});
  const settingsPanel = buildSettingsPanel(col, {
    save: persist,
    applyPage: () => api.runInColumn(id, 'apply-column-settings', pageSettings(col)).catch(() => {}),
    reload,
    retitle,
    reschedule: () => scheduleRefresh(wrap, col),
  });

  const btns = document.createElement('div');
  btns.className = 'column-buttons';
  const homeBtn = mkBtn('⌂', columnHomeTooltip(col), reload);
  btns.append(
    homeBtn,
    mkBtn('←', '戻る', () => api.goBackColumn(id)),
    mkBtn('⤒', '一番上へスクロール', () => api.runInColumn(id, 'scroll', { to: 'top' })),
    mkBtn('⤓', '一番下へスクロール', () => api.runInColumn(id, 'scroll', { to: 'bottom' })),
    mkBtn('⟲', '差分更新（新着のみ反映・スクロール位置を維持）', () => runDiffUpdate(wrap)),
    mkBtn('⟳', '更新（ページ全体を再読み込み）', () => api.reloadColumn(id)),
    mkBtn('⚙', 'カラム設定（文字サイズ・自動更新・並び替え/表示・検索演算子）', () => {
      settingsPanel.hidden = !settingsPanel.hidden;
    }),
    mkBtn('✕', 'カラム削除', () => removeColumn(id)),
  );
  header.append(titleGroup, btns);

  // Body: header, ⚙ panel, and the slot the x.com webview is placed over.
  const body = document.createElement('div');
  body.className = 'column-body';
  const slot = document.createElement('div');
  slot.className = 'column-slot';
  wrap._slot = slot;
  body.append(header, settingsPanel, slot);

  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'col-resize-handle';
  resizeHandle.title = 'ドラッグして幅を変更';

  wrap.append(body, resizeHandle);

  enableReorder(handle, wrap, reorderColumn);
  enableResize(resizeHandle, wrap, (width) => {
    col.width = width;
    persist();
  });
  return wrap;
}

// The webview can only be placed once the slot is in the DOM and laid out.
async function openColumnWebview(wrap, col) {
  try {
    await api.openColumn(col.id, columnKind(col), columnUrl(col), slotBounds(wrap._slot), pageSettings(col));
    wrap._opened = true;
    observeSlot(wrap._slot);
  } catch (e) {
    console.error('open column', e);
    wrap._statusEl.textContent = '読み込み失敗';
    wrap._statusEl.dataset.result = 'error';
  }
  scheduleRefresh(wrap, col);
  scheduleLayout();
}

function mountColumn(col, beforeEl = null) {
  const wrap = createColumnElement(col);
  columnsEl.insertBefore(wrap, beforeEl);
  openColumnWebview(wrap, col);
  return wrap;
}

function showEmptyState() {
  columnsEl.innerHTML = '';
  const empty = document.createElement('div');
  empty.className = 'empty-state';
  empty.textContent = '上のフォームからカラムを追加してください。初回はいずれかのカラムでXにログインすると、全カラムで共有されます。';
  columnsEl.appendChild(empty);
}

function makeColumn(partial) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    zoom: DEFAULT_ZOOM,
    refreshMs: DEFAULT_REFRESH_MS,
    width: DEFAULT_WIDTH,
    ...partial,
  };
}

function addColumn(partial) {
  const col = makeColumn(partial);
  if (columns.length === 0) columnsEl.innerHTML = '';
  columns.push(col);
  persist();
  const wrap = mountColumn(col);
  wrap.scrollIntoView({ inline: 'nearest' });
}

// Columns opened from inside another column (a hashtag click) go right
// after it, so it's clear where they came from. Called by Rust
// (commands.rs open_hashtag).
window.insertColumnAfter = (afterId, partial) => {
  const index = columns.findIndex((c) => c.id === afterId);
  if (index === -1) {
    addColumn(partial);
    return;
  }
  const col = makeColumn(partial);
  columns.splice(index + 1, 0, col);
  persist();
  const afterEl = columnEl(afterId);
  const wrap = mountColumn(col, afterEl ? afterEl.nextSibling : null);
  wrap.scrollIntoView({ inline: 'nearest' });
};

function removeColumn(id) {
  columns = columns.filter((c) => c.id !== id);
  persist();
  const el = columnEl(id);
  if (el) {
    clearInterval(el._refreshTimer);
    clearSettle(el);
    unobserveSlot(el._slot);
    el.remove();
  }
  api.closeColumn(id).catch(() => {});
  if (columns.length === 0) showEmptyState();
  scheduleLayout();
}

function reorderColumn(srcId, targetId) {
  const srcIndex = columns.findIndex((c) => c.id === srcId);
  const targetIndex = columns.findIndex((c) => c.id === targetId);
  if (srcIndex === -1 || targetIndex === -1 || srcIndex === targetIndex) return;
  const [moved] = columns.splice(srcIndex, 1);
  columns.splice(targetIndex, 0, moved);
  persist();
  const srcEl = columnEl(srcId);
  const targetEl = columnEl(targetId);
  if (srcEl && targetEl) {
    if (srcIndex < targetIndex) targetEl.after(srcEl);
    else targetEl.before(srcEl);
  }
  scheduleLayout();
}

// --- toolbar ---------------------------------------------------------------

const operatorCheckboxes = OPERATOR_OPTIONS.map(([op, short, title]) => {
  const label = document.createElement('label');
  label.className = 'operator-toggle';
  label.title = title;
  const box = document.createElement('input');
  box.type = 'checkbox';
  label.append(box, document.createTextNode(short));
  searchOperatorsEl.appendChild(label);
  return { op, box };
});

function updateFormForType() {
  const needsQuery = typeSelect.value === 'search';
  for (const el of [queryInput, sortSelect, searchOperatorsEl]) el.style.display = needsQuery ? '' : 'none';
  queryInput.required = needsQuery;
}
typeSelect.addEventListener('change', updateFormForType);
updateFormForType();

form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (typeSelect.value !== 'search') {
    addColumn({ type: typeSelect.value });
    return;
  }
  const q = queryInput.value.trim();
  if (!q) return;
  const operators = operatorCheckboxes.filter((o) => o.box.checked).map((o) => o.op);
  addColumn({ type: 'search', query: q, sort: sortSelect.value, operators });
  queryInput.value = '';
  operatorCheckboxes.forEach((o) => { o.box.checked = false; });
});

composeBtn.addEventListener('click', () => api.openCompose().catch((e) => console.error('compose', e)));

updateAllBtn.addEventListener('click', async () => {
  const label = updateAllBtn.textContent;
  updateAllBtn.disabled = true;
  updateAllBtn.textContent = '⟲ 更新中…';
  const wraps = Array.from(columnsEl.querySelectorAll('.column')).filter((w) => w._opened);
  const results = await Promise.all(wraps.map((w) => runDiffUpdate(w)));
  const withNew = results.filter((r) => r === 'clicked' || r === 'pending').length;
  updateAllBtn.textContent = withNew
    ? `✓ ${withNew}/${wraps.length} カラムに新着`
    : `✓ 新着なし (${wraps.length} カラム確認)`;
  setTimeout(() => {
    updateAllBtn.textContent = label;
    updateAllBtn.disabled = false;
  }, 2500);
});

async function init() {
  columns = await api.loadColumns().catch(() => []);
  if (columns.length === 0) {
    showEmptyState();
    return;
  }
  for (const col of columns) mountColumn(col);
}

init();
