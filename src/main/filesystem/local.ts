import { lstat, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { cp } from 'node:fs/promises';
import path from 'node:path';
import { includeListed, parentPath, separatorOf, sortEntries, type DirectoryPage, type FileEntry, type FileKind, type LocationIndex } from '../../shared/files';
import { singleSegment } from '../../shared/files';
import { locationPlaces, platform } from '../platform/index';

const STAT_CONCURRENCY = 32;

export function absolutePath(input: unknown): string {
  if (typeof input !== 'string' || input.length === 0 || input.includes('\0')) {
    throw new Error('Недопустимый путь');
  }
  return path.resolve(input);
}

function kindOf(entry: { isDirectory(): boolean; isSymbolicLink(): boolean; isFile(): boolean }): FileKind {
  if (entry.isSymbolicLink()) return 'symlink';
  if (entry.isDirectory()) return 'directory';
  if (entry.isFile()) return 'file';
  return 'other';
}

async function mapPool<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item === undefined) continue;
      results[index] = await run(item);
    }
  });
  await Promise.all(workers);
  return results;
}

function nodeCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
}

async function absentTarget(target: string): Promise<void> {
  try {
    await stat(target);
  } catch (error) {
    if (nodeCode(error) === 'ENOENT') return;
    throw error;
  }
  throw new Error(`Уже существует: ${path.basename(target)}`);
}

function containedBy(parent: string, child: string): boolean {
  const base = path.resolve(parent);
  const target = path.resolve(child);
  const relative = path.relative(base, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export async function listDirectory(input: unknown, showHidden: boolean, showSystem = false): Promise<DirectoryPage> {
  if (typeof input === 'string') {
    const special = await platform().specialList(input, showHidden);
    if (special) {
      const entries = special.entries.filter((entry) => includeListed(entry.hidden, entry.system, showHidden, showSystem));
      return withNavigation({ ...special, entries });
    }
  }
  const directory = absolutePath(input);
  const info = await lstat(directory);
  if (!info.isDirectory() && !info.isSymbolicLink()) throw new Error('Это не каталог');
  const adapter = platform();
  const [children, hidden, system] = await Promise.all([
    readdir(directory, { withFileTypes: true }),
    adapter.hiddenNames(directory),
    adapter.systemNames(directory),
  ]);
  const entries = await mapPool(children, STAT_CONCURRENCY, async (child): Promise<FileEntry | null> => {
    const hiddenEntry = adapter.isHiddenName(child.name) || hidden.has(child.name);
    const systemEntry = system.has(child.name);
    if (!includeListed(hiddenEntry, systemEntry, showHidden, showSystem)) return null;
    const full = path.join(directory, child.name);
    try {
      const item = await lstat(full);
      return {
        name: child.name,
        path: full,
        kind: kindOf(child.isSymbolicLink() ? item : child),
        size: item.isDirectory() ? null : item.size,
        modified: item.mtimeMs,
        hidden: hiddenEntry,
        system: systemEntry,
      };
    } catch {
      return {
        name: child.name,
        path: full,
        kind: kindOf(child),
        size: null,
        modified: null,
        hidden: hiddenEntry,
        system: systemEntry,
      };
    }
  });
  return withNavigation({
    path: directory,
    parent: parentPath(directory),
    separator: separatorOf(directory),
    entries: sortEntries(entries.filter((entry): entry is FileEntry => entry !== null)),
  });
}

function withNavigation(page: DirectoryPage): DirectoryPage {
  const up: FileEntry = {
    name: '..',
    path: page.parent ?? page.path,
    kind: 'directory',
    size: null,
    modified: null,
    hidden: false,
    system: false,
  };
  const rest = page.entries.filter((entry) => entry.name !== '.' && entry.name !== '..');
  return { ...page, entries: [up, ...rest] };
}

export async function locations(): Promise<LocationIndex> {
  const adapter = platform();
  const [places, roots] = await Promise.all([locationPlaces(adapter), adapter.roots()]);
  return { places, roots, computer: adapter.id === 'windows' ? 'Этот компьютер' : 'Диски' };
}

export async function createDirectory(parentInput: unknown, nameInput: unknown): Promise<string> {
  const parent = absolutePath(parentInput);
  const name = singleSegment(String(nameInput ?? ''));
  const target = path.join(parent, name);
  await mkdir(target);
  return target;
}

export async function renamePath(targetInput: unknown, nameInput: unknown): Promise<string> {
  const target = absolutePath(targetInput);
  const name = singleSegment(String(nameInput ?? ''));
  const next = path.join(path.dirname(target), name);
  if (next === target) return target;
  await rename(target, next);
  return next;
}

export async function removePaths(inputs: unknown): Promise<void> {
  if (!Array.isArray(inputs) || inputs.length === 0) throw new Error('Нечего удалять');
  for (const input of inputs) {
    await rm(absolutePath(input), { recursive: true, force: false });
  }
}

async function transfer(inputs: unknown, destinationInput: unknown, mode: 'copy' | 'move'): Promise<void> {
  if (!Array.isArray(inputs) || inputs.length === 0) throw new Error('Ничего не выбрано');
  const destination = absolutePath(destinationInput);
  const destinationStat = await stat(destination);
  if (!destinationStat.isDirectory()) throw new Error('Назначение должно быть каталогом');
  for (const input of inputs) {
    const source = absolutePath(input);
    if (containedBy(source, destination)) throw new Error('Нельзя перенести каталог внутрь самого себя');
    const target = path.join(destination, path.basename(source));
    if (path.resolve(source) === path.resolve(target)) throw new Error('Источник и назначение совпадают');
    await absentTarget(target);
    if (mode === 'copy') {
      await cp(source, target, { recursive: true, errorOnExist: true, force: false });
      continue;
    }
    try {
      await rename(source, target);
    } catch (error) {
      if (nodeCode(error) !== 'EXDEV') throw error;
      await cp(source, target, { recursive: true, errorOnExist: true, force: false });
      await rm(source, { recursive: true, force: false });
    }
  }
}

export function copyPaths(inputs: unknown, destination: unknown): Promise<void> {
  return transfer(inputs, destination, 'copy');
}

export function movePaths(inputs: unknown, destination: unknown): Promise<void> {
  return transfer(inputs, destination, 'move');
}
