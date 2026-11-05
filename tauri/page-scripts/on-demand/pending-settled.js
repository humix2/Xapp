// Port of pendingSettledJS() in the Electron renderer.js: has a "新着あり"
// column caught up? (at the very top, and either every counted new post is
// shown, or X shows neither its "N 件のポストを表示" row nor the pill).
// args.newIds: tweet ids the detect phase counted as new.
(args) => {
  const scroller = document.scrollingElement || document.documentElement;
  if (scroller.scrollTop >= 5) return false;
  const ids = (args && args.newIds) || [];
  const shown = new Set(Array.from(document.querySelectorAll('article a[href*="/status/"]'))
    .map((a) => (a.getAttribute('href').match(/\/status\/(\d+)/) || [])[1]).filter(Boolean));
  if (ids.length && ids.every((id) => shown.has(id))) return true;
  const WORDED_RE = /新しい.{0,4}ポスト|new posts?/i;
  const COUNT_RE = /^\d[\d,]*\s*(件の)?\s*(新しい)?\s*(ポスト|post)/i;
  const labelOf = (el) => (el.getAttribute('aria-label') || el.textContent || '').trim();
  const row = Array.from(document.querySelectorAll('[data-testid="cellInnerDiv"] [role="button"], [data-testid="cellInnerDiv"] button'))
    .some((el) => !el.closest('article') && labelOf(el).length <= 40 && (COUNT_RE.test(labelOf(el)) || WORDED_RE.test(labelOf(el))));
  const pill = Array.from(document.querySelectorAll('button[aria-label], [role="button"][aria-label]'))
    .some((el) => !el.closest('article') && WORDED_RE.test(el.getAttribute('aria-label')) && el.getAttribute('aria-hidden') !== 'true');
  return !row && !pill;
}
