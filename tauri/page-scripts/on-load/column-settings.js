// Per-column page settings: zoom (文字サイズ) and, for home columns, which
// feed tab is selected (フォロー中 / おすすめ).
//
// Zoom is CSS on <html>, as in the Electron version — per-webview zoom
// would be shared by every column on x.com.
//
// Rust fills in __COLUMN_ID__ and __SETTINGS_JSON__ (the column's settings
// when the webview was created). Changes made later from ⚙ are saved in
// localStorage under the column's id (on-demand/apply-column-settings.js),
// so they also survive X reloading the page.
(() => {
  const KEY = 'xdeck-column-' + __COLUMN_ID__;
  const initial = __SETTINGS_JSON__ || {};
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { /* ignore */ }
  let settings = { ...initial, ...(saved || {}) };

  const TABS = { following: /フォロー中|Following/, forYou: /おすすめ|For you/ };

  const applyZoom = () => {
    let style = document.getElementById('xdeck-zoom');
    const zoom = Number(settings.zoom) || 1;
    if (!style) {
      const parent = document.head || document.documentElement;
      if (!parent) return;
      style = document.createElement('style');
      style.id = 'xdeck-zoom';
      parent.appendChild(style);
    }
    style.textContent = zoom !== 1 ? `html { zoom: ${zoom}; }` : '';
  };

  let tabTimer = null;
  const selectHomeTab = () => {
    if (!settings.homeFeed) return;
    const re = TABS[settings.homeFeed] || TABS.following;
    clearInterval(tabTimer);
    let tries = 0;
    const attempt = () => {
      const tabs = document.querySelectorAll('div[role="tablist"][data-testid="ScrollSnap-List"] [role="tab"]');
      const selected = Array.from(tabs).find((t) => t.getAttribute('aria-selected') === 'true');
      if (selected && re.test(selected.textContent)) return true;
      const target = Array.from(tabs).find((t) => re.test(t.textContent));
      if (target) target.click();
      return false;
    };
    // X renders the tabs a while after load.
    if (attempt()) return;
    tabTimer = setInterval(() => {
      if (attempt() || ++tries > 30) clearInterval(tabTimer);
    }, 500);
  };

  window.__xdeckApplySettings = (next) => {
    settings = { ...settings, ...(next || {}) };
    try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* ignore */ }
    applyZoom();
    selectHomeTab();
    return true;
  };

  applyZoom();
  new MutationObserver(() => { if (!document.getElementById('xdeck-zoom')) applyZoom(); })
    .observe(document, { childList: true, subtree: true });
  selectHomeTab();
})();
