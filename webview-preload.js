// Runs inside each column's <webview> guest page (x.com itself). Its job is
// to intercept clicks on tweet photo thumbnails before X's own React click
// handlers see them, so photos open in a dedicated XDeck viewer window
// instead of X's built-in lightbox — which, inside a <webview>, is confined
// to the column's own pixel width (280-900px) and is nearly useless in a
// narrow column.
const { ipcRenderer } = require('electron');

// X autoplays timeline videos (and GIF-as-mp4 loops) purely via scroll
// position — an IntersectionObserver in X's own bundle starts them as they
// enter the viewport, with no single click handler to intercept instead.
//
// First attempt patched HTMLMediaElement.prototype.play() to gate on a
// recent user gesture — confirmed live to have zero effect, because this
// preload script runs in Electron's isolated world (contextIsolation
// defaults to true, and nothing here overrides it for the <webview>'s
// `webpreferences`). An isolated world gets its own separate copy of every
// built-in prototype, so a patch made here is invisible to X's own bundle
// running in the page's real ("main") world — it still calls the original,
// unpatched play(). What DOES cross the isolation boundary is (a) DOM events
// dispatched on the shared, live DOM tree (same mechanism the photo/hashtag
// click interception below already relies on) and (b) direct method calls /
// attribute changes on an actual element instance obtained via the DOM,
// since that instance's underlying state is shared regardless of which
// world touches it. So: listen for the native 'play' event (fires whenever
// playback actually starts, no matter what triggered it) and immediately
// pause() unless it happened shortly after a real pointer/keyboard event;
// and separately strip the `autoplay` attribute proactively so most videos
// never even start in the first place.
(() => {
  let lastInteractionAt = 0;
  const markInteraction = () => { lastInteractionAt = Date.now(); };
  document.addEventListener('pointerdown', markInteraction, true);
  document.addEventListener('keydown', markInteraction, true);
  const isUserInitiated = () => Date.now() - lastInteractionAt <= 1500;

  // 'play' does not bubble, so this has to listen in the capture phase (which
  // still traverses down to the target regardless of the bubbles flag) on an
  // ancestor, rather than the more usual bubble-phase document listener.
  //
  // Also rewinds to 0 on every blocked play: X's own autoplay controller
  // reacts to the pause (it still thinks the video should be playing, since
  // nothing told its IntersectionObserver otherwise) by calling play() again
  // a moment later, which this then pauses again, and so on — confirmed live
  // as a visible symptom: small bursts of playback advancing the video a
  // little further each cycle, which looks like the video is being
  // fast-forwarded in steps even though it's silent and mostly paused.
  // Rewinding every time this fires means each burst starts from frame 0
  // again, so the loop (if it keeps happening) just flickers the first frame
  // in place instead of visibly creeping forward.
  document.addEventListener('play', (event) => {
    if (isUserInitiated()) return;
    const media = event.target;
    media.pause();
    media.currentTime = 0;
  }, true);

  const stripAutoplay = (media) => {
    if (media.hasAttribute && media.hasAttribute('autoplay')) media.removeAttribute('autoplay');
  };
  document.querySelectorAll('video, audio').forEach(stripAutoplay);
  // Observing `document` itself, not `document.documentElement` (tried
  // first) — this preload script runs at essentially document-start timing,
  // and `documentElement` (the <html> node) is occasionally not created yet
  // at that exact instant, which throws ("parameter 1 is not of type
  // 'Node'") and silently kills every statement after it in this file, since
  // it's all one synchronous script: the photo-click and hashtag-click
  // listeners further down never get registered either. This is the actual
  // explanation for the intermittent "photo/hashtag click do nothing, no
  // console error" reports — confirmed by the fact that only the one build
  // that happened to wrap this in a try/catch didn't exhibit it. `document`
  // itself always exists, so observing it instead (childList still catches
  // <html> being inserted, subtree covers everything under it once it is)
  // removes the race instead of working around it.
  new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'attributes') {
        stripAutoplay(m.target);
        continue;
      }
      m.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        stripAutoplay(node);
        node.querySelectorAll && node.querySelectorAll('video, audio').forEach(stripAutoplay);
      });
    }
  }).observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['autoplay'],
  });
})();

function fullSizeUrl(src) {
  try {
    const u = new URL(src);
    if (u.hostname === 'pbs.twimg.com') u.searchParams.set('name', 'orig');
    return u.toString();
  } catch {
    return src;
  }
}

// Multi-photo tweets render one [data-testid="tweetPhoto"] per image inside
// the same <article>; collecting all of them (in DOM order) lets the viewer
// offer prev/next navigation instead of only ever showing a single photo.
function collectTweetPhotoUrls(article) {
  const imgs = Array.from(article.querySelectorAll('[data-testid="tweetPhoto"] img'));
  return imgs.map((img) => fullSizeUrl(img.src));
}

document.addEventListener('click', (event) => {
  const img = event.target.closest && event.target.closest('[data-testid="tweetPhoto"] img');
  if (!img) return;

  const article = img.closest('article');
  const urls = article ? collectTweetPhotoUrls(article) : [fullSizeUrl(img.src)];
  const startUrl = fullSizeUrl(img.src);
  const startIndex = Math.max(0, urls.indexOf(startUrl));

  // Capture phase, so this runs before X's own delegated React click
  // handler (attached lower in the tree) ever sees the event — stopping it
  // here prevents both the SPA navigation to the .../photo/1 route and its
  // in-page lightbox from ever opening.
  event.preventDefault();
  event.stopPropagation();
  ipcRenderer.sendToHost('xdeck-image-click', { urls, startIndex });
}, true);

// X renders every #hashtag in tweet text as <a href="/hashtag/foo?src=hashtag_click">.
// Left to navigate normally, it would replace the clicking column's own
// content with the search results, silently turning "the column I was
// reading" into "a hashtag search", which is confusing since search columns
// otherwise only appear where the user explicitly asked for one. Intercepting
// it here lets the host (renderer.js) open the search as a new column next to
// this one instead, leaving this column's own content untouched.
document.addEventListener('click', (event) => {
  const link = event.target.closest && event.target.closest('a[href*="/hashtag/"]');
  if (!link) return;

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
  ipcRenderer.sendToHost('xdeck-hashtag-click', { query: `#${decodeURIComponent(match[1])}` });
}, true);

// Lets the host (renderer.js) confirm this script actually ran all the way
// through and registered the listeners above — see ensurePreloadInjected in
// renderer.js for why that's not always a safe assumption.
ipcRenderer.sendToHost('xdeck-preload-ready');
