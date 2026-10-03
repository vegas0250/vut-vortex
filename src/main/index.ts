import { app, BrowserWindow, nativeTheme, session, shell } from 'electron';
import { fileURLToPath } from 'node:url';
import { registerIpc } from './ipc';

const devUrl = process.env.VUT_RENDERER_URL;

function flashColor(): string {
  return nativeTheme.shouldUseDarkColors ? '#1b1b1b' : '#f4f4f4';
}

function installProductionPolicy(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = details.responseHeaders ?? {};
    responseHeaders['Content-Security-Policy'] = [
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
    ];
    callback({ responseHeaders });
  });
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1120,
    height: 740,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: 'Vortex',
    backgroundColor: flashColor(),
    webPreferences: {
      preload: fileURLToPath(new URL('../preload/index.cjs', import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (devUrl && url.startsWith(devUrl)) return;
    if (url.startsWith('file:')) return;
    event.preventDefault();
  });
  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(fileURLToPath(new URL('../renderer/index.html', import.meta.url)));
  return win;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(() => {
    if (!devUrl) installProductionPolicy();
    registerIpc(shell);
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
  app.on('window-all-closed', () => {
    app.quit();
  });
}
