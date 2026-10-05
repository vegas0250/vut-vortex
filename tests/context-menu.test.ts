import { describe, expect, it } from 'vitest';
import {
  classifySelection,
  composeMenu,
  contextCacheKey,
  desktopId,
  isVortexCommand,
  menuIcon,
  systemMenuItems,
  vortexItems,
  type ContextMenuItem,
  type ContextMenuQuery,
} from '../src/shared/context-menu';
import { linuxCapabilities, desktopAllows, expandExec, mimeForPath, mimeMatches, parseDesktopEntry, parseMimeGlobs, parseServiceMenu, selectionFiles, linuxMenuItems } from '../src/main/context-menu/linux-menu';
import { windowsModernItems, windowsModernReport, withCommandBar } from '../src/main/context-menu/modern';
import { createContextMenuService, type SystemMenuProvider } from '../src/main/context-menu/service';
import { shellNodesToItems } from '../src/main/context-menu/shell-nodes';
import { executeRequest, contextQuery } from '../src/main/ipc';
import type { ShellMenuNode } from '../src/shared/ipc';

function query(patch: Partial<ContextMenuQuery> = {}): ContextMenuQuery {
  return {
    target: { type: 'file', paths: ['/tmp/note.txt'] },
    folders: [],
    directory: '/tmp',
    extended: false,
    kind: 'local',
    flags: {
      open: true,
      openTab: false,
      copy: true,
      cut: true,
      paste: false,
      rename: true,
      remove: true,
      create: true,
      transfer: true,
    },
    ...patch,
  };
}

function provider(system: () => Promise<ContextMenuItem[]>, replacesSession = false): SystemMenuProvider & { executed: string[] } {
  const commands = new Map<string, boolean>();
  const executed: string[] = [];
  return {
    id: 'linux',
    replacesSession,
    executed,
    warm: async () => undefined,
    get: async () => {
      const items = await system();
      for (const item of items) {
        if (item.command) commands.set(item.command, true);
      }
      return items;
    },
    execute: async (commandId: string) => {
      if (!commands.has(commandId)) return false;
      executed.push(commandId);
      return true;
    },
    forget: (ids) => {
      for (const id of ids) commands.delete(id);
    },
    release: async () => {
      commands.clear();
    },
    shutdown: async () => undefined,
  };
}

describe('selection', () => {
  it('classifies a file, a folder, several files, a mix, and empty space', () => {
    expect(classifySelection([{ path: '/a/file.txt', kind: 'file', name: 'file.txt' }], '/a')).toEqual({
      type: 'file',
      paths: ['/a/file.txt'],
    });
    expect(classifySelection([{ path: '/a/Docs', kind: 'directory', name: 'Docs' }], '/a')).toEqual({
      type: 'folder',
      paths: ['/a/Docs'],
    });
    expect(classifySelection([
      { path: '/a/a.txt', kind: 'file', name: 'a.txt' },
      { path: '/a/b.txt', kind: 'file', name: 'b.txt' },
      { path: '/a/c.jpg', kind: 'file', name: 'c.jpg' },
    ], '/a').type).toBe('file');
    expect(classifySelection([
      { path: '/a/file.txt', kind: 'file', name: 'file.txt' },
      { path: '/a/folder', kind: 'directory', name: 'folder' },
    ], '/a').type).toBe('mixed');
    expect(classifySelection([], '/a')).toEqual({ type: 'background', directory: '/a' });
    expect(classifySelection([{ path: '/a', kind: 'directory', name: '..' }], '/a').type).toBe('background');
  });

  it('does not reuse a one-file key for several files or another extension', () => {
    const one = contextCacheKey('linux', 'gnome', query());
    const many = contextCacheKey('linux', 'gnome', query({ target: { type: 'file', paths: ['/tmp/a.txt', '/tmp/b.txt'] } }));
    const image = contextCacheKey('linux', 'gnome', query({ target: { type: 'file', paths: ['/tmp/c.jpg'] } }));
    const background = contextCacheKey('linux', 'gnome', query({ target: { type: 'background', directory: '/tmp' } }));
    const shifted = contextCacheKey('linux', 'gnome', query({ extended: true }));
    expect(new Set([one, many, image, background, shifted]).size).toBe(5);
    expect(desktopId({ XDG_CURRENT_DESKTOP: 'ubuntu:GNOME' })).toBe('ubuntu');
  });
});

