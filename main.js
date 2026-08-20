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

const ALLOWED_HOSTNAME = /(?:^|\.)(x|twitter)\.com$/i;

// Every link a user could click should either stay inside XDeck (only if
// it's still x.com/twitter.com) or open in the OS's default browser — never
// spawn a new Electron window. The <webview> tag's 'new-window' DOM event is
// deprecated and, confirmed by testing, no longer reliably prevents Electron
// from opening its own popup window even when preventDefault() is called.
// webContents.setWindowOpenHandler() (registered here, on the guest's real
// webContents) is the current, reliable replacement. will-navigate is a
// second layer for links that navigate the same window instead of opening a
// new one.
//
// Registered after createWindow() so mainWindow's own webContents (created
// synchronously inside `new BrowserWindow()`, before this listener exists)
// never reaches it — only future webContents do: every column's <webview>
// guest and the compose popup window.
function interceptExternalNavigation(_event, contents) {
  contents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  contents.on('will-navigate', (event, url) => {
    try {
      if (!ALLOWED_HOSTNAME.test(new URL(url).hostname)) {
        event.preventDefault();
        shell.openExternal(url);
      }
    } catch {
      // Not a parseable absolute URL; leave navigation alone.
    }
  });

  // No visible DevTools button in the column header (it's rarely needed day
  // to day), but F12 still opens it for whichever column's webview has
  // focus — needed for the inject.css maintenance workflow (inspecting an
  // element to find its current selector after X changes its markup).
  contents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      contents.toggleDevTools();
    }
  });
}

let composeWindow = null;

function openComposeWindow() {
  if (composeWindow && !composeWindow.isDestroyed()) {
    composeWindow.focus();
    return;
  }
  composeWindow = new BrowserWindow({
    width: 600,
    height: 650,
    backgroundColor: '#15202b',
    parent: mainWindow,
    title: 'ポストする',
    webPreferences: {
      partition: 'persist:xsession',
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  composeWindow.setMenuBarVisibility(false);
  composeWindow.loadURL('https://x.com/compose/post');
  composeWindow.webContents.on('dom-ready', () => {
    composeWindow.webContents.insertCSS(readInjectCss()).catch(() => {});
  });
  composeWindow.on('closed', () => {
    composeWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('web-contents-created', interceptExternalNavigation);

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
ipcMain.handle('compose:open', () => openComposeWindow());
