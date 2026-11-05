const columnsEl = document.getElementById('columns');
const form = document.getElementById('add-column-form');
const typeSelect = document.getElementById('type-select');
const queryInput = document.getElementById('query-input');
const sortSelect = document.getElementById('sort-select');
const searchOperatorsEl = document.getElementById('search-operators');
const composeBtn = document.getElementById('compose-btn');
const updateAllBtn = document.getElementById('update-all-btn');

composeBtn.addEventListener('click', () => window.xdeck.openCompose());
updateAllBtn.addEventListener('click', async () => {
  const label = '⟲ 全カラム更新';
  updateAllBtn.disabled = true;
  updateAllBtn.textContent = '⟲ 更新中…';
  const wraps = Array.from(columnsEl.children).filter((w) => w._webview);
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

// 話題を検索 (Explore) tabs. Unlike the home feed, each tab has its own URL,
// so switching is a loadURL rather than a tab click.
const EXPLORE_TAB_OPTIONS = [
  ['for-you', 'おすすめ'],
  ['trending', 'トレンド'],
  ['news', 'ニュース'],
  ['sports', 'スポーツ'],
  ['entertainment', 'エンタメ'],
];

function exploreTabOption(col) {
  const key = col.exploreTab || 'for-you';
  return EXPLORE_TAB_OPTIONS.find(([k]) => k === key) || EXPLORE_TAB_OPTIONS[0];
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

// Manual scroll-to-top/bottom buttons (⤒/⤓ in the column toolbar).
const SCROLL_TO_TOP_JS = `(() => {
  const scroller = document.scrollingElement || document.documentElement;
  scroller.scrollTo({ top: 0, behavior: 'smooth' });
})();`;

const SCROLL_TO_BOTTOM_JS = `(() => {
  const scroller = document.scrollingElement || document.documentElement;
  scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
})();`;

// Diff update ("差分更新") — how X behaves, all confirmed live via the
// DevTools protocol on 2026-11-03:
//
// - X only checks for new posts while the page believes it has focus. With
//   XDeck in the background nothing ever triggered a timeline request, so
//   runDiffUpdate turns on focus emulation for the column first (main.js).
// - With focus, the check is triggered by the timeline being scrolled away
//   for a moment and then arriving back at the very top (HomeLatestTimeline /
//   SearchTimeline fires right then). Explicit scroll events are needed; a
//   programmatic scrollTop change alone wasn't enough.
// - X's floating pill <button aria-label="新しいポストがあります。…"> is always
//   in the DOM (inside the sticky header inject.css hides). aria-hidden="true"
//   means nothing new; the attribute disappears once new posts are pending.
//   That is the "新着あり" signal. Clicking it does nothing useful though.
// - What actually inserts the posts is the inline "N 件のポストを表示" row X
//   puts in the first timeline cell. It often isn't rendered until X gets a
//   "." key press (its own load-new-posts shortcut), sent from main.js as a
//   real key event — after which the row appears within ~1.5s.
//
// So a diff update is two page scripts:
//   'detect': scroll away → back to top → wait for X's request to finish →
//             report 'clicked' (row was already there and got clicked),
//             'pending' (new posts announced, row not there yet) or 'none'.
//   'insert': (run while "." is sent) wait for the row and click it.
// Both keep the reading position: the post at the top of the viewport is
// remembered by its status URL and pinned back to the same on-screen offset
// after the click (restoring by scrollHeight was unreliable because X
// virtualizes the timeline), with X's own window.scrollTo muted meanwhile.
function diffUpdateJS(phase) {
  return `(async () => {
  const PHASE = '${phase}';
  const WORDED_RE = /新しい.{0,4}ポスト|new posts?/i;
  const COUNT_RE = /^\\d[\\d,]*\\s*(件の)?\\s*(新しい)?\\s*(ポスト|post)/i;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const labelOf = (el) => (el.getAttribute('aria-label') || el.textContent || '').trim();
  const findRow = () => Array.from(document.querySelectorAll('[data-testid="cellInnerDiv"] [role="button"], [data-testid="cellInnerDiv"] button'))
    .find((el) => {
      if (el.closest('article')) return false;
      const label = labelOf(el);
      return label.length <= 40 && (COUNT_RE.test(label) || WORDED_RE.test(label));
    });
  const pendingSignal = () => Array.from(document.querySelectorAll('button[aria-label], [role="button"][aria-label]'))
    .some((el) => !el.closest('article') && WORDED_RE.test(el.getAttribute('aria-label')) && el.getAttribute('aria-hidden') !== 'true');

  const scroller = document.scrollingElement || document.documentElement;
  const beforeTop = scroller.scrollTop;
  const beforeHeight = scroller.scrollHeight;
  const permalinkOf = (article) => {
    const t = article.querySelector('a[href*="/status/"] time');
    const a = t && t.closest('a');
    return a ? a.getAttribute('href') : null;
  };
  const anchor = (() => {
    for (const art of document.querySelectorAll('article')) {
      const r = art.getBoundingClientRect();
      if (r.bottom <= 0) continue;
      const href = permalinkOf(art);
      if (href) return { href, top: r.top };
    }
    return null;
  })();
  const pin = () => {
    const art = anchor && Array.from(document.querySelectorAll('article')).find((a) => permalinkOf(a) === anchor.href);
    if (art) {
      const diff = art.getBoundingClientRect().top - anchor.top;
      if (Math.abs(diff) > 1) scroller.scrollTop += diff;
    } else {
      scroller.scrollTop = beforeTop + Math.max(0, scroller.scrollHeight - beforeHeight);
    }
  };
  const origScrollTo = window.scrollTo;
  const origScroll = window.scroll;
  const muteScroll = () => { window.scrollTo = () => {}; window.scroll = () => {}; };
  const unmuteScroll = () => { window.scrollTo = origScrollTo; window.scroll = origScroll; };

  const clickAndPin = async (row) => {
    const label = labelOf(row);
    muteScroll();
    try {
      row.click();
      pin();
      const timer = setInterval(pin, 50);
      // Held until the end so the caller's "更新中…" covers the pinning.
      await sleep(1500);
      clearInterval(timer);
    } finally {
      unmuteScroll();
    }
    pin();
    return { result: 'clicked', label };
  };

  if (PHASE === 'insert') {
    muteScroll();
    let row = null;
    try {
      for (let w = 0; !row && w < 3000; w += 100) { await sleep(100); row = findRow(); }
    } finally {
      unmuteScroll();
    }
    if (row) return clickAndPin(row);
    pin();
    return { result: 'pending' };
  }

  // PHASE === 'detect'
  // The pill also flips to "new posts" when the only new entry is an ad (seen
  // live right after startup: pill un-hidden, nothing real to insert). So the
  // decision is made from X's own response instead: count tweet /
  // notification entries in it that aren't already shown in this column,
  // ignoring promoted ones.
  const shownIds = new Set(Array.from(document.querySelectorAll('article a[href*="/status/"]'))
    .map((a) => (a.getAttribute('href').match(/\\/status\\/(\\d+)/) || [])[1]).filter(Boolean));
  let newCount = 0;
  const newIds = [];
  const countNew = (text) => {
    const seen = new Set();
    for (const m of text.matchAll(/"entryId":"([^"]+)"/g)) {
      const id = m[1];
      if (id.includes('promoted') || seen.has(id)) continue;
      seen.add(id);
      const tweet = id.match(/(?:^|-)tweet-(\\d+)$/);
      if (tweet && !shownIds.has(tweet[1])) { newCount++; newIds.push(tweet[1]); }
    }
  };
  // Notification entries can't be matched against what's on screen, so that
  // page keeps using X's pill signal.
  const countable = !location.pathname.startsWith('/notifications');
  let row = findRow();
  let fetchInfo = 'already-shown';
  if (!row) {
    let started = 0;
    let finished = 0;
    const OX = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (m, u, ...rest) {
      if (/graphql\\/[^/]+\\/\\w*(Timeline|Notifications|Search)/i.test(String(u))) {
        started++;
        this.addEventListener('loadend', () => {
          finished++;
          try {
            const text = typeof this.response === 'string' ? this.response
              : this.responseType === '' || this.responseType === 'text' ? this.responseText
              : JSON.stringify(this.response);
            countNew(text || '');
          } catch { /* unreadable response: leave the count as is */ }
        }, { once: true });
      }
      return OX.call(this, m, u, ...rest);
    };
    try {
      scroller.scrollTop = beforeTop + 300;
      window.dispatchEvent(new Event('scroll'));
      for (let w = 0; !started && w < 1500; w += 100) await sleep(100);
      scroller.scrollTop = 0;
      window.dispatchEvent(new Event('scroll'));
      for (let w = 0; !started && w < 2500; w += 100) await sleep(100);
      if (started) {
        for (let w = 0; finished < started && w < 5000; w += 100) await sleep(100);
        // Give X a moment to insert the row if it does so on its own.
        if (newCount || !countable) for (let w = 0; !(row = findRow()) && w < 1000; w += 100) await sleep(100);
      }
    } finally {
      XMLHttpRequest.prototype.open = OX;
    }
    fetchInfo = started ? (finished >= started ? 'fetched' : 'fetch-pending') : 'no-fetch';
    row = row || findRow();
  }
  if (row) return { ...(await clickAndPin(row)), fetchInfo, newCount };
  scroller.scrollTop = beforeTop;
  pin();
  // The pill alone isn't trusted on timelines (ads trip it); only a counted
  // response is. If X didn't fetch this time, nothing new is known.
  const pending = countable ? fetchInfo === 'fetched' && newCount > 0 : pendingSignal();
  return { result: pending ? 'pending' : 'none', fetchInfo, newCount, newIds };
})();`;
}

// Checks whether a "新着あり" column has caught up: the column is at the very
// top and either every post the detect phase counted as new is now shown
// (X inserted them itself, or the user clicked the row), or X shows neither
// the "N 件のポストを表示" row nor the new-posts pill (nothing left to insert).
function pendingSettledJS(newIds) {
  return `(() => {
  const scroller = document.scrollingElement || document.documentElement;
  if (scroller.scrollTop >= 5) return false;
  const ids = ${JSON.stringify(newIds || [])};
  const shown = new Set(Array.from(document.querySelectorAll('article a[href*="/status/"]'))
    .map((a) => (a.getAttribute('href').match(/\\/status\\/(\\d+)/) || [])[1]).filter(Boolean));
  if (ids.length && ids.every((id) => shown.has(id))) return true;
  const WORDED_RE = /新しい.{0,4}ポスト|new posts?/i;
  const COUNT_RE = /^\\d[\\d,]*\\s*(件の)?\\s*(新しい)?\\s*(ポスト|post)/i;
  const labelOf = (el) => (el.getAttribute('aria-label') || el.textContent || '').trim();
  const row = Array.from(document.querySelectorAll('[data-testid="cellInnerDiv"] [role="button"], [data-testid="cellInnerDiv"] button'))
    .some((el) => !el.closest('article') && labelOf(el).length <= 40 && (COUNT_RE.test(labelOf(el)) || WORDED_RE.test(labelOf(el))));
  const pill = Array.from(document.querySelectorAll('button[aria-label], [role="button"][aria-label]'))
    .some((el) => !el.closest('article') && WORDED_RE.test(el.getAttribute('aria-label')) && el.getAttribute('aria-hidden') !== 'true');
  return !row && !pill;
})();`;
}

// Runs a diff update on one column (see diffUpdateJS) and shows the result
// next to the column title. Resolves to 'clicked' (new posts inserted),
// 'pending' (X announced new posts but they couldn't be inserted), 'none' or
// 'error'. Never does a full reload: that loses the reading position, and
// reloading several search columns at once made X answer with
// "問題が発生しました".
function runDiffUpdate(wrap) {
  if (!wrap._webview) return Promise.resolve('error');
  // One update per column at a time (e.g. auto-refresh firing during a manual
  // one) — two runs would fight over the scroll position.
  if (wrap._updating) return wrap._updating;
  showColumnUpdating(wrap);
  const webview = wrap._webview;
  let wcId = null;
  try { wcId = webview.getWebContentsId(); } catch { /* not attached yet */ }

  const run = async () => {
    if (wcId) await window.xdeck.setWebviewFocusEmulation(wcId, true).catch(() => false);
    try {
      let res = await webview.executeJavaScript(diffUpdateJS('detect'));
      if (res && res.result === 'pending' && wcId) {
        // New posts announced but the "N 件のポストを表示" row isn't there yet:
        // X's own "." shortcut makes it appear. Start waiting for the row
        // first, then press the key.
        const inserting = webview.executeJavaScript(diffUpdateJS('insert'));
        await new Promise((r) => setTimeout(r, 100));
        await window.xdeck.pressPeriodInWebview(wcId).catch(() => {});
        const ins = await inserting;
        res = { ...ins, fetchInfo: res.fetchInfo, newCount: res.newCount, newIds: res.newIds };
      }
      return res || { result: 'none' };
    } finally {
      if (wcId) await window.xdeck.setWebviewFocusEmulation(wcId, false).catch(() => {});
    }
  };

  wrap._updating = run()
    .catch(() => ({ result: 'error' }))
    .then((res) => {
      wrap._updating = null;
      showColumnStatus(wrap, res.result, res.label, res.fetchInfo, res.newCount, res.newIds);
      return res.result;
    });
  return wrap._updating;
}

function showColumnUpdating(wrap) {
  const el = wrap._statusEl;
  if (!el) return;
  clearStatusSettle(wrap);
  el.textContent = '更新中…';
  el.dataset.result = 'updating';
  el.classList.remove('flash');
}

const STATUS_TEXT = { clicked: '新着を反映', pending: '新着あり', none: '新着なし', error: '更新失敗' };

function showColumnStatus(wrap, result, label, fetchInfo, newCount, newIds) {
  const el = wrap._statusEl;
  if (!el) return;
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const count = newCount && (result === 'clicked' || result === 'pending') ? `(${newCount})` : '';
  el.textContent = `${STATUS_TEXT[result]}${count} ${hhmm}`;
  // Hover shows what was actually clicked, to diagnose wrong matches.
  const FETCH_TEXT = {
    fetched: 'Xに新着を問い合わせ済み',
    'fetch-pending': 'Xへの問い合わせが時間内に終わらず',
    'no-fetch': 'Xが新着を問い合わせなかった',
  };
  el.title = label
    ? `最後の差分更新: 「${label}」をクリック`
    : result === 'pending'
    ? 'Xが新着ありと通知したが、取り込めなかった（⟲で再試行）'
    : `最後の差分更新の結果${fetchInfo && FETCH_TEXT[fetchInfo] ? `（${FETCH_TEXT[fetchInfo]}）` : ''}`;
  el.dataset.result = result;
  // Re-trigger the flash animation even if the text didn't change.
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');

  // Afterwards the status settles into a muted "HH:MM 確認" so the last check
  // time stays visible (e.g. to see auto-refresh is running):
  // - 新着を反映: the inserted posts sit above the reading position, unseen,
  //   so it stays until the user scrolls the column to the very top.
  // - 新着なし: after a few seconds.
  // - 新着あり: once the column is at the top and caught up (pendingSettledJS).
  // - 更新失敗 needs attention, so it stays.
  clearStatusSettle(wrap);
  const settle = () => {
    clearStatusSettle(wrap);
    el.textContent = `${hhmm} 確認`;
    el.dataset.result = 'settled';
  };
  if (result === 'none') {
    wrap._statusSettleTimer = setTimeout(settle, 5000);
  } else if (result === 'clicked') {
    wrap._statusSettleTimer = setInterval(() => {
      if (!wrap._webview || wrap._updating) return;
      wrap._webview.executeJavaScript('(document.scrollingElement || document.documentElement).scrollTop')
        .then((top) => { if (top < 5) settle(); })
        .catch(() => {});
    }, 1000);
  } else if (result === 'pending') {
    const check = pendingSettledJS(newIds);
    wrap._statusSettleTimer = setInterval(() => {
      if (!wrap._webview || wrap._updating) return;
      wrap._webview.executeJavaScript(check)
        .then((done) => { if (done) settle(); })
        .catch(() => {});
    }, 1000);
  }
}

function clearStatusSettle(wrap) {
  if (wrap._statusSettleTimer) {
    clearTimeout(wrap._statusSettleTimer);
    clearInterval(wrap._statusSettleTimer);
    wrap._statusSettleTimer = null;
  }
}

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
  if (col.type === 'explore') return `https://x.com/explore/tabs/${exploreTabOption(col)[0]}`;
  if (col.type === 'home') return 'https://x.com/home';
  if (col.type === 'notifications') return 'https://x.com/notifications';
  return buildSearchUrl(col.query, col.sort, col.operators);
}

function columnTitle(col) {
  if (col.type === 'trends') return 'トレンド';
  if (col.type === 'explore') return `話題を検索・${exploreTabOption(col)[1]}`;
  if (col.type === 'home') return `ホーム・${homeFeedOption(col)[1]}`;
  if (col.type === 'notifications') return '通知';
  return `${col.query}・${col.sort === 'top' ? '話題' : '最新'}`;
}

function columnHomeTooltip(col) {
  if (col.type === 'trends') return 'トレンドに戻る';
  if (col.type === 'explore') return '話題を検索に戻る';
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

// Electron's <webview> preload script (webview-preload.js — the photo/hashtag
// click interception and autoplay-blocking) occasionally fails to actually
// attach on a given navigation: confirmed live, on an otherwise-unmodified
// build, across restarts of the same app with no code changes in between —
// photo clicks and hashtag clicks both silently fall back to X's default
// behavior, with no console error anywhere to explain why. Root cause wasn't
// pinned down (a <webview> guest-process init race is the leading suspect,
// not anything specific to this app's code), so this is a defensive
// self-heal instead of a real fix: webview-preload.js pings back over IPC
// once it's fully loaded and registered every listener; if that ping hasn't
// arrived a couple seconds after dom-ready, assume injection failed and
// reload the column once to get a fresh attempt. Capped at 2 retries per
// navigation so a genuinely broken case (not just one-off flakiness) doesn't
// reload forever.
function ensurePreloadInjected(wrap, webview) {
  const attemptId = (wrap._preloadAttempt = (wrap._preloadAttempt ?? 0) + 1);
  wrap._preloadReady = false;
  wrap._preloadRetryCount = wrap._preloadRetryCount ?? 0;
  setTimeout(() => {
    if (wrap._preloadReady || wrap._preloadAttempt !== attemptId) return;
    if (wrap._preloadRetryCount >= 2) return;
    wrap._preloadRetryCount += 1;
    wrap._expectingNav = true;
    webview.reload();
  }, 2000);
}

function scheduleColumnRefresh(wrap, col) {
  if (wrap._refreshTimer) clearInterval(wrap._refreshTimer);
  const ms = col.refreshMs ?? DEFAULT_REFRESH_MS;
  if (!ms) return;
  wrap._refreshTimer = setInterval(() => runDiffUpdate(wrap), ms);
}

function createColumnElement(col) {
  const wrap = document.createElement('div');
  wrap.className = 'column';
  wrap.dataset.id = col.id;
  const initialWidth = col.width ?? DEFAULT_WIDTH;
  wrap.style.width = `${initialWidth}px`;
  wrap.style.flexBasis = `${initialWidth}px`;

  // Set right before every navigation XDeck itself initiates (⌂/⟳ buttons,
  // sort/operator changes, the initial load below) and cleared again at the
  // end of the did-navigate handler further down. If did-navigate ever fires
  // while this is still false, nothing XDeck did caused it — X's own JS (a
  // "." refresh, a forced reload after a version bump, etc.) navigated the
  // page on its own, which gets reported to main.js's reload-debug.log for
  // diagnosing "why did this column reload" reports that don't trace back to
  // a button click.
  wrap._expectingNav = true;

  const webview = document.createElement('webview');
  webview.className = 'col-webview';
  webview.setAttribute('src', buildColumnUrl(col));
  webview.setAttribute('partition', 'persist:xsession');
  webview.setAttribute('allowpopups', 'true');
  webview.setAttribute('preload', webviewPreloadPath);
  webview.addEventListener('ipc-message', (event) => {
    if (event.channel === 'xdeck-image-click') {
      const { urls, startIndex } = event.args[0];
      window.xdeck.openImageViewer(urls, startIndex);
    } else if (event.channel === 'xdeck-hashtag-click') {
      const { query } = event.args[0];
      insertColumnAfter(col.id, { type: 'search', query, sort: 'live', operators: [] });
    } else if (event.channel === 'xdeck-preload-ready') {
      wrap._preloadReady = true;
    }
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
        wrap._expectingNav = true;
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
        wrap._expectingNav = true;
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

  if (col.type === 'explore') {
    const tabLabel = document.createElement('label');
    tabLabel.textContent = '表示';
    const tabSel = buildStringSelect(
      'col-explore-tab-select',
      EXPLORE_TAB_OPTIONS,
      exploreTabOption(col)[0],
      (value) => {
        col.exploreTab = value;
        persist();
        updateTitle();
        wrap._expectingNav = true;
        webview.loadURL(buildColumnUrl(col));
      },
    );
    tabLabel.appendChild(tabSel);
    settingsPanel.appendChild(tabLabel);
  }

  const btns = document.createElement('div');
  btns.className = 'column-buttons';
  btns.append(
    mkBtn('⌂', columnHomeTooltip(col), () => { wrap._expectingNav = true; webview.loadURL(buildColumnUrl(col)); }),
    mkBtn('←', '戻る', () => { if (webview.canGoBack()) { wrap._expectingNav = true; webview.goBack(); } }),
    mkBtn('⤒', '一番上へスクロール', () => webview.executeJavaScript(SCROLL_TO_TOP_JS).catch(() => {})),
    mkBtn('⤓', '一番下へスクロール', () => webview.executeJavaScript(SCROLL_TO_BOTTOM_JS).catch(() => {})),
    mkBtn('⟲', '差分更新（新着のみ反映・スクロール位置を維持）', () => runDiffUpdate(wrap)),
    mkBtn('⟳', '更新（ページ全体を再読み込み）', () => { wrap._expectingNav = true; webview.reload(); }),
    mkBtn('⚙', 'カラム設定（文字サイズ・自動更新・並び替え/表示・検索演算子）', () => { settingsPanel.hidden = !settingsPanel.hidden; }),
    mkBtn('✕', 'カラム削除', () => removeColumn(col.id)),
  );

  const titleGroup = document.createElement('div');
  titleGroup.className = 'column-title-group';
  const statusEl = document.createElement('span');
  statusEl.className = 'column-status';
  statusEl.title = '最後の差分更新の結果';
  wrap._statusEl = statusEl;
  titleGroup.append(handle, title, statusEl);

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
      ensurePreloadInjected(wrap, webview);
    }
  };
  webview.addEventListener('dom-ready', () => reinject(true));
  webview.addEventListener('did-navigate', () => {
    if (!wrap._expectingNav) {
      window.xdeck.logUnexpectedReload({ colId: col.id, colType: col.type || 'search', url: webview.getURL() }).catch(() => {});
    }
    wrap._expectingNav = false;
    reinject(true);
  });
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
    '「話題を検索」でXの話題を検索（おすすめ）、「トレンド」でX全体のトレンド一覧のカラムになります）。' +
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
  columns.push(col);
  persist();
  if (columns.length === 1) {
    renderAll();
  } else {
    columnsEl.appendChild(createColumnElement(col));
  }
}

// Used for columns opened as a side-effect of an action inside another
// column (e.g. clicking a hashtag) — placed immediately to that column's
// right rather than at the far end of the deck, so it's obvious which
// column the search came from instead of getting lost among unrelated ones.
function insertColumnAfter(afterId, partial) {
  const col = makeColumn(partial);
  const index = columns.findIndex((c) => c.id === afterId);
  if (index === -1) {
    columns.push(col);
  } else {
    columns.splice(index + 1, 0, col);
  }
  persist();

  const afterEl = columnsEl.querySelector(`.column[data-id="${afterId}"]`);
  const newEl = createColumnElement(col);
  if (afterEl) {
    afterEl.after(newEl);
  } else {
    columnsEl.appendChild(newEl);
  }
}

function removeColumn(id) {
  columns = columns.filter((c) => c.id !== id);
  persist();
  const el = columnsEl.querySelector(`.column[data-id="${id}"]`);
  if (el) {
    if (el._refreshTimer) clearInterval(el._refreshTimer);
    clearStatusSettle(el);
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
