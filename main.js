const { app, BrowserWindow, ipcMain, shell, screen, Menu, webContents } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

// Tried app.disableHardwareAcceleration() here to stop the GPU-process-crash
// reloads (see reload-debug.log reasoning below) — reverted. It looked at
// first like it broke every <webview> guest's preload script
// (webview-preload.js), taking out the photo-click-opens-a-viewer-window and
// hashtag-click-opens-a-new-column features at once, but that turned out to
// be an unrelated, pre-existing intermittent bug in webview-preload.js itself
// (see the comment there on the MutationObserver's observe() target) that
// just happened to surface around the same time. disableHardwareAcceleration
// is not confirmed to cause any regression — it just wasn't confirmed to fix
// the GPU crash either before being reverted. Needs a narrower fix for the
// GPU crash (see TODO.md).

// A second instance (e.g. launched from another virtual desktop) would open
// its own set of <webview>s against the same persist:xsession partition —
// two processes fighting over the same session storage at once, which has
// been observed to leave every column stuck on X's loading screen (an
// Arkose bot-challenge iframe failing to render, likely from X treating the
// resulting traffic as suspicious). Bail out immediately and just focus the
// existing window instead of letting a second instance start at all.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

const configPath = path.join(app.getPath('userData'), 'columns.json');
const windowStatePath = path.join(app.getPath('userData'), 'window-state.json');
const injectCssPath = path.join(__dirname, 'inject.css');
const reloadDebugLogPath = path.join(app.getPath('userData'), 'reload-debug.log');

// Diagnostic trail for "a column (or several at once) went blank and came
// back" reports — same reasoning as compose-debug.log below: this only
// happens intermittently and isn't reproducible on demand, so the only way
// to tell "a renderer process got killed under memory/CPU pressure while
// scrolling" apart from "X's own JS called location.reload()" apart from
// "the user clicked ⟳" is to have a timestamped record from all columns to
// compare after the fact.
function appendReloadDebugLog(line) {
  try {
    fs.appendFileSync(reloadDebugLogPath, `${new Date().toISOString()} ${line}\n`);
  } catch {
    // Best-effort debug log; never let this break the actual feature.
  }
}

// Confirmed live: a reload report reproduced (scroll to the bottom of one
// column repeatedly) with none of the per-column (render-process-gone,
// unexpected did-navigate) or main-window did-navigate hooks above firing —
// so whatever the user is seeing isn't a navigation or a renderer crash at
// all. The next suspect is the GPU process: every column's images/video
// frames are composited through it, so heavy image churn from one column's
// infinite scroll could be enough to crash or exceed a limit in that single
// shared process, which would blank and repaint the *entire* window (every
// column at once, matching the report) with no navigation involved anywhere.
// 'render-process-gone' above only covers page renderer processes, not this
// one — app-level 'child-process-gone' is the general hook that also covers
// the GPU process (and any utility/zygote process), so it's the one that can
// actually confirm or rule this out.
app.on('child-process-gone', (_event, details) => {
  appendReloadDebugLog(`child-process-gone type=${details.type} reason=${details.reason} exitCode=${details.exitCode} name=${details.name || ''}`);
});

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
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#1e2732',
      symbolColor: '#e7e9ea',
      height: 49,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  if (state?.isMaximized) mainWindow.maximize();

  mainWindow.setMenuBarVisibility(false);

  // index.html is the entire app shell — every column lives inside it, so a
  // navigation here (as opposed to a column's own <webview> reloading, a
  // separate webContents handled per-column in renderer.js) means the whole
  // app just got torn down and rebuilt from columns.json, which looks to the
  // user like every column reloading at once. renderer.js's own
  // reload-debug.log hooks can't see this happen because the reload wipes
  // out the very JS state (and event listeners) those hooks live in before
  // they'd get a chance to record anything — this has to be caught from the
  // main process side, which survives the reload, instead.
  let sawInitialLoad = false;
  mainWindow.webContents.on('did-navigate', () => {
    if (!sawInitialLoad) {
      sawInitialLoad = true;
      return;
    }
    appendReloadDebugLog(`main-window-reload (entire app shell reloaded, not just one column)`);
  });
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

