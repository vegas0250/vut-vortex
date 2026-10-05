import { extensionOf } from '../../shared/context-menu';
import type { ContextMenuItem, ContextMenuQuery } from '../../shared/context-menu';

export interface DesktopEntry {
  name: string;
  exec: string;
  mimes: string[];
  onlyShowIn: string[];
  notShowIn: string[];
}

export interface ServiceEntry {
  menu: string;
  name: string;
  exec: string;
  mimes: string[];
  onlyShowIn: string[];
  notShowIn: string[];
}

export interface LinuxIndex {
  applications: DesktopEntry[];
  services: ServiceEntry[];
  xdgOpen: boolean;
}

export interface LinuxCapabilities {
  desktop: string;
  freedesktop: boolean;
  gio: boolean;
  kde: boolean;
  gnome: boolean;
  xfce: boolean;
  nautilusExtensions: false;
  xdgOpen: boolean;
  notes: readonly string[];
}

interface Group {
  name: string;
  values: Map<string, string>;
}

function unescape(value: string): string {
  return value.replace(/\\s/g, ' ').replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\');
}

function groupsOf(text: string): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const header = line.match(/^\[(.+)]$/);
    if (header) {
      current = { name: header[1] ?? '', values: new Map() };
      groups.push(current);
      continue;
    }
    if (!current) continue;
    const split = line.indexOf('=');
    if (split <= 0) continue;
    current.values.set(line.slice(0, split).trim(), unescape(line.slice(split + 1).trim()));
  }
  return groups;
}

function localized(values: Map<string, string>, key: string): string {
  return values.get(`${key}[ru]`) || values.get(key) || '';
}

function list(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(';').map((item) => item.trim()).filter(Boolean);
}

function flag(values: Map<string, string>, key: string): boolean {
  return values.get(key)?.toLowerCase() === 'true';
}

export function parseDesktopEntry(text: string): DesktopEntry | null {
  const group = groupsOf(text).find((item) => item.name === 'Desktop Entry');
  if (!group) return null;
  if (flag(group.values, 'NoDisplay') || flag(group.values, 'Hidden')) return null;
  const type = group.values.get('Type') ?? 'Application';
  if (type !== 'Application') return null;
  const name = localized(group.values, 'Name');
  const exec = group.values.get('Exec') ?? '';
  if (!name || !exec) return null;
  return {
    name,
    exec,
    mimes: list(group.values.get('MimeType')),
    onlyShowIn: list(group.values.get('OnlyShowIn')),
    notShowIn: list(group.values.get('NotShowIn')),
  };
}

export function parseServiceMenu(text: string): ServiceEntry[] {
  const groups = groupsOf(text);
  const root = groups.find((item) => item.name === 'Desktop Entry');
  if (!root) return [];
  const service = root.values.get('Type') === 'Service'
    || (root.values.get('ServiceTypes') ?? '').includes('KonqPopupMenu')
    || (root.values.get('X-KDE-ServiceTypes') ?? '').includes('KonqPopupMenu');
  if (!service) return [];
  const mimes = list(root.values.get('MimeType'));
  const onlyShowIn = list(root.values.get('OnlyShowIn'));
  const notShowIn = list(root.values.get('NotShowIn'));
  const menu = localized(root.values, 'Name') || localized(root.values, 'X-KDE-Submenu') || 'Действия';
  const actions = list(root.values.get('Actions'));
  const entries: ServiceEntry[] = [];
  if (!actions.length) {
    const exec = root.values.get('Exec') ?? '';
    const name = localized(root.values, 'Name');
    if (name && exec) entries.push({ menu: name, name, exec, mimes, onlyShowIn, notShowIn });
    return entries;
  }
  for (const action of actions) {
    const group = groups.find((item) => item.name === `Desktop Action ${action}`);
    if (!group) continue;
    const name = localized(group.values, 'Name');
    const exec = group.values.get('Exec') ?? '';
    if (!name || !exec) continue;
    entries.push({ menu, name, exec, mimes, onlyShowIn, notShowIn });
  }
  return entries;
}

export function parseMimeGlobs(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const weight = line.match(/^\d+:([^:]+):(\*\.[A-Za-z0-9._+-]+)$/);
    if (weight) {
      const mime = weight[1] ?? '';
      const pattern = weight[2] ?? '';
      const extension = pattern.slice(2).toLowerCase();
      if (extension && mime && !map.has(extension)) map.set(extension, mime);
      continue;
    }
    const plain = line.match(/^(\*\.[A-Za-z0-9._+-]+)[:\s]+(\S+)$/);
    if (!plain) continue;
    const extension = (plain[1] ?? '').slice(2).toLowerCase();
    const mime = plain[2] ?? '';
    if (extension && mime && !map.has(extension)) map.set(extension, mime);
  }
  return map;
}

