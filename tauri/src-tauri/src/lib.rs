//! XDeck on Tauri (prototype).
//!
//! One native window holds several webviews:
//! - `shell`: the local UI in `tauri/ui/` (toolbar, column headers). It fills
//!   the whole window and tells Rust where each column's content area is.
//! - `col-<id>`: one per column, loading x.com, placed on top of the shell at
//!   the rectangle the shell reported (see `columns`).
//!
//! Module layout:
//! - `commands`      — everything the shell UI can call (`invoke`)
//! - `columns`       — creating / placing / closing column webviews
//! - `navigation`    — which URLs stay inside a column, which open in the browser
//! - `page_scripts`  — the JS injected into x.com (files in `tauri/page-scripts/`)
//! - `config`        — columns.json load/save
//! - `image_viewer`  — the photo viewer window
//! - `compose`       — the "ポストする" window
//! - `fullscreen`    — video fullscreen from a column
//! - `webview2`      — WebView2 DevTools Protocol calls (Windows only)

mod columns;
mod commands;
mod compose;
mod config;
mod fullscreen;
mod image_viewer;
mod navigation;
mod page_scripts;
#[cfg(windows)]
mod webview2;

use tauri::window::{Color, WindowBuilder};
use tauri::{AppHandle, LogicalPosition, Manager, WebviewBuilder, WebviewUrl};

pub const SHELL_LABEL: &str = "shell";
pub const MAIN_WINDOW_LABEL: &str = "main";

pub fn run() {
    tauri::Builder::default()
        // Must be first. A second XDeck would open the same profile from
        // another process (in Electron that left every column stuck on X's
        // loading screen), so it just brings the running window forward.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_window(MAIN_WINDOW_LABEL) {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        // Remembers the main window's position / size / maximized state.
        // The popups open at their default size each time, like Electron.
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_denylist(&[image_viewer::LABEL, compose::LABEL])
                .build(),
        )
        // Used from Rust only (navigation.rs). Its default click interceptor
        // is turned off: it grabs every target=_blank click in every
        // webview — x.com included — and then fails there (x.com may not
        // call the plugin, and its CSP blocks the IPC anyway), so external
        // links did nothing. Without it, those clicks reach on_new_window.
        .plugin(tauri_plugin_opener::Builder::new().open_js_links_on_click(false).build())
        .manage(fullscreen::State::default())
        .invoke_handler(tauri::generate_handler![
            commands::load_columns,
            commands::save_columns,
            commands::column_open,
            commands::column_close,
            commands::column_set_bounds,
            commands::column_navigate,
            commands::column_reload,
            commands::column_go_back,
            commands::column_run,
            commands::column_focus_emulation,
            commands::column_press_period,
            commands::open_image_viewer,
            commands::scroll_columns,
            commands::open_compose,
            commands::compose_posted,
            commands::open_hashtag,
        ])
        .setup(|app| {
            create_main_window(app.handle())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running XDeck (Tauri)");
}

fn create_main_window(app: &AppHandle) -> tauri::Result<()> {
    let window = WindowBuilder::new(app, MAIN_WINDOW_LABEL)
        .title("XDeck")
        .inner_size(1400.0, 900.0)
        .background_color(Color(0x15, 0x20, 0x2b, 0xff))
        .build()?;

    let size = window.inner_size()?.to_logical::<f64>(window.scale_factor()?);
    window.add_child(
        WebviewBuilder::new(SHELL_LABEL, WebviewUrl::App("index.html".into())).auto_resize(),
        LogicalPosition::new(0.0, 0.0),
        size,
    )?;
    Ok(())
}
