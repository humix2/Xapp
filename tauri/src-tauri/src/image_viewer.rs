//! Image viewer window — opened when a photo in a column is clicked
//! (page-scripts/on-load/photo-click.js). Same idea as the Electron
//! version: a dedicated window instead of X's lightbox, which would be
//! squeezed into the column's width.
//!
//! The images are handed to the page directly: an initialization script
//! when the window is first created, `showImages(...)` via eval when it's
//! already open. So the viewer itself needs no IPC.

use serde_json::json;
use tauri::{AppHandle, LogicalSize, Manager, Url, WebviewUrl, WebviewWindowBuilder};

pub const LABEL: &str = "image-viewer";
const MAX_IMAGES: usize = 20;

/// The request comes from x.com's page, so only accept X's image CDN.
fn is_x_image(url: &str) -> bool {
    match url.parse::<Url>() {
        Ok(u) => u.scheme() == "https" && u.host_str().is_some_and(|h| h == "pbs.twimg.com"),
        Err(_) => false,
    }
}

pub fn open(app: &AppHandle, urls: Vec<String>, start_index: usize) -> Result<(), String> {
    let urls: Vec<String> = urls.into_iter().filter(|u| is_x_image(u)).take(MAX_IMAGES).collect();
    if urls.is_empty() {
        return Err("no valid image urls".into());
    }
    let start_index = start_index.min(urls.len() - 1);
    let data = json!({ "urls": urls, "startIndex": start_index });

    if let Some(window) = app.get_webview_window(LABEL) {
        window.eval(format!("window.showImages({data})")).map_err(|e| e.to_string())?;
        let _ = window.unminimize();
        let _ = window.set_focus();
        return Ok(());
    }

    // 80% x 85% of the primary screen, like the Electron version.
    let size = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|m| m.size().to_logical::<f64>(m.scale_factor()))
        .map(|s| LogicalSize::new(s.width * 0.8, s.height * 0.85))
        .unwrap_or(LogicalSize::new(1200.0, 800.0));

    WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("image-viewer.html".into()))
        .title("画像")
        .inner_size(size.width, size.height)
        .center()
        .background_color(tauri::window::Color(0, 0, 0, 0xff))
        .initialization_script(format!("window.__XDECK_VIEWER_DATA__ = {data};"))
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}