describe('vortex commands', () => {
  it('builds one menu for local files and keeps properties last', () => {
    const items = composeMenu(vortexItems(query()), [
      { id: 'sys:zip', label: 'Extract', source: 'windows-shell', command: 'sys:zip' },
    ]);
    const labels = items.filter((item) => !item.separator).map((item) => item.label);
    expect(labels[0]).toBe('Открыть');
    expect(labels).toContain('Создать папку');
    expect(labels).toContain('Extract');
    expect(labels.at(-1)).toBe('Свойства');
    const system = systemMenuItems(items);
    expect(system.map((item) => item.label)).toEqual(['Extract']);
    expect(system.every((item) => item.source !== 'vortex')).toBe(true);
    expect(items.find((item) => item.label === 'Удалить')?.icon).toBe('trash-2');
    expect(menuIcon('C:\\Windows\\notepad.exe')).toBeUndefined();
    expect(menuIcon('trash-2')).toBe('trash-2');
  });

  it('disables edit commands on empty space and enables paste when asked', () => {
    const background = vortexItems(query({
      target: { type: 'background', directory: '/tmp' },
      flags: { ...query().flags, open: false, copy: false, cut: false, rename: false, remove: false, paste: true },
    }));
    expect(background.find((item) => item.command === 'vortex:open')?.enabled).toBe(false);
    expect(background.find((item) => item.command === 'vortex:paste')?.enabled).toBe(true);
    expect(background.find((item) => item.command === 'vortex:create')?.enabled).toBe(true);
  });

  it('uses the same command ids for a remote session', () => {
    const ssh = vortexItems(query({ kind: 'ssh' }));
    expect(ssh.map((item) => item.command).filter(Boolean)).toEqual([
      'vortex:terminal',
      'vortex:copy-address',
      'vortex:disconnect',
    ]);
    expect(ssh.every((item) => item.source === 'vortex' || item.separator)).toBe(true);
  });
});

describe('context menu service', () => {
  it('falls back to vortex commands when the system provider fails', async () => {
    const system = provider(async () => {
      throw new Error('shell down');
    });
    const service = createContextMenuService(system, 'linux', {}, () => undefined, () => 0);
    const first = await service.get(query());
    expect(first.items.some((item) => item.command === 'vortex:open')).toBe(true);
    expect(first.items.some((item) => item.source === 'linux-system')).toBe(false);
    const second = await service.get(query());
    expect(second.timing.cached).toBe(false);
  });

  it('caches a successful menu and rejects a command from outside that session', async () => {
    let reads = 0;
    const system = provider(async () => {
      reads += 1;
      return [{ id: 'sys:ready', label: 'Archive', source: 'extension', command: 'sys:ready' }];
    });
    let clock = 1_000;
    const service = createContextMenuService(system, 'linux', { XDG_CURRENT_DESKTOP: 'KDE' }, () => undefined, () => clock);
    const first = await service.get(query());
    const second = await service.get(query());
    expect(reads).toBe(1);
    expect(second.timing.cached).toBe(true);
    expect(second.session).toBe(first.session);
    expect(await service.execute(first.session, 'sys:ready')).toBe(true);
    expect(await service.execute(first.session, 'sys:ready')).toBe(false);
    expect(await service.execute('ses:other', 'sys:ready')).toBe(false);
    expect(await service.execute(first.session, 'vortex:delete')).toBe(false);
    expect(isVortexCommand('vortex:delete')).toBe(true);
    clock += 20_000;
    await service.get(query());
    expect(reads).toBe(2);
  });

  it('drops a command after the selection that owned it was replaced', async () => {
    const system = provider(async () => [{ id: 'sys:one', label: 'One', source: 'windows-shell', command: 'sys:one' }], true);
    const service = createContextMenuService(system, 'win32', {}, () => undefined, () => 5);
    const file = await service.get(query());
    await service.get(query({ target: { type: 'file', paths: ['/tmp/other.txt'] } }));
    expect(await service.execute(file.session, 'sys:one')).toBe(false);
  });
});

