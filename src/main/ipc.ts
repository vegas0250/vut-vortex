import { BrowserWindow, Menu, ipcMain, type MenuItemConstructorOptions, type Shell, type WebContents } from 'electron';
import { channels, failure, type ContextAction, type ContextMenuRequest, type Result } from '../shared/ipc';
import { copyPaths, createDirectory, listDirectory, locations, movePaths, removePaths, renamePath, absolutePath } from './filesystem/local';

async function guard<T>(run: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    console.error(error);
    return failure(error);
  }
}

function contextRequest(input: unknown): ContextMenuRequest {
  if (!input || typeof input !== 'object') throw new Error('Некорректное меню');
  const item = input as Partial<ContextMenuRequest>;
  const x = Number(item.x);
  const y = Number(item.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Некорректное меню');
  const kind = item.kind;
  if (kind !== 'local' && kind !== 'ssh' && kind !== 'sftp' && kind !== 'ftp') throw new Error('Некорректное меню');
  return {
    x: Math.round(x),
    y: Math.round(y),
    kind,
    open: item.open === true,
    rename: item.rename === true,
    transfer: item.transfer === true,
    remove: item.remove === true,
  };
}

function contextTemplate(
  request: ContextMenuRequest,
  choose: (next: ContextAction) => () => void,
): MenuItemConstructorOptions[] {
  if (request.kind === 'ssh') {
    return [
      { label: 'Открыть терминал', click: choose('terminal') },
      { label: 'Копировать адрес', click: choose('copy-address') },
      { type: 'separator' },
      { label: 'Отключиться', click: choose('disconnect') },
    ];
  }
  if (request.kind === 'sftp' || request.kind === 'ftp') {
    const title = request.kind === 'sftp' ? 'SFTP' : 'FTP';
    return [
      { label: 'Открыть', enabled: request.open, click: choose('open') },
      { label: 'Скачать', enabled: request.transfer, click: choose('download') },
      { label: `Загрузить в ${title}`, click: choose('upload') },
      { type: 'separator' },
      { label: 'Переименовать', enabled: request.rename, click: choose('rename') },
      { label: 'Копировать', enabled: request.transfer, click: choose('copy') },
      { label: 'Переместить', enabled: request.transfer, click: choose('move') },
      { type: 'separator' },
      { label: 'Удалить', enabled: request.remove, click: choose('delete') },
      { type: 'separator' },
      { label: 'Копировать адрес', click: choose('copy-address') },
      { label: 'Отключиться', click: choose('disconnect') },
    ];
  }
  return [
    { label: 'Открыть', enabled: request.open, click: choose('open') },
    { type: 'separator' },
    { label: 'Переименовать', enabled: request.rename, click: choose('rename') },
    { label: 'Копировать', enabled: request.transfer, click: choose('copy') },
    { label: 'Переместить', enabled: request.transfer, click: choose('move') },
    { type: 'separator' },
    { label: 'Удалить', enabled: request.remove, click: choose('delete') },
  ];
}

function popupContextMenu(request: ContextMenuRequest, sender: WebContents): Promise<ContextAction | null> {
  const window = BrowserWindow.fromWebContents(sender);
  if (!window) return Promise.resolve(null);
  return new Promise((resolve) => {
    let action: ContextAction | null = null;
    const choose = (next: ContextAction) => () => {
      action = next;
    };
    const menu = Menu.buildFromTemplate(contextTemplate(request, choose));
    menu.popup({
      window,
      x: request.x,
      y: request.y,
      callback: () => resolve(action),
    });
  });
}

function strings(input: unknown): unknown[] {
  if (!Array.isArray(input) || input.some((item) => typeof item !== 'string')) {
    throw new Error('Ожидался список путей');
  }
  return input;
}

export function registerIpc(shell: Shell): void {
  ipcMain.handle(channels.list, (_event, input: unknown, showHidden: unknown) =>
    guard(() => listDirectory(input, showHidden === true)),
  );
  ipcMain.handle(channels.locations, () => guard(() => locations()));
  ipcMain.handle(channels.mkdir, (_event, parent: unknown, name: unknown) =>
    guard(() => createDirectory(parent, name)),
  );
  ipcMain.handle(channels.rename, (_event, target: unknown, name: unknown) =>
    guard(() => renamePath(target, name)),
  );
  ipcMain.handle(channels.remove, (_event, targets: unknown) => guard(() => removePaths(strings(targets))));
  ipcMain.handle(channels.copy, (_event, targets: unknown, destination: unknown) =>
    guard(() => copyPaths(strings(targets), destination)),
  );
  ipcMain.handle(channels.move, (_event, targets: unknown, destination: unknown) =>
    guard(() => movePaths(strings(targets), destination)),
  );
  ipcMain.handle(channels.open, (_event, target: unknown) =>
    guard(async () => {
      const opened = await shell.openPath(absolutePath(target));
      if (opened) throw new Error(opened);
    }),
  );
  ipcMain.handle(channels.contextMenu, (event, input: unknown) =>
    guard(() => popupContextMenu(contextRequest(input), event.sender)),
  );
}
