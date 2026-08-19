const columnsEl = document.getElementById('columns');
const form = document.getElementById('add-column-form');
const typeSelect = document.getElementById('type-select');
const queryInput = document.getElementById('query-input');
const sortSelect = document.getElementById('sort-select');

const DEFAULT_ZOOM = 1;
const DEFAULT_REFRESH_MS = 180000; // 3分
const ZOOM_OPTIONS = [0.8, 0.9, 1, 1.1, 1.25, 1.5];
const REFRESH_OPTIONS = [
  [0, 'オフ'],
  [60000, '1分'],
  [180000, '3分'],
  [300000, '5分'],
  [600000, '10分'],
];

// Search/explore/trends pages and the home timeline all render their tab bar
// (話題のポスト/最新/... or おすすめ/フォロー中) with the same
// data-testid="ScrollSnap-List". Search & trends columns hide it (the app's
// own controls cover sorting), but home columns need it visible so
// "フォロー中" can be selected — so this stays conditional per column type
// instead of living in the static inject.css.
const TAB_BAR_HIDE_CSS = 'div[role="tablist"][data-testid="ScrollSnap-List"] { display: none !important; }';

let injectCss = '';
let columns = [];
let dragSrcId = null;
const cssKeys = new WeakMap(); // webview -> last inserted CSS key

function buildSearchUrl(query, sort) {
  const params = new URLSearchParams();
  params.set('q', query);
  params.set('src', 'typed_query');
  if (sort === 'live') params.set('f', 'live');
  return `https://x.com/search?${params.toString()}`;
}

function buildColumnUrl(col) {
  if (col.type === 'trends') return 'https://x.com/explore/tabs/trending';
  if (col.type === 'home') return 'https://x.com/home';
  return buildSearchUrl(col.query, col.sort);
}

function columnTitle(col) {
  if (col.type === 'trends') return 'トレンド';
  if (col.type === 'home') return 'ホーム';
  return col.query;
}

function columnHomeTooltip(col) {
  if (col.type === 'trends') return 'トレンドに戻る';
  if (col.type === 'home') return 'ホームに戻る';
  return '検索トップに戻る';
}

function applyCss(webview, col) {
  const prevKey = cssKeys.get(webview);
  const tabCss = col.type === 'home' ? '' : TAB_BAR_HIDE_CSS;
  // webview.setZoomFactor() would work too, but Chromium ties it to the
  // partition's per-origin zoom map: since every column shares
  // persist:xsession + x.com, setting it on one column silently changes
  // the zoom of every other column too. Scoping zoom to CSS injected per
  // webview keeps each column's zoom independent.
  const zoom = col.zoom ?? DEFAULT_ZOOM;
  const zoomCss = zoom !== 1 ? `html { zoom: ${zoom}; }` : '';
  const css = [injectCss, tabCss, zoomCss].filter(Boolean).join('\n');
  const insert = () => {
    webview.insertCSS(css).then((key) => cssKeys.set(webview, key)).catch(() => {});
  };
  if (prevKey) {
    webview.removeInsertedCSS(prevKey).catch(() => {}).finally(insert);
  } else {
    insert();
  }
}

