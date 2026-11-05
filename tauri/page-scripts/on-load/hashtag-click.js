// #hashtag click → opens the search as a new column right after this one,
// instead of replacing this column's content. Same as the hashtag part of
// webview-preload.js in the Electron version.
//
// Uses the open_hashtag command (capabilities/x-pages.json); Rust works out
// which column it came from.
(() => {
  document.addEventListener('click', (event) => {
    const link = event.target.closest && event.target.closest('a[href*="/hashtag/"]');
    if (!link) return;
    const ipc = window.__TAURI_INTERNALS__;
    if (!ipc) return;
    let url;
    try {
      url = new URL(link.getAttribute('href'), location.href);
    } catch {
      return;
    }
    const match = url.pathname.match(/^\/hashtag\/([^/]+)/);
    if (!match) return;
    event.preventDefault();
    event.stopPropagation();
    ipc.invoke('open_hashtag', { query: `#${decodeURIComponent(match[1])}` }).catch(() => {});
  }, true);
})();
