//! Link handling for column webviews — same rules as main.js in the
//! Electron version: x.com / twitter.com stay in the column, other http(s)
//! links open in the default browser, everything else is blocked. URLs come
//! from page content (anyone can post a link), so non-http(s) schemes are
//! never handed to the OS.

use tauri::{AppHandle, Url};
use tauri_plugin_opener::OpenerExt;

pub fn is_x_url(url: &Url) -> bool {
    if url.scheme() != "https" {
        return false;
    }
    match url.host_str() {
        Some(host) => {
            let host = host.to_ascii_lowercase();
            ["x.com", "twitter.com"]
                .iter()
                .any(|d| host == *d || host.ends_with(&format!(".{d}")))
        }
        None => false,
    }
}

fn open_in_browser(app: &AppHandle, url: &Url) {
    if matches!(url.scheme(), "http" | "https") {
        let _ = app.opener().open_url(url.as_str(), None::<&str>);
    }
}

/// Navigation of a column's main frame. Returns whether to allow it.
pub fn allow_navigation(app: &AppHandle, url: &Url) -> bool {
    if is_x_url(url) || matches!(url.scheme(), "about" | "blob" | "data") {
        return true;
    }
    open_in_browser(app, url);
    false
}

/// window.open / target=_blank from a column: never a new app window.
pub fn handle_new_window(app: &AppHandle, url: &Url) {
    open_in_browser(app, url);
}
