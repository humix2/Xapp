// ⚙ changes (zoom / home feed) → applied and remembered by
// on-load/column-settings.js. args: { zoom?, homeFeed? }.
(args) => (window.__xdeckApplySettings ? window.__xdeckApplySettings(args) : false)
