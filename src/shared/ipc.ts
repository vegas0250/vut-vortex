export const channels = {
  list: 'fs:list',
  locations: 'fs:locations',
  mkdir: 'fs:mkdir',
  rename: 'fs:rename',
  remove: 'fs:remove',
  copy: 'fs:copy',
  move: 'fs:move',
  open: 'fs:open',
  contextMenuGet: 'fs:context-menu-get',
  contextMenuExecute: 'fs:context-menu-execute',
  contextMenuDismiss: 'fs:context-menu-dismiss',
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

export interface ShellMenuNode {
  label: string;
  shortcut: string;
  separator: boolean;
  disabled: boolean;
  checked: boolean;
  command: number | null;
  /** Canonical shell verb, such as `open` or `properties`. Empty when the shell did not name one. */
  verb?: string;
  children: ShellMenuNode[];
}

export type Result<T> = { ok: true; value: T } | { ok: false; message: string };

export function failure(error: unknown): Result<never> {
  return { ok: false, message: error instanceof Error ? error.message : 'Неизвестная ошибка' };
}
