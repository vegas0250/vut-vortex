import type { SourceKind } from './ipc';

/** Where a command came from. The menu view does not branch on this. */
export type ContextMenuSource = 'vortex' | 'windows-shell' | 'linux-system' | 'extension';

/**
 * What the click refers to.
 * Several files stay `file` with more than one path. Two folders, or files mixed with folders, are `mixed`.
 */
export type ContextMenuTarget =
  | { type: 'file'; paths: string[] }
  | { type: 'folder'; paths: string[] }
  | { type: 'mixed'; paths: string[] }
  | { type: 'background'; directory: string };

export interface ContextMenuItem {
  id: string;
  label: string;
  /** VUI icon name. Absent when the system did not provide one the view can draw. */
  icon?: string;
  enabled?: boolean;
  checked?: boolean;
  separator?: boolean;
  shortcut?: string;
  children?: ContextMenuItem[];
  source: ContextMenuSource;
  /** Opaque id. Vortex ids start with `vortex:`. System ids are minted by the provider. */
  command?: string;
  /** Shell verb, when the provider named one. Used to choose an icon and the command bar. */
  verb?: string;
  /** Bottom icon row, as in the Windows 11 menu. */
  bar?: boolean;
}

export interface ContextMenuFlags {
  open: boolean;
  openTab: boolean;
  copy: boolean;
  cut: boolean;
  paste: boolean;
  rename: boolean;
  remove: boolean;
  create: boolean;
  transfer: boolean;
}

export interface ContextMenuQuery {
  target: ContextMenuTarget;
  /** Paths inside `target` that are directories. Files are the rest. */
  folders: string[];
  directory: string;
  extended: boolean;
  /** Ask for the full classic menu even when Windows is set to the short menu. */
  classic?: boolean;
  kind: SourceKind;
  flags: ContextMenuFlags;
}

export interface ContextMenuTiming {
  cached: boolean;
  providerMs: number;
  systemMs: number;
  normalizeMs: number;
  totalMs: number;
}

export interface ContextMenuModel {
  items: ContextMenuItem[];
  session: string;
  timing: ContextMenuTiming;
}

export interface ContextMenuExecuteRequest {
  session: string;
  commandId: string;
}

const menuIcons = new Set([
  'copy',
  'download',
  'file',
  'folder',
  'folder-open',
  'folder-plus',
  'info',
  'loader',
  'menu-apps',
  'menu-archive',
  'menu-cut',
  'menu-item',
  'menu-link',
  'menu-more',
  'menu-open',
  'menu-paste',
  'menu-properties',
  'menu-share',
  'menu-star',
  'menu-window',
  'pencil',
  'pin',
  'search',
  'terminal',
  'trash-2',
]);

/** Keeps a VUI registry name. Paths, handles, and data URLs are not icons. */
export function menuIcon(value: string | undefined): string | undefined {
  if (!value || !menuIcons.has(value)) return undefined;
  return value;
}

export function classifySelection(
  entries: readonly { path: string; kind: string; name: string }[],
  directory: string,
): ContextMenuTarget {
  const selected = entries.filter((entry) => entry.name !== '.' && entry.name !== '..');
  if (!selected.length) return { type: 'background', directory };
  const folders = selected.filter((entry) => entry.kind === 'directory');
  const paths = selected.map((entry) => entry.path);
  if (folders.length === selected.length && selected.length === 1) return { type: 'folder', paths };
  if (folders.length === 0) return { type: 'file', paths };
  return { type: 'mixed', paths };
}

export function selectionPaths(target: ContextMenuTarget): string[] {
  return target.type === 'background' ? [] : target.paths;
}

export function extensionOf(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';
  return base.slice(dot).toLowerCase();
}

export function desktopId(env: Readonly<Record<string, string | undefined>>): string {
  const raw = env.XDG_CURRENT_DESKTOP || env.XDG_SESSION_DESKTOP || '';
  const token = raw.split(':').find((part) => part.trim().length > 0) ?? '';
  return token.toLowerCase() || 'unknown';
}

/** Same selection, count, extension, and place share a key. A different selection does not. */
export function contextCacheKey(os: string, desktop: string, query: ContextMenuQuery): string {
  const paths = [...selectionPaths(query.target)].sort();
  return JSON.stringify({
    os,
    desktop,
    kind: query.kind,
    type: query.target.type,
    count: paths.length,
    extensions: paths.map(extensionOf).sort(),
    directory: query.directory,
    paths,
    folders: [...query.folders].sort(),
    extended: query.extended,
    classic: query.classic === true,
  });
}

function separator(id: string, source: ContextMenuSource): ContextMenuItem {
  return { id, label: '', separator: true, source };
}

function command(
  id: string,
  label: string,
  enabled: boolean,
  icon?: string,
): ContextMenuItem {
  return {
    id,
    label,
    source: 'vortex',
    command: id,
    enabled,
    icon: menuIcon(icon),
  };
}

