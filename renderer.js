const columnsEl = document.getElementById('columns');
const form = document.getElementById('add-column-form');
const typeSelect = document.getElementById('type-select');
const queryInput = document.getElementById('query-input');
const sortSelect = document.getElementById('sort-select');
const searchOperatorsEl = document.getElementById('search-operators');
const composeBtn = document.getElementById('compose-btn');

composeBtn.addEventListener('click', () => window.xdeck.openCompose());

const DEFAULT_ZOOM = 1;
const DEFAULT_REFRESH_MS = 180000; // 3分
const DEFAULT_WIDTH = 380;
const MIN_WIDTH = 280;
const MAX_WIDTH = 900;
const ZOOM_OPTIONS = [0.8, 0.9, 1, 1.1, 1.25, 1.5];
const REFRESH_OPTIONS = [
  [0, 'オフ'],
  [60000, '1分'],
  [180000, '3分'],
  [300000, '5分'],
  [600000, '10分'],
];

// Checked ones get appended to the query text sent to X's q= param. Kept to
// a short, boolean-toggle-only list (no from:/since:/min_faves: etc., which
// need a value input rather than a checkbox) so the UI doesn't get crowded.
const OPERATOR_OPTIONS = [
  ['lang:ja', '日本語', '日本語の投稿のみ (lang:ja)'],
  ['filter:media', 'メディア', '画像/動画付きの投稿のみ (filter:media)'],
  ['-filter:retweets', 'RT除外', 'リツイートを除外 (-filter:retweets)'],
  ['-filter:replies', '返信除外', '返信を除外 (-filter:replies)'],
];

// Search/explore/trends pages and the home timeline all render their tab bar
// (話題のポスト/最新/... or おすすめ/フォロー中) with the same
// data-testid="ScrollSnap-List", so one rule hides it everywhere. Hiding it
// removes the only way to see or switch which one is active, so home columns
// get a "表示" select (おすすめ/フォロー中) in ⚙ that clicks the matching tab
// via ensureTabSelectedJS below, and search columns get their ソート select
// exposed there too (rebuilding the URL with f=live instead of a tab click,
// since that's how X's search itself distinguishes 話題のポスト/最新).
//
// Tweets with several photos (confirmed via DevTools outerHTML) render them
// as a swipeable carousel that reuses this exact same
// role="tablist"/data-testid="ScrollSnap-List" component, so the unscoped
// rule was also hiding every multi-photo tweet's images — single-photo
// tweets use a different markup and were unaffected, which is why it only
// ever looked like "some" images were missing. A real tab bar's items are
// `<a role="tab">`; the photo carousel's are `<div role="presentation">`,
// so requiring a [role="tab"] child excludes the carousel.
const TAB_BAR_HIDE_CSS = 'div[role="tablist"][data-testid="ScrollSnap-List"]:has([role="tab"]) { display: none !important; }';

const HOME_FEED_OPTIONS = [
  ['following', 'フォロー中', 'フォロー中|Following'],
  ['forYou', 'おすすめ', 'おすすめ|For you'],
];

function homeFeedOption(col) {
  const key = col.homeFeed || 'following';
  return HOME_FEED_OPTIONS.find(([k]) => k === key) || HOME_FEED_OPTIONS[0];
}

function ensureTabSelectedJS(regexSource) {
  return `(() => {
    const re = /${regexSource}/;
    const tabs = document.querySelectorAll('div[role="tablist"][data-testid="ScrollSnap-List"] [role="tab"]');
    const selected = Array.from(tabs).find((t) => t.getAttribute('aria-selected') === 'true');
    if (selected && re.test(selected.textContent)) return;
    const target = Array.from(tabs).find((t) => re.test(t.textContent));
    if (target) target.click();
  })();`;
}

