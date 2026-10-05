import { execFile } from 'node:child_process';
import { release } from 'node:os';
import type { ContextMenuItem } from '../../shared/context-menu';
import type { ShellMenuNode } from '../../shared/ipc';

/** Verbs Windows 11 keeps on the short menu. The rest stays behind «Дополнительные параметры». */
const modernVerbs = new Set([
  'open',
  'openas',
  'openwith',
  'cut',
  'copy',
  'paste',
  'rename',
  'delete',
  'properties',
  'share',
  'windows.share',
  'pintohome',
  'pintostartscreen',
]);

let modeCache: { at: number; modern: boolean } | null = null;

export function compactShellMenu(nodes: readonly ShellMenuNode[]): ShellMenuNode[] {
  const next: ShellMenuNode[] = [];
  for (const node of nodes) {
    if (node.separator) {
      if (next.length > 0 && !next[next.length - 1]?.separator) next.push(node);
      continue;
    }
    const children = compactShellMenu(node.children);
    const verb = (node.verb ?? '').trim().toLowerCase();
    if (children.length > 0) next.push({ ...node, children, command: null });
    else if (modernVerbs.has(verb)) next.push({ ...node, children: [] });
  }
  while (next[0]?.separator) next.shift();
  while (next.at(-1)?.separator) next.pop();
  return next;
}

/** Windows 11 uses the short menu unless the classic-menu class id is installed. */
export function windowsUsesModernMenu(): Promise<boolean> {
  const parts = release().split('.');
  const build = Number(parts[2]);
  if (!(parts[0] === '10' && Number.isFinite(build) && build >= 22000)) return Promise.resolve(false);
  if (modeCache && Date.now() - modeCache.at < 2000) return Promise.resolve(modeCache.modern);
  return new Promise((resolve) => {
    execFile(
      'reg',
      ['query', 'HKCU\\Software\\Classes\\CLSID\\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}'],
      { windowsHide: true },
      (error) => {
        const modern = Boolean(error);
        modeCache = { at: Date.now(), modern };
        resolve(modern);
      },
    );
  });
}

const verbIcons: Record<string, string> = {
  open: 'menu-open',
  openas: 'menu-apps',
  openwith: 'menu-apps',
  cut: 'menu-cut',
  copy: 'copy',
  paste: 'menu-paste',
  rename: 'pencil',
  delete: 'trash-2',
  properties: 'menu-properties',
  share: 'menu-share',
  'windows.share': 'menu-share',
  pintohome: 'menu-star',
  pintostartscreen: 'pin',
  copyaspath: 'menu-link',
  'windows.copyaspath': 'menu-link',
  extract: 'menu-archive',
  extractall: 'menu-archive',
  compress: 'menu-archive',
  explore: 'folder-open',
  find: 'search',
  edit: 'pencil',
};

const barOrder = ['cut', 'copy', 'paste', 'rename', 'share', 'delete'] as const;

export function verbIcon(verb: string | undefined): string | undefined {
  const key = (verb ?? '').trim().toLowerCase();
  return key ? verbIcons[key] : undefined;
}

/** Gives every row an icon. Unknown shell commands use a neutral mark so the column stays even. */
export function paintMenuIcons(items: readonly ContextMenuItem[]): ContextMenuItem[] {
  return items.map((item) => {
    const children = item.children?.length ? paintMenuIcons(item.children) : item.children;
    if (item.separator) return children === item.children ? item : { ...item, children };
    const icon = item.icon ?? verbIcon(item.verb) ?? 'menu-item';
    if (icon === item.icon && children === item.children) return item;
    return { ...item, icon, children };
  });
}

/** Puts cut, copy, paste, rename, share and delete on the bottom row of the short menu. */
export function withCommandBar(items: readonly ContextMenuItem[]): ContextMenuItem[] {
  const bar = new Map<string, ContextMenuItem>();
  const rows: ContextMenuItem[] = [];
  for (const item of items) {
    const verb = (item.verb ?? '').trim().toLowerCase();
    const barVerb = (barOrder as readonly string[]).includes(verb);
    if (barVerb && !item.separator && !item.children?.length && !bar.has(verb)) {
      bar.set(verb, { ...item, bar: true, icon: verbIcon(verb) ?? item.icon });
      continue;
    }
    rows.push(item);
  }
  const cleaned: ContextMenuItem[] = [];
  for (const item of rows) {
    if (item.separator && (cleaned.length === 0 || cleaned.at(-1)?.separator)) continue;
    cleaned.push(item);
  }
  while (cleaned[0]?.separator) cleaned.shift();
  while (cleaned.at(-1)?.separator) cleaned.pop();
  const strip = barOrder.flatMap((verb) => {
    const item = bar.get(verb);
    return item ? [item] : [];
  });
  return [...cleaned, ...strip];
}

export function classicMenuItem(): ContextMenuItem {
  return {
    id: 'shell:classic',
    label: 'Дополнительные параметры',
    source: 'windows-shell',
    command: 'shell:classic',
    icon: 'menu-more',
    enabled: true,
  };
}

export interface WindowsModernReport {
  build: number | null;
  windows11: boolean;
  /** Commands this provider can add. Empty: the compact menu is not a public list. */
  items: ContextMenuItem[];
  available: readonly string[];
  unavailable: readonly string[];
  classicTransition: string;
  icons: string;
}

/**
 * Windows 11 draws its compact menu inside Explorer.
 * Documented integration for another file manager is the classic shell menu
 * (`IShellFolder`, `IContextMenu`, `IContextMenu2`, `IContextMenu3`).
 * `IExplorerCommand` is the interface an application implements to add a command.
 * There is no documented call that returns Explorer's compact menu for a selection.
 */
export function windowsModernReport(release: string): WindowsModernReport {
  const parts = release.split('.');
  const build = Number(parts[2]);
  const windows11 = parts[0] === '10' && Number.isFinite(build) && build >= 22000;
  return {
    build: Number.isFinite(build) ? build : null,
    windows11,
    items: [],
    available: [
      'IShellFolder, PIDL, IContextMenu, IContextMenu2, IContextMenu3',
      'QueryContextMenu and InvokeCommand, including installed shell extensions',
      'CMF_EXTENDEDVERBS when Shift is held',
      'Canonical verbs through InvokeCommand, identified by the shell rather than by label',
    ],
    unavailable: [
      'Explorer compact menu: which commands it shows and which it hides',
      'Share, and other commands that exist only in the Explorer frame',
      'A public enumerator of IExplorerCommand for an arbitrary file',
      'The undocumented decision behind Show more options',
    ],
    classicTransition:
      'Show more options and Shift+F10 are Explorer actions. They open the classic IContextMenu. Vortex requests that menu directly.',
    icons:
      'Classic items often have no bitmap, or an owner-drawn callback. Handles stay in the shell process. The view receives an icon only when it is a VUI icon name.',
  };
}

export function windowsModernItems(): readonly ContextMenuItem[] {
  return windowsModernReport('10.0.0').items;
}
