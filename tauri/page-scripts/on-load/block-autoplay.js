// Video autoplay blocking — same as webview-preload.js in the Electron
// version. Unlike there, Tauri's initialization scripts already run in the
// page's main world, so patching play() reaches X's own code directly.
(() => {
  const proto = HTMLMediaElement.prototype;
  if (proto.__xdeckPlayGated) return;
  Object.defineProperty(proto, '__xdeckPlayGated', { value: true });
  const isUserInitiated = () => !!(navigator.userActivation && navigator.userActivation.isActive);

  // Primary block: a rejected play() makes X show its play button and stop
  // retrying (same error Chromium's own autoplay policy gives).
  const originalPlay = proto.play;
  proto.play = function () {
    if (isUserInitiated()) return originalPlay.call(this);
    return Promise.reject(new DOMException('Autoplay blocked by XDeck', 'NotAllowedError'));
  };

  // Fallback for playback started without play().
  document.addEventListener('play', (event) => {
    if (isUserInitiated()) return;
    event.target.pause();
    event.target.currentTime = 0;
  }, true);

  const stripAutoplay = (media) => {
    if (media.hasAttribute && media.hasAttribute('autoplay')) media.removeAttribute('autoplay');
  };
  new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'attributes') { stripAutoplay(m.target); continue; }
      m.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        stripAutoplay(node);
        node.querySelectorAll('video, audio').forEach(stripAutoplay);
      });
    }
  }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['autoplay'] });
})();