// X shows a "新しいポストがあります" (new posts available) button above the
// timeline — the same one its own "." keyboard shortcut activates — that
// inserts new posts in place without a page navigation. Clicking it instead
// of webview.reload() for both the periodic auto-refresh and the manual
// diff-update button avoids the reload flash and keeps scroll position when
// there's nothing new to show. Confirmed via testing: no did-navigate fires
// and the URL is unchanged.
//
// X's own button jumps the viewport to the top when there IS something new
// (same as if the user clicked it themselves), which is exactly the
// scroll-loss problem this feature exists to avoid — so after triggering
// the click we measure how much content it prepended and add that amount
// back onto the previous scrollTop, landing the viewport on the same posts
// the user was already reading. The MutationObserver catches the insert as
// soon as React renders it; the extra setTimeout passes re-assert the
// position for a beat afterward to win against X's own scroll-to-top
// animation, then everything is torn down so it stops fighting the user's
// own subsequent scrolling.
// Hiding chrome (tab bar, header rows, etc.) via CSS after the page has
// already started laying out can trigger Chromium's scroll anchoring: it
// tries to keep the same content under the viewport when something above it
// shrinks away, which nudges scrollTop off 0 by a small amount. Re-asserted
// a few times after CSS injection on a fresh page load (not on in-page SPA
// navigation, where X's own scroll-to-top for the new view should stand).
const FORCE_SCROLL_TOP_JS = `(() => {
  const scroller = document.scrollingElement || document.documentElement;
  scroller.scrollTop = 0;
})();`;

const CLICK_NEW_POSTS_JS = `(() => {
  const btn = document.querySelector('[aria-label*="新しいポスト"], [aria-label*="new post" i]');
  if (!btn) return;
  const scroller = document.scrollingElement || document.documentElement;
  const beforeTop = scroller.scrollTop;
  const beforeHeight = scroller.scrollHeight;
  btn.click();
  let settled = false;
  const restore = () => {
    if (settled) return;
    const delta = scroller.scrollHeight - beforeHeight;
    if (delta > 0) {
      scroller.scrollTop = beforeTop + delta;
      settled = true;
    }
  };
  const observer = new MutationObserver(restore);
  observer.observe(document.body, { childList: true, subtree: true });
  [0, 50, 150, 300, 600].forEach((ms) => setTimeout(restore, ms));
  setTimeout(() => observer.disconnect(), 800);
})();`;

// Hides posts matching any filter predicate, and keeps re-checking as more
// posts stream in via infinite scroll (a MutationObserver, since a one-time
// CSS/JS pass only ever sees what's rendered at that moment). Currently just
// filters promoted ("広告"/"Ad"/"Promoted") posts. X renders that label as a
// plain <span> with no data-testid or other stable attribute — confirmed by
// inspecting a real ad — so detection has to walk the article's text nodes
// looking for an exact match, excluding the actual tweet body
// ([data-testid="tweetText"]) so a post that merely mentions the word "広告"
// isn't caught. Written as a list of predicates so a future muted-keyword
// filter is a one-line addition rather than a new mechanism.
const POST_FILTER_JS = `(() => {
  if (window.__xdeckFilterInstalled) return;
  window.__xdeckFilterInstalled = true;

  const AD_LABELS = new Set(['広告', 'Ad', 'Promoted', 'プロモーション']);

  function isPromoted(article) {
    const tweetText = article.querySelector('[data-testid="tweetText"]');
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (tweetText && tweetText.contains(node)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let node;
    while ((node = walker.nextNode())) {
      if (AD_LABELS.has(node.textContent.trim())) return true;
    }
    return false;
  }

  const filters = [isPromoted];

  function sweep() {
    document.querySelectorAll('article').forEach((article) => {
      if (filters.some((fn) => fn(article))) {
        const cell = article.closest('[data-testid="cellInnerDiv"]') || article;
        cell.style.display = 'none';
      }
    });
  }

  sweep();
  new MutationObserver(sweep).observe(document.body, { childList: true, subtree: true });
})();`;

let injectCss = '';
let columns = [];
let dragSrcId = null;
let webviewPreloadPath = '';
const cssKeys = new WeakMap(); // webview -> last inserted CSS key

function buildSearchUrl(query, sort, operators) {
  const fullQuery = [query, ...(operators || [])].join(' ').trim();
  const params = new URLSearchParams();
  params.set('q', fullQuery);
  params.set('src', 'typed_query');
  if (sort === 'live') params.set('f', 'live');
  return `https://x.com/search?${params.toString()}`;
}

function buildColumnUrl(col) {
  if (col.type === 'trends') return 'https://x.com/explore/tabs/trending';
  if (col.type === 'home') return 'https://x.com/home';
  if (col.type === 'notifications') return 'https://x.com/notifications';
  return buildSearchUrl(col.query, col.sort, col.operators);
}

function columnTitle(col) {
  if (col.type === 'trends') return 'トレンド';
  if (col.type === 'home') return `ホーム・${homeFeedOption(col)[1]}`;
  if (col.type === 'notifications') return '通知';
  return `${col.query}・${col.sort === 'top' ? '話題' : '最新'}`;
}

