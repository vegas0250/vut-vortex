import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { isNetworkRoot, type DirectoryPage, type Place } from '../../shared/files';
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
    label: name,
    path: `\\\\wsl.localhost\\${name}`,
    group: 'linux',
  }));
}

export interface QuickAccessRow {
  pinned: boolean;
  name: string;
  path: string;
  display: string;
}

export function parseQuickAccess(stdout: string): QuickAccessRow[] {
  const rows: QuickAccessRow[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const [flag, name, rawPath, rawDisplay = ''] = line.split('\t');
    if ((flag !== '0' && flag !== '1') || !name?.trim() || (!rawPath?.trim() && !rawDisplay.trim())) continue;
    rows.push({
      pinned: flag === '1',
      name: name.trim(),
      path: rawPath?.trim() ?? '',
      display: rawDisplay.trim(),
    });
  }
  return rows;
}

export function filesystemPath(value: string): string | null {
  const trimmed = value.trim().replace(/^\\\\\?\\/, '');
  if (/^[A-Za-z]:\\/.test(trimmed) || trimmed.startsWith('\\\\')) return trimmed;
  const drive = trimmed.match(/\(([A-Za-z]:)\\?\)/);
  if (drive?.[1]) return `${drive[1]}\\`;
  return null;
}

function cloudName(name: string): boolean {
  return /yandex|яндекс/iu.test(name);
}

export function placesFromQuickAccess(rows: readonly QuickAccessRow[]): Place[] {
  const picked = rows.filter((row) => row.pinned || cloudName(row.name));
  const places: Place[] = [];
  for (const row of picked) {
    const folder = filesystemPath(row.path) ?? filesystemPath(row.display);
    if (!folder || places.some((item) => samePath(item.path, folder))) continue;
    const yandex = cloudName(row.name);
    places.push({
      id: yandex ? 'yandex' : `pin:${folder}`,
      label: row.name,
      path: folder,
    });
  }
  return places;
}

function samePath(left: string, right: string): boolean {
  return left.replace(/[\\/]+$/, '').toLowerCase() === right.replace(/[\\/]+$/, '').toLowerCase();
}

const quickAccessScript = [
  '$OutputEncoding = [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false',
  '$shell = New-Object -ComObject Shell.Application',
  "$folder = $shell.NameSpace('shell:::{679f85cb-0220-4080-b29b-5540cc05aab6}')",
  'if ($null -eq $folder) { exit 0 }',
  'foreach ($item in @($folder.Items())) {',
  "  $raw = $item.ExtendedProperty('System.Home.IsPinned')",
  "  $flag = '0'",
  '  if ($raw -eq $true -or $raw -eq -1) { $flag = \'1\' }',
  "  $display = $item.ExtendedProperty('System.ItemPathDisplay')",
  '  $path = ([string]$item.Path) -replace "[`r`n`t]", " "',
  '  if ($display) { $display = ([string]$display) -replace "[`r`n`t]", " " } else { $display = "" }',
  '  $name = ([string]$item.Name) -replace "[`r`n`t]", " "',
  '  Write-Output ($flag + [char]9 + $name + [char]9 + $path + [char]9 + $display)',
  '}',
].join('\n');

async function quickAccessPlaces(): Promise<Place[]> {
  try {
    const encoded = Buffer.from(quickAccessScript, 'utf16le').toString('base64');
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, timeout: 8000, encoding: 'utf8' },
    );
    const places: Place[] = [];
    for (const place of placesFromQuickAccess(parseQuickAccess(stdout))) {
      if (!/^[A-Za-z]:\\/.test(place.path) || (await readable(place.path))) places.push(place);
    }
    return places;
  } catch {
    return [];
  }
}

async function yandexFolder(home: string): Promise<Place | null> {
  for (const folder of [path.join(home, 'YandexDisk'), path.join(home, 'Yandex.Disk')]) {
    if (await readable(folder)) return { id: 'yandex', label: 'Яндекс.Диск', path: folder };
  }
  return null;
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
    if (!isNetworkRoot(target)) return Promise.resolve(null);
    return execFileAsync('net.exe', ['view'], { windowsHide: true, timeout: 20000 })
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
    const [stored, pinned, distros] = await Promise.all([
      registryValues(['HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders']),
      quickAccessPlaces(),
      wslPlaces(),
    ]);
    const links: Place[] = [{ id: 'home', label: 'Домой', path: home }];
    for (const [key, id, label] of shellFolders) {
      const raw = stored.get(key);
      const folder = raw ? expandEnv(raw) : path.join(home, defaultFolder(id));
      if (folder && folder !== home && (await readable(folder))) links.push({ id, label, path: folder });
    }
    for (const place of pinned) {
      if (!links.some((item) => samePath(item.path, place.path))) links.push(place);
    }
    if (!links.some((item) => item.id === 'yandex' || cloudName(item.label))) {
      const yandex = await yandexFolder(home);
      if (yandex && !links.some((item) => samePath(item.path, yandex.path))) links.push(yandex);
    }
    links.push({ id: 'network', label: 'Сеть', path: '\\\\' });
    links.push(...distros);
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
