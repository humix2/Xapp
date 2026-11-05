// Photo click → XDeck's image viewer window, instead of X's lightbox (which
// would be squeezed into the column's width). Same as the photo-click part
// of webview-preload.js in the Electron version.
//
// The only Rust command x.com is allowed to call is open_image_viewer
// (capabilities/x-pages.json).
(() => {
  const fullSizeUrl = (src) => {
    try {
      const u = new URL(src);
      if (u.hostname === 'pbs.twimg.com') u.searchParams.set('name', 'orig');
      return u.toString();
    } catch {
      return src;
    }
  };

  document.addEventListener('click', (event) => {
    const img = event.target.closest && event.target.closest('[data-testid="tweetPhoto"] img');
    if (!img) return;
    const ipc = window.__TAURI_INTERNALS__;
    if (!ipc) return; // no IPC here: let X open its own lightbox

    // Every photo of the same post, in order, for prev/next in the viewer.
    const article = img.closest('article');
    const imgs = article ? Array.from(article.querySelectorAll('[data-testid="tweetPhoto"] img')) : [img];
    const urls = imgs.map((i) => fullSizeUrl(i.src));
    const startIndex = Math.max(0, imgs.indexOf(img));

    // Capture phase: stops X's own handler (lightbox + /photo/1 navigation).
    event.preventDefault();
    event.stopPropagation();
    ipc.invoke('open_image_viewer', { urls, startIndex }).catch(() => {});
  }, true);
})();
