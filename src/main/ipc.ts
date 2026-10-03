import { ipcMain, type Shell } from 'electron';
import { channels, failure, type Result } from '../shared/ipc';
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
}
