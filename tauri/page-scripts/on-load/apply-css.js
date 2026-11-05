// Adds inject.css (+ the tab-bar rule) to every x.com page. Runs before the
// document exists, so it waits for <html>/<head> and re-adds the <style> if
// X ever replaces the head.
(() => {
  const CSS = __CSS_JSON__;
  const ID = 'xdeck-inject-css';
  const add = () => {
    if (document.getElementById(ID)) return;
    const parent = document.head || document.documentElement;
    if (!parent) return;
    const style = document.createElement('style');
    style.id = ID;
    style.textContent = CSS;
    parent.appendChild(style);
  };
  add();
  new MutationObserver(add).observe(document, { childList: true, subtree: true });
})();
