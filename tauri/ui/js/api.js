// Thin wrappers over the Rust commands (src-tauri/src/commands.rs), so the
// rest of the UI never spells out command names.
const { invoke } = window.__TAURI__.core;

export const openCompose = () => invoke('open_compose');

export const loadColumns = () => invoke('load_columns');
export const saveColumns = (columns) => invoke('save_columns', { columns });

export const openColumn = (id, kind, url, bounds, settings) => invoke('column_open', { id, kind, url, bounds, settings });
export const closeColumn = (id) => invoke('column_close', { id });
export const setColumnBounds = (bounds) => invoke('column_set_bounds', { bounds });
export const navigateColumn = (id, url) => invoke('column_navigate', { id, url });
export const reloadColumn = (id) => invoke('column_reload', { id });
export const goBackColumn = (id) => invoke('column_go_back', { id });

/** Runs a named script from page-scripts/on-demand in the column's page. */
export const runInColumn = (id, script, args = null) => invoke('column_run', { id, script, args });
export const setFocusEmulation = (id, enabled) => invoke('column_focus_emulation', { id, enabled });
export const pressPeriod = (id) => invoke('column_press_period', { id });
