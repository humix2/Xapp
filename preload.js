const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('xdeck', {
  loadColumns: () => ipcRenderer.invoke('columns:load'),
  saveColumns: (columns) => ipcRenderer.invoke('columns:save', columns),
  getInjectCss: () => ipcRenderer.invoke('inject-css:get'),
  onInjectCssUpdated: (cb) => ipcRenderer.on('inject-css-updated', (_e, css) => cb(css)),
  openCompose: () => ipcRenderer.invoke('compose:open'),
  openImageViewer: (urls, startIndex) => ipcRenderer.invoke('image-viewer:open', { urls, startIndex }),
  // <webview> requires an absolute file: URL for its own preload attribute.
  // This runs in the sandboxed preload context, where require() only
  // polyfills 'electron'/'events'/'timers'/'url' (not 'path') — so the path
  // is built in the main process, which has full Node access, and fetched
  // over IPC instead of computed here.
  getWebviewPreloadPath: () => ipcRenderer.invoke('webview-preload-path:get'),
});
