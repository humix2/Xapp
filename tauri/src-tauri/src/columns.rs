//! Column webviews: one x.com webview per column, laid over the shell.
//!
//! The shell owns the layout. It reports each column's content rectangle
//! (in CSS px of the shell, which equal logical px since the shell is at
//! 0,0 with zoom 1) and Rust just moves the webview there. All column
//! webviews share one WebView2 profile, so logging in once covers every
//! column.

use serde::Deserialize;
use serde_json::Value;
use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, Url, Webview, WebviewBuilder, WebviewUrl};

use crate::{navigation, page_scripts, MAIN_WINDOW_LABEL};

#[derive(Debug, Clone, Copy, Deserialize)]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Deserialize)]
pub struct ColumnBounds {
    pub id: String,
    #[serde(flatten)]
    pub bounds: Bounds,
}

/// Column ids come from the shell; keep them to what a webview label allows.
fn label_for(id: &str) -> Result<String, String> {
    if id.is_empty() || id.len() > 64 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err(format!("invalid column id: {id}"));
    }
    Ok(format!("col-{id}"))
}

pub fn get(app: &AppHandle, id: &str) -> Result<Webview, String> {
    let label = label_for(id)?;
    app.get_webview(&label).ok_or_else(|| format!("no column webview: {id}"))
}

fn parse_x_url(url: &str) -> Result<Url, String> {
    let url: Url = url.parse().map_err(|e| format!("bad url: {e}"))?;
    if !navigation::is_x_url(&url) {
        return Err(format!("not an x.com url: {url}"));
    }
    Ok(url)
}

/// `settings`: the page-side column settings ({ zoom, homeFeed }), see
/// page-scripts/on-load/column-settings.js.
pub fn open(app: &AppHandle, id: &str, kind: &str, url: &str, bounds: Bounds, settings: Value) -> Result<(), String> {
    let label = label_for(id)?;
    if app.get_webview(&label).is_some() {
        return set_bounds(app, id, bounds);
    }
    let url = parse_x_url(url)?;
    let window = app
        .get_window(MAIN_WINDOW_LABEL)
        .ok_or("main window is gone")?;

    let nav_app = app.clone();
    let popup_app = app.clone();
    let mut builder = WebviewBuilder::new(&label, WebviewUrl::External(url))
        .devtools(true)
        .on_navigation(move |url| navigation::allow_navigation(&nav_app, url))
        .on_new_window(move |url, _features| {
            navigation::handle_new_window(&popup_app, &url);
            NewWindowResponse::Deny
        });
    for script in page_scripts::on_load(kind, id, &settings) {
        builder = builder.initialization_script(script);
    }

    let webview = window
        .add_child(
            builder,
            LogicalPosition::new(bounds.x, bounds.y),
            LogicalSize::new(bounds.width.max(1.0), bounds.height.max(1.0)),
        )
        .map_err(|e| e.to_string())?;

    #[cfg(windows)]
    {
        let fs_app = app.clone();
        let fs_id = id.to_string();
        // Handed off to the async runtime: this fires inside a WebView2
        // callback on the main thread.
        crate::webview2::on_fullscreen_change(&webview, move |full| {
            let app = fs_app.clone();
            let id = fs_id.clone();
            tauri::async_runtime::spawn(async move { crate::fullscreen::changed(&app, &id, full) });
        })?;
    }
    #[cfg(not(windows))]
    let _ = webview;
    Ok(())
}

pub fn set_bounds(app: &AppHandle, id: &str, bounds: Bounds) -> Result<(), String> {
    if crate::fullscreen::bounds_override(app, id) {
        return Ok(());
    }
    let webview = get(app, id)?;
    webview
        .set_position(LogicalPosition::new(bounds.x, bounds.y))
        .and_then(|_| webview.set_size(LogicalSize::new(bounds.width.max(1.0), bounds.height.max(1.0))))
        .map_err(|e| e.to_string())
}

pub fn close(app: &AppHandle, id: &str) -> Result<(), String> {
    match get(app, id) {
        Ok(webview) => webview.close().map_err(|e| e.to_string()),
        Err(_) => Ok(()),
    }
}

pub fn navigate(app: &AppHandle, id: &str, url: &str) -> Result<(), String> {
    let url = parse_x_url(url)?;
    get(app, id)?.navigate(url).map_err(|e| e.to_string())
}

pub fn eval(app: &AppHandle, id: &str, script: &str) -> Result<(), String> {
    get(app, id)?.eval(script).map_err(|e| e.to_string())
}