// url here comes from whatever the webview's page content contains (tweet
// text, DMs, profile bios, ...) — effectively attacker-controlled, since any
// X user can post a link. shell.openExternal hands the URL to the OS, which
// on Windows resolves it through whatever program is registered for its
// scheme; a non-http(s) scheme could reach a third-party protocol handler
// with known argument-injection bugs from nothing more than a click. Electron's
// own security guidance is explicit about this: never call openExternal with
// untrusted content. Restricting to http(s) keeps this to "open in the
// default browser", which is all this is meant to do anyway.
function isSafeExternalUrl(url) {
  try {
    return /^https?:$/i.test(new URL(url).protocol);
  } catch {
    return false;
  }
}

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
    if (isSafeExternalUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  contents.on('will-navigate', (event, url) => {
    try {
      if (!ALLOWED_HOSTNAME.test(new URL(url).hostname)) {
        event.preventDefault();
        if (isSafeExternalUrl(url)) shell.openExternal(url);
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

  // A renderer process getting killed (OOM under system memory pressure,
  // GPU crash, etc.) and a full page navigation look identical to the user —
  // content goes blank and comes back — but have very different causes and
  // fixes. Logging this side unambiguously identifies the "process actually
  // died" case; see logUnexpectedReload below (called from renderer.js) for
  // the "a navigation happened that XDeck itself didn't ask for" case.
  contents.on('render-process-gone', (_e, details) => {
    appendReloadDebugLog(`render-process-gone reason=${details.reason} url=${contents.getURL()}`);
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

let imageViewerWindow = null;

function openImageViewer(urls, startIndex) {
  if (!Array.isArray(urls) || urls.length === 0) return;

  if (imageViewerWindow && !imageViewerWindow.isDestroyed()) {
    imageViewerWindow.webContents.send('image-viewer:data', { urls, startIndex });
    imageViewerWindow.focus();
    return;
  }

  const workArea = screen.getPrimaryDisplay().workArea;
  imageViewerWindow = new BrowserWindow({
    width: Math.round(workArea.width * 0.8),
    height: Math.round(workArea.height * 0.85),
    backgroundColor: '#000000',
    parent: mainWindow,
    title: '画像',
    webPreferences: {
      preload: path.join(__dirname, 'image-viewer-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  imageViewerWindow.setMenuBarVisibility(false);
  imageViewerWindow.loadFile('image-viewer.html');
  imageViewerWindow.webContents.on('did-finish-load', () => {
    imageViewerWindow.webContents.send('image-viewer:data', { urls, startIndex });
  });
  imageViewerWindow.on('closed', () => {
    imageViewerWindow = null;
  });
}

app.whenReady().then(() => {
  // setMenuBarVisibility(false) on the window only hides the menu *bar* —
  // Electron's auto-generated default menu (and its accelerators: CmdOrCtrl+R
  // reload, CmdOrCtrl+Shift+R force-reload, CmdOrCtrl+W close-window, ...)
  // stays fully live underneath even with the bar hidden. CmdOrCtrl+R landing
  // on the *main* window reloads index.html — the whole app shell every
  // column lives in — which is indistinguishable from "every column reloaded
  // at once" to the user, and a stray CmdOrCtrl+W would silently close the
  // entire app. Removing the menu entirely removes those accelerators too;
  // F12 DevTools (handled separately, per-column, in
  // interceptExternalNavigation below) is unaffected since it doesn't go
  // through the Menu at all.
  Menu.setApplicationMenu(null);

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
ipcMain.handle('image-viewer:open', (_evt, { urls, startIndex }) => openImageViewer(urls, startIndex));
ipcMain.handle('webview-preload-path:get', () => pathToFileURL(path.join(__dirname, 'webview-preload.js')).toString());
ipcMain.handle('debug:log-unexpected-reload', (_evt, { colId, colType, url }) => {
  appendReloadDebugLog(`unexpected-navigate col=${colId} type=${colType} url=${url}`);
});

// X only checks for new posts while its page believes it has focus — confirmed
// live: with the XDeck window in the background, scrolling a column never
// triggered a timeline request; with DevTools-protocol focus emulation on, it
// did every time. Faking it from inside the page (document.hasFocus override,
// synthetic focus events) did not work. So the diff update turns focus
// emulation on for the column's webview just while it runs.
ipcMain.handle('webview:focus-emulation', async (evt, { webContentsId, enabled }) => {
  const wc = webContents.fromId(webContentsId);
  // Only this window's own <webview> guests.
  if (!wc || wc.isDestroyed() || wc.hostWebContents !== evt.sender) return false;
  try {
    if (enabled) {
      if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
      await wc.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
    } else if (wc.debugger.isAttached()) {
      await wc.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: false });
      wc.debugger.detach();
    }
    return true;
  } catch {
    return false;
  }
});

// Sends X's own "." (load new posts) shortcut as a real key event. Used by the
// diff update when X has announced new posts but hasn't rendered its
// "N 件のポストを表示" row yet — confirmed live that the row appears ~1.5s
// after this. Needs the debugger attached by 'webview:focus-emulation' above.
ipcMain.handle('webview:press-period', async (evt, { webContentsId }) => {
  const wc = webContents.fromId(webContentsId);
  if (!wc || wc.isDestroyed() || wc.hostWebContents !== evt.sender || !wc.debugger.isAttached()) return false;
  const key = { key: '.', code: 'Period', text: '.', unmodifiedText: '.', windowsVirtualKeyCode: 190, nativeVirtualKeyCode: 190 };
  try {
    await wc.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', ...key });
    await wc.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'char', ...key });
    await wc.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
    return true;
  } catch {
    return false;
  }
});
