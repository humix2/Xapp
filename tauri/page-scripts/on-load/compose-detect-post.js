// Compose window only: closes the window once the post actually went
// through. Same rule as main.js in the Electron version — a successful
// (2xx) POST to an X GraphQL operation with "Tweet" in its name (seen live:
// CreateTweet) — but watched from inside the page by wrapping XHR/fetch,
// since Tauri has no webRequest hook. Installed before X's own code runs.
//
// Uses the compose_posted command (capabilities/compose.json).
(() => {
  const isPost = (method, url) => /^post$/i.test(method || '') && /\/graphql\/[^/]+\/\w*Tweet/i.test(String(url));
  let reported = false;
  const report = () => {
    if (reported) return;
    reported = true;
    const ipc = window.__TAURI_INTERNALS__;
    if (ipc) ipc.invoke('compose_posted').catch(() => {});
  };

  const XHR = XMLHttpRequest.prototype;
  const origOpen = XHR.open;
  XHR.open = function (method, url, ...rest) {
    if (isPost(method, url)) {
      this.addEventListener('loadend', () => {
        if (this.status >= 200 && this.status < 300) report();
      }, { once: true });
    }
    return origOpen.call(this, method, url, ...rest);
  };

  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : input && input.url;
    const method = (init && init.method) || (input && input.method) || 'GET';
    const promise = origFetch.apply(this, arguments);
    if (isPost(method, url)) {
      promise.then((res) => { if (res.ok) report(); }).catch(() => {});
    }
    return promise;
  };
})();
