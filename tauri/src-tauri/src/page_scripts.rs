//! JS injected into x.com. The scripts themselves live in
//! `tauri/page-scripts/` and are embedded at build time:
//! - `on-load/`   run on every page load, before X's own code
//! - `on-demand/` run when the shell asks (`column_run`); each file is a
//!   function expression `(args) => ...`, called with JSON args.
//!
//! inject.css is the Electron version's own file (repo root), shared as is.

use serde_json::Value;

const INJECT_CSS: &str = include_str!("../../../inject.css");

/// Same as TAB_BAR_HIDE_CSS in the Electron renderer.js.
const TAB_BAR_HIDE_CSS: &str =
    r#"div[role="tablist"][data-testid="ScrollSnap-List"]:has([role="tab"]) { display: none !important; }"#;

const APPLY_CSS: &str = include_str!("../../page-scripts/on-load/apply-css.js");
const BLOCK_AUTOPLAY: &str = include_str!("../../page-scripts/on-load/block-autoplay.js");
const HIDE_ADS: &str = include_str!("../../page-scripts/on-load/hide-ads.js");
const PHOTO_CLICK: &str = include_str!("../../page-scripts/on-load/photo-click.js");
const FORWARD_HORIZONTAL_WHEEL: &str = include_str!("../../page-scripts/on-load/forward-horizontal-wheel.js");
const HASHTAG_CLICK: &str = include_str!("../../page-scripts/on-load/hashtag-click.js");
const COLUMN_SETTINGS: &str = include_str!("../../page-scripts/on-load/column-settings.js");

const APPLY_COLUMN_SETTINGS: &str = include_str!("../../page-scripts/on-demand/apply-column-settings.js");
const DIFF_UPDATE: &str = include_str!("../../page-scripts/on-demand/diff-update.js");
const PENDING_SETTLED: &str = include_str!("../../page-scripts/on-demand/pending-settled.js");
const SCROLL: &str = include_str!("../../page-scripts/on-demand/scroll.js");
const SCROLL_TOP_POSITION: &str = include_str!("../../page-scripts/on-demand/scroll-top-position.js");

const COMPOSE_DETECT_POST: &str = include_str!("../../page-scripts/on-load/compose-detect-post.js");

fn apply_css(css: &str) -> String {
    let css_json = serde_json::to_string(css).unwrap_or_else(|_| "\"\"".into());
    APPLY_CSS.replace("__CSS_JSON__", &css_json)
}

/// Scripts for the compose window (Electron applied just inject.css there).
pub fn compose_on_load() -> Vec<String> {
    vec![apply_css(INJECT_CSS), COMPOSE_DETECT_POST.to_string()]
}

/// Scripts for a column. `settings` is the column's page-side settings
/// ({ zoom, homeFeed }); homeFeed only matters for "home" columns.
pub fn on_load(kind: &str, id: &str, settings: &Value) -> Vec<String> {
    let mut settings = settings.clone();
    if kind != "home" {
        if let Some(obj) = settings.as_object_mut() {
            obj.remove("homeFeed");
        }
    }
    let column_settings = COLUMN_SETTINGS
        .replace("__COLUMN_ID__", &Value::from(id).to_string())
        .replace("__SETTINGS_JSON__", &settings.to_string());
    vec![
        apply_css(&format!("{INJECT_CSS}\n{TAB_BAR_HIDE_CSS}")),
        column_settings,
        BLOCK_AUTOPLAY.to_string(),
        HIDE_ADS.to_string(),
        PHOTO_CLICK.to_string(),
        HASHTAG_CLICK.to_string(),
        FORWARD_HORIZONTAL_WHEEL.to_string(),
    ]
}

/// The expression to evaluate for a named on-demand script, or None if the
/// name is unknown (the shell can only run scripts listed here).
pub fn on_demand(name: &str, args: &Value) -> Option<String> {
    let body = match name {
        "apply-column-settings" => APPLY_COLUMN_SETTINGS,
        "diff-update" => DIFF_UPDATE,
        "pending-settled" => PENDING_SETTLED,
        "scroll" => SCROLL,
        "scroll-top-position" => SCROLL_TOP_POSITION,
        _ => return None,
    };
    let body = body.trim().trim_end_matches(';');
    Some(format!("({body})({args})"))
}