/** Application commands. They do not depend on the host menu APIs. */
export function vortexItems(query: ContextMenuQuery): ContextMenuItem[] {
  if (query.kind === 'ssh') {
    return [
      command('vortex:terminal', 'Открыть терминал', true, 'terminal'),
      command('vortex:copy-address', 'Копировать адрес', true, 'copy'),
      separator('vortex:ssh-split', 'vortex'),
      command('vortex:disconnect', 'Отключиться', true),
    ];
  }
  if (query.kind === 'sftp' || query.kind === 'ftp') {
    const title = query.kind === 'sftp' ? 'SFTP' : 'FTP';
    return [
      command('vortex:open', 'Открыть', query.flags.open, 'file'),
      command('vortex:download', 'Скачать', query.flags.transfer, 'download'),
      command('vortex:upload', `Загрузить в ${title}`, true),
      separator('vortex:remote-edit', 'vortex'),
      command('vortex:rename', 'Переименовать', query.flags.rename, 'pencil'),
      command('vortex:copy', 'Копировать', query.flags.transfer, 'copy'),
      command('vortex:move', 'Переместить', query.flags.transfer),
      separator('vortex:remote-remove', 'vortex'),
      command('vortex:delete', 'Удалить', query.flags.remove, 'trash-2'),
      separator('vortex:remote-session', 'vortex'),
      command('vortex:copy-address', 'Копировать адрес', true, 'copy'),
      command('vortex:disconnect', 'Отключиться', true),
    ];
  }
  const openIcon = query.target.type === 'folder' ? 'folder-open' : query.target.type === 'file' ? 'file' : undefined;
  return [
    command('vortex:open', 'Открыть', query.flags.open, openIcon),
    command('vortex:open-tab', 'Открыть в новой вкладке', query.flags.openTab, 'folder'),
    separator('vortex:edit-split', 'vortex'),
    command('vortex:copy', 'Копировать', query.flags.copy, 'copy'),
    command('vortex:cut', 'Вырезать', query.flags.cut),
    command('vortex:paste', 'Вставить', query.flags.paste),
    command('vortex:rename', 'Переименовать', query.flags.rename, 'pencil'),
    command('vortex:delete', 'Удалить', query.flags.remove, 'trash-2'),
    command('vortex:create', 'Создать папку', query.flags.create, 'folder-plus'),
    command('vortex:properties', 'Свойства', Boolean(query.directory) || selectionPaths(query.target).length > 0, 'info'),
  ];
}

function systemCommands(items: readonly ContextMenuItem[]): ContextMenuItem[] {
  const commands: ContextMenuItem[] = [];
  for (const item of items) {
    if (item.separator) {
      if (commands.length > 0 && !commands[commands.length - 1]?.separator) commands.push(item);
      continue;
    }
    commands.push(item);
  }
  while (commands.at(-1)?.separator) commands.pop();
  return commands;
}

/** System commands for the file view. Vortex commands stay on the toolbar. */
export function systemMenuItems(items: readonly ContextMenuItem[]): ContextMenuItem[] {
  const next: ContextMenuItem[] = [];
  for (const item of items) {
    if (item.source === 'vortex') continue;
    if (item.separator) {
      if (next.length > 0 && !next[next.length - 1]?.separator) next.push(item);
      continue;
    }
    const children = item.children?.length ? systemMenuItems(item.children) : item.children;
    next.push(children === item.children ? item : { ...item, children });
  }
  while (next[0]?.separator) next.shift();
  while (next.at(-1)?.separator) next.pop();
  return next;
}

/** Vortex commands, then system commands, then Properties. */
export function composeMenu(application: readonly ContextMenuItem[], system: readonly ContextMenuItem[]): ContextMenuItem[] {
  const properties = application.filter((item) => item.command === 'vortex:properties');
  const head = application.filter((item) => item.command !== 'vortex:properties');
  const middle = systemCommands(system);
  const items = [...head];
  while (items.at(-1)?.separator) items.pop();
  if (middle.length > 0) {
    items.push(separator('vortex:system-split', 'vortex'));
    items.push(...middle);
  }
  if (properties.length > 0) {
    items.push(separator('vortex:properties-split', 'vortex'));
    items.push(...properties);
  }
  while (items[0]?.separator) items.shift();
  while (items.at(-1)?.separator) items.pop();
  return items;
}

export function collectCommands(items: readonly ContextMenuItem[]): string[] {
  const ids: string[] = [];
  for (const item of items) {
    if (item.command && item.source !== 'vortex') ids.push(item.command);
    if (item.children?.length) ids.push(...collectCommands(item.children));
  }
  return ids;
}

export function isVortexCommand(commandId: string): boolean {
  return commandId.startsWith('vortex:');
}
