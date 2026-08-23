const imgEl = document.getElementById('viewer-img');
const prevBtn = document.getElementById('prev-btn');
const nextBtn = document.getElementById('next-btn');
const closeBtn = document.getElementById('close-btn');
const counter = document.getElementById('counter');
const backdrop = document.getElementById('backdrop');

let urls = [];
let index = 0;

function render() {
  imgEl.src = urls[index] ?? '';
  const multi = urls.length > 1;
  prevBtn.hidden = !multi;
  nextBtn.hidden = !multi;
  counter.hidden = !multi;
  counter.textContent = multi ? `${index + 1} / ${urls.length}` : '';
}

function go(delta) {
  if (urls.length === 0) return;
  index = (index + delta + urls.length) % urls.length;
  render();
}

prevBtn.addEventListener('click', () => go(-1));
nextBtn.addEventListener('click', () => go(1));
closeBtn.addEventListener('click', () => window.close());
backdrop.addEventListener('click', (e) => {
  if (e.target === backdrop) window.close();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.close();
  else if (e.key === 'ArrowLeft') go(-1);
  else if (e.key === 'ArrowRight') go(1);
});

window.viewer.onData(({ urls: newUrls, startIndex }) => {
  urls = Array.isArray(newUrls) ? newUrls : [];
  index = Math.min(Math.max(0, startIndex || 0), Math.max(0, urls.length - 1));
  render();
});
