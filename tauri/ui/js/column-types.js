// Column types: URLs, titles and the ⚙ options — same as the Electron
// renderer.js (buildColumnUrl / columnTitle / *_OPTIONS).

export const DEFAULT_ZOOM = 1;
export const DEFAULT_REFRESH_MS = 180000; // 3分
export const DEFAULT_WIDTH = 380;
export const MIN_WIDTH = 280;
export const MAX_WIDTH = 900;

export const ZOOM_OPTIONS = [0.8, 0.9, 1, 1.1, 1.25, 1.5].map((v) => [v, `${Math.round(v * 100)}%`]);
export const REFRESH_OPTIONS = [
  [0, 'オフ'],
  [60000, '1分'],
  [180000, '3分'],
  [300000, '5分'],
  [600000, '10分'],
];
export const SORT_OPTIONS = [['live', '最新'], ['top', '話題']];

// Checked ones are appended to the search query.
export const OPERATOR_OPTIONS = [
  ['lang:ja', '日本語', '日本語の投稿のみ (lang:ja)'],
  ['filter:media', 'メディア', '画像/動画付きの投稿のみ (filter:media)'],
  ['-filter:retweets', 'RT除外', 'リツイートを除外 (-filter:retweets)'],
  ['-filter:replies', '返信除外', '返信を除外 (-filter:replies)'],
];

// Home: which tab to keep selected (the tab bar itself is hidden).
export const HOME_FEED_OPTIONS = [['following', 'フォロー中'], ['forYou', 'おすすめ']];

// 話題を検索: each tab has its own URL.
export const EXPLORE_TAB_OPTIONS = [
  ['for-you', 'おすすめ'],
  ['trending', 'トレンド'],
  ['news', 'ニュース'],
  ['sports', 'スポーツ'],
  ['entertainment', 'エンタメ'],
];

const labelOf = (options, key, fallback) => (options.find(([k]) => k === key) || options[0] || [fallback, fallback])[1];

export function columnKind(col) {
  return col.type || 'search';
}

export function homeFeed(col) {
  return col.homeFeed || 'following';
}

export function exploreTab(col) {
  return col.exploreTab || 'for-you';
}

function buildSearchUrl(query, sort, operators) {
  const fullQuery = [query, ...(operators || [])].join(' ').trim();
  const params = new URLSearchParams();
  params.set('q', fullQuery);
  params.set('src', 'typed_query');
  if (sort === 'live') params.set('f', 'live');
  return `https://x.com/search?${params.toString()}`;
}

export function columnUrl(col) {
  switch (columnKind(col)) {
    case 'trends': return 'https://x.com/explore/tabs/trending';
    case 'explore': return `https://x.com/explore/tabs/${exploreTab(col)}`;
    case 'home': return 'https://x.com/home';
    case 'notifications': return 'https://x.com/notifications';
    default: return buildSearchUrl(col.query, col.sort, col.operators);
  }
}

export function columnTitle(col) {
  switch (columnKind(col)) {
    case 'trends': return 'トレンド';
    case 'explore': return `話題を検索・${labelOf(EXPLORE_TAB_OPTIONS, exploreTab(col))}`;
    case 'home': return `ホーム・${labelOf(HOME_FEED_OPTIONS, homeFeed(col))}`;
    case 'notifications': return '通知';
    default: return `${col.query}・${col.sort === 'top' ? '話題' : '最新'}`;
  }
}

export function columnHomeTooltip(col) {
  switch (columnKind(col)) {
    case 'trends': return 'トレンドに戻る';
    case 'explore': return '話題を検索に戻る';
    case 'home': return 'ホームに戻る';
    case 'notifications': return '通知に戻る';
    default: return '検索トップに戻る';
  }
}

/** What the page itself needs to know (page-scripts/on-load/column-settings.js). */
export function pageSettings(col) {
  const s = { zoom: col.zoom ?? DEFAULT_ZOOM };
  if (columnKind(col) === 'home') s.homeFeed = homeFeed(col);
  return s;
}