export function mimeForPath(filePath: string, directory: boolean, globs: ReadonlyMap<string, string>): string {
  if (directory) return 'inode/directory';
  const extension = extensionOf(filePath);
  if (!extension) return 'application/octet-stream';
  return globs.get(extension.slice(1)) ?? 'application/octet-stream';
}

export function mimeMatches(mime: string, pattern: string, directory: boolean): boolean {
  if (pattern === 'all/all' || pattern === '*') return true;
  if (pattern === 'all/allfiles') return !directory;
  if (pattern.endsWith('/*')) return mime.startsWith(pattern.slice(0, -1));
  return mime === pattern;
}

export function desktopAllows(onlyShowIn: readonly string[], notShowIn: readonly string[], desktop: string): boolean {
  const tokens = desktop.split(':').map((item) => item.trim().toLowerCase()).filter(Boolean);
  const blocked = notShowIn.some((item) => tokens.includes(item.toLowerCase()));
  if (blocked) return false;
  if (!onlyShowIn.length) return true;
  return onlyShowIn.some((item) => tokens.includes(item.toLowerCase()));
}

interface ExecToken {
  text: string;
  codes: string[];
}

/** Splits a desktop Exec value. The result is an argument list, not a shell command. */
export function splitExec(exec: string): ExecToken[] {
  const tokens: ExecToken[] = [];
  let current = '';
  let codes: string[] = [];
  let quote: '"' | "'" | '' = '';
  for (let index = 0; index < exec.length; index += 1) {
    const symbol = exec[index];
    if (symbol === undefined) continue;
    if (quote) {
      if (symbol === quote) {
        quote = '';
        continue;
      }
      if (symbol === '\\' && quote === '"' && index + 1 < exec.length) {
        current += exec[index + 1];
        index += 1;
        continue;
      }
      current += symbol;
      continue;
    }
    if (symbol === '"' || symbol === "'") {
      quote = symbol;
      continue;
    }
    if (symbol === '\\' && index + 1 < exec.length) {
      current += exec[index + 1];
      index += 1;
      continue;
    }
    if (symbol === ' ' || symbol === '\t') {
      if (current.length > 0 || codes.length > 0) tokens.push({ text: current, codes });
      current = '';
      codes = [];
      continue;
    }
    if (symbol === '%' && index + 1 < exec.length) {
      const code = exec[index + 1] ?? '';
      if (code === '%') {
        current += '%';
        index += 1;
        continue;
      }
      codes.push(code);
      index += 1;
      continue;
    }
    current += symbol;
  }
  if (current.length > 0 || codes.length > 0) tokens.push({ text: current, codes });
  return tokens;
}

function fileUri(filePath: string): string {
  const encoded = filePath.split('/').map((part) => encodeURIComponent(part)).join('/');
  return `file://${encoded.startsWith('/') ? '' : '/'}${encoded}`;
}

/**
 * Expands desktop field codes. Returns null when the command expects one file and several are selected.
 * Unknown codes are rejected so a desktop file cannot smuggle an unparsed instruction.
 */
export function expandExec(exec: string, files: readonly string[], name = ''): string[] | null {
  if (files.some((file) => file.includes('\0'))) return null;
  const tokens = splitExec(exec);
  const multiple = files.length !== 1;
  const argv: string[] = [];
  for (const token of tokens) {
    const meaningful = token.codes.filter((code) => !'iconkdDnN'.includes(code) && code !== 'c' && code !== 'k');
    if (meaningful.some((code) => !'fFuU'.includes(code))) return null;
    if (multiple && meaningful.some((code) => code === 'f' || code === 'u')) return null;
    let text = token.text;
    const extras: string[] = [];
    for (const code of token.codes) {
      if (code === 'c') text += name;
      if (code === 'f' && files[0]) extras.push(files[0]);
      if (code === 'u' && files[0]) extras.push(fileUri(files[0]));
      if (code === 'F') extras.push(...files);
      if (code === 'U') extras.push(...files.map(fileUri));
    }
    if (text.includes('\0')) return null;
    if (text.length > 0) argv.push(text);
    for (const extra of extras) argv.push(extra);
  }
  if (!argv.length || argv[0]?.includes('\0')) return null;
  return argv;
}