describe('windows shell model', () => {
  it('keeps submenus and drops a command index from the view model', () => {
    const nodes: ShellMenuNode[] = [
      { label: 'Open', shortcut: 'Enter', separator: false, disabled: false, checked: false, command: 0, children: [] },
      { label: '', shortcut: '', separator: true, disabled: false, checked: false, command: null, children: [] },
      {
        label: '7-Zip',
        shortcut: '',
        separator: false,
        disabled: false,
        checked: false,
        command: null,
        children: [
          { label: 'Extract', shortcut: '', separator: false, disabled: false, checked: false, command: 4, children: [] },
        ],
      },
      { label: 'Gone', shortcut: '', separator: false, disabled: true, checked: false, command: null, children: [] },
    ];
    const bound: number[] = [];
    const items = shellNodesToItems(nodes, (command) => {
      bound.push(command);
      return `sys:${command}`;
    });
    expect(bound).toEqual([0, 4]);
    expect(items.filter((item) => !item.separator).map((item) => item.label)).toEqual(['Open', '7-Zip']);
    expect(items[2]?.children?.[0]?.command).toBe('sys:4');
    expect(items[2]?.children?.[0]?.source).toBe('windows-shell');
    expect(JSON.stringify(items)).not.toContain('HMENU');
  });

  it('keeps the short list and moves edit verbs onto the command bar', () => {
    const row = (verb: string, label: string): ContextMenuItem => ({
      id: verb,
      label,
      source: 'windows-shell',
      command: `sys:${verb}`,
      verb,
    });
    const items = withCommandBar([
      row('open', 'Открыть'),
      row('copy', 'Копировать'),
      row('delete', 'Удалить'),
      { id: 'shell:classic', label: 'Дополнительные параметры', source: 'windows-shell', command: 'shell:classic', icon: 'menu-more' },
    ]);
    expect(items.filter((item) => !item.bar).map((item) => item.label)).toEqual(['Открыть', 'Дополнительные параметры']);
    expect(items.filter((item) => item.bar).map((item) => item.verb)).toEqual(['copy', 'delete']);
    expect(items.find((item) => item.verb === 'copy')?.icon).toBe('copy');
  });

  it('reports the modern menu as unavailable through the public API and adds no items', () => {
    const report = windowsModernReport('10.0.22631');
    expect(report.windows11).toBe(true);
    expect(report.items).toEqual([]);
    expect(windowsModernItems()).toEqual([]);
    expect(report.unavailable.some((line) => line.includes('IExplorerCommand'))).toBe(true);
    expect(report.available.some((line) => line.includes('IContextMenu'))).toBe(true);
    expect(report.classicTransition.length).toBeGreaterThan(10);
    expect(windowsModernReport('10.0.19045').windows11).toBe(false);
  });
});