function columnHomeTooltip(col) {
  if (col.type === 'trends') return 'トレンドに戻る';
  if (col.type === 'home') return 'ホームに戻る';
  if (col.type === 'notifications') return '通知に戻る';
  return '検索トップに戻る';
}

function applyCss(webview, col) {
  const prevKey = cssKeys.get(webview);
  // webview.setZoomFactor() would work too, but Chromium ties it to the
  // partition's per-origin zoom map: since every column shares
  // persist:xsession + x.com, setting it on one column silently changes
  // the zoom of every other column too. Scoping zoom to CSS injected per
  // webview keeps each column's zoom independent.
  const zoom = col.zoom ?? DEFAULT_ZOOM;
  const zoomCss = zoom !== 1 ? `html { zoom: ${zoom}; }` : '';
  const css = [injectCss, TAB_BAR_HIDE_CSS, zoomCss].filter(Boolean).join('\n');
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

// Same idea as buildSelect but for string-valued options (sort: 'live'/'top',
// homeFeed: 'following'/'forYou') — buildSelect compares via Number(), which
// makes every non-numeric value NaN === NaN (always false), so it can never
// mark the right <option> as selected for these.
function buildStringSelect(className, options, selectedValue, onChange) {
  const select = document.createElement('select');
  select.className = className;
  for (const [value, label] of options) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    select.appendChild(opt);
  }
  select.value = selectedValue;
  select.addEventListener('change', () => onChange(select.value));
  return select;
}

function scheduleColumnRefresh(wrap, col) {
  if (wrap._refreshTimer) clearInterval(wrap._refreshTimer);
  const ms = col.refreshMs ?? DEFAULT_REFRESH_MS;
  if (!ms) return;
  wrap._refreshTimer = setInterval(() => {
    wrap._webview && wrap._webview.executeJavaScript(CLICK_NEW_POSTS_JS).catch(() => {});
  }, ms);
}

