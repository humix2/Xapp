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