describe('linux menus', () => {
  const desktopFile = `
[Desktop Entry]
Type=Application
Name=Archive tool
Name[ru]=Архиватор
Exec=ark --extract %F
MimeType=application/zip;
OnlyShowIn=KDE;
`.trim();

  const serviceFile = `
[Desktop Entry]
Type=Service
MimeType=application/zip;
Actions=extract;
X-KDE-ServiceTypes=KonqPopupMenu/Plugin

[Desktop Action extract]
Name=Extract here
Exec=ark --batch %F
`.trim();

  it('reads desktop files, service menus, and mime globs', () => {
    const app = parseDesktopEntry(desktopFile);
    expect(app?.name).toBe('Архиватор');
    expect(parseServiceMenu(serviceFile).map((item) => item.name)).toEqual(['Extract here']);
    const globs = parseMimeGlobs('50:application/zip:*.zip\n*.txt:text/plain\n');
    expect(mimeForPath('/tmp/a.zip', false, globs)).toBe('application/zip');
    expect(mimeForPath('/tmp/a.txt', false, globs)).toBe('text/plain');
    expect(mimeMatches('image/png', 'image/*', false)).toBe(true);
    expect(desktopAllows(['KDE'], [], 'ubuntu:GNOME')).toBe(false);
    expect(desktopAllows(['KDE'], [], 'KDE')).toBe(true);
  });

  it('expands field codes without a shell and refuses several files for %f', () => {
    expect(expandExec('ark --extract %F', ['/tmp/a.zip', '/tmp/b.zip'])).toEqual([
      'ark',
      '--extract',
      '/tmp/a.zip',
      '/tmp/b.zip',
    ]);
    expect(expandExec('viewer %f', ['/tmp/a.zip', '/tmp/b.zip'])).toBeNull();
    expect(expandExec('tool "two words" %%', ['/tmp/a.zip'])).toEqual(['tool', 'two words', '%']);
    expect(expandExec('danger %(', ['/tmp/a.zip'])).toBeNull();
  });

  it('detects capabilities and builds items from the index', () => {
    const caps = linuxCapabilities({
      desktop: 'GNOME',
      applicationCount: 2,
      serviceCount: 0,
      gio: true,
      xdgOpen: true,
      mimeGlobs: true,
    });
    expect(caps.gnome).toBe(true);
    expect(caps.nautilusExtensions).toBe(false);
    expect(caps.freedesktop).toBe(true);
    const kde = linuxCapabilities({
      desktop: 'KDE',
      applicationCount: 0,
      serviceCount: 1,
      gio: false,
      xdgOpen: true,
      mimeGlobs: false,
    });
    expect(kde.kde).toBe(true);
    const current = query();
    const files = selectionFiles(current, new Map([['txt', 'text/plain']]));
    const bound = new Map<string, string[]>();
    const items = linuxMenuItems(current, {
      applications: [parseDesktopEntry('[Desktop Entry]\nType=Application\nName=Editor\nExec=editor %f\nMimeType=text/plain;\n')].filter((entry): entry is NonNullable<typeof entry> => entry !== null),
      services: parseServiceMenu(serviceFile),
      xdgOpen: true,
    }, 'KDE', files, () => `sys:${bound.size + 1}`, (id, argv) => bound.set(id, argv));
    expect(items.some((item) => item.label === 'Открыть с помощью')).toBe(true);
    expect(items.some((item) => item.source === 'linux-system')).toBe(true);
    expect([...bound.values()].some((argv) => argv[0] === 'xdg-open')).toBe(true);
  });
});

describe('ipc guards', () => {
  it('accepts a query and rejects a vortex id or a raw shell string', () => {
    const parsed = contextQuery(query());
    expect(parsed.target).toEqual({ type: 'file', paths: ['/tmp/note.txt'] });
    expect(executeRequest({ session: 'ses:abc', commandId: 'sys:abc' })).toEqual({
      session: 'ses:abc',
      commandId: 'sys:abc',
    });
    expect(() => executeRequest({ session: 'ses:abc', commandId: 'vortex:delete' })).toThrow(/команда/i);
    expect(() => executeRequest({ session: 'ses:abc', commandId: 'rm -rf /' })).toThrow(/команда/i);
    expect(() => contextQuery({ kind: 'local', target: { type: 'nope' } })).toThrow(/меню/i);
  });
});
