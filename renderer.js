const columnsEl = document.getElementById('columns');
const form = document.getElementById('add-column-form');
const typeSelect = document.getElementById('type-select');
const queryInput = document.getElementById('query-input');
const sortSelect = document.getElementById('sort-select');
const refreshIntervalSelect = document.getElementById('refresh-interval');
const zoomSelect = document.getElementById('zoom-select');

let injectCss = '';
let columns = [];
let refreshMs = Number(refreshIntervalSelect.value);
let refreshTimer = null;
let dragSrcId = null;
let zoomFactor = Number(zoomSelect.value);
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
  return buildSearchUrl(col.query, col.sort);
}

function columnTitle(col) {
  return col.type === 'trends' ? 'トレンド' : col.query;
}

function applyCss(webview) {
  const prevKey = cssKeys.get(webview);
  const insert = () => {
    webview.insertCSS(injectCss).then((key) => cssKeys.set(webview, key)).catch(() => {});
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

  const btns = document.createElement('div');
  btns.className = 'column-buttons';
  btns.append(
    mkBtn('⌂', col.type === 'trends' ? 'トレンドに戻る' : '検索トップに戻る', () => webview.loadURL(buildColumnUrl(col))),
    mkBtn('←', '戻る', () => { if (webview.canGoBack()) webview.goBack(); }),
    mkBtn('⟳', '更新', () => webview.reload()),
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

  const reinject = () => {
    applyCss(webview);
    webview.setZoomFactor(zoomFactor);
  };
  webview.addEventListener('dom-ready', reinject);
  webview.addEventListener('did-navigate', reinject);
  webview.addEventListener('did-navigate-in-page', reinject);

  wrap.append(header, webview);
  wrap._webview = webview;
  return wrap;
}

function showEmptyState() {
  columnsEl.innerHTML = '';
  const empty = document.createElement('div');
  empty.className = 'empty-state';
  empty.textContent =
    '上のフォームから検索キーワードを入力してカラムを追加してください（「トレンド」を選ぶとX全体のトレンド一覧カラムになります）。' +
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
  const col = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, ...partial };
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
  if (el) el.remove();
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
  const isTrends = typeSelect.value === 'trends';
  queryInput.style.display = isTrends ? 'none' : '';
  sortSelect.style.display = isTrends ? 'none' : '';
  queryInput.required = !isTrends;
}

typeSelect.addEventListener('change', updateFormForType);
updateFormForType();

form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (typeSelect.value === 'trends') {
    addColumn({ type: 'trends' });
    return;
  }
  const q = queryInput.value.trim();
  if (!q) return;
  addColumn({ type: 'search', query: q, sort: sortSelect.value });
  queryInput.value = '';
});

function scheduleRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  if (!refreshMs) return;
  refreshTimer = setInterval(() => {
    for (const wrap of columnsEl.children) {
      wrap._webview && wrap._webview.reload();
    }
  }, refreshMs);
}

refreshIntervalSelect.addEventListener('change', () => {
  refreshMs = Number(refreshIntervalSelect.value);
  scheduleRefresh();
});

zoomSelect.addEventListener('change', () => {
  zoomFactor = Number(zoomSelect.value);
  window.xdeck.saveSettings({ fontZoom: zoomFactor });
  for (const wrap of columnsEl.children) {
    wrap._webview && wrap._webview.setZoomFactor(zoomFactor);
  }
});

async function init() {
  injectCss = await window.xdeck.getInjectCss();
  window.xdeck.onInjectCssUpdated((css) => {
    injectCss = css;
    for (const wrap of columnsEl.children) {
      if (wrap._webview) applyCss(wrap._webview);
    }
  });

  const settings = await window.xdeck.loadSettings();
  if (settings.fontZoom) {
    zoomFactor = settings.fontZoom;
    zoomSelect.value = String(zoomFactor);
  }

  columns = await window.xdeck.loadColumns();
  renderAll();
  scheduleRefresh();
}

init();
