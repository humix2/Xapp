//! Commands callable with `invoke(...)`. Who may call which is set per
//! webview in capabilities/: the shell gets the column commands, x.com
//! pages only get open_image_viewer, scroll_columns and open_hashtag, the compose window
//! only compose_posted.

use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Webview};

use crate::columns::{self, Bounds, ColumnBounds};
use crate::{compose, config, image_viewer, page_scripts, SHELL_LABEL};

#[tauri::command]
pub fn load_columns(app: AppHandle) -> Result<Vec<Value>, String> {
    config::load(&app)
}

#[tauri::command]
pub fn save_columns(app: AppHandle, columns: Vec<Value>) -> Result<(), String> {
    config::save(&app, &columns)
}

/// Async on purpose: creating a webview from a sync command (which runs on
/// the main thread) deadlocks on Windows.
#[tauri::command]
pub async fn column_open(
    app: AppHandle,
    id: String,
    kind: String,
    url: String,
    bounds: Bounds,
    settings: Option<Value>,
) -> Result<(), String> {
    columns::open(&app, &id, &kind, &url, bounds, settings.unwrap_or(Value::Null))
}

#[tauri::command]
pub fn column_close(app: AppHandle, id: String) -> Result<(), String> {
    columns::close(&app, &id)
}

/// All columns at once (sent on every layout change: resize, scroll, add/remove).
#[tauri::command]
pub fn column_set_bounds(app: AppHandle, bounds: Vec<ColumnBounds>) -> Result<(), String> {
    // Minimizing shrinks the shell to 0×0, which would squash every column
    // to 1px. X then drops all but one post from its timeline and doesn't
    // redraw them when the window comes back, so leave the columns alone.
    let minimized = app
        .get_window(crate::MAIN_WINDOW_LABEL)
        .and_then(|w| w.is_minimized().ok())
        .unwrap_or(false);
    if minimized {
        return Ok(());
    }
    for b in bounds {
        columns::set_bounds(&app, &b.id, b.bounds)?;
    }
    Ok(())
}

#[tauri::command]
pub fn column_navigate(app: AppHandle, id: String, url: String) -> Result<(), String> {
    columns::navigate(&app, &id, &url)
}

#[tauri::command]
pub fn column_reload(app: AppHandle, id: String) -> Result<(), String> {
    columns::eval(&app, &id, "location.reload()")
}

#[tauri::command]
pub fn column_go_back(app: AppHandle, id: String) -> Result<(), String> {
    columns::eval(&app, &id, "history.back()")
}

/// Runs a named script from page-scripts/on-demand and returns its result.
#[tauri::command]
pub async fn column_run(app: AppHandle, id: String, script: String, args: Option<Value>) -> Result<Value, String> {
    let args = args.unwrap_or(Value::Null);
    let expression = page_scripts::on_demand(&script, &args).ok_or_else(|| format!("unknown script: {script}"))?;
    let webview = columns::get(&app, &id)?;
    platform::evaluate(&webview, &expression).await
}

/// Called from x.com itself (page-scripts/on-load/photo-click.js) — the one
/// command the column pages are allowed to use. Async because it may
/// create a window (sync would deadlock on Windows).
#[tauri::command]
pub async fn open_image_viewer(app: AppHandle, urls: Vec<String>, start_index: usize) -> Result<(), String> {
    image_viewer::open(&app, urls, start_index)
}

/// "✎ ポストする" in the shell toolbar.
#[tauri::command]
pub async fn open_compose(app: AppHandle) -> Result<(), String> {
    compose::open(&app)
}

/// Called from the compose window's page once the post succeeded
/// (page-scripts/on-load/compose-detect-post.js).
#[tauri::command]
pub async fn compose_posted(app: AppHandle) {
    compose::posted(&app);
}

/// Called from x.com (page-scripts/on-load/hashtag-click.js): opens the
/// hashtag as a search column right after the column it was clicked in.
/// The column comes from the calling webview's label, not from the page.
#[tauri::command]
pub fn open_hashtag(app: AppHandle, webview: Webview, query: String) -> Result<(), String> {
    let id = webview.label().strip_prefix("col-").ok_or("not a column")?;
    let query: String = query.chars().take(200).collect();
    let column = json!({ "type": "search", "query": query, "sort": "live", "operators": [] });
    let shell = app.get_webview(SHELL_LABEL).ok_or("shell is gone")?;
    shell
        .eval(format!(
            "window.insertColumnAfter && window.insertColumnAfter({}, {column})",
            json!(id)
        ))
        .map_err(|e| e.to_string())
}

/// Called from x.com (page-scripts/on-load/forward-horizontal-wheel.js):
/// a horizontal wheel over a column scrolls the shell's column strip.
#[tauri::command]
pub fn scroll_columns(app: AppHandle, dx: f64) -> Result<(), String> {
    if !dx.is_finite() {
        return Err("bad dx".into());
    }
    let shell = app.get_webview(SHELL_LABEL).ok_or("shell is gone")?;
    let dx = dx.clamp(-5000.0, 5000.0);
    shell
        .eval(format!("window.scrollColumnsBy && window.scrollColumnsBy({dx})"))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn column_focus_emulation(app: AppHandle, id: String, enabled: bool) -> Result<(), String> {
    let webview = columns::get(&app, &id)?;
    platform::set_focus_emulation(&webview, enabled).await
}

#[tauri::command]
pub async fn column_press_period(app: AppHandle, id: String) -> Result<(), String> {
    let webview = columns::get(&app, &id)?;
    platform::press_period(&webview).await
}

#[cfg(windows)]
use crate::webview2 as platform;

/// The DevTools-protocol features are WebView2-only; elsewhere they fail
/// cleanly so the rest of the prototype still builds.
#[cfg(not(windows))]
mod platform {
    use serde_json::Value;
    use tauri::Webview;
    const MSG: &str = "only supported on Windows (WebView2)";
    pub async fn evaluate(_: &Webview, _: &str) -> Result<Value, String> { Err(MSG.into()) }
    pub async fn set_focus_emulation(_: &Webview, _: bool) -> Result<(), String> { Err(MSG.into()) }
    pub async fn press_period(_: &Webview) -> Result<(), String> { Err(MSG.into()) }
}
