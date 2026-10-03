import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { copyPaths, createDirectory, listDirectory, movePaths, removePaths, renamePath } from '../src/main/filesystem/local';
import { crumbs, displayName, formatSize, parentPath, singleSegment, sortEntries, type FileEntry } from '../src/shared/files';
import { expandEnv, parseNetView, parseRegistryValues } from '../src/main/platform/windows';

describe('paths', () => {
  it('walks parents and crumbs without treating a root as a child', () => {
    expect(parentPath('/')).toBeNull();
    expect(parentPath('/home/vegas')).toBe('/home');
    expect(parentPath('C:\\Users\\vegas')).toBe('C:\\Users');
    expect(parentPath('C:\\Users')).toBe('C:\\');
    expect(crumbs('/home/vegas').map((item) => item.path)).toEqual(['/', '/home', '/home/vegas']);
    expect(crumbs('C:\\Users\\vegas').map((item) => item.label)).toEqual(['C:\\', 'Users', 'vegas']);
    expect(parentPath('\\\\host\\share')).toBe('\\\\host');
    expect(parentPath('\\\\host')).toBe('\\\\');
    expect(crumbs('\\\\host\\share').map((item) => item.path)).toEqual(['\\\\', '\\\\host', '\\\\host\\share']);
    expect(displayName('note.txt', 'file', false)).toBe('note');
    expect(displayName('archive.tar.gz', 'file', false)).toBe('archive.tar');
    expect(displayName('.secret', 'file', false)).toBe('.secret');
    expect(displayName('dir', 'directory', false)).toBe('dir');
  });

  it('reads Windows shell folders, network hosts, and expanded paths', () => {
    expect(expandEnv('%USERPROFILE%\\Desktop', { USERPROFILE: 'C:\\Users\\vegas' })).toBe('C:\\Users\\vegas\\Desktop');
    const folders = parseRegistryValues(
      'HKEY_CURRENT_USER\\Software\n    Desktop    REG_EXPAND_SZ    %USERPROFILE%\\Desktop\n    Personal    REG_SZ    D:\\Docs\n',
    );
    expect(folders.get('Desktop')).toBe('%USERPROFILE%\\Desktop');
    expect(folders.get('Personal')).toBe('D:\\Docs');
    expect(parseNetView('Server Name\n-------------------------------------------------------------------------------\n\\\\OFFICE    Files\nThe command completed successfully.\n')).toEqual(['OFFICE']);
  });

  it('rejects path segments and sorts directories first', () => {
    expect(() => singleSegment('../etc')).toThrow(/Недопустимое имя/);
    expect(singleSegment(' notes ')).toBe('notes');
    const entries: FileEntry[] = [
      { name: 'b.txt', path: '/b.txt', kind: 'file', size: 1, modified: null, hidden: false },
      { name: 'a', path: '/a', kind: 'directory', size: null, modified: null, hidden: false },
    ];
    expect(sortEntries(entries).map((entry) => entry.name)).toEqual(['a', 'b.txt']);
    expect(formatSize(1536, 'file')).toBe('1.5 КБ');
    expect(formatSize(null, 'directory')).toBe('');
  });
});

describe('local filesystem', () => {
  it('lists, creates, renames, copies, moves, and deletes inside a temporary directory', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'vortex-'));
    await writeFile(path.join(root, 'note.txt'), 'hello');
    await writeFile(path.join(root, '.secret'), 'hidden');
    await mkdir(path.join(root, 'dir'));

    const visible = await listDirectory(root, false);
    expect(visible.entries.map((entry) => entry.name)).toEqual(['dir', 'note.txt']);
    const all = await listDirectory(root, true);
    expect(all.entries.some((entry) => entry.name === '.secret' && entry.hidden)).toBe(true);

    const created = await createDirectory(root, 'next');
    expect(created.endsWith(`${path.sep}next`)).toBe(true);
    const renamed = await renamePath(path.join(root, 'note.txt'), 'renamed.txt');
    const destination = path.join(root, 'dir');
    await copyPaths([renamed], destination);
    expect((await listDirectory(destination, false)).entries.map((entry) => entry.name)).toEqual(['renamed.txt']);
    await movePaths([created], destination);
    await expect(copyPaths([path.join(root, 'dir')], path.join(root, 'dir'))).rejects.toThrow(/внутрь самого себя/);
    await removePaths([path.join(destination, 'renamed.txt'), path.join(destination, 'next')]);
    expect((await listDirectory(destination, false)).entries).toEqual([]);
  });
});
