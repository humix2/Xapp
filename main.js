const { app, BrowserWindow, ipcMain, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');

const configPath = path.join(app.getPath('userData'), 'columns.json');
const windowStatePath = path.join(app.getPath('userData'), 'window-state.json');
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

function loadWindowState() {
  try {
    return JSON.parse(fs.readFileSync(windowStatePath, 'utf-8'));
  } catch {
    return null;
  }
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const isMaximized = mainWindow.isMaximized();
  const bounds = mainWindow.getNormalBounds();
  fs.writeFileSync(windowStatePath, JSON.stringify({ ...bounds, isMaximized }), 'utf-8');
}

// Only trust a saved position if the window would actually land somewhere
// reachable — e.g. a second monitor that's since been unplugged shouldn't
// strand the window off-screen. Width/height are kept either way.
function sanitizeWindowState(saved) {
  if (!saved || typeof saved.width !== 'number' || typeof saved.height !== 'number') return null;
  const width = Math.max(600, Math.min(saved.width, 6000));
  const height = Math.max(400, Math.min(saved.height, 6000));
  if (typeof saved.x !== 'number' || typeof saved.y !== 'number') {
    return { width, height, isMaximized: !!saved.isMaximized };
  }
  const onScreen = screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return saved.x + 100 > a.x && saved.x < a.x + a.width && saved.y + 20 > a.y && saved.y < a.y + a.height;
  });
  return onScreen
    ? { x: saved.x, y: saved.y, width, height, isMaximized: !!saved.isMaximized }
    : { width, height, isMaximized: !!saved.isMaximized };
}

let mainWindow;

function createWindow() {
  const state = sanitizeWindowState(loadWindowState());

  mainWindow = new BrowserWindow({
    width: state?.width ?? 1400,
    height: state?.height ?? 900,
    x: state?.x,
    y: state?.y,
    backgroundColor: '#15202b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  if (state?.isMaximized) mainWindow.maximize();

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile('index.html');

  let saveTimer = null;
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveWindowState, 500);
  };
  mainWindow.on('resize', scheduleSave);
  mainWindow.on('move', scheduleSave);
  mainWindow.on('close', () => {
    clearTimeout(saveTimer);
    saveWindowState();
  });
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

  // Auto-close the popup once the post actually goes through, instead of
  // making the user close it themselves. X's own "Post" button click isn't
  // a reliable signal (the request could still fail), so this watches for a
  // successful response from the GraphQL call the click triggers — the
  // operation name is a guess (X doesn't publish this), so the pattern is
  // deliberately broad (anything under .../graphql/.../ with "Tweet" in the
  // operation name, on either x.com or twitter.com) rather than the exact
  // "CreateTweet" tried first, which didn't close the window on a real post.
  //
  // debugLogPath: every matching graphql call (regardless of status) is
  // appended here so the actual operation name can be read back after a
  // real post, without needing DevTools open at the time.
  const ses = composeWindow.webContents.session;
  const debugLogPath = path.join(app.getPath('userData'), 'compose-debug.log');
  const urls = [
    'https://x.com/i/api/graphql/*',
    'https://twitter.com/i/api/graphql/*',
    'https://api.x.com/*',
    'https://api.twitter.com/*',
  ];
  const onGraphqlCompleted = (details) => {
    try {
      fs.appendFileSync(debugLogPath, `${new Date().toISOString()} ${details.statusCode} ${details.method} ${details.url}\n`);
    } catch {
      // Best-effort debug log; never let this break the actual feature.
    }
    const isPostLike = /Tweet/i.test(details.url) && details.method === 'POST';
    if (isPostLike && details.statusCode >= 200 && details.statusCode < 300) {
      // destroy(), not close(): a real post confirmed via CreateTweet 200 in
      // the debug log still left the window open with close(), most likely
      // X's own beforeunload handler intercepting it (a "leave site?"
      // prompt the user didn't notice/dismiss). destroy() skips
      // beforeunload/unload entirely — appropriate here since we only ever
      // call it after confirming the post already succeeded.
      if (composeWindow && !composeWindow.isDestroyed()) composeWindow.destroy();
    }
  };
  ses.webRequest.onCompleted({ urls }, onGraphqlCompleted);

  composeWindow.on('closed', () => {
    ses.webRequest.onCompleted(null);
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
