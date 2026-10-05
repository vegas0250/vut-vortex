import { app, BrowserWindow, ipcMain, session, shell } from 'electron';
import { fileURLToPath } from 'node:url';
import { channels, type SourceKind, type SourceRequest, type SourceTarget } from '../shared/ipc';
import { registerIpc } from './ipc';
import { shutdownContextMenu, warmContextMenu } from './context-menu';

const devUrl = process.env.VUT_RENDERER_URL;
let manager: BrowserWindow | null = null;
let sourcesWindow: BrowserWindow | null = null;
let sourceTarget: SourceTarget = 'tab';

function installProductionPolicy(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = details.responseHeaders ?? {};
    responseHeaders['Content-Security-Policy'] = [
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
    ];
    callback({ responseHeaders });
  });
}

function load(win: BrowserWindow, sources: boolean): void {
  if (devUrl) {
    void win.loadURL(sources ? `${devUrl}#sources` : devUrl);
    return;
  }
  const file = fileURLToPath(new URL('../renderer/index.html', import.meta.url));
  void win.loadFile(file, sources ? { hash: 'sources' } : undefined);
}

function createWindow(sources: boolean): BrowserWindow {
  const win = new BrowserWindow({
    width: sources ? 760 : 1120,
    height: sources ? 560 : 740,
    minWidth: sources ? 640 : 720,
    minHeight: sources ? 420 : 480,
    show: false,
    frame: false,
    title: sources ? 'Источник' : 'Vortex',
    backgroundColor: '#0e1411',
    webPreferences: {
      preload: fileURLToPath(new URL('../preload/index.cjs', import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.on('maximize', () => win.webContents.send(channels.state, true));
  win.on('unmaximize', () => win.webContents.send(channels.state, false));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (devUrl && url.startsWith(devUrl)) return;
    if (url.startsWith('file:')) return;
    event.preventDefault();
  });
  load(win, sources);
  return win;
}

function readSource(value: unknown): SourceRequest | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<SourceRequest>;
  const kinds: SourceKind[] = ['local', 'ssh', 'sftp', 'ftp'];
  if (!item.kind || !kinds.includes(item.kind)) return null;
  if (typeof item.label !== 'string' || typeof item.path !== 'string') return null;
  if (typeof item.host !== 'string' || typeof item.user !== 'string') return null;
  const port = Number(item.port);
  if (!Number.isFinite(port)) return null;
  return { kind: item.kind, label: item.label, path: item.path, host: item.host, port, user: item.user };
}

function registerWindowIpc(): void {
  ipcMain.on(channels.minimize, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });
  ipcMain.on(channels.toggleMaximize, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on(channels.close, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });
  ipcMain.handle(channels.openSources, (_event, target: unknown) => {
    sourceTarget = target === 'pane' || target === 'active' ? target : 'tab';
    if (sourcesWindow && !sourcesWindow.isDestroyed()) {
      sourcesWindow.focus();
      return;
    }
    sourcesWindow = createWindow(true);
    sourcesWindow.on('closed', () => {
      sourcesWindow = null;
    });
  });
  ipcMain.on(channels.source, (event, value: unknown) => {
    const source = readSource(value);
    if (!source || !manager || manager.isDestroyed()) return;
    manager.webContents.send(channels.source, { ...source, target: sourceTarget });
    if (manager.isMinimized()) manager.restore();
    manager.focus();
    BrowserWindow.fromWebContents(event.sender)?.close();
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!manager || manager.isDestroyed()) return;
    if (manager.isMinimized()) manager.restore();
    manager.focus();
  });
  app.whenReady().then(() => {
    if (!devUrl) installProductionPolicy();
    registerIpc(shell);
    registerWindowIpc();
    void warmContextMenu();
    manager = createWindow(false);
    manager.on('closed', () => {
      manager = null;
      if (sourcesWindow && !sourcesWindow.isDestroyed()) sourcesWindow.close();
    });
  });
  app.on('before-quit', () => {
    void shutdownContextMenu();
  });
  app.on('window-all-closed', () => {
    app.quit();
  });
}
