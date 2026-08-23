const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('viewer', {
  onData: (cb) => ipcRenderer.on('image-viewer:data', (_e, data) => cb(data)),
});
