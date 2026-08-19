const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const configPath = path.join(app.getPath('userData'), 'columns.json');
const injectCssPath = path.join(__dirname, 'inject.css');

function loadColumns() {
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    return [];
  }
}

function saveColumns(columns) {
  fs.writeFileSync(configPath, JSON.stringify(columns, null, 2), 'utf-8');
}

function readInjectCss() {
  try {
    return fs.readFileSync(injectCssPath, 'utf-8');
  } catch {
    return '';
  }
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#15202b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
  createWindow();

  // Live-reload inject.css: edit the file while the app is running (e.g. after
  // X changes its markup) and every column re-applies the CSS immediately.
  fs.watch(injectCssPath, { persistent: false }, () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('inject-css-updated', readInjectCss());
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('columns:load', () => loadColumns());
ipcMain.handle('columns:save', (_evt, columns) => {
  saveColumns(columns);
  return true;
});
ipcMain.handle('inject-css:get', () => readInjectCss());
ipcMain.handle('shell:open-external', (_evt, url) => shell.openExternal(url));
