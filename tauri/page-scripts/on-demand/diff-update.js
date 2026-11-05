// Diff update page script — a straight port of diffUpdateJS() in the
// Electron renderer.js (see the long comment there for how X behaves).
// args.phase: 'detect' | 'insert'.
async (args) => {
  const PHASE = args && args.phase;
  const WORDED_RE = /新しい.{0,4}ポスト|new posts?/i;
  const COUNT_RE = /^\d[\d,]*\s*(件の)?\s*(新しい)?\s*(ポスト|post)/i;
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
  const shownIds = new Set(Array.from(document.querySelectorAll('article a[href*="/status/"]'))
    .map((a) => (a.getAttribute('href').match(/\/status\/(\d+)/) || [])[1]).filter(Boolean));
  let newCount = 0;
  const newIds = [];
  const countNew = (text) => {
    const seen = new Set();
    for (const m of text.matchAll(/"entryId":"([^"]+)"/g)) {
      const id = m[1];
      if (id.includes('promoted') || seen.has(id)) continue;
      seen.add(id);
      const tweet = id.match(/(?:^|-)tweet-(\d+)$/);
      if (tweet && !shownIds.has(tweet[1])) { newCount++; newIds.push(tweet[1]); }
    }
  };
  const countable = !location.pathname.startsWith('/notifications');
  let row = findRow();
  let fetchInfo = 'already-shown';
  if (!row) {
    let started = 0;
    let finished = 0;
    const OX = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (m, u, ...rest) {
      if (/graphql\/[^/]+\/\w*(Timeline|Notifications|Search)/i.test(String(u))) {
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
  const pending = countable ? fetchInfo === 'fetched' && newCount > 0 : pendingSignal();
  return { result: pending ? 'pending' : 'none', fetchInfo, newCount, newIds };
}
