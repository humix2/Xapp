// Hides promoted posts — same as POST_FILTER_JS in the Electron renderer.js.
(() => {
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

  function sweep() {
    document.querySelectorAll('article').forEach((article) => {
      if (isPromoted(article)) {
        const cell = article.closest('[data-testid="cellInnerDiv"]') || article;
        cell.style.display = 'none';
      }
    });
  }

  const start = () => {
    sweep();
    new MutationObserver(sweep).observe(document.body, { childList: true, subtree: true });
  };
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
