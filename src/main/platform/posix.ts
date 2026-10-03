import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { DirectoryPage, Place } from '../../shared/files';
import type { PlatformAdapter } from './types';

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

const namedDirs: Array<[string, string, string]> = [
  ['XDG_DESKTOP_DIR', 'desktop', 'Рабочий стол'],
  ['XDG_DOCUMENTS_DIR', 'documents', 'Документы'],
  ['XDG_DOWNLOAD_DIR', 'downloads', 'Загрузки'],
  ['XDG_PICTURES_DIR', 'pictures', 'Изображения'],
  ['XDG_MUSIC_DIR', 'music', 'Музыка'],
  ['XDG_VIDEOS_DIR', 'videos', 'Видео'],
  ['XDG_PUBLICSHARE_DIR', 'public', 'Общие'],
];

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
  specialList(): Promise<DirectoryPage | null> {
    return Promise.resolve(null);
  },
  async quickLinks(): Promise<Place[]> {
    const home = homedir();
    const dirs = userDirs(home);
    const fallback: Record<string, string> = {
      XDG_DESKTOP_DIR: path.join(home, 'Desktop'),
      XDG_DOCUMENTS_DIR: path.join(home, 'Documents'),
      XDG_DOWNLOAD_DIR: path.join(home, 'Downloads'),
      XDG_PICTURES_DIR: path.join(home, 'Pictures'),
      XDG_MUSIC_DIR: path.join(home, 'Music'),
      XDG_VIDEOS_DIR: path.join(home, 'Videos'),
      XDG_PUBLICSHARE_DIR: path.join(home, 'Public'),
    };
    const links: Place[] = [place('home', 'Домой', home)].filter((item): item is Place => item !== null);
    for (const [key, id, label] of namedDirs) {
      const found = place(id, label, existing(dirs.get(key) ?? fallback[key] ?? null));
      if (found && found.path !== home) links.push(found);
    }
    const uid = typeof process.getuid === 'function' ? process.getuid() : null;
    const network = uid === null ? null : existing(path.join('/run/user', String(uid), 'gvfs'));
    const share = place('network', 'Сеть', network);
    if (share) links.push(share);
    return links;
  },
};
