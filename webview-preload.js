// Runs inside each column's <webview> guest page (x.com itself). Its job is
// to intercept clicks on tweet photo thumbnails before X's own React click
// handlers see them, so photos open in a dedicated XDeck viewer window
// instead of X's built-in lightbox — which, inside a <webview>, is confined
// to the column's own pixel width (280-900px) and is nearly useless in a
// narrow column.
const { ipcRenderer } = require('electron');

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
