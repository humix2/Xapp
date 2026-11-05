//! Video fullscreen from a column. When a column's page goes fullscreen,
//! that column's webview is stretched over the whole window, the window
//! itself goes fullscreen, and the other columns are hidden meanwhile.
//! Leaving fullscreen (Esc, or the video's own button) undoes all of it and
//! has the shell lay the columns out again.
//!
//! While a column is fullscreen, the shell's layout updates (it reacts to
//! the window resizing) keep it filling the window instead of moving it
//! back into its slot — see `bounds_override`.

use std::sync::Mutex;

use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, Webview};

use crate::{columns, MAIN_WINDOW_LABEL, SHELL_LABEL};

/// Id of the column that is fullscreen right now, if any.
#[derive(Default)]
pub struct State(Mutex<Option<String>>);

fn current(app: &AppHandle) -> Option<String> {
    app.state::<State>().0.lock().ok().and_then(|s| s.clone())
}

fn set_current(app: &AppHandle, id: Option<String>) {
    if let Ok(mut s) = app.state::<State>().0.lock() {
        *s = id;
    }
}

fn other_columns(app: &AppHandle, id: &str) -> Vec<Webview> {
    app.webviews()
        .into_values()
        .filter(|w| w.label().starts_with("col-") && w.label() != format!("col-{id}"))
        .collect()
}

/// Stretches the column over the whole window.
fn fill_window(app: &AppHandle, webview: &Webview) {
    let Some(window) = app.get_window(MAIN_WINDOW_LABEL) else { return };
    let (Ok(size), Ok(scale)) = (window.inner_size(), window.scale_factor()) else { return };
    let size = size.to_logical::<f64>(scale);
    let _ = webview.set_position(LogicalPosition::new(0.0, 0.0));
    let _ = webview.set_size(LogicalSize::new(size.width, size.height));
}

pub fn changed(app: &AppHandle, id: &str, fullscreen: bool) {
    if fullscreen {
        enter(app, id);
    } else {
        exit(app, id);
    }
}

fn enter(app: &AppHandle, id: &str) {
    let Ok(webview) = columns::get(app, id) else { return };
    set_current(app, Some(id.to_string()));
    for other in other_columns(app, id) {
        let _ = other.hide();
    }
    if let Some(window) = app.get_window(MAIN_WINDOW_LABEL) {
        let _ = window.set_fullscreen(true);
    }
    fill_window(app, &webview);
}

fn exit(app: &AppHandle, id: &str) {
    if current(app).as_deref() != Some(id) {
        return;
    }
    set_current(app, None);
    if let Some(window) = app.get_window(MAIN_WINDOW_LABEL) {
        let _ = window.set_fullscreen(false);
    }
    for other in other_columns(app, id) {
        let _ = other.show();
    }
    // Put every column back where its slot is.
    if let Some(shell) = app.get_webview(SHELL_LABEL) {
        let _ = shell.eval("window.relayoutColumns && window.relayoutColumns()");
    }
}

/// Called for every layout update from the shell: true if this column is
/// fullscreen, in which case it was made to fill the window instead.
pub fn bounds_override(app: &AppHandle, id: &str) -> bool {
    if current(app).as_deref() != Some(id) {
        return false;
    }
    if let Ok(webview) = columns::get(app, id) {
        fill_window(app, &webview);
    }
    true
}