export function selectionFiles(
  query: ContextMenuQuery,
  globs: ReadonlyMap<string, string>,
): { path: string; mime: string; directory: boolean }[] {
  if (query.target.type === 'background') {
    if (!query.directory) return [];
    return [{ path: query.directory, mime: 'inode/directory', directory: true }];
  }
  const folders = new Set(query.folders);
  return query.target.paths.map((filePath) => {
    const directory = folders.has(filePath) || query.target.type === 'folder';
    return { path: filePath, mime: mimeForPath(filePath, directory, globs), directory };
  });
}

function matchesAll(
  mimes: readonly string[],
  files: readonly { mime: string; directory: boolean }[],
): boolean {
  if (!mimes.length) return false;
  return files.every((file) => mimes.some((pattern) => mimeMatches(file.mime, pattern, file.directory)));
}

export function linuxCapabilities(input: {
  desktop: string;
  applicationCount: number;
  serviceCount: number;
  gio: boolean;
  xdgOpen: boolean;
  mimeGlobs: boolean;
}): LinuxCapabilities {
  const desktop = input.desktop.toLowerCase();
  const gnome = desktop.includes('gnome');
  const kde = desktop.includes('kde') || input.serviceCount > 0;
  const xfce = desktop.includes('xfce');
  return {
    desktop: desktop || 'unknown',
    freedesktop: input.applicationCount > 0 || input.mimeGlobs || input.xdgOpen,
    gio: input.gio,
    kde,
    gnome,
    xfce,
    nautilusExtensions: false,
    xdgOpen: input.xdgOpen,
    notes: [
      'Open With comes from desktop files and shared-mime-info, on every freedesktop environment.',
      'KDE service menus are read from kio/servicemenus and kservices5/kservices6 ServiceMenus.',
      'Nautilus extensions run inside Nautilus and have no API for another file manager.',
      'XFCE uses the same desktop files. Thunar is not a required host.',
    ],
  };
}

export function linuxMenuItems(
  query: ContextMenuQuery,
  index: LinuxIndex,
  desktop: string,
  files: readonly { path: string; mime: string; directory: boolean }[],
  mint: () => string,
  bind: (id: string, argv: string[]) => void,
): ContextMenuItem[] {
  const paths = files.map((file) => file.path);
  const applications = index.applications.filter((entry) =>
    desktopAllows(entry.onlyShowIn, entry.notShowIn, desktop)
    && matchesAll(entry.mimes, files)
    && expandExec(entry.exec, paths, entry.name),
  );
  const items: ContextMenuItem[] = [];
  if (applications.length > 0 && query.target.type !== 'background') {
    const children: ContextMenuItem[] = [];
    for (const entry of applications.slice(0, 12)) {
      const argv = expandExec(entry.exec, paths, entry.name);
      if (!argv) continue;
      const id = mint();
      bind(id, argv);
      children.push({
        id,
        label: entry.name,
        source: 'linux-system',
        command: id,
      });
    }
    if (children.length > 0) {
      items.push({
        id: mint(),
        label: 'Открыть с помощью',
        source: 'linux-system',
        children,
      });
    }
  }
  if (index.xdgOpen && paths.length === 1) {
    const argv = expandExec('xdg-open %f', paths, 'xdg-open');
    if (argv) {
      const id = mint();
      bind(id, argv);
      items.push({
        id,
        label: 'Открыть стандартным приложением',
        source: 'linux-system',
        command: id,
      });
    }
  }
  const grouped = new Map<string, ContextMenuItem[]>();
  for (const entry of index.services) {
    if (!desktopAllows(entry.onlyShowIn, entry.notShowIn, desktop)) continue;
    if (!matchesAll(entry.mimes, files)) continue;
    const argv = expandExec(entry.exec, paths, entry.name);
    if (!argv) continue;
    const id = mint();
    bind(id, argv);
    const child: ContextMenuItem = {
      id,
      label: entry.name,
      source: 'extension',
      command: id,
    };
    const listForMenu = grouped.get(entry.menu) ?? [];
    listForMenu.push(child);
    grouped.set(entry.menu, listForMenu);
  }
  for (const [menu, children] of grouped) {
    if (children.length === 1 && children[0]) {
      items.push({ ...children[0], label: children[0].label });
      continue;
    }
    items.push({
      id: mint(),
      label: menu,
      source: 'extension',
      children,
    });
  }
  return items;
}
