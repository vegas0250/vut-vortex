export const channels = {
  list: 'fs:list',
  locations: 'fs:locations',
  mkdir: 'fs:mkdir',
  rename: 'fs:rename',
  remove: 'fs:remove',
  copy: 'fs:copy',
  move: 'fs:move',
  open: 'fs:open',
  contextMenu: 'fs:context-menu',
  minimize: 'window:minimize',
  toggleMaximize: 'window:toggle-maximize',
  close: 'window:close',
  state: 'window:state',
  openSources: 'window:open-sources',
  source: 'window:source',
} as const;

export type SourceKind = 'local' | 'ssh' | 'sftp' | 'ftp';

export type SourceTarget = 'tab' | 'pane' | 'active';

export interface SourceRequest {
  kind: SourceKind;
  label: string;
  path: string;
  host: string;
  port: number;
  user: string;
}

export interface OpenedSource extends SourceRequest {
  target: SourceTarget;
}

export interface ContextMenuRequest {
  x: number;
  y: number;
  kind: SourceKind;
  open: boolean;
  rename: boolean;
  transfer: boolean;
  remove: boolean;
}

export type ContextAction =
  | 'open'
  | 'rename'
  | 'copy'
  | 'move'
  | 'delete'
  | 'terminal'
  | 'download'
  | 'upload'
  | 'copy-address'
  | 'disconnect';

export type Result<T> = { ok: true; value: T } | { ok: false; message: string };

export function failure(error: unknown): Result<never> {
  return { ok: false, message: error instanceof Error ? error.message : 'Неизвестная ошибка' };
}