function mkBtn(label, title, onClick) {
  const b = document.createElement('button');
  b.textContent = label;
  b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

function buildSelect(className, options, selectedValue, onChange) {
  const select = document.createElement('select');
  select.className = className;
  for (const [value, label] of options) {
    const opt = document.createElement('option');
    opt.value = String(value);
    opt.textContent = label;
    if (Number(value) === Number(selectedValue)) opt.selected = true;
    select.appendChild(opt);
  }
  select.addEventListener('change', () => onChange(Number(select.value)));
  return select;
}

function scheduleColumnRefresh(wrap, col) {
  if (wrap._refreshTimer) clearInterval(wrap._refreshTimer);
  const ms = col.refreshMs ?? DEFAULT_REFRESH_MS;
  if (!ms) return;
  wrap._refreshTimer = setInterval(() => {
    wrap._webview && wrap._webview.reload();
  }, ms);
}

function createColumnElement(col) {
  const wrap = document.createElement('div');
  wrap.className = 'column';
  wrap.dataset.id = col.id;

  const webview = document.createElement('webview');
  webview.className = 'col-webview';
  webview.setAttribute('src', buildColumnUrl(col));
  webview.setAttribute('partition', 'persist:xsession');
  webview.setAttribute('allowpopups', 'true');

  const header = document.createElement('div');
  header.className = 'column-header';

  const handle = document.createElement('span');
  handle.className = 'drag-handle';
  handle.textContent = '⠿';
  handle.title = 'ドラッグして並べ替え';
  handle.draggable = true;

  const title = document.createElement('span');
  title.className = 'column-title';
  title.textContent = columnTitle(col);
  title.title = columnTitle(col);

  const settingsPanel = document.createElement('div');
  settingsPanel.className = 'column-settings';
  settingsPanel.hidden = true;

  const zoomLabel = document.createElement('label');
  zoomLabel.textContent = '文字サイズ';
  const zoomSelect = buildSelect(
    'col-zoom-select',
    ZOOM_OPTIONS.map((v) => [v, `${Math.round(v * 100)}%`]),
    col.zoom ?? DEFAULT_ZOOM,
    (value) => {
      col.zoom = value;
      persist();
      applyCss(webview, col);
    },
  );
  zoomLabel.appendChild(zoomSelect);

  const refreshLabel = document.createElement('label');
  refreshLabel.textContent = '自動更新';
  const refreshSelect = buildSelect(
    'col-refresh-select',
    REFRESH_OPTIONS,
    col.refreshMs ?? DEFAULT_REFRESH_MS,
    (value) => {
      col.refreshMs = value;
      persist();
      scheduleColumnRefresh(wrap, col);
    },
  );
  refreshLabel.appendChild(refreshSelect);

  settingsPanel.append(zoomLabel, refreshLabel);

  const btns = document.createElement('div');
  btns.className = 'column-buttons';
  btns.append(
    mkBtn('⌂', columnHomeTooltip(col), () => webview.loadURL(buildColumnUrl(col))),
    mkBtn('←', '戻る', () => { if (webview.canGoBack()) webview.goBack(); }),
    mkBtn('⟳', '更新', () => webview.reload()),
    mkBtn('⚙', 'カラム設定（文字サイズ・自動更新）', () => { settingsPanel.hidden = !settingsPanel.hidden; }),
    mkBtn('🔍', 'DevTools（要素検証・CSS調整用）', () => webview.openDevTools()),
    mkBtn('✕', 'カラム削除', () => removeColumn(col.id)),
  );

  const titleGroup = document.createElement('div');
  titleGroup.className = 'column-title-group';
  titleGroup.append(handle, title);

  header.append(titleGroup, btns);

  handle.addEventListener('dragstart', (e) => {
    dragSrcId = col.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', col.id);
    wrap.classList.add('dragging');
  });
  handle.addEventListener('dragend', () => {
    wrap.classList.remove('dragging');
    dragSrcId = null;
  });
  wrap.addEventListener('dragover', (e) => {
    if (!dragSrcId || dragSrcId === col.id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    wrap.classList.add('drag-over');
  });
  wrap.addEventListener('dragleave', () => wrap.classList.remove('drag-over'));
  wrap.addEventListener('drop', (e) => {
    e.preventDefault();
    wrap.classList.remove('drag-over');
    if (dragSrcId) reorderColumn(dragSrcId, col.id);
  });

  webview.addEventListener('new-window', (e) => {
    e.preventDefault();
    window.xdeck.openExternal(e.url);
  });

  const reinject = () => applyCss(webview, col);
  webview.addEventListener('dom-ready', reinject);
  webview.addEventListener('did-navigate', reinject);
  webview.addEventListener('did-navigate-in-page', reinject);

  wrap.append(header, settingsPanel, webview);
  wrap._webview = webview;
  wrap._col = col;
  scheduleColumnRefresh(wrap, col);
  return wrap;
}

function showEmptyState() {
  columnsEl.innerHTML = '';
  const empty = document.createElement('div');
  empty.className = 'empty-state';
  empty.textContent =
    '上のフォームから検索キーワードを入力してカラムを追加してください（「ホーム」でフォロー中タイムライン、' +
    '「トレンド」でX全体のトレンド一覧のカラムになります）。' +
    '初回はいずれかのカラムでXにログインすると、セッションは全カラム・次回起動時にも共有されます。';
  columnsEl.appendChild(empty);
}

function renderAll() {
  columnsEl.innerHTML = '';
  if (columns.length === 0) {
    showEmptyState();
    return;
  }
  for (const col of columns) {
    columnsEl.appendChild(createColumnElement(col));
  }
}

function persist() {
  window.xdeck.saveColumns(columns);
}

function addColumn(partial) {
  const col = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    zoom: DEFAULT_ZOOM,
    refreshMs: DEFAULT_REFRESH_MS,
    ...partial,
  };
  columns.push(col);
  persist();
  if (columns.length === 1) {
    renderAll();
  } else {
    columnsEl.appendChild(createColumnElement(col));
  }
}

function removeColumn(id) {
  columns = columns.filter((c) => c.id !== id);
  persist();
  const el = columnsEl.querySelector(`.column[data-id="${id}"]`);
  if (el) {
    if (el._refreshTimer) clearInterval(el._refreshTimer);
    el.remove();
  }
  if (columns.length === 0) showEmptyState();
}

function reorderColumn(srcId, targetId) {
  if (srcId === targetId) return;
  const srcIndex = columns.findIndex((c) => c.id === srcId);
  const targetIndex = columns.findIndex((c) => c.id === targetId);
  if (srcIndex === -1 || targetIndex === -1) return;

  const [moved] = columns.splice(srcIndex, 1);
  columns.splice(targetIndex, 0, moved);
  persist();

  const srcEl = columnsEl.querySelector(`.column[data-id="${srcId}"]`);
  const targetEl = columnsEl.querySelector(`.column[data-id="${targetId}"]`);
  if (!srcEl || !targetEl) return;
  if (srcIndex < targetIndex) {
    targetEl.after(srcEl);
  } else {
    targetEl.before(srcEl);
  }
}

function updateFormForType() {
  const needsQuery = typeSelect.value === 'search';
  queryInput.style.display = needsQuery ? '' : 'none';
  sortSelect.style.display = needsQuery ? '' : 'none';
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
  addColumn({ type: 'search', query: q, sort: sortSelect.value });
  queryInput.value = '';
});

async function init() {
  injectCss = await window.xdeck.getInjectCss();
  window.xdeck.onInjectCssUpdated((css) => {
    injectCss = css;
    for (const wrap of columnsEl.children) {
      if (wrap._webview && wrap._col) applyCss(wrap._webview, wrap._col);
    }
  });

  columns = await window.xdeck.loadColumns();
  renderAll();
}

init();