function createColumnElement(col) {
  const wrap = document.createElement('div');
  wrap.className = 'column';
  wrap.dataset.id = col.id;
  const initialWidth = col.width ?? DEFAULT_WIDTH;
  wrap.style.width = `${initialWidth}px`;
  wrap.style.flexBasis = `${initialWidth}px`;

  const webview = document.createElement('webview');
  webview.className = 'col-webview';
  webview.setAttribute('src', buildColumnUrl(col));
  webview.setAttribute('partition', 'persist:xsession');
  webview.setAttribute('allowpopups', 'true');
  webview.setAttribute('preload', webviewPreloadPath);
  webview.addEventListener('ipc-message', (event) => {
    if (event.channel !== 'xdeck-image-click') return;
    const { urls, startIndex } = event.args[0];
    window.xdeck.openImageViewer(urls, startIndex);
  });

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
  const updateTitle = () => {
    const t = columnTitle(col);
    title.textContent = t;
    title.title = t;
  };

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

  if (!col.type || col.type === 'search') {
    const sortLabel = document.createElement('label');
    sortLabel.textContent = '並び替え';
    const sortSel = buildStringSelect(
      'col-sort-select',
      [['live', '最新'], ['top', '話題']],
      col.sort === 'top' ? 'top' : 'live',
      (value) => {
        col.sort = value;
        persist();
        updateTitle();
        webview.loadURL(buildColumnUrl(col));
      },
    );
    sortLabel.appendChild(sortSel);
    settingsPanel.appendChild(sortLabel);

    if (!col.operators) col.operators = [];
    const opsWrap = document.createElement('div');
    opsWrap.className = 'column-settings-operators';
    for (const [opStr, shortLabel, opTitle] of OPERATOR_OPTIONS) {
      const opLabel = document.createElement('label');
      opLabel.className = 'operator-toggle';
      opLabel.title = opTitle;
      const opCheckbox = document.createElement('input');
      opCheckbox.type = 'checkbox';
      opCheckbox.checked = col.operators.includes(opStr);
      opCheckbox.addEventListener('change', () => {
        col.operators = opCheckbox.checked
          ? [...col.operators, opStr]
          : col.operators.filter((o) => o !== opStr);
        persist();
        webview.loadURL(buildColumnUrl(col));
      });
      opLabel.append(opCheckbox, document.createTextNode(shortLabel));
      opsWrap.appendChild(opLabel);
    }
    settingsPanel.appendChild(opsWrap);
  }

  if (col.type === 'home') {
    const feedLabel = document.createElement('label');
    feedLabel.textContent = '表示';
    const feedSel = buildStringSelect(
      'col-feed-select',
      HOME_FEED_OPTIONS.map(([key, label]) => [key, label]),
      homeFeedOption(col)[0],
      (value) => {
        col.homeFeed = value;
        persist();
        updateTitle();
        webview.executeJavaScript(ensureTabSelectedJS(homeFeedOption(col)[2])).catch(() => {});
      },
    );
    feedLabel.appendChild(feedSel);
    settingsPanel.appendChild(feedLabel);
  }

  const btns = document.createElement('div');
  btns.className = 'column-buttons';
  btns.append(
    mkBtn('⌂', columnHomeTooltip(col), () => webview.loadURL(buildColumnUrl(col))),
    mkBtn('←', '戻る', () => { if (webview.canGoBack()) webview.goBack(); }),
    mkBtn('⟲', '差分更新（新着のみ反映・先頭にジャンプせずスクロール位置を維持）', () => webview.executeJavaScript(CLICK_NEW_POSTS_JS).catch(() => {})),
    mkBtn('⟳', '更新（ページ全体を再読み込み）', () => webview.reload()),
    mkBtn('⚙', 'カラム設定（文字サイズ・自動更新・並び替え/表示・検索演算子）', () => { settingsPanel.hidden = !settingsPanel.hidden; }),
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


  const reinject = (isFullNavigation) => {
    applyCss(webview, col);
    webview.executeJavaScript(POST_FILTER_JS).catch(() => {});
    if (col.type === 'home') webview.executeJavaScript(ensureTabSelectedJS(homeFeedOption(col)[2])).catch(() => {});
    if (isFullNavigation) {
      [0, 50, 150, 300].forEach((ms) => {
        setTimeout(() => webview.executeJavaScript(FORCE_SCROLL_TOP_JS).catch(() => {}), ms);
      });
    }
  };
  webview.addEventListener('dom-ready', () => reinject(true));
  webview.addEventListener('did-navigate', () => reinject(true));
  webview.addEventListener('did-navigate-in-page', () => reinject(false));

  const body = document.createElement('div');
  body.className = 'column-body';
  body.append(header, settingsPanel, webview);

  // A dedicated sibling strip rather than an overlay on the webview: a
  // <webview> is its own embedded view and swallows pointer events for
  // anything drawn on top of it, so a resize handle positioned over its
  // edge wouldn't reliably receive the drag. Pointer-events are also
  // disabled on every webview for the duration of the drag, in case the
  // mouse crosses over one while resizing.
  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'col-resize-handle';
  resizeHandle.title = 'ドラッグして幅を変更';
  resizeHandle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = wrap.getBoundingClientRect().width;
    const webviews = document.querySelectorAll('.col-webview');
    webviews.forEach((wv) => { wv.style.pointerEvents = 'none'; });
    resizeHandle.classList.add('resizing');

    const onMove = (ev) => {
      const next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + (ev.clientX - startX)));
      wrap.style.width = `${next}px`;
      wrap.style.flexBasis = `${next}px`;
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      webviews.forEach((wv) => { wv.style.pointerEvents = ''; });
      resizeHandle.classList.remove('resizing');
      col.width = Math.round(wrap.getBoundingClientRect().width);
      persist();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  wrap.append(body, resizeHandle);
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
    width: DEFAULT_WIDTH,
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

const operatorCheckboxes = OPERATOR_OPTIONS.map(([opStr, shortLabel, title]) => {
  const label = document.createElement('label');
  label.className = 'operator-toggle';
  label.title = title;
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  label.append(checkbox, document.createTextNode(shortLabel));
  searchOperatorsEl.appendChild(label);
  return { opStr, checkbox };
});

function updateFormForType() {
  const needsQuery = typeSelect.value === 'search';
  queryInput.style.display = needsQuery ? '' : 'none';
  sortSelect.style.display = needsQuery ? '' : 'none';
  searchOperatorsEl.style.display = needsQuery ? '' : 'none';
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
  const operators = operatorCheckboxes.filter((o) => o.checkbox.checked).map((o) => o.opStr);
  addColumn({ type: 'search', query: q, sort: sortSelect.value, operators });
  queryInput.value = '';
  operatorCheckboxes.forEach((o) => { o.checkbox.checked = false; });
});

async function init() {
  webviewPreloadPath = await window.xdeck.getWebviewPreloadPath();
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
