const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('xdeck', {
  loadColumns: () => ipcRenderer.invoke('columns:load'),
  saveColumns: (columns) => ipcRenderer.invoke('columns:save', columns),
  getInjectCss: () => ipcRenderer.invoke('inject-css:get'),
  onInjectCssUpdated: (cb) => ipcRenderer.on('inject-css-updated', (_e, css) => cb(css)),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
});
