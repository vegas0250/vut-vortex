import { existsSync, readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import type { Place } from '../../shared/files';
import type { KnownPlaces, PlatformAdapter } from './types';

function existing(candidate: string): string | null {
  try {
    return existsSync(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

function expandHome(value: string, home: string): string {
  return value.replace(/^\$HOME\b/, home).replace(/^~(?=$|\/)/, home);
}

function userDirs(home: string): Map<string, string> {
  const file = path.join(home, '.config', 'user-dirs.dirs');
  const found = new Map<string, string>();
  if (!existsSync(file)) return found;
  let text = '';
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return found;
  }
  for (const line of text.split('\n')) {
    const match = line.match(/^(XDG_[A-Z_]+_DIR)="(.+)"/);
    const key = match?.[1];
    const raw = match?.[2];
    if (!key || !raw) continue;
    found.set(key, expandHome(raw, home));
  }
  return found;
}

function place(id: string, label: string, target: string | null): Place | null {
  if (!target) return null;
  return { id, label, path: target };
}

export const posixPlatform: PlatformAdapter = {
  id: 'linux',
  isHiddenName(name: string): boolean {
    return name.startsWith('.');
  },
  hiddenNames(): Promise<ReadonlySet<string>> {
    return Promise.resolve(new Set());
  },
  roots(): Promise<Place[]> {
    return Promise.resolve([{ id: 'root', label: 'Корень', path: '/' }]);
  },
  places(): KnownPlaces {
    const home = homedir();
    const dirs = userDirs(home);
    return {
      home,
      desktop: existing(dirs.get('XDG_DESKTOP_DIR') ?? path.join(home, 'Desktop')),
      documents: existing(dirs.get('XDG_DOCUMENTS_DIR') ?? path.join(home, 'Documents')),
      downloads: existing(dirs.get('XDG_DOWNLOAD_DIR') ?? path.join(home, 'Downloads')),
      temporary: tmpdir(),
    };
  },
};

export function linuxPlaces(adapter: PlatformAdapter = posixPlatform): Place[] {
  const known = adapter.places();
  return [
    place('home', 'Домой', known.home),
    place('desktop', 'Рабочий стол', known.desktop),
    place('documents', 'Документы', known.documents),
    place('downloads', 'Загрузки', known.downloads),
    place('temporary', 'Временные', known.temporary),
  ].filter((item): item is Place => item !== null);
}
