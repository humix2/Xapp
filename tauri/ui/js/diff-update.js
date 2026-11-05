// Diff update ("差分更新") and the status label next to the column title —
// same flow as runDiffUpdate / showColumnStatus in the Electron renderer.js.
// The page-side work is page-scripts/on-demand/diff-update.js; focus
// emulation and the "." key go through WebView2's DevTools protocol (Rust).
import { pressPeriod, runInColumn, setFocusEmulation } from './api.js';

const STATUS_TEXT = { clicked: '新着を反映', pending: '新着あり', none: '新着なし', error: '更新失敗' };
const FETCH_TEXT = {
  fetched: 'Xに新着を問い合わせ済み',
  'fetch-pending': 'Xへの問い合わせが時間内に終わらず',
  'no-fetch': 'Xが新着を問い合わせなかった',
};

/** Resolves to 'clicked' | 'pending' | 'none' | 'error'. */
export function runDiffUpdate(wrap) {
  if (!wrap._opened) return Promise.resolve('error');
  // One update per column at a time; two would fight over the scroll position.
  if (wrap._updating) return wrap._updating;
  showUpdating(wrap);
  const id = wrap.dataset.id;

  const run = async () => {
    await setFocusEmulation(id, true).catch(() => {});
    try {
      let res = await runInColumn(id, 'diff-update', { phase: 'detect' });
      if (res && res.result === 'pending') {
        // Start waiting for X's "N 件のポストを表示" row, then press ".".
        const inserting = runInColumn(id, 'diff-update', { phase: 'insert' });
        await new Promise((r) => setTimeout(r, 100));
        await pressPeriod(id).catch(() => {});
        const ins = await inserting;
        res = { ...ins, fetchInfo: res.fetchInfo, newCount: res.newCount, newIds: res.newIds };
      }
      return res || { result: 'none' };
    } finally {
      await setFocusEmulation(id, false).catch(() => {});
    }
  };

  wrap._updating = run()
    .catch((e) => { console.error('diff update', e); return { result: 'error' }; })
    .then((res) => {
      wrap._updating = null;
      showStatus(wrap, res);
      return res.result;
    });
  return wrap._updating;
}

function showUpdating(wrap) {
  clearSettle(wrap);
  wrap._statusEl.textContent = '更新中…';
  wrap._statusEl.dataset.result = 'updating';
}

function showStatus(wrap, { result, label, fetchInfo, newCount, newIds }) {
  const el = wrap._statusEl;
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const count = newCount && (result === 'clicked' || result === 'pending') ? `(${newCount})` : '';
  el.textContent = `${STATUS_TEXT[result]}${count} ${hhmm}`;
  el.title = label
    ? `最後の差分更新: 「${label}」をクリック`
    : result === 'pending'
    ? 'Xが新着ありと通知したが、取り込めなかった（⟲で再試行）'
    : `最後の差分更新の結果${FETCH_TEXT[fetchInfo] ? `（${FETCH_TEXT[fetchInfo]}）` : ''}`;
  el.dataset.result = result;

  // Settles into a muted "HH:MM 確認" afterwards:
  // - 新着なし: after a few seconds.
  // - 新着を反映: once the column is scrolled to the very top.
  // - 新着あり: once the column is at the top and caught up.
  // - 更新失敗: stays.
  clearSettle(wrap);
  const settle = () => {
    clearSettle(wrap);
    el.textContent = `${hhmm} 確認`;
    el.dataset.result = 'settled';
  };
  const poll = (check) => {
    wrap._settleTimer = setInterval(() => {
      if (!wrap._opened || wrap._updating) return;
      check().then((done) => { if (done) settle(); }).catch(() => {});
    }, 1000);
  };
  const id = wrap.dataset.id;
  if (result === 'none') {
    wrap._settleTimer = setTimeout(settle, 5000);
  } else if (result === 'clicked') {
    poll(() => runInColumn(id, 'scroll-top-position').then((top) => top < 5));
  } else if (result === 'pending') {
    poll(() => runInColumn(id, 'pending-settled', { newIds: newIds || [] }));
  }
}

export function clearSettle(wrap) {
  if (wrap._settleTimer) {
    clearTimeout(wrap._settleTimer);
    clearInterval(wrap._settleTimer);
    wrap._settleTimer = null;
  }
}
