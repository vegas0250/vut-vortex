import { BrowserWindow, ipcMain, type Shell, type WebContents } from 'electron';
import { readContextMenu, contextMenuService } from './context-menu';
import { channels, failure, type Result } from '../shared/ipc';
import type { ContextMenuExecuteRequest, ContextMenuFlags, ContextMenuQuery, ContextMenuTarget } from '../shared/context-menu';
import { isVortexCommand } from '../shared/context-menu';
import { copyPaths, createDirectory, listDirectory, locations, movePaths, removePaths, renamePath, absolutePath } from './filesystem/local';

async function guard<T>(run: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    console.error(error);
    return failure(error);
  }
}

function strings(input: unknown): unknown[] {
  if (!Array.isArray(input) || input.some((item) => typeof item !== 'string')) {
    throw new Error('Ожидался список путей');
  }
  return input;
}

function stringList(input: unknown): string[] {
  if (!Array.isArray(input) || input.some((item) => typeof item !== 'string')) {
    throw new Error('Некорректное меню');
  }
  return input;
}

function flags(input: unknown): ContextMenuFlags {
  const record = input && typeof input === 'object' ? input as Partial<ContextMenuFlags> : {};
  return {
    open: record.open === true,
    openTab: record.openTab === true,
    copy: record.copy === true,
    cut: record.cut === true,
    paste: record.paste === true,
    rename: record.rename === true,
    remove: record.remove === true,
    create: record.create === true,
    transfer: record.transfer === true,
  };
}

function target(input: unknown, directory: string): ContextMenuTarget {
  if (!input || typeof input !== 'object') throw new Error('Некорректное меню');
  const record = input as { type?: unknown; paths?: unknown; directory?: unknown };
  if (record.type === 'background') {
    const place = typeof record.directory === 'string' ? record.directory : directory;
    return { type: 'background', directory: place };
  }
  if (record.type !== 'file' && record.type !== 'folder' && record.type !== 'mixed') {
    throw new Error('Некорректное меню');
  }
  return { type: record.type, paths: stringList(record.paths) };
}

export function contextQuery(input: unknown): ContextMenuQuery {
  if (!input || typeof input !== 'object') throw new Error('Некорректное меню');
  const item = input as Partial<ContextMenuQuery>;
  const kind = item.kind;
  if (kind !== 'local' && kind !== 'ssh' && kind !== 'sftp' && kind !== 'ftp') throw new Error('Некорректное меню');
  const directory = typeof item.directory === 'string' ? item.directory : '';
  return {
    target: target(item.target, directory),
    folders: stringList(item.folders ?? []),
    directory,
    extended: item.extended === true,
    classic: item.classic === true,
    kind,
    flags: flags(item.flags),
  };
}

export function executeRequest(input: unknown): ContextMenuExecuteRequest {
  if (!input || typeof input !== 'object') throw new Error('Некорректная команда меню');
  const item = input as Partial<ContextMenuExecuteRequest>;
  if (typeof item.session !== 'string' || typeof item.commandId !== 'string') throw new Error('Некорректная команда меню');
  if (!item.session.startsWith('ses:') || item.session.length > 80) throw new Error('Некорректная команда меню');
  if (!item.commandId.startsWith('sys:') || item.commandId.length > 80 || isVortexCommand(item.commandId)) {
    throw new Error('Некорректная команда меню');
  }
  return { session: item.session, commandId: item.commandId };
}

function senderWindow(sender: WebContents): WebContents | null {
  return BrowserWindow.fromWebContents(sender) ? sender : null;
}

export function registerIpc(shell: Shell): void {
  ipcMain.handle(channels.list, (_event, input: unknown, showHidden: unknown, showSystem: unknown) =>
    guard(() => listDirectory(input, showHidden === true, showSystem === true)),
  );
  ipcMain.handle(channels.locations, () => guard(() => locations()));
  ipcMain.handle(channels.mkdir, (_event, parent: unknown, name: unknown) =>
    guard(() => createDirectory(parent, name)),
  );
  ipcMain.handle(channels.rename, (_event, targetPath: unknown, name: unknown) =>
    guard(() => renamePath(targetPath, name)),
  );
  ipcMain.handle(channels.remove, (_event, targets: unknown) => guard(() => removePaths(strings(targets))));
  ipcMain.handle(channels.copy, (_event, targets: unknown, destination: unknown) =>
    guard(() => copyPaths(strings(targets), destination)),
  );
  ipcMain.handle(channels.move, (_event, targets: unknown, destination: unknown) =>
    guard(() => movePaths(strings(targets), destination)),
  );
  ipcMain.handle(channels.open, (_event, opened: unknown) =>
    guard(async () => {
      const result = await shell.openPath(absolutePath(opened));
      if (result) throw new Error(result);
    }),
  );
  ipcMain.handle(channels.contextMenuGet, (event, input: unknown) =>
    guard(() => readContextMenu(contextQuery(input), senderWindow(event.sender))),
  );
  ipcMain.handle(channels.contextMenuExecute, (_event, input: unknown) =>
    guard(() => {
      const request = executeRequest(input);
      return contextMenuService().execute(request.session, request.commandId);
    }),
  );
  ipcMain.handle(channels.contextMenuDismiss, () => guard(() => contextMenuService().dismiss()));
}
