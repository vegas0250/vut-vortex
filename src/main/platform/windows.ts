import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { DirectoryPage, Place } from '../../shared/files';
import type { PlatformAdapter } from './types';

const execFileAsync = promisify(execFile);

async function readable(target: string): Promise<boolean> {
  try {
    await access(target, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function hiddenListing(directory: string, attributes: string): Promise<string[]> {
  const { stdout } = await execFileAsync('cmd.exe', ['/d', '/c', 'dir', attributes, '/b', directory], {
    windowsHide: true,
    timeout: 8000,
  });
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

const shellFolders: Array<[string, string, string]> = [
  ['Desktop', 'desktop', 'Рабочий стол'],
  ['Personal', 'documents', 'Документы'],
  ['{374DE290-123F-4565-9164-39C4925E467B}', 'downloads', 'Загрузки'],
  ['My Pictures', 'pictures', 'Изображения'],
  ['My Music', 'music', 'Музыка'],
  ['My Video', 'videos', 'Видео'],
];

export function expandEnv(value: string, env: NodeJS.ProcessEnv = process.env): string {
  return value.replace(/%([^%]+)%/g, (token, name: string) => env[name] ?? token);
}

export function parseRegistryValues(stdout: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const line of stdout.split(/\r?\n/)) {
    const match = line.match(/^\s+(.+?)\s+REG_\w+\s+(.+)$/);
    const name = match?.[1]?.trim();
    const value = match?.[2]?.trim();
    if (name && value) found.set(name, value);
  }
  return found;
}

export function parseNetView(stdout: string): string[] {
  const names: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const match = line.match(/^\\\\(\S+)/);
    if (match?.[1]) names.push(match[1]);
  }
  return names;
}

async function registryValues(args: string[]): Promise<Map<string, string>> {
  try {
    const { stdout } = await execFileAsync('reg.exe', ['query', ...args], { windowsHide: true, timeout: 8000 });
    return parseRegistryValues(stdout);
  } catch {
    return new Map();
  }
}

async function wslPlaces(): Promise<Place[]> {
  const nested = await registryValues(['HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss', '/s']);
  const names = new Set<string>();
  for (const [key, value] of nested) if (key === 'DistributionName') names.add(value);
  return [...names].sort((left, right) => left.localeCompare(right)).map((name) => ({
    id: `wsl:${name}`,
    label: `WSL ${name}`,
    path: `\\\\wsl.localhost\\${name}`,
  }));
}

export const windowsPlatform: PlatformAdapter = {
  id: 'windows',
  isHiddenName(name: string): boolean {
    return name.startsWith('.');
  },
  async hiddenNames(directory: string): Promise<ReadonlySet<string>> {
    try {
      const files = await hiddenListing(directory, '/a:h-d');
      const directories = await hiddenListing(directory, '/a:hd');
      return new Set([...files, ...directories]);
    } catch {
      return new Set();
    }
  },
  async roots(): Promise<Place[]> {
    const found: Place[] = [];
    for (let code = 65; code <= 90; code += 1) {
      const root = `${String.fromCharCode(code)}:\\`;
      if (await readable(root)) found.push({ id: root, label: root, path: root });
    }
    return found;
  },
  specialList(target: string): Promise<DirectoryPage | null> {
    const root = target.replace(/[\\/]+$/, '');
    if (root !== '\\\\' && target !== '\\\\' && target !== '\\') return Promise.resolve(null);
    return execFileAsync('net.exe', ['view'], { windowsHide: true, timeout: 8000 })
      .then(({ stdout }) => {
        const entries = parseNetView(stdout).map((name) => ({
          name,
          path: `\\\\${name}`,
          kind: 'directory' as const,
          size: null,
          modified: null,
          hidden: false,
        }));
        return { path: '\\\\', parent: null, separator: '\\' as const, entries };
      })
      .catch(() => ({ path: '\\\\', parent: null, separator: '\\' as const, entries: [] }));
  },
  async quickLinks(): Promise<Place[]> {
    const home = process.env.USERPROFILE || homedir();
    const stored = await registryValues(['HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders']);
    const links: Place[] = [{ id: 'home', label: 'Домой', path: home }];
    for (const [key, id, label] of shellFolders) {
      const raw = stored.get(key);
      const folder = raw ? expandEnv(raw) : path.join(home, defaultFolder(id));
      if (folder && folder !== home && (await readable(folder))) links.push({ id, label, path: folder });
    }
    links.push({ id: 'network', label: 'Сеть', path: '\\\\' });
    links.push(...(await wslPlaces()));
    return links;
  },
};

function defaultFolder(id: string): string {
  if (id === 'desktop') return 'Desktop';
  if (id === 'documents') return 'Documents';
  if (id === 'downloads') return 'Downloads';
  if (id === 'pictures') return 'Pictures';
  if (id === 'music') return 'Music';
  if (id === 'videos') return 'Videos';
  return '';
}
