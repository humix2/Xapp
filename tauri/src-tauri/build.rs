// Every app command gets its own `allow-<name>` permission, so each webview
// can be granted exactly the commands it needs (see capabilities/). Without
// this list, any webview with a capability could call every command.
const COMMANDS: &[&str] = &[
    "load_columns",
    "save_columns",
    "column_open",
    "column_close",
    "column_set_bounds",
    "column_navigate",
    "column_reload",
    "column_go_back",
    "column_run",
    "column_focus_emulation",
    "column_press_period",
    "open_image_viewer",
    "scroll_columns",
    "open_compose",
    "compose_posted",
    "open_hashtag",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run tauri-build");
}
