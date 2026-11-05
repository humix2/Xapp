//! Compose window ("ポストする") — x.com/compose/post in its own window,
//! closed automatically once the post succeeds
//! (page-scripts/on-load/compose-detect-post.js → compose_posted).
//! Shares the columns' login, since every webview uses the same profile.

use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::{navigation, page_scripts};

pub const LABEL: &str = "compose";
const URL: &str = "https://x.com/compose/post";

pub fn open(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.unminimize();
        let _ = window.set_focus();
        return Ok(());
    }
    let nav_app = app.clone();
    let popup_app = app.clone();
    let mut builder = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::External(URL.parse().unwrap()))
        .title("ポストする")
        .inner_size(600.0, 650.0)
        .center()
        .background_color(tauri::window::Color(0x15, 0x20, 0x2b, 0xff))
        .on_navigation(move |url| navigation::allow_navigation(&nav_app, url))
        .on_new_window(move |url, _features| {
            navigation::handle_new_window(&popup_app, &url);
            NewWindowResponse::Deny
        });
    for script in page_scripts::compose_on_load() {
        builder = builder.initialization_script(script);
    }
    builder.build().map_err(|e| e.to_string())?;
    Ok(())
}

/// destroy(), not close(): like the Electron version, skip X's "leave this
/// page?" prompt — the post is already confirmed sent at this point.
pub fn posted(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.destroy();
    }
}
